// Checks that the three places that wire a screen into the site stay in sync:
// MOUNTS in serve.mjs, the cp -R in pages.yml and the href of each zone in home/index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// planner/ is a domain mount (no screen, no index.html): pages.yml copies only planner/src, in its own step
const DOMAIN_MOUNTS = ['planner'];
// shared/ is code the screens import (shared/README.md, #142): copied whole, but it is not a screen
const CODE_MOUNTS = ['shared'];
const allMounts = JSON.parse(read('serve.mjs').match(/const MOUNTS = (\[.*?\]);/)[1].replace(/'/g, '"'));
const mounts = allMounts.filter(m => !DOMAIN_MOUNTS.includes(m));
const screens = mounts.filter(m => !CODE_MOUNTS.includes(m));
const copied = read('.github/workflows/pages.yml').match(/cp -R (.*) _site\//)[1].split(/\s+/);
const hrefs = [...read('home/index.html').matchAll(/\bhref:\s*"([^"]+)"/g)].map(m => m[1]);

test('every screen mount has a folder with an index.html', () => {
  for (const mount of screens) assert.ok(fs.existsSync(path.join(ROOT, mount, 'index.html')), `${mount}/index.html missing`);
});

test('pages.yml copies exactly the mounts of serve.mjs', () => {
  assert.deepEqual([...copied].sort(), [...mounts].sort());
});

test('every href in ZONES points to an existing mount', () => {
  assert.ok(hrefs.length > 0, 'no href found in ZONES');
  for (const href of hrefs) {
    const m = href.match(/^\.\.\/([^/]+)\/$/);
    assert.ok(m && screens.includes(m[1]), `href ${href} does not point to a screen`);
  }
});

test('shared/ is served by serve.mjs and copied by pages.yml', () => {
  assert.ok(allMounts.includes('shared'), 'shared missing from MOUNTS in serve.mjs');
  assert.ok(copied.includes('shared'), 'shared missing from the cp -R of pages.yml');
  assert.ok(fs.existsSync(path.join(ROOT, 'shared/render/quality.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'shared/render/moon-globe.js')), 'shared/render/moon-globe.js (G1.2, #140)');
  assert.ok(fs.existsSync(path.join(ROOT, 'shared/render/tex/moon-color-2k.jpg')), 'shared/render/tex/ (G1.2, #140)');
});

test('mission 03 (zone rol) links to the game screen', () => {
  assert.match(read('home/index.html'), /\{id:"rol",[^\n]*?\bhref:"\.\.\/rolegame\/"/);
});

test('mission 04 (zone aterrizaje) links to the landing simulator', () => {
  assert.match(read('home/index.html'), /\{id:"aterrizaje",[^\n]*?\bhref:"\.\.\/lander\/"/);
});

// Old URLs of the screens renamed in #126 (/tour/ → /viewpoint/, /juego/ → /rolegame/): same redirects locally and in Pages
test('serve.mjs and pages.yml redirect the same old URLs, to existing mounts', () => {
  const renamed = Object.entries(JSON.parse(read('serve.mjs').match(/const RENAMED = (\{.*?\});/)[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":')));
  const pairs = read('.github/workflows/pages.yml').match(/for pair in (.*); do/)[1].trim().split(/\s+/).map(p => p.split(':'));
  assert.deepEqual(pairs.sort(), renamed.sort());
  for (const [old, now] of renamed) {
    assert.ok(mounts.includes(now), `${old} redirects to ${now}, which is not a mount`);
    assert.ok(!mounts.includes(old) && !fs.existsSync(path.join(ROOT, old)), `${old} is still a folder`);
  }
});

// The "3D not available" notice of the home page (#144) links to the same screens as the missions
test('the links of #glost in home/index.html are the hrefs of the missions', () => {
  const glost = read('home/index.html').match(/<div class="glost" id="glost"[\s\S]*?<\/ul>/);
  assert.ok(glost, '#glost missing from home/index.html');
  const links = [...glost[0].matchAll(/<a href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...links].sort(), [...hrefs].sort());
});

// tour.css has no colours of its own (#83): without the tokens the tutorial card is transparent (#200)
test('every screen that links tour.css links the design tokens before it', () => {
  const withTour = screens.filter(s => /styles\/tour\.css"/.test(read(`${s}/index.html`)));
  assert.ok(withTour.length > 1, 'no screen links tour.css');
  for (const screen of withTour) {
    const html = read(`${screen}/index.html`);
    // web/ gets the tokens through base.css, which imports tokens.css
    const tokens = html.search(/styles\/(tokens|base)\.css"/);
    assert.ok(tokens >= 0 && tokens < html.indexOf('styles/tour.css"'), `${screen}/index.html links tour.css without tokens.css before it`);
  }
});
