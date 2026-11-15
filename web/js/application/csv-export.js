// What the web exports to CSV (issue #66): the mission hour by hour and the comparison of sites. Pure functions from
// the data the views already paint to the text of the file (format in ../common/csv.js); the view only downloads it.
import { toCsv, isoUtc, round } from '../common/csv.js';
import { lang } from '../common/i18n.js';
import { overRelief } from '../common/sky-visibility.js';
import { skippedNote } from '../engine/coherence.js';
import { DEFAULT_PANEL, panelName, panelFormula } from '../engine/panel.js';

// The file follows the page language (Spanish under node --test); headers and fixed texts in both, side by side.
const EN = lang === 'en';
const VERDICT_TEXT = EN ? { viable: 'Viable', marginal: 'Marginal', not_viable: 'Not viable' } : { viable: 'Viable', marginal: 'Justo', not_viable: 'No viable' };

/** Where the figures come from, by the horizon model of the site: it also says whether the heights were used. */
const ORIGIN = EN ? {
  mask: 'Data API, with LOLA terrain',
  sphere: 'Data API, over a smooth Moon (no terrain): panel and antenna heights not used',
  fake: 'Example data: approximate ephemerides and made-up terrain (panel and antenna heights not used)',
} : {
  mask: 'API de datos, con relieve LOLA',
  sphere: 'API de datos, sobre una Luna lisa (sin relieve): no usa las alturas del panel ni de la antena',
  fake: 'Datos de ejemplo: efemérides aproximadas y relieve inventado (no usa las alturas del panel ni de la antena)',
};
export const dataOrigin = horizonModel => (horizonModel === 'mask' || horizonModel === 'sphere' ? ORIGIN[horizonModel] : ORIGIN.fake);

export const MISSION_HOURS_HEADERS = EN ? [
  'Site', 'Mission hour (h)', 'Date and time (UTC, ISO 8601)',
  'Sun: azimuth (°)', 'Sun: centre elevation (°)', 'Sun: terrain in that direction (°)', 'Sun: centre above terrain (°)', 'Sun visible (yes/no)',
  'Earth: azimuth (°)', 'Earth: centre elevation (°)', 'Earth: terrain in that direction (°)', 'Earth: centre above terrain (°)', 'Earth visible (yes/no)',
  'Panel height (m)', 'Antenna height (m)', 'Data origin',
] : [
  'Sitio', 'Hora de misión (h)', 'Fecha y hora (UTC, ISO 8601)',
  'Sol: azimut (°)', 'Sol: elevación del centro (°)', 'Sol: relieve en esa dirección (°)', 'Sol: centro sobre el relieve (°)', 'Sol visible (sí/no)',
  'Tierra: azimut (°)', 'Tierra: elevación del centro (°)', 'Tierra: relieve en esa dirección (°)', 'Tierra: centro sobre el relieve (°)', 'Tierra visible (sí/no)',
  'Altura del panel (m)', 'Altura de la antena (m)', 'Origen de los datos',
];

/**
 * The mission hour by hour: one row per hour from the landing, with what the chart draws (the Sun and the Earth over the
 * terrain) and whether each is visible by the same windows as the verdict.
 *   site: { name }, landing: ms, series: [{ sun: { az, el, horizon, margin }, earth }] one per hour,
 *   visible: { sun, earth } arrays of 0 / 1 per hour (null: whole disc over the terrain, overRelief), heights, horizonModel.
 */
export function missionHoursCsv({ site, landing, series, visible = null, heights, horizonModel }) {
  const origin = dataOrigin(horizonModel);
  const body = (b, seen) => [round(b.az), round(b.el, 3), round(b.horizon, 3), round(b.margin, 3), seen];
  const rows = series.map((k, h) => [
    site.name, h, isoUtc(landing + h * 36e5),
    ...body(k.sun, visible ? !!visible.sun[h] : overRelief(k.sun)),
    ...body(k.earth, visible ? !!visible.earth[h] : overRelief(k.earth)),
    heights.panelHeightM, heights.antennaHeightM, origin,
  ]);
  return toCsv(MISSION_HOURS_HEADERS, rows);
}

export const SITE_COMPARISON_HEADERS = EN ? [
  'Rank', 'Site', 'Latitude (°)', 'Longitude (°)', 'Best landing (UTC, ISO 8601)', 'Verdict', 'Reason', 'Score (0-100)',
  'Time in sunlight (%)', 'Longest shadow (h)', 'Time with Earth visible (%)', 'Longest Earth outage (h)',
  'Delay margin (days)', 'Viable landings in the window', 'Landings tested in the window', 'Slope over 100 m (°)',
  'Mission duration (days)', 'Battery: hours without Sun (h)', 'Minimum Earth (%)', 'Maximum continuous time without Earth (h)',
  'Window: not before (UTC, ISO 8601)', 'Window: not after (UTC, ISO 8601)',
  'Panel height (m)', 'Antenna height (m)', 'Panel orientation', 'Data origin',
] : [
  'Puesto', 'Sitio', 'Latitud (°)', 'Longitud (°)', 'Mejor aterrizaje (UTC, ISO 8601)', 'Veredicto', 'Motivo', 'Puntuación (0-100)',
  'Tiempo con Sol (%)', 'Sombra más larga (h)', 'Tiempo con la Tierra visible (%)', 'Corte de Tierra más largo (h)',
  'Margen ante retrasos (días)', 'Aterrizajes viables en la ventana', 'Aterrizajes probados en la ventana', 'Pendiente en 100 m (°)',
  'Duración de la misión (días)', 'Batería: aguanta sin Sol (h)', 'Tierra mínima (%)', 'Máximo seguido sin la Tierra (h)',
  'Ventana: no antes de (UTC, ISO 8601)', 'Ventana: no después de (UTC, ISO 8601)',
  'Altura del panel (m)', 'Altura de la antena (m)', 'Orientación del panel', 'Origen de los datos',
];

/**
 * The comparison of sites: one row per site of the search, in order, each on its best landing of the window.
 *   options: the options of the search (mission-service.js search()), conditions: its conditions,
 *   points(o): score 0–100, slopeDeg(siteId): number or null, horizonModel(siteId).
 * The panel orientation (#254) is the one of the conditions (a tracker without one), with its factor.
 * A search computed with skipped coherence rules (conditions.skippedRules, #252) adds a last column that says which;
 * without them the file is as it was.
 */
/** Last column of the comparison when the search skipped coherence rules (#252). */
export const SKIPPED_RULES_HEADER = EN ? 'Skipped coherence rules' : 'Reglas de coherencia saltadas';

export function siteComparisonCsv({ options, conditions: c, points, slopeDeg = () => null, horizonModel = () => null }) {
  const skipped = c.skippedRules?.length ? skippedNote(c.skippedRules) : null;
  const panel = `${panelName(c.panel ?? DEFAULT_PANEL)} (${panelFormula(c.panel ?? DEFAULT_PANEL)})`;
  const rows = options.map((o, i) => {
    const r = o.result, noData = !!r.noData;
    const num = (v, digits) => (noData ? null : round(v, digits));
    return [
      i + 1, o.site.name, o.site.lat, o.site.lon, isoUtc(o.landing), VERDICT_TEXT[o.verdict.code] ?? o.verdict.title, o.verdict.reason, points(o),
      num(r.pctSun, 1), num(r.maxDarkHours, 1), num(r.pctEarth, 1), num(r.maxNoEarthHours, 1),
      round(o.robustness?.maxDelayDays ?? null, 2), o.viableInWindow, o.landings.length, round(slopeDeg(o.site.id), 1),
      c.days, c.batteryHours, c.minEarthPct, c.maxEarthGapHours,
      isoUtc(c.from), isoUtc(c.to),
      c.panelHeightM, c.antennaHeightM, panel, dataOrigin(horizonModel(o.site.id)),
      ...(skipped ? [skipped] : []),
    ];
  });
  return toCsv(skipped ? [...SITE_COMPARISON_HEADERS, SKIPPED_RULES_HEADER] : SITE_COMPARISON_HEADERS, rows);
}
