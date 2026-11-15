// The NASA branding of the Z-2 atlas is painted over (pipeline/suit-branding.mjs): what each region paints and what it leaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_SIZE, BRANDING_REGIONS, removeBranding, sampleColor } from '../suit-branding.mjs';

const atlas = (fill) => {
  const data = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 3).fill(fill);
  return { data, info: { width: ATLAS_SIZE, height: ATLAS_SIZE, channels: 3 } };
};
const at = ({ data }, x, y) => [...data.subarray((y * ATLAS_SIZE + x) * 3, (y * ATLAS_SIZE + x) * 3 + 3)];
const paint = (img, x0, y0, x1, y1, rgb) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set(rgb, (y * ATLAS_SIZE + x) * 3); };

test('the insignia, the flag, the mission patch and the ACL credit and logos are covered', () => {
  const names = BRANDING_REGIONS.map(r => r.name);
  for (const n of ['us-flag', 'nasa-insignia', 'mission-patch', 'acl-credit', 'acl-logo', 'acl-logo-panel']) assert.ok(names.includes(n), n);
});

test('a patch becomes the cloth next to it, and the credit on the background becomes background', () => {
  const img = atlas(255);
  paint(img, 600, 2840, 640, 2880, [230, 225, 215]);   // the cloth sampled for the patches
  paint(img, 220, 3470, 340, 3590, [20, 40, 140]);     // the NASA insignia
  paint(img, 3950, 2000, 4000, 2100, [0, 0, 0]);       // the ACL credit text
  removeBranding(img.data, img.info, 'color');
  assert.deepEqual(at(img, 280, 3525), [230, 225, 215]);
  assert.deepEqual(at(img, 3975, 2050), [255, 255, 255]);
});

test('the relief map skips the colour-only strip, and the strip keeps its outline', () => {
  const img = atlas(255);
  paint(img, 1400, 4045, 3700, 4080, [200, 200, 200]);
  paint(img, 2000, 4055, 2100, 4065, [90, 90, 90]);    // blurred text on the strip
  const bump = { data: img.data.slice(), info: img.info };
  assert.ok(!removeBranding(bump.data, bump.info, 'bump').includes('strip-text'));
  assert.deepEqual(at(bump, 2050, 4060), [90, 90, 90]);
  removeBranding(img.data, img.info, 'color');
  assert.deepEqual(at(img, 2050, 4060), [200, 200, 200]);
  assert.deepEqual(at(img, 1350, 4040), [255, 255, 255], 'the background around the strip stays background');
});

test('sampleColor takes the median, and a wrong atlas size is refused', () => {
  const img = atlas(10);
  paint(img, 0, 0, 3, 1, [50, 60, 70]);
  assert.deepEqual(sampleColor(img.data, ATLAS_SIZE, 3, [0, 0, 5, 1]), [50, 60, 70]);
  assert.throws(() => removeBranding(new Uint8Array(12), { width: 2, height: 2, channels: 3 }, 'color'), /4096/);
});
