// The shared loader of the LOLA relief image (#331): one image, 'loading' → 'ready' | 'failed', and every subscriber
// hears the change. A fake image stands in for the browser's Image.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReliefLoader } from '../js/common/relief-image.js';

function fakeImages() {
  const made = [];
  const make = ({ onload, onerror }) => {
    const img = { src: null, naturalWidth: 0, onload, onerror };
    made.push(img);
    return img;
  };
  return { made, make };
}

test('creates one image, sets its src once, and starts loading', () => {
  const { made, make } = fakeImages();
  const reliefImage = createReliefLoader('relief.png', make);
  assert.equal(made.length, 0, 'loads nothing until first use');
  const a = reliefImage(), b = reliefImage();
  assert.equal(made.length, 1);
  assert.equal(made[0].src, 'relief.png');
  assert.equal(a.img, b.img);
  assert.equal(a.state, 'loading');
});

test('onload with a real image: ready, and every subscriber hears it', () => {
  const { made, make } = fakeImages();
  const reliefImage = createReliefLoader('relief.png', make);
  const heard1 = [], heard2 = [];
  reliefImage(s => heard1.push(s));
  reliefImage(s => heard2.push(s));
  made[0].naturalWidth = 720;
  made[0].onload();
  assert.deepEqual(heard1, ['ready']);
  assert.deepEqual(heard2, ['ready']);
  assert.equal(reliefImage().state, 'ready');
});

test('onerror: failed', () => {
  const { made, make } = fakeImages();
  const reliefImage = createReliefLoader('relief.png', make);
  const heard = [];
  reliefImage(s => heard.push(s));
  made[0].onerror();
  assert.deepEqual(heard, ['failed']);
  assert.equal(reliefImage().state, 'failed');
});

test('onload with an empty image (naturalWidth 0): failed', () => {
  const { made, make } = fakeImages();
  const reliefImage = createReliefLoader('relief.png', make);
  reliefImage();
  made[0].onload();
  assert.equal(reliefImage().state, 'failed');
});

test('unsubscribe stops the notices', () => {
  const { made, make } = fakeImages();
  const reliefImage = createReliefLoader('relief.png', make);
  const heard = [];
  const { unsubscribe } = reliefImage(s => heard.push(s));
  unsubscribe();
  made[0].onerror();
  assert.deepEqual(heard, []);
});
