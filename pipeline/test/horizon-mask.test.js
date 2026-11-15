// mask.json of the exploration regions (E1.1, #122): an exact copy of the catalogue mask, with the DEM of the series.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MASK_SITE_IDS, buildMask, outFileFor, serialize, sourceFileFor } from '../horizon-mask.mjs';

const read = (url) => JSON.parse(readFileSync(url, 'utf8'));

for (const id of MASK_SITE_IDS) {
  test(`${id}: mask.json is the catalogue mask, unchanged`, () => {
    const catalog = read(sourceFileFor(id));
    const doc = read(outFileFor(id));
    assert.equal(doc.siteId, id);
    assert.equal(doc.stepDeg, catalog.stepDeg);
    assert.equal(doc.el.length, 720);
    assert.deepEqual(doc.el, catalog.el);
    assert.equal(doc.source, catalog.source);
    // Line endings aside (a Windows checkout with core.autocrlf turns them into CRLF), the file is what the script writes.
    assert.equal(readFileSync(outFileFor(id), 'utf8').replace(/\r\n/g, '\n'), serialize(buildMask(catalog)), 'mask.json no está al día: node pipeline/horizon-mask.mjs');
  });

  test(`${id}: mask.json and series-2027.json come from the same DEM`, () => {
    const series = read(new URL(`../../viewpoint/data/${id}/series-2027.json`, import.meta.url));
    const doc = read(outFileFor(id));
    assert.ok(series.source.includes(`demVersion: ${doc.demVersion}`), `${series.source} ≠ ${doc.demVersion}`);
    assert.equal(doc.observerHeightM, series.observerHeightM);
  });
}

test('a mask that does not cover 360° is rejected', () => {
  assert.throws(() => buildMask({ id: 'x', stepDeg: 1, el: [0, 1] }), /360°/);
});
