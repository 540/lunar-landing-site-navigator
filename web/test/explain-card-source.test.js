// The explanation card says the active data source (#338): with the API known but the mission service not loaded yet
// (Replan, or Plan before its first search), a card must not fall back to the sample-data text.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const cardEl = { innerHTML: '' };
globalThis.location = { search: '?debug=1', hash: '' };
globalThis.document = {
  getElementById: id => (id === 'explain-card' ? cardEl : null),
  addEventListener: () => {},
  querySelectorAll: () => [],
  documentElement: {},
};

const { state, services } = await import('../js/common/state.js');
const { renderCard } = await import('../js/common/explain.js');
const { EXPLANATIONS } = await import('../js/common/explanations.js');
const { esc } = await import('../js/common/util.js');

const KEY = 'scenarios';

test('renderCard: con la API conocida y el servicio de misión sin cargar, la ficha dice la fuente de la API', () => {
  const card = EXPLANATIONS[KEY];
  assert.ok(card.api && card.api !== card.demo, `${KEY} needs its own api text`);
  state.explain = true;
  state.card = { key: KEY, site: null };
  services.mission = { source: null };
  state.dataSource = 'api';
  renderCard();
  assert.ok(cardEl.innerHTML.includes(esc(card.api)), cardEl.innerHTML);
  assert.ok(!cardEl.innerHTML.includes(esc(card.demo)), cardEl.innerHTML);

  state.dataSource = 'fake';
  renderCard();
  assert.ok(cardEl.innerHTML.includes(esc(card.demo)));

  // The mission service, once it has loaded windows, wins over the source known at start.
  services.mission = { source: 'api' };
  renderCard();
  assert.ok(cardEl.innerHTML.includes(esc(card.api)));
});
