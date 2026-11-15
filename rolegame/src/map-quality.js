// Quality of the map (J4.3): the same levels and the same stored level as the home page, the viewpoint and the 3D
// sky (shared/render/quality.js). The game never measures nor stores: the home page does (#143). Pure: no DOM.
import { resolveQuality } from '../../shared/render/quality.js';

// What each level draws: the full horizon with penumbra, or the low one with all-or-nothing Sun.
export const MAP_LEVELS = Object.freeze({
  alto: Object.freeze({ horizon: 'full', penumbra: true }),
  medio: Object.freeze({ horizon: 'full', penumbra: true }),
  bajo: Object.freeze({ horizon: 'low', penumbra: false }),
});

// params: URLSearchParams (?q=); signals: readSignals; stored: decodeStored; tooSlow: decodeStoredTooSlow (#144).
// → { mode: 'gl' | '2d', level, source: 'url' | 'stored' | 'auto', horizon: 'full' | 'low', penumbra }
export function mapQuality({ params, signals = {}, stored = null, tooSlow = false, webgl }) {
  const { level, source } = resolveQuality({ params, signals, stored });
  const mode = !webgl || signals.softwareRenderer === true || tooSlow === true ? '2d' : 'gl';
  return { mode, level, source, ...MAP_LEVELS[level] };
}
