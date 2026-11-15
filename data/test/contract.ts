// Helpers of the v1 contract tests: the 1.4.0 hashes (fixtures/v1-contract-1.4.0.json) and the 1.9.0 bodies
// (fixtures/v1-contract-1.9.0.json, written by fixtures/write-contract.ts).
import { BATTERY_DEFAULTS_SOURCES, TRACKING_NOTE } from '../src/notes.ts';

/** How `battery.note` credited the defaults until 1.22.0: all three to COMPASS, with an old title (#255). */
const BATTERY_DEFAULTS_SOURCES_1_22_0 = 'Valores por defecto (100 W, 200 Wh/kg, profundidad de descarga 0,9) del estudio COMPASS '
  + 'de NASA GRC «Overnight Power and Thermal Solutions for Small Landers» (2022).';

/**
 * 1.22.1 corrects the sources of the battery defaults in every `battery.note` (#255): put back the 1.22.0 text so the
 * bodies compare with the ones served before. No number nor field changes.
 */
const withOldBatterySources = (text: string): string => text.replaceAll(BATTERY_DEFAULTS_SOURCES, BATTERY_DEFAULTS_SOURCES_1_22_0);

/** The body without its optional `warnings` (since 1.9.0), serialized as the server does. */
export function withoutWarnings(text: string): string {
  const { warnings: _w, ...body } = JSON.parse(text) as Record<string, unknown>;
  return JSON.stringify(body);
}

/**
 * 1.22.0 adds `angularRadiusDeg` to each body of /v1/track (#192), on every request: dropped here so that the bodies
 * compare with the ones served before. Any other change keeps failing.
 */
function withoutTrackRadius(body: Record<string, unknown>): void {
  for (const b of ['sun', 'earth']) {
    const series = body[b] as Record<string, unknown> | undefined;
    if (series && Array.isArray(series.angularRadiusDeg) && Array.isArray(series.azimuthDeg)) delete series.angularRadiusDeg;
  }
}

/**
 * The body as 1.12.0 served it (and, since 1.22.0, without `angularRadiusDeg` in /v1/track). Since 1.22.1, with the 1.22.0 sources in `battery.note`. 1.13.0 only adds, without new parameters, the `terrain` object of /v1/health and, with
 * terrain=1 when some horizon is still the smooth sphere, the `terrain_not_applied` warning (dropped here, and with it
 * `warnings` when nothing else is left). Anything else that changed keeps failing the byte-for-byte comparison.
 */
export function asOf1_12(text: string): string {
  const body = JSON.parse(withOldBatterySources(text)) as Record<string, unknown> & { warnings?: { code: string }[] };
  if (body.status === 'ok' && 'apiVersion' in body) delete body.terrain;
  withoutTrackRadius(body);
  if (body.warnings) {
    body.warnings = body.warnings.filter((w) => w.code !== 'terrain_not_applied');
    if (!body.warnings.length) delete body.warnings;
  }
  return JSON.stringify(body);
}

/**
 * The body as 1.4.0 served it. Since 1.9.0 a request without new parameters only changes in three documented ways:
 * the optional `warnings` (smooth Moon beyond 80° in /v1/sun-earth and /v1/windows); in /v1/rank, the sentence
 * TRACKING_NOTE at the end of `note`; and, with terrain=1 on a server without DEM, the script named in the `note`
 * (`fetch-dem.ts`, it was `fetch-dem.js`, a file that no longer exists). Since 1.22.0, also `angularRadiusDeg` in
 * /v1/track; since 1.22.1, the sources in `battery.note`. Anything else that changed keeps failing the hash.
 */
export function legacyText(path: string, text: string): string {
  const body = JSON.parse(withoutWarnings(withOldBatterySources(text))) as Record<string, unknown>;
  withoutTrackRadius(body);
  if (path.startsWith('/v1/rank') && typeof body.note === 'string' && body.note.endsWith(` ${TRACKING_NOTE}`)) {
    body.note = body.note.slice(0, -TRACKING_NOTE.length - 1);
  }
  if (typeof body.note === 'string') body.note = body.note.replace('(node scripts/fetch-dem.ts)', '(node scripts/fetch-dem.js)');
  return JSON.stringify(body);
}

/** Paths of the 1.9.0 contract fixture: the 1.4.0 ones, landing-dates and some of the new parameters. */
export const CONTRACT_PATHS = [
  '/v1/health',
  '/v1/sites',
  '/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z',
  '/v1/sun-earth?lat=-89.5&lon=0&date=2027-01-15&mode=center',
  '/v1/sun-earth?site=apollo11&date=2027-06-01T12:00:00Z&terrain=1',
  '/v1/sun-earth?site=apollo11&date=2027-06-01T12:00:00Z&earthMinElevationDeg=5',
  '/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-03-01&mode=center',
  '/v1/windows?lat=-65.31485&lon=-3.05572&start=2027-01-24&end=2027-02-07&fullNight=1&battery=1',
  '/v1/track?site=im1&start=2027-01-01&end=2027-01-03&step=30m',
  '/v1/horizon?site=shackleton-rim',
  '/v1/rank?sites=all&start=2027-01-01&days=30',
  '/v1/rank?sites=shackleton-rim,im1&start=2027-01-24&days=14&panel=horizontal&fullNight=1&battery=1',
  '/v1/rank?sites=-65.31485:-3.05572,apollo11&start=2027-03-01&days=14&mode=full&terrain=1',
  '/v1/rank?sites=im1,apollo11,chandrayaan3&start=2027-01-01&days=14&weightMeanSunDiskFraction=1&weightEarthTimeFraction=1&minEarthTimeFraction=0.9&maxLongestNightHours=200&earthMinElevationDeg=3',
  '/v1/landing-dates?site=im1&start=2027-01-01&end=2027-01-15',
  '/v1/landing-dates?lat=-65.31485&lon=-3.05572&start=2027-01-01&end=2027-02-01&dateStep=2d&days=10&fullNight=1&battery=1&panel=vertical-rotating',
  '/v1/landing-dates?site=apollo11&start=2027-01-01&end=2027-01-20&dateStep=2d&minMeanSunDiskFraction=0.5&maxLongestNightHours=100&weightMeanSunDiskFraction=1&weightEarthTimeFraction=0',
  '/v1/sun-earth?site=apollo11&date=2027-01-15&terain=1&lat=3',
];
