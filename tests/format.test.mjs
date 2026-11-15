import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtNum, num, deg, pct, km, m, coords, langOf } from '../shared/format/number.js';
import { days, hours, date, dateTime, dayMonth, dayMonthTime, time, isoDay, MONTHS } from '../shared/format/time.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MINUS = '−'; // U+2212

test('fmtNum: coma decimal, sin ceros de relleno y como mucho los decimales pedidos', () => {
  assert.equal(fmtNum(6.5), '6,5');
  assert.equal(fmtNum(10), '10');
  assert.equal(fmtNum(0.25, 2), '0,25');
  assert.equal(fmtNum(3.04), '3');
  assert.equal(fmtNum(3.5, 0), '4');
  assert.equal(fmtNum(88.52, 2), '88,52');
});

test('fmtNum: en inglés (idioma de la página), punto decimal y el mismo «−»', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: { documentElement: { lang: 'en' } }, configurable: true });
  try {
    assert.equal(fmtNum(6.5), '6.5');
    assert.equal(fmtNum(1234.5), '1,234.5');
    assert.equal(fmtNum(-1.5), '−1.5');
    assert.equal(fmtNum(1, 1, 1), '1.0');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
  }
});

test('fmtNum: una sola firma, fmtNum(x, max, min); el tercer argumento es el mínimo de decimales, no el idioma', async () => {
  assert.equal(fmtNum.length, 1, 'x y dos opcionales con valor por defecto');
  assert.equal(fmtNum(1, 1, 1), '1,0');
  assert.equal(fmtNum(2.5, 2, 2), '2,50');
  const i18n = await import('../web/js/common/i18n.js');
  assert.equal(i18n.fmtNum, fmtNum, 'web/js/common/i18n.js reexporta el fmtNum de shared/format/, sin envoltorio');
});

test('fmtNum: signo menos «−» (U+2212) en los negativos y sin signo en el cero', () => {
  assert.equal(fmtNum(-1.5), '−1,5');
  assert.equal(fmtNum(-0.01), '0');
  assert.equal(fmtNum(-0), '0');
});

test('num: agrupa los miles también con cuatro cifras', () => {
  assert.equal(num('es', 1234), '1.234');
  assert.equal(num('es', 12345.6), '12.345,6');
  assert.equal(num('en', 1234), '1,234');
  assert.equal(num('es', -1234), '−1.234');
});

test('num: decimales mínimos y máximos', () => {
  assert.equal(num('es', 1, 1, 1), '1,0');
  assert.equal(num('en', 1.25, 1, 1), '1.3');
  assert.equal(num('es', 3.14159, 4, 4), '3,1416');
  assert.equal(num('es', 2, 0, 2), '2,00');
});

test('langOf: idioma o locale; cualquier otra cosa, español', () => {
  assert.equal(langOf('en'), 'en');
  assert.equal(langOf('en-GB'), 'en');
  assert.equal(langOf('es-ES'), 'es');
  assert.equal(langOf(undefined), 'es');
  assert.equal(langOf('fr'), 'es');
});

test('deg, pct, km, m y coords en los dos idiomas', () => {
  assert.equal(deg('es', 1.25, 1, 1), '1,3°');
  assert.equal(deg('en', -3.5), '−3.5°');
  assert.equal(pct('es', 12.4), '12 %');
  assert.equal(pct('en', 12.4), '12%');
  assert.equal(pct('es', 7.25, 1), '7,3 %');
  assert.equal(km('es', 12.34), '12,3 km');
  assert.equal(km('es', 1234), '1.234 km');
  assert.equal(m('en', 120.4), '120 m');
  assert.equal(coords('es', { lat: -89.4512, lon: -12.3 }), '89,45° S, 12,3° O');
  assert.equal(coords('en', { lat: -89.4512, lon: -12.3 }), '89.45° S, 12.3° W');
  assert.equal(coords('es', { lat: 10, lon: 20 }, 4, 4), '10,0000° N, 20,0000° E');
});

test('ningún formateador escribe un guion como signo menos', () => {
  for (const lang of ['es', 'en']) {
    for (const text of [num(lang, -2.5), deg(lang, -2.5), pct(lang, -2.5), km(lang, -2.5), m(lang, -2.5),
      days(lang, -2.5), hours(lang, -50), hours(lang, -5)]) {
      assert.ok(text.startsWith(MINUS), `${lang}: «${text}» empieza por «${MINUS}»`);
      assert.ok(!text.includes('-'), `${lang}: «${text}» sin guion`);
    }
  }
});

test('days y hours: sin «0 h»', () => {
  assert.equal(days('es', 2), '2 d');
  assert.equal(days('es', 2.5), '2,5 d');
  assert.equal(days('en', 2.5), '2.5 d');
  assert.equal(hours('es', 48), '2 d');
  assert.equal(hours('es', 51), '2 d 3 h');
  assert.equal(hours('es', 5.4), '5 h');
  assert.equal(hours('es', 0), '0 h');
  assert.equal(hours('es', 47.6), '2 d');
  assert.equal(hours('es', 24 * 1000), '1.000 d');
  assert.equal(hours('es', Infinity), '—');
  assert.equal(hours('es', NaN), '—');
});

test('fechas: «15 ene 2027 · 00:00 UTC», con los meses de un solo sitio', () => {
  const ms = Date.UTC(2027, 0, 15);
  assert.equal(date('es', ms), '15 ene 2027');
  assert.equal(date('en', ms), '15 Jan 2027');
  assert.equal(dateTime('es', ms), '15 ene 2027 · 00:00 UTC');
  assert.equal(dateTime('en', Date.UTC(2027, 0, 20, 12, 5)), '20 Jan 2027 · 12:05 UTC');
  assert.equal(dayMonth('es', ms), '15 ene');
  assert.equal(dayMonthTime('es', Date.UTC(2027, 8, 3, 9)), '3 sep · 09:00 UTC');
  assert.equal(time('es', Date.UTC(2027, 8, 3, 9, 30)), '09:30 UTC');
  assert.equal(date('es', Date.UTC(2027, 8, 1)), '1 sep 2027', 'septiembre es «sep», no «sept»');
  assert.equal(date('es', '2027-01-15'), '15 ene 2027', 'acepta el día ISO');
  assert.equal(date('es', new Date(ms)), '15 ene 2027', 'acepta un Date');
  assert.equal(isoDay(ms), '2027-01-15');
  assert.equal(MONTHS.es.length, 12);
  assert.equal(MONTHS.en.length, 12);
});

// The screens format visible numbers and dates only through shared/format/ (#343): no own Intl formatters, no
// toLocaleString and none of the deleted formatters defined again.
// Each screen whole, without its dependencies, tests or data.
const SCREENS = ['home', 'viewpoint', 'rolegame', 'lander', 'web'];
const SKIP = /(^|[\\/])(node_modules|tests?|data)([\\/]|$)/;
const files = path => {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { recursive: true }).filter(f => !SKIP.test(f)).map(f => join(full, f))
    .filter(f => /\.(m?js|html)$/.test(f) && statSync(f).isFile());
};
const screenFiles = () => SCREENS.flatMap(files);

test('shared/i18n/lang.js ya no formatea: sin formatNumber ni formatDate', async () => {
  const lang = await import('../shared/i18n/lang.js');
  assert.equal(lang.formatNumber, undefined);
  assert.equal(lang.formatDate, undefined);
});

test('las pantallas no importan formatNumber ni formatDate de shared/i18n/lang.js', () => {
  const imports = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*shared\/i18n\/lang\.js['"]/g;
  const found = [];
  for (const file of screenFiles()) {
    for (const [, names] of readFileSync(file, 'utf8').matchAll(imports)) {
      if (/\b(formatNumber|formatDate)\b/.test(names)) found.push(relative(ROOT, file));
    }
  }
  assert.deepEqual(found, [], `usan shared/format/:\n${found.join('\n')}`);
});

test('las pantallas no formatean números ni fechas visibles por su cuenta', () => {
  const own = /toLocaleString\(|toLocaleDateString\(|toLocaleTimeString\(|\bIntl\.(NumberFormat|DateTimeFormat)\(/;
  const found = [];
  for (const file of screenFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => { if (own.test(line)) found.push(`${relative(ROOT, file)}:${i + 1}`); });
  }
  assert.deepEqual(found, [], `usan shared/format/:\n${found.join('\n')}`);
});

// ISO dates built by hand and labelled «UTC» are visible text: they go through dateTime (#343). The ISO only stays in
// URLs, files and the API; the allowed lines below are not visible text.
const ISO_ALLOWED = [
  // The two console.log lines of the Replan test scenario (logTrial), copied into the test sheet, not shown on screen.
  /^web\/js\/views\/replan\.js: +escenario: `\$\{TEST_SCENARIO\.siteId\}/,
  /^web\/js\/views\/replan\.js: +aterrizaje: new Date\(o\.landingMs\)/,
];

test('las pantallas no escriben fechas ISO a mano en textos visibles', () => {
  const iso = /toISOString\(\)\.slice\([^)]*\)[^;\n]*UTC|\.replace\('T', ' '\)[^;\n]*UTC/;
  const found = [];
  for (const file of screenFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const where = `${relative(ROOT, file)}:${line}`;
      if (iso.test(line) && !ISO_ALLOWED.some(re => re.test(where))) found.push(`${relative(ROOT, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(found, [], `usan dateTime de shared/format/time.js:\n${found.join('\n')}`);
});

test('los formateadores borrados no reaparecen fuera de shared/', () => {
  const defined = /(?:const|let|function)\s+(fmtDH|fmtDay|dayMonth|formatUtc|isoDay|fmtDateIntl|monthShort)\b\s*[=(]/;
  const found = [];
  for (const file of screenFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => { if (defined.test(line)) found.push(`${relative(ROOT, file)}:${i + 1}`); });
  }
  assert.deepEqual(found, [], `se importan de shared/format/:\n${found.join('\n')}`);
});

// common/util.js lost fmtDH and fmtDate (#343): a screen that still imports them fails to load in the browser (a named
// import that does not exist breaks the whole module graph), and no test of its own would see it.
test('lo que las pantallas importan de web/js/common/util.js existe', async () => {
  const util = await import('../web/js/common/util.js');
  const imports = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*common\/util\.js['"]/g;
  const found = [];
  for (const file of screenFiles()) {
    for (const [, names] of readFileSync(file, 'utf8').matchAll(imports)) {
      for (const name of names.split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        if (!(name in util)) found.push(`${relative(ROOT, file)}: ${name}`);
      }
    }
  }
  assert.deepEqual(found, [], `no los exporta common/util.js:\n${found.join('\n')}`);
});
