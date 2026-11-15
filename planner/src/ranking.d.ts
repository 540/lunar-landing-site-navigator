// Tipos de ranking.js para quien lo importa desde TypeScript (data/). planner/ es JavaScript sin build.

export type Verdict = 'viable' | 'marginal' | 'not-viable' | 'no-data';

/** Ventanas de visibilidad de un sitio (la forma `w` de rules.js): intervalos [inicioMs, finMs) ordenados y sin solapes. */
export interface VisibilityWindows {
  site: { id: string; name: string; latDeg: number; lonDeg: number; horizonModel: string };
  startMs: number;
  endMs: number;
  sun: [number, number][];
  earth: [number, number][];
  sunAndEarth: [number, number][];
  /** Pendiente del sitio, como el objeto `slope` de /v1/windows (R9). Sin ella, R9 queda sin certificar. */
  slope?: unknown;
}

export interface Mission { days: number; batteryHours: number; minEarthPct: number; maxEarthGapHours?: number; transitDays?: number }
export interface Priority { id: 'energy' | 'comms' | 'early' | 'delays'; name: string; weights: { e: number; c: number; a: number; r: number } }
export interface TraceItem { rule: string; ok: boolean | null; value: string }

export interface RankedOption {
  siteId: string;
  landing: number;
  verdict: Exclude<Verdict, 'no-data'>;
  reason: string;
  trace: TraceItem[];
  metrics: Record<string, unknown> & { noData: boolean };
  reasons: string[];
  score: number;
  parts: { energy: number; comms: number; early: number; delays: number };
  robustness: { maxDelayDays: number; nextWindow: number | null };
  viableInWindow: number;
  landings: { t: number; verdict: Exclude<Verdict, 'no-data'>; reason: string; streak: number }[];
}

export const SAFE_SLOPE_DEG: number;
export const DEFAULT_TRANSIT_DAYS: number;
export const RANK_STEP_HOURS: number;
export const LOOKAHEAD_DAYS: number;
export const PRIORITIES: Priority[];
export function missionProfile(mission: Mission): unknown;
export function rankingRange(o: { from: number; to: number; days: number }): { fromMs: number; toMs: number };
export function describe(evaluation: unknown): { verdict: Exclude<Verdict, 'no-data'>; reason: string; trace: TraceItem[] };
export function landingReasons(o: { verdict: Verdict; reason: string; shadowHours: number; earthPct: number; robustDays: number }, mission: Mission): string[];
export function bestLandings(o: {
  windowsBySite: Record<string, VisibilityWindows>;
  sites: { id: string }[];
  from: number;
  to: number;
  mission: Mission;
  priority: string;
}): { stepHours: number; tested: number; options: RankedOption[] };
