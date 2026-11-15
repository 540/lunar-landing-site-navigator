// A hidden body is named the same in every view (#337): below 0° the home says «bajo el horizonte».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Spanish of the home page lives in index.html and, for the texts its script builds, in home/i18n.js (#283).
const home = readFileSync(new URL('../home/index.html', import.meta.url), 'utf8') + readFileSync(new URL('../home/i18n.js', import.meta.url), 'utf8');

test('la portada no dice «tapada por el horizonte», sino «bajo el horizonte»', () => {
  assert.ok(!home.includes('tapada por el horizonte'));
  assert.ok(home.includes('bajo el horizonte'));
});
