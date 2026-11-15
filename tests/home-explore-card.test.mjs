// «Explorar la Luna» also as the last card of the mission list on the home (#466). home/index.html is a single-file export: read as text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MENU_GAP, MCARDS_OFFSET, mcardsFit } from '../home/src/menu-layout.mjs';

const home = readFileSync(new URL('../home/index.html', import.meta.url), 'utf8');
const block = home.match(/Its card on the left, the last of the list[\s\S]*?XR.card=c;XR.cardItem=li;\}/)?.[0];

test('creates an mcard for XR, in lilac, after the mission cards', () => {
  assert.ok(block, 'falta el bloque de la tarjeta de XR');
  assert.match(block, /className="mcard"/);
  assert.match(block, /setProperty\("--c","var\(--explore\)"\)/);
  assert.match(block, /\$\{XR\.mission\}[\s\S]*\$\{XR\.name\}[\s\S]*\$\{XR\.text\}/);
  assert.ok(home.indexOf('z.card=c;') < home.indexOf('XR.card=c;'));
});

test('its click opens «Explorar la Luna» like the rocket label, and hover and focus highlight XR', () => {
  assert.match(block, /click",\(\)=>openExplore\(undefined,c\)/);
  assert.match(block, /pointerenter",\(\)=>setHover\(XR\)/);
  assert.match(block, /pointerleave",\(\)=>setHover\(null\)/);
  assert.match(block, /focus",\(\)=>setHover\(XR\)/);
  assert.match(block, /blur",\(\)=>setHover\(null\)/);
});

test('the highlight marks the XR card too', () => {
  assert.match(home, /\[\.\.\.ZONES,XR\]\.forEach\(o=>o\.card\.classList\.toggle\("on",o===z\)\)/);
});

test('the list is out of the layout while off, and mOverview uses the pure fit rule', () => {
  assert.match(home, /\.mcards\{[^}]*max-height:0;overflow:hidden/);
  assert.match(home, /\.app\.mcards-on:not\(\.zoomed\) \.mcards\{max-height:none/);
  assert.match(home, /mcardsFit\(\{headerBottom:h\.bottom,listHeight:L\.scrollHeight,dockTop:k\.top\}\)/);
});

test('mcardsFit: fits with the measured heights on a tall viewport, not on a laptop-height one', () => {
  // 1366×650 measured: header bottom ~150, five cards ~ 4 × 87 + gaps, dock top 599
  const listHeight = 5 * 87 + 4 * 6;
  assert.equal(mcardsFit({ headerBottom: 150, listHeight, dockTop: 599 }), false);
  assert.equal(mcardsFit({ headerBottom: 150, listHeight, dockTop: 800 }), true);
  const exact = 150 + MCARDS_OFFSET + listHeight + MENU_GAP;
  assert.equal(mcardsFit({ headerBottom: 150, listHeight, dockTop: exact }), true);
  assert.equal(mcardsFit({ headerBottom: 150, listHeight, dockTop: exact - 1 }), false);
});

test('the card is hidden until zones.json loads, and unhidden next to the rocket label', () => {
  assert.match(block, /li\.hidden=true/);
  assert.match(home, /XR\.el\.hidden=false;XR\.cardItem\.hidden=false;/);
});

test('coming back from Explorar la Luna the focus returns to the control that opened it', () => {
  assert.match(home, /XR\.from=rocket===true\?XR\.el:rocket\|\|null/);
  assert.match(home, /const f=XR\.from;/);
  assert.match(home, /checkVisibility\?\.\(\{visibilityProperty:true\}\)&&\(f!==XR\.card\|\|app\.classList\.contains\("mcards-on"\)\)\?f:\$\("exploreBtn"\)/);
  assert.match(home, /t\.focus\(\{preventScroll:true\}\)/);
});
