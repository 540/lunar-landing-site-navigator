// What the relief under the Advanced and Replan maps is, in a few words (#331). No DOM: tested in test/relief-note.test.js.
// The words come from the dictionary (i18n/common.js, common.relief.*), in the language of the page (#283).
// `state` is the state of the shared LOLA relief image (common/map.js, reliefImage()): 'loading' | 'ready' | 'failed'.
// `source` is where the verdicts come from: 'api' (data API), null/undefined (not known yet: no search, or the windows
// still loading) or anything else (the simulated engine). Only a known non-API source says «veredictos con datos de ejemplo».
// While loading, or if the image never loads, the maps draw the invented relief of the simulated engine: the note says it.
import { t } from './i18n.js';

export function reliefNote(state, source) {
  if (state === 'ready') return t(source === 'api' || source == null ? 'common.relief.lola' : 'common.relief.lolaSimulated');
  if (state === 'loading') return t('common.relief.loading');
  return t('common.relief.failed');
}

// The note under both south-pole maps (#344): which relief, whether part of the frame is hatched (beyond the relief
// image) and which way is up. `uncovered` comes from drawBaseMap() in common/map.js.
export function baseMapNote(state, source, { uncovered = false } = {}) {
  return [reliefNote(state, source), uncovered && t('common.map.hatched'), t('common.map.top')].filter(Boolean).join(' · ');
}
