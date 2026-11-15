// Options of the lookout (E8.2, #498): graphics quality and visible layers, and how they are stored. Pure: the storage
// comes in as an argument (anything with getItem / setItem), so node:test can check it without a browser.
import { LEVELS } from '../../../shared/render/quality.js';

export const OPTIONS_KEY = 'llsn.viewpoint.options';

/** Quality choices of the drawer: «auto» is today's behaviour (the device decides); the rest force a level. */
export const QUALITY_CHOICES = Object.freeze(['auto', ...Object.keys(LEVELS).reverse()]);

/** Layers that can be switched: the light and Earth panel, the Sun and Earth labels and the fine detail of the ground. */
export const LAYER_IDS = Object.freeze(['panel', 'labels', 'ground']);

export const DEFAULT_OPTIONS = Object.freeze({
  quality: 'auto',
  layers: Object.freeze({ panel: true, labels: true, ground: true }),
});

/** Options from a stored string; anything missing, wrong or corrupt falls back to the default for that value. */
export function decodeOptions(raw) {
  let value = null;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : null; } catch { value = null; }
  const stored = value && typeof value === 'object' ? value : {};
  const layers = stored.layers && typeof stored.layers === 'object' ? stored.layers : {};
  return {
    quality: QUALITY_CHOICES.includes(stored.quality) ? stored.quality : DEFAULT_OPTIONS.quality,
    layers: Object.fromEntries(LAYER_IDS.map(id => [id, typeof layers[id] === 'boolean' ? layers[id] : DEFAULT_OPTIONS.layers[id]])),
  };
}

export const encodeOptions = options => JSON.stringify(decodeOptions(JSON.stringify(options)));

/** localStorage of the browser, or null where it is blocked or does not exist (node:test). */
export const browserStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function loadOptions(storage) {
  try { return decodeOptions(storage?.getItem(OPTIONS_KEY)); } catch { return decodeOptions(null); }
}

/** Saves the options; in private mode or with the storage full they are simply not remembered. */
export function saveOptions(storage, options) {
  try { storage?.setItem(OPTIONS_KEY, encodeOptions(options)); } catch { /* not saved */ }
}

/** The level the options force, or null for «auto». It goes to resolveQuality as `stored`, so ?q= in the URL still wins. */
export const forcedLevel = options => (options.quality === 'auto' ? null : options.quality);

/** Groups of the drawer in order. The mission viewer has no region selector: it opens at the site of the mission. */
export const optionGroups = ({ mission = false } = {}) => ['lang', 'region', 'quality', 'layers'].filter(g => !(mission && g === 'region'));

/**
 * Whether a key press opens or closes the drawer: O alone, not repeated, not while a form control or another modal (the
 * tutorial, «Fuentes») has the keys. `modalOpen` tells if any dialog is open; the drawer itself does not count.
 */
export function isOptionsKey(ev, { isFormTarget, modalOpen, drawerOpen }) {
  if (ev.key !== 'o' && ev.key !== 'O') return false;
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat) return false;
  if (isFormTarget(ev.target)) return false;
  return !(modalOpen && !drawerOpen);
}

/** Layers the drawer offers: the panel of light and Earth only exists in the exploration. */
export const layersFor = ({ mission = false } = {}) => LAYER_IDS.filter(id => !(mission && id === 'panel'));
