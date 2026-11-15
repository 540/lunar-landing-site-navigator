// The play buttons of Plan and Advanced share one playback (state.playing): both always show its real state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paintPlayButtons, PLAY_LABEL } from '../js/common/player.js';

const button = () => ({ textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });

test('mientras se reproduce, todos los botones dicen pausar', () => {
  const plan = button(), advanced = button();
  paintPlayButtons([plan, advanced], 7);
  for (const b of [plan, advanced]) { assert.equal(b.textContent, '❚❚'); assert.equal(b.attrs['aria-label'], PLAY_LABEL.pause); }
});

test('parada, todos dicen reproducir, aunque se pausara desde otra vista', () => {
  const plan = button(), advanced = button();
  paintPlayButtons([plan, advanced], 7);
  paintPlayButtons([plan, advanced], null); // paused from Advanced: Plan's button follows
  for (const b of [plan, advanced]) { assert.equal(b.textContent, '▶'); assert.equal(b.attrs['aria-label'], PLAY_LABEL.play); }
});

test('un botón que falta no rompe a los demás', () => {
  const plan = button();
  paintPlayButtons([null, plan], null);
  assert.equal(plan.textContent, '▶');
});
