// Rate limit per client (#161): token buckets with a fake clock, the client's address behind trusted proxies (and that a
// client cannot choose it), keys that skip the limit, bounded memory and the configuration of the environment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { RateLimiter, UNMETERED, addressKey, clientAddress, rateLimitConfig, rateLimitCors } from '../src/rateLimit.ts';
import type { RateLimitConfig } from '../src/rateLimit.ts';
import { serveConfig } from '../src/httpServe.ts';

const CONFIG: RateLimitConfig = { lightPerMin: 60, heavyPerMin: 6, lightBurst: 10, heavyBurst: 3, trustProxy: 0, keys: [], maxClients: 100 };
const clock = () => { let t = 0; return { now: () => t, advance: (ms: number) => { t += ms; } }; };
const req = (remoteAddress: string, headers: Record<string, string> = {}) => ({ socket: { remoteAddress }, headers } as unknown as IncomingMessage);

test('el cubo admite su ráfaga, rechaza la siguiente con Retry-After y se recupera con el tiempo', () => {
  const c = clock();
  const limiter = new RateLimiter(CONFIG, c.now);
  for (let i = 0; i < 3; i++) assert.equal(limiter.take('a', 'heavy').rejection, null);
  const over = limiter.take('a', 'heavy');
  assert.equal(over.rejection?.status, 429);
  assert.equal(over.rejection?.code, 'rate_limited');
  assert.equal(over.rejection?.retryAfterS, 10); // 6 per minute: one token every 10 s
  assert.match(over.rejection!.message, /pesadas \(6 por minuto, hasta 3 seguidas\).*10 s/);
  assert.equal(over.headers['retry-after'], '10');
  assert.equal(over.headers['ratelimit-remaining'], '0');
  c.advance(9_000);
  assert.equal(limiter.take('a', 'heavy').rejection?.retryAfterS, 1, 'casi una ficha: falta 1 s');
  c.advance(1_000);
  assert.equal(limiter.take('a', 'heavy').rejection, null, 'a los 10 s, una ficha');
  assert.notEqual(limiter.take('a', 'heavy').rejection, null);
  c.advance(3_600_000);
  for (let i = 0; i < 3; i++) assert.equal(limiter.take('a', 'heavy').rejection, null, 'tras una hora, la ráfaga entera y no más');
  assert.notEqual(limiter.take('a', 'heavy').rejection, null);
});

test('cabeceras RateLimit-*: tamaño del cubo, lo que queda, segundos hasta llenarse y la política', () => {
  const limiter = new RateLimiter(CONFIG, clock().now);
  assert.deepEqual(limiter.take('a', 'heavy').headers, {
    'ratelimit-limit': '3', 'ratelimit-remaining': '2', 'ratelimit-reset': '10', 'ratelimit-policy': '3;w=30;name="heavy"',
  });
  assert.equal(limiter.take('a', 'light').headers['ratelimit-policy'], '10;w=10;name="light"');
});

test('ligeras y pesadas tienen cubos distintos, y cada cliente los suyos', () => {
  const limiter = new RateLimiter(CONFIG, clock().now);
  for (let i = 0; i < 3; i++) limiter.take('a', 'heavy');
  assert.notEqual(limiter.take('a', 'heavy').rejection, null);
  for (let i = 0; i < 10; i++) assert.equal(limiter.take('a', 'light').rejection, null, 'sin pesadas, las ligeras siguen');
  assert.notEqual(limiter.take('a', 'light').rejection, null);
  assert.equal(limiter.take('b', 'heavy').rejection, null, 'otro cliente no se entera');
});

test('una clase con 0 por minuto no se limita ni lleva cabeceras', () => {
  const limiter = new RateLimiter({ ...CONFIG, lightPerMin: 0 }, clock().now);
  for (let i = 0; i < 1000; i++) assert.equal(limiter.take('a', 'light').rejection, null);
  assert.deepEqual(limiter.take('a', 'light').headers, {});
});

test('memoria acotada: al llegar a maxClients se olvida el visto hace más tiempo', () => {
  const limiter = new RateLimiter({ ...CONFIG, maxClients: 2 }, clock().now);
  for (let i = 0; i < 3; i++) limiter.take('a', 'heavy');
  limiter.take('b', 'heavy');
  limiter.take('a', 'light'); // a, the most recent
  limiter.take('c', 'heavy'); // b goes
  assert.equal(limiter.status().clients, 2);
  assert.equal(limiter.status().forgotten, 1);
  assert.notEqual(limiter.take('a', 'heavy').rejection, null, 'a sigue recordado (y sin fichas pesadas)');
  limiter.take('d', 'heavy'); // c goes
  limiter.take('e', 'heavy'); // a goes: it comes back with full buckets
  assert.equal(limiter.take('a', 'heavy').rejection, null);
});

test('el contador: una petición se cobra una vez; con una clave válida no se cobra ni lleva cabeceras', () => {
  const limiter = new RateLimiter({ ...CONFIG, keys: ['clave-equipo', 'otra'] }, clock().now);
  const m = limiter.meter(req('10.0.0.1'));
  assert.deepEqual(m.headers(), {}, 'nada cobrado, nada que decir');
  assert.equal(m.charge('heavy'), null);
  assert.equal(m.charge('heavy'), null);
  assert.equal(m.headers()['ratelimit-remaining'], '2', 'el segundo cargo no gasta');
  for (let i = 0; i < 5; i++) assert.equal(limiter.meter(req('10.0.0.2', { 'x-api-key': 'otra' })).charge('heavy'), null);
  assert.equal(limiter.meter(req('10.0.0.2', { 'x-api-key': 'clave-equipo' })), UNMETERED);
  assert.notEqual(limiter.meter(req('10.0.0.2', { 'x-api-key': 'mala' })), UNMETERED, 'una clave que no está cuenta como cualquiera');
  assert.equal(limiter.status().bypassed, 6);
});

test('dirección del cliente: sin proxy de confianza, la de la conexión aunque mande X-Forwarded-For', () => {
  assert.equal(clientAddress(req('203.0.113.7', { 'x-forwarded-for': '1.2.3.4' }), 0), '203.0.113.7');
  const limiter = new RateLimiter(CONFIG, clock().now);
  for (let i = 0; i < 3; i++) limiter.meter(req('203.0.113.7', { 'x-forwarded-for': `198.51.100.${i}` })).charge('heavy');
  assert.notEqual(limiter.meter(req('203.0.113.7', { 'x-forwarded-for': '198.51.100.99' })).charge('heavy'), null, 'cambiar la cabecera no da otro cupo');
});

test('detrás de n proxies de confianza, la entrada n-ésima por la derecha: lo que añade el cliente no cuenta', () => {
  // The proxy appends what it sees; whatever the client sent stays to its left.
  const cloudRun = (sent: string | null) => req('169.254.1.1', { 'x-forwarded-for': sent ? `${sent}, 203.0.113.7` : '203.0.113.7' });
  assert.equal(clientAddress(cloudRun(null), 1), '203.0.113.7');
  assert.equal(clientAddress(cloudRun('1.2.3.4'), 1), '203.0.113.7');
  assert.equal(clientAddress(cloudRun('1.2.3.4, 5.6.7.8'), 1), '203.0.113.7');
  // A Google HTTPS load balancer in front also appends its own address: two trusted proxies.
  assert.equal(clientAddress(req('10.0.0.1', { 'x-forwarded-for': '1.2.3.4, 203.0.113.7, 34.1.2.3' }), 2), '203.0.113.7');
  // Fewer entries than trusted proxies (misconfiguration): the address of the connection, never a client's entry.
  assert.equal(clientAddress(req('10.0.0.1', { 'x-forwarded-for': '1.2.3.4' }), 2), '10.0.0.1');
  assert.equal(clientAddress(req('10.0.0.1'), 1), '10.0.0.1');
  // A repeated header (several lines) is one list.
  assert.equal(clientAddress({ socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': ['1.2.3.4', '203.0.113.7'] } } as unknown as IncomingMessage, 1), '203.0.113.7');

  const limiter = new RateLimiter({ ...CONFIG, trustProxy: 1 }, clock().now);
  for (let i = 0; i < 3; i++) assert.equal(limiter.meter(cloudRun(`198.51.100.${i}`)).charge('heavy'), null);
  assert.notEqual(limiter.meter(cloudRun('198.51.100.99')).charge('heavy'), null, 'falsear la cabecera no da otro cupo');
  assert.equal(limiter.meter(req('169.254.1.1', { 'x-forwarded-for': '203.0.113.8' })).charge('heavy'), null, 'otra IP real, otro cupo');
});

test('claves de dirección: sin puerto, IPv4 mapeada como IPv4 e IPv6 agrupada por /64', () => {
  assert.equal(addressKey('203.0.113.7:51234'), '203.0.113.7');
  assert.equal(addressKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(addressKey('[2001:db8:0:1::5]:443'), '2001:db8:0:1::/64');
  assert.equal(addressKey('2001:db8:0:1:aaaa:bbbb:cccc:dddd'), '2001:db8:0:1::/64');
  assert.equal(addressKey('2001:0db8:0000:0001::9'), '2001:db8:0:1::/64');
  assert.equal(addressKey('::1'), '0:0:0:0::/64');
  assert.equal(addressKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(addressKey('no-es-una-ip'), 'no-es-una-ip');
});

test('configuración: apagado por defecto; con LUNAR_RATE_LIMIT=1, los valores por defecto y los de las variables', () => {
  assert.equal(rateLimitConfig({}), null);
  assert.equal(rateLimitConfig({ LUNAR_RATE_LIMIT: '0', LUNAR_RATE_HEAVY_PER_MIN: '5' }), null);
  assert.equal(serveConfig({}).rateLimit, null);
  assert.deepEqual(rateLimitConfig({ LUNAR_RATE_LIMIT: '1' }), { lightPerMin: 300, heavyPerMin: 60, lightBurst: 600, heavyBurst: 120, trustProxy: 0, keys: [], maxClients: 10000 });
  assert.deepEqual(rateLimitConfig({
    LUNAR_RATE_LIMIT: '1', LUNAR_RATE_LIGHT_PER_MIN: '100', LUNAR_RATE_HEAVY_PER_MIN: '10', LUNAR_RATE_HEAVY_BURST: '15',
    LUNAR_TRUST_PROXY: '1', LUNAR_API_KEYS: ' a, b ,,', LUNAR_RATE_MAX_CLIENTS: '50',
  }), { lightPerMin: 100, heavyPerMin: 10, lightBurst: 200, heavyBurst: 15, trustProxy: 1, keys: ['a', 'b'], maxClients: 50 });
  assert.throws(() => rateLimitConfig({ LUNAR_RATE_LIMIT: 'sí' }), /LUNAR_RATE_LIMIT/);
  assert.throws(() => rateLimitConfig({ LUNAR_RATE_LIMIT: '1', LUNAR_RATE_HEAVY_BURST: '0' }), /LUNAR_RATE_HEAVY_BURST/);
});

test('CORS con el límite: admite X-Api-Key y expone las cabeceras RateLimit-* sin repetir las que ya estaban', () => {
  const cors = rateLimitCors({ 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, if-none-match', 'access-control-expose-headers': 'etag, retry-after, location' });
  assert.equal(cors['access-control-allow-origin'], '*');
  assert.equal(cors['access-control-allow-headers'], 'content-type, if-none-match, x-api-key');
  assert.equal(cors['access-control-expose-headers'], 'etag, retry-after, location, ratelimit-limit, ratelimit-remaining, ratelimit-reset, ratelimit-policy');
});
