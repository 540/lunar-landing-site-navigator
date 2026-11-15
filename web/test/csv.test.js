// CSV exports of the web (issue #66): the mission hour by hour and the comparison of sites. Headers in Spanish with
// units, UTF-8 with BOM, ";" between cells with a decimal comma, dates in UTC ISO 8601.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CSV_BOM, csvCell, fileSlug, fileStamp, isoUtc, toCsv } from '../js/common/csv.js';
import { MISSION_HOURS_HEADERS, SITE_COMPARISON_HEADERS, missionHoursCsv, siteComparisonCsv } from '../js/application/csv-export.js';
import { createMissionService } from '../js/application/mission-service.js';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { SITES } from '../js/engine/catalog.js';

/** The text of a CSV file → its rows of cells, undoing the quoting (a small RFC 4180 reader with ";"). */
function parse(text) {
  const rows = [[]];
  let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') { rows.at(-1).push(cell); cell = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { rows.at(-1).push(cell); cell = ''; rows.push([]); i++; }
    else cell += ch;
  }
  assert.deepEqual(rows.pop(), [], 'el fichero acaba en salto de línea');
  return rows;
}

test('formato: BOM, punto y coma, coma decimal, sí / no, comillas solo cuando hacen falta', () => {
  assert.equal(csvCell(1.5), '1,5');
  assert.equal(csvCell(-89.45), '-89,45');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(true), 'sí');
  assert.equal(csvCell(false), 'no');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(NaN), '');
  assert.equal(csvCell('Cresta de conexión'), 'Cresta de conexión');
  assert.equal(csvCell('Tierra ≥ 60 %; sin cortes'), '"Tierra ≥ 60 %; sin cortes"');
  assert.equal(csvCell('la «buena» y la "mala"'), '"la «buena» y la ""mala"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)", 'un texto no se ejecuta como fórmula');
  const text = toCsv(['Año', 'Señal (°)'], [[2027, 1.25], ['x;y', null]]);
  assert.ok(text.startsWith(CSV_BOM), 'empieza por el BOM de UTF-8');
  assert.equal(text.slice(1), 'Año;Señal (°)\r\n2027;1,25\r\n"x;y";\r\n');
  // The bytes Excel reads: EF BB BF and then UTF-8.
  assert.deepEqual([...new TextEncoder().encode(text).slice(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('fechas en UTC ISO 8601 y nombres de fichero sin tildes', () => {
  const t = Date.UTC(2027, 3, 3, 12);
  assert.equal(isoUtc(t), '2027-04-03T12:00:00Z');
  assert.equal(fileStamp(t), '2027-04-03T1200Z');
  assert.equal(fileSlug('Cresta Shackleton (≈4 km)'), 'cresta-shackleton-4-km');
});

test('la misión hora a hora: una fila por hora, cabeceras con unidades y lo visible según las ventanas', () => {
  const landing = Date.UTC(2027, 3, 3, 12);
  const series = [
    { sun: { az: 10.126, el: 1.23456, horizon: 0.5, margin: 0.73456 }, earth: { az: 359.9, el: -2, horizon: 1, margin: -3 } },
    { sun: { az: 25, el: 1.5, horizon: 0.25, margin: 1.25 }, earth: { az: 0.5, el: 4, horizon: 1, margin: 3 } },
  ];
  // The second hour the Sun is over the terrain by its centre but not by the windows (full disc): the windows decide.
  const text = missionHoursCsv({
    site: { name: 'Cresta de conexión de Shackleton' }, landing, series, visible: { sun: [1, 0], earth: [0, 1] },
    heights: { panelHeightM: 2, antennaHeightM: 7.5 }, horizonModel: 'mask',
  });
  const rows = parse(text.slice(1));
  assert.deepEqual(rows[0], MISSION_HOURS_HEADERS);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['Cresta de conexión de Shackleton', '0', '2027-04-03T12:00:00Z', '10,13', '1,235', '0,5', '0,735', 'sí', '359,9', '-2', '1', '-3', 'no', '2', '7,5', 'API de datos, con relieve LOLA']);
  assert.deepEqual(rows[2].slice(1, 3), ['1', '2027-04-03T13:00:00Z']);
  assert.deepEqual([rows[2][7], rows[2][12]], ['no', 'sí']);
  for (const h of MISSION_HOURS_HEADERS.slice(1, 15)) assert.match(h, /\((h|°|m|UTC, ISO 8601|sí\/no)\)$/, `«${h}» dice su unidad`);
});

test('sin ventanas (solo el cielo), lo visible sale del margen; los datos de ejemplo se dicen en cada fila', () => {
  const series = [{ sun: { az: 1, el: 1, horizon: 0, margin: 1 }, earth: { az: 1, el: -1, horizon: 0, margin: -1 } }];
  const rows = parse(missionHoursCsv({ site: { name: 'X' }, landing: 0, series, heights: { panelHeightM: 2, antennaHeightM: 2 }, horizonModel: 'simulated-terrain' }).slice(1));
  assert.deepEqual([rows[1][7], rows[1][12]], ['sí', 'no']);
  assert.match(rows[1].at(-1), /^Datos de ejemplo.*no usa las alturas/);
});

test('la comparación de sitios: la búsqueda real del servicio, un sitio por fila y en su orden', async () => {
  const sites = SITES.filter(s => !s.offMap).slice(0, 3);
  const service = createMissionService({ visibility: { ...fakeVisibility, source: async () => 'fake' }, sites });
  const cond = { sites, from: Date.UTC(2027, 3, 1), to: Date.UTC(2027, 3, 6), days: 5, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48, priority: 'energy', panelHeightM: 2, antennaHeightM: 10 };
  await service.prepare({ fromMs: cond.from - 864e5, toMs: cond.to + 80 * 864e5, ...cond });
  const res = await service.search(cond);
  const text = siteComparisonCsv({
    options: res.options, conditions: cond, points: o => Math.round(50 * o.score),
    slopeDeg: id => (id === res.options[0].site.id ? 7.26 : null), horizonModel: service.horizonModel,
  });
  const rows = parse(text.slice(1));
  assert.deepEqual(rows[0], SITE_COMPARISON_HEADERS);
  assert.equal(rows.length, 1 + sites.length);
  assert.ok(rows.every(r => r.length === SITE_COMPARISON_HEADERS.length), 'todas las filas tienen las mismas columnas');
  const col = name => SITE_COMPARISON_HEADERS.indexOf(name);
  res.options.forEach((o, i) => {
    const r = rows[i + 1];
    assert.equal(r[col('Puesto')], String(i + 1));
    assert.equal(r[col('Sitio')], o.site.name);
    assert.equal(r[col('Mejor aterrizaje (UTC, ISO 8601)')], new Date(o.landing).toISOString().replace('.000Z', 'Z'));
    assert.equal(r[col('Veredicto')], o.verdict.title);
    assert.equal(r[col('Latitud (°)')], String(o.site.lat).replace('.', ','));
    assert.equal(Number(r[col('Tiempo con Sol (%)')].replace(',', '.')), Math.round(o.result.pctSun * 10) / 10);
    assert.equal(r[col('Aterrizajes probados en la ventana')], String(o.landings.length));
    assert.match(r[col('Origen de los datos')], /^Datos de ejemplo/);
  });
  assert.equal(rows[1][col('Pendiente en 100 m (°)')], '7,3');
  assert.equal(rows[2][col('Pendiente en 100 m (°)')], '', 'sin pendiente, celda vacía');
  assert.deepEqual([rows[1][col('Altura del panel (m)')], rows[1][col('Altura de la antena (m)')]], ['2', '10']);
  assert.deepEqual([rows[1][col('Ventana: no antes de (UTC, ISO 8601)')], rows[1][col('Ventana: no después de (UTC, ISO 8601)')]], ['2027-04-01T00:00:00Z', '2027-04-06T00:00:00Z']);
});

test('sin ventanas, la Tierra con el centro sobre el relieve pero no el borde inferior no se ve; el margen sigue siendo el del centro (#269)', () => {
  const series = [{ sun: { az: 1, el: 2, horizon: 0, margin: 2, fullMargin: 1.73 }, earth: { az: 1, el: 1.5, horizon: 1, margin: 0.5, fullMargin: -0.45 } }];
  const rows = parse(missionHoursCsv({ site: { name: 'X' }, landing: 0, series, visible: null, heights: { panelHeightM: 2, antennaHeightM: 2 }, horizonModel: 'mask' }).slice(1));
  assert.deepEqual(rows[0], MISSION_HOURS_HEADERS);
  assert.equal(rows[1][11], '0,5');
  assert.deepEqual([rows[1][7], rows[1][12]], ['sí', 'no']);
});
