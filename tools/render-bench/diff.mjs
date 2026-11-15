#!/usr/bin/env node
// Compares two PNG screenshots: node tools/render-bench/diff.mjs a.png b.png [heat.png]
// Prints { size, scaled, meanAbs, pctOver8, pctOver24 }. The PNGs are decoded in headless Chrome (canvas 2D) to avoid
// npm dependencies; the metric is diffStats of lib.mjs, run inside the page.
import fs from 'node:fs';
import { diffStats, heatPixels } from './lib.mjs';
import { launch } from './cdp.mjs';

const [a, b, heat] = process.argv.slice(2);
if (!a || !b) {
  process.stderr.write('Uso: node tools/render-bench/diff.mjs a.png b.png [calor.png]\n');
  process.exit(2);
}
const dataUrl = file => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;

const script = `(async () => {
  const diffStats = ${diffStats.toString()};
  const heatPixels = ${heatPixels.toString()};
  const load = src => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('PNG no válido')); i.src = src; });
  const [ia, ib] = await Promise.all([load(${JSON.stringify(dataUrl(a))}), load(${JSON.stringify(dataUrl(b))})]);
  const w = ia.naturalWidth, h = ia.naturalHeight, scaled = ib.naturalWidth !== w || ib.naturalHeight !== h;
  const pixels = img => { const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
  const pa = pixels(ia), pb = pixels(ib);
  const out = { size: [w, h], scaled, ...diffStats(pa, pb) };
  if (${!!heat}) { const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(heatPixels(pa, pb), w, h), 0, 0); out.heat = c.toDataURL('image/png'); }
  return out;
})()`;

let chrome;
try {
  chrome = await launch({ gpu: 'sw', extraFlags: ['--force-color-profile=srgb'] });
  const out = await chrome.evaluate(script);
  if (heat) {
    fs.writeFileSync(heat, Buffer.from(out.heat.slice(out.heat.indexOf(',') + 1), 'base64'));
    delete out.heat;
  }
  process.stdout.write(JSON.stringify(out) + '\n');
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = err.code === 'NO_CHROME' ? 2 : 1;
} finally {
  chrome?.close();
}
