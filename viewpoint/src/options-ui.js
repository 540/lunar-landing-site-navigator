// The drawer of options (E8.2, #498): language, region (exploration only), graphics quality and layers. The rules are in
// core/options.js, the open / close and keys in core/options-drawer.js; this fills the texts and wires the controls.
import { UI, LANG } from './texts.js';
import { mountLangToggle } from '../../shared/i18n/page.js';
import { createDrawer } from './core/options-drawer.js';
import { browserStorage, loadOptions, saveOptions, QUALITY_CHOICES, layersFor, optionGroups } from './core/options.js';

const $ = id => document.getElementById(id);
const storage = browserStorage();

let state = loadOptions(storage);
let currentView = null;
let repaintGround = () => {};
const layerBoxes = {};

/** Applies a layer: the panel and the labels by a class on <body> (CSS hides them), the ground detail in the scene. */
function applyLayer(id, on) {
  if (id === 'ground') { currentView?.ground?.setMicro(on); repaintGround(); }
  else document.body.classList.toggle(`layer-off-${id}`, !on);
}

/** A layer changed from somewhere else (the «Textura fina» button): the box and the stored options follow. */
export function setLayer(id, on) {
  if (state.layers[id] === on) return;
  state = { ...state, layers: { ...state.layers, [id]: on } };
  if (layerBoxes[id]) layerBoxes[id].checked = on;
  saveOptions(storage, state);
  applyLayer(id, on);
}

/** The scene is up: the ground detail takes the stored choice. */
/** @param repaint what repaints the «Textura fina» button, so it follows the layer */
export function attachView(view, repaint = () => {}) {
  currentView = view;
  repaintGround = repaint;
  applyLayer('ground', state.layers.ground);
}

export const layerOn = id => state.layers[id];

/**
 * @param {{ mission?: boolean, reload?: () => void }} opts mission: no region group (the viewer opens at the site of the
 * mission); reload: what a change of quality does (by default, reload the page).
 */
export function setupOptions({ mission = false, reload = () => location.reload() } = {}) {
  const T = UI.options;
  const groups = optionGroups({ mission });
  if (!groups.includes('region')) $('options-region-group').remove();
  $('options-btn-label').textContent = T.button;
  $('options-btn').title = T.buttonTitle;
  $('options-title').textContent = T.title;
  $('options-close').textContent = T.close;
  $('options-lang-title').textContent = T.lang;
  if ($('options-region-title')) $('options-region-title').textContent = T.region;
  $('options-quality-title').textContent = T.quality;
  $('options-quality-note').textContent = T.qualityNote;
  $('options-layers-title').textContent = T.layers;
  mountLangToggle($('options-lang'), { lang: LANG, buttonClass: 'topbar-btn' });

  const option = (type, name, value, label, checked) => {
    const wrap = document.createElement('label');
    wrap.className = 'options__choice';
    const input = document.createElement('input');
    Object.assign(input, { type, name, value, checked });
    wrap.append(input, Object.assign(document.createElement('span'), { textContent: label }));
    return { wrap, input };
  };
  let pending = state.quality;
  const apply = $('options-quality-apply');
  apply.textContent = T.qualityApply;
  apply.disabled = true;
  apply.addEventListener('click', () => {
    if (pending === state.quality) return;
    state = { ...state, quality: pending };
    saveOptions(storage, state);
    reload();
  });
  for (const level of QUALITY_CHOICES) {
    const { wrap, input } = option('radio', 'quality', level, T.qualityChoices[level], state.quality === level);
    // Moving between radios with the arrows only picks; the view reloads on «Aplicar» (WCAG 3.2.2)
    input.addEventListener('change', () => { pending = level; apply.disabled = pending === state.quality; });
    $('options-quality').append(wrap);
  }
  for (const id of layersFor({ mission })) {
    const { wrap, input } = option('checkbox', 'layer', id, T.layerChoices[id], state.layers[id]);
    input.addEventListener('change', () => setLayer(id, input.checked));
    layerBoxes[id] = input;
    $('options-layers').append(wrap);
    applyLayer(id, state.layers[id]);
  }
  if (mission) $('options-layers').closest('fieldset').dataset.mission = 'true';

  const drawer = createDrawer({ dialog: $('options'), button: $('options-btn'), doc: document });
  $('options-close').addEventListener('click', drawer.close);
  return drawer;
}
