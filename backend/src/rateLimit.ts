// Per-client rate limit of the public API (#161, since API 1.21.0), used by httpServe.ts for /v1 and GraphQL.
//
// Token buckets in memory, two per client: one for light requests and a stricter one for heavy ones (the same split as
// the pool's priority: searches, sweeps, rankings, terrain, expensive GraphQL…). A bucket holds up to `burst` tokens and
// refills at `perMin` tokens per minute; each counted request takes one. Only requests that compute count: a response
// from the result cache costs nothing, nor do health, the spec, /docs, GraphiQL or a preflight.
//
// The client is its IP address: the one of the connection or, behind trusted proxies (LUNAR_TRUST_PROXY = how many
// append themselves to X-Forwarded-For), the entry that the nearest trusted proxy wrote, counted from the right. A client
// can only add entries to the left of that one, so it cannot choose its key. IPv6 clients are grouped by their /64 (one
// machine usually owns a whole /64). Optional keys (LUNAR_API_KEYS, header X-Api-Key) skip the limit.
//
// Off by default. The memory is bounded (LUNAR_RATE_MAX_CLIENTS buckets, the least recently seen go first) and per
// instance: with N instances that do not share memory, a client gets up to N times the limit.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

export type RateClass = 'light' | 'heavy';

export interface RateLimitConfig {
  /** Tokens per minute of each class (0: that class is not limited). */
  lightPerMin: number;
  heavyPerMin: number;
  /** Capacity of each bucket: the requests a client can make in a row after a pause. */
  lightBurst: number;
  heavyBurst: number;
  /** Trusted proxies that append themselves to X-Forwarded-For (0: the address of the connection). */
  trustProxy: number;
  /** Keys that skip the limit (X-Api-Key). */
  keys: string[];
  /** Clients kept in memory; beyond that, the least recently seen are forgotten. */
  maxClients: number;
}

/** Defaults when the limit is on (LUNAR_RATE_LIMIT=1): a person using the planner never reaches them. */
export const RATE_DEFAULTS = { lightPerMin: 300, heavyPerMin: 60, maxClients: 10000 } as const;

const int = (env: Record<string, string | undefined>, name: string, fallback: number, min = 0): number => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} debe ser un entero mayor o igual que ${min} (vale «${raw}»)`);
  return n;
};

/** The configuration of the environment, or null when the limit is off (LUNAR_RATE_LIMIT unset or 0). */
export function rateLimitConfig(env: Record<string, string | undefined> = process.env): RateLimitConfig | null {
  const on = env.LUNAR_RATE_LIMIT ?? '';
  if (on !== '' && on !== '0' && on !== '1') throw new Error(`LUNAR_RATE_LIMIT debe valer 0 o 1 (vale «${on}»)`);
  if (on !== '1') return null;
  const lightPerMin = int(env, 'LUNAR_RATE_LIGHT_PER_MIN', RATE_DEFAULTS.lightPerMin);
  const heavyPerMin = int(env, 'LUNAR_RATE_HEAVY_PER_MIN', RATE_DEFAULTS.heavyPerMin);
  return {
    lightPerMin,
    heavyPerMin,
    lightBurst: int(env, 'LUNAR_RATE_LIGHT_BURST', 2 * lightPerMin, 1),
    heavyBurst: int(env, 'LUNAR_RATE_HEAVY_BURST', 2 * heavyPerMin, 1),
    trustProxy: int(env, 'LUNAR_TRUST_PROXY', 0),
    keys: (env.LUNAR_API_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean),
    maxClients: int(env, 'LUNAR_RATE_MAX_CLIENTS', RATE_DEFAULTS.maxClients, 1),
  };
}

/** A request over the limit: what the 429 says, and its headers (Retry-After and RateLimit-*). */
export interface RateRejection { status: 429; code: 'rate_limited'; message: string; retryAfterS: number }

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** An address as a key: without port or brackets, IPv4-mapped IPv6 as IPv4, IPv6 reduced to its /64. */
export function addressKey(raw: string): string {
  let a = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(a);
  if (bracketed) a = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(a)) a = a.slice(0, a.lastIndexOf(':'));
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(a);
  if (mapped) a = mapped[1];
  if (isIP(a) !== 6) return a.slice(0, 64);
  const [head, tail = ''] = a.toLowerCase().split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = a.includes('::') && tail ? tail.split(':') : [];
  // An embedded IPv4 at the end (::1.2.3.4) is in the last 64 bits: it does not change the /64.
  const groups = a.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * Address of the client of a request. With `trustProxy` = n > 0, the n-th entry of X-Forwarded-For counted from the
 * right (each trusted proxy appends the address it saw); with fewer entries, the address of the connection.
 */
export function clientAddress(req: Pick<IncomingMessage, 'headers' | 'socket'>, trustProxy: number): string {
  if (trustProxy > 0) {
    const header = req.headers?.['x-forwarded-for'];
    const entries = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    if (entries.length >= trustProxy) return addressKey(entries[entries.length - trustProxy]);
  }
  return addressKey(req.socket?.remoteAddress ?? 'unknown');
}

const EPS = 1e-9;

interface Buckets { light: number; heavy: number; at: number }

/** What a request has been charged: nothing yet, a class, or a rejection. */
export interface Meter {
  /** Takes a token of `cls` for this request (once: later calls return the first result). null = allowed. */
  charge(cls: RateClass): RateRejection | null;
  /** RateLimit-* headers (and Retry-After on a rejection) of what has been charged; empty if nothing. */
  headers(): Record<string, string>;
}

/** Meter of a request that is not counted (limit off, or a valid key): nothing charged, no header added. */
export const UNMETERED: Meter = { charge: () => null, headers: () => ({}) };

export class RateLimiter {
  readonly config: RateLimitConfig;
  private readonly now: () => number;
  private readonly keys: Set<string>;
  private readonly clients = new Map<string, Buckets>();
  private counters = { allowed: 0, rejected: 0, bypassed: 0, forgotten: 0 };

  constructor(config: RateLimitConfig, now: () => number = () => performance.now()) {
    this.config = config;
    this.now = now;
    // Kept hashed: a lookup only reveals hashes, never a key.
    this.keys = new Set(config.keys.map(sha256));
  }

  private rate(cls: RateClass): { perMin: number; burst: number } {
    return cls === 'heavy' ? { perMin: this.config.heavyPerMin, burst: this.config.heavyBurst } : { perMin: this.config.lightPerMin, burst: this.config.lightBurst };
  }

  /** Buckets of a client refilled up to now; it becomes the most recently seen. */
  private buckets(client: string): Buckets {
    const t = this.now();
    let b = this.clients.get(client);
    if (b) {
      this.clients.delete(client);
      const minutes = (t - b.at) / 60000;
      b.light = Math.min(this.config.lightBurst, b.light + minutes * this.config.lightPerMin);
      b.heavy = Math.min(this.config.heavyBurst, b.heavy + minutes * this.config.heavyPerMin);
      b.at = t;
    } else {
      b = { light: this.config.lightBurst, heavy: this.config.heavyBurst, at: t };
      // Full: the least recently seen goes. Forgetting a client gives it full buckets, as if it had waited.
      while (this.clients.size >= this.config.maxClients) {
        this.clients.delete(this.clients.keys().next().value!);
        this.counters.forgotten++;
      }
    }
    this.clients.set(client, b);
    return b;
  }

  /** Takes a token of `cls` from `client`. */
  take(client: string, cls: RateClass): { rejection: RateRejection | null; headers: Record<string, string> } {
    const { perMin, burst } = this.rate(cls);
    if (perMin <= 0) return { rejection: null, headers: {} };
    const b = this.buckets(client);
    // EPS absorbs the rounding of the refill (0.9 + 0.1 tokens is 0.9999999999999999 in floating point).
    const ok = b[cls] >= 1 - EPS;
    if (ok) b[cls] = Math.max(0, b[cls] - 1);
    const tokens = b[cls];
    const secondsFor = (n: number): number => Math.max(0, Math.ceil((n * 60) / perMin - EPS));
    const headers: Record<string, string> = {
      'ratelimit-limit': String(burst),
      'ratelimit-remaining': String(Math.floor(tokens + EPS)),
      'ratelimit-reset': String(secondsFor(burst - tokens)),
      'ratelimit-policy': `${burst};w=${secondsFor(burst)};name="${cls}"`,
    };
    if (ok) { this.counters.allowed++; return { rejection: null, headers }; }
    this.counters.rejected++;
    const retryAfterS = Math.max(1, secondsFor(1 - tokens));
    const kind = cls === 'heavy' ? 'pesadas' : 'ligeras';
    return {
      rejection: { status: 429, code: 'rate_limited', retryAfterS, message: `Has superado el límite de peticiones ${kind} (${perMin} por minuto, hasta ${burst} seguidas). Vuelve a intentarlo dentro de ${retryAfterS} s.` },
      headers: { ...headers, 'retry-after': String(retryAfterS) },
    };
  }

  /** The meter of a request: free with a valid X-Api-Key, otherwise charged to the client's address. */
  meter(req: Pick<IncomingMessage, 'headers' | 'socket'>): Meter {
    const key = req.headers?.['x-api-key'];
    if (typeof key === 'string' && key !== '' && this.keys.has(sha256(key))) { this.counters.bypassed++; return UNMETERED; }
    const client = clientAddress(req, this.config.trustProxy);
    let charged: { rejection: RateRejection | null; headers: Record<string, string> } | null = null;
    return {
      charge: (cls) => (charged ??= this.take(client, cls)).rejection,
      headers: () => charged?.headers ?? {},
    };
  }

  status(): { clients: number; maxClients: number; allowed: number; rejected: number; bypassed: number; forgotten: number } {
    return { clients: this.clients.size, maxClients: this.config.maxClients, ...this.counters };
  }
}

/** CORS of a server with the limit on: X-Api-Key allowed, Retry-After and RateLimit-* readable from the browser. */
export function rateLimitCors(cors: Record<string, string>): Record<string, string> {
  const add = (value: string | undefined, extra: string[]): string =>
    [...new Set([...(value ? value.split(',').map((s) => s.trim().toLowerCase()) : []), ...extra])].join(', ');
  return {
    ...cors,
    'access-control-allow-headers': add(cors['access-control-allow-headers'], ['x-api-key']),
    'access-control-expose-headers': add(cors['access-control-expose-headers'], ['retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'ratelimit-policy']),
  };
}
