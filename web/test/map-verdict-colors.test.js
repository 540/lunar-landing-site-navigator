// Verdict dots on the region map of Replanificar (#332): the LOLA relief is dark in both themes, so the dots use
// the --color-map-* tokens (the -400 tones), which the light theme does not redefine, and not --color-ok/warn/bad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(WEB, rel), 'utf8');

test('tokens.css define --color-map-ok, -warn, -bad y -muted una sola vez, fuera del tema claro', () => {
  const css = read('styles/tokens.css');
  const start = css.indexOf(':root[data-theme="light"] {');
  assert.ok(start >= 0, 'no se encuentra el bloque del tema claro en tokens.css');
  const light = css.slice(start);
  for (const name of ['--color-map-ok', '--color-map-warn', '--color-map-bad', '--color-map-muted']) {
    const defs = css.match(new RegExp(`${name}\\s*:`, 'g')) ?? [];
    assert.equal(defs.length, 1, `${name} se define ${defs.length} veces`);
    assert.doesNotMatch(light, new RegExp(`${name}\\s*:`), `${name} no se redefine en el tema claro`);
  }
});

test('el mapa de región de replan.js pinta los veredictos con th.mapOk, th.mapWarn, th.mapBad y th.mapMuted', () => {
  const js = read('js/views/replan.js');
  const colour = js.match(/colour = \{ viable:[^}]*\}/)?.[0];
  assert.ok(colour, 'no se encuentra el objeto de colores del mapa de región');
  for (const token of ['th.mapOk', 'th.mapWarn', 'th.mapBad', 'th.mapMuted']) assert.ok(colour.includes(token), `falta ${token}`);
  for (const token of [/\bth\.ok\b/, /\bth\.warn\b/, /\bth\.bad\b/, /\bth\.muted\b/]) assert.doesNotMatch(colour, token);
  const legend = js.match(/rp-region-legend'\)\.innerHTML = `[^\n]*/)?.[0] ?? '';
  for (const v of ['--color-map-ok', '--color-map-warn', '--color-map-bad']) assert.ok(legend.includes(`var(${v})`), `la leyenda no usa ${v}`);
});

test('theme() expone mapOk, mapWarn, mapBad y mapMuted', () => {
  const js = read('js/common/theme.js');
  assert.match(js, /mapOk: read\('--color-map-ok'\)/);
  assert.match(js, /mapWarn: read\('--color-map-warn'\)/);
  assert.match(js, /mapBad: read\('--color-map-bad'\)/);
  assert.match(js, /mapMuted: read\('--color-map-muted'\)/);
});

test('las muestras de la leyenda del mapa de región llevan el anillo oscuro del mapa', () => {
  const css = read('styles/replan.css');
  const rule = css.match(/\.rp-region__legend i \{[^}]*\}/)?.[0] ?? '';
  assert.match(rule, /box-shadow:[^;]*var\(--color-map-bg\)/, 'las muestras no llevan el anillo --color-map-bg');
});
