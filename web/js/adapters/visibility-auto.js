// The visibility port every screen uses (docs/adr/0001): the data API if it answers, the simulated engine if not.
// By default it asks the data API (?api=… changes its URL); ?data=fake forces the simulated engine. If the API does not
// answer at start (GitHub Pages, or data/ not running) it falls back to the simulated engine. Plan, Advanced, Replan
// and the 3D viewer (viewpoint/) build their services on it, so they all give the same verdict.
import { fakeVisibility } from './visibility-fake.js';
import { apiVisibility } from './visibility-api.js';
import { t } from '../common/i18n.js';

/** @param {URLSearchParams} params → { visibility, api, useApi: Promise<boolean> } */
export function autoVisibility(params) {
  const api = apiVisibility({ baseUrl: params.get('api') || undefined });
  const useApi = params.get('data') === 'fake' ? Promise.resolve(false) : api.check().then(() => true, err => { console.warn(err.message); return false; });
  const adapter = async () => ((await useApi) ? api : fakeVisibility);
  const visibility = {
    loadWindows: async (...args) => (await adapter()).loadWindows(...args),
    loadSky: async (...args) => (await adapter()).loadSky(...args),
    loadRelief: async (...args) => (await adapter()).loadRelief(...args),
    loadLightMap: async (...args) => { const a = await adapter(); if (!a.loadLightMap) throw new Error(t('common.needsData', { what: t('common.needsApi.lightMap') })); return a.loadLightMap(...args); },
    loadBestLandings: async (...args) => { const a = await adapter(); if (!a.loadBestLandings) throw new Error(t('common.needsData', { what: t('common.needsApi.ranking') })); return a.loadBestLandings(...args); },
    loadSlope: async (...args) => { const a = await adapter(); if (!a.loadSlope) throw new Error(t('common.needsData', { what: t('common.needsApi.slope') })); return a.loadSlope(...args); },
    loadEnergy: async (...args) => { const a = await adapter(); if (!a.loadEnergy) throw new Error(t('common.needsData', { what: t('common.needsApi.energy') })); return a.loadEnergy(...args); },
    source: async () => ((await useApi) ? 'api' : 'fake'),
  };
  return { visibility, api, useApi };
}
