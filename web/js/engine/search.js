// Best-landing search: it lives in the domain, planner/src/ranking.js, shared with the data API (/v1/best-landings).
// The views take from here the priorities and the reasons of a landing, in the shapes they already paint.
import { PRIORITIES, landingReasons } from '../../../planner/src/ranking.js';

export { PRIORITIES };

/** Reasons of a landing picked by hand. k: { r (web metrics), verdict (web), robustDays }; req: { batteryHours, minEarthPct }. */
export const reasons = (k, cond, req) => landingReasons(
  { verdict: k.verdict.code, reason: k.verdict.reason, shadowHours: k.r.maxDarkHours, earthPct: k.r.pctEarth, robustDays: k.robustDays },
  req,
);
