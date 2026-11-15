// Cliente mínimo de la API de datos (data/openapi.yaml). Solo lo que necesita el evaluador.
import { fromApi } from './rules.js';
import { API_URL } from './config.js';

export const DEFAULT_API = API_URL;
const DAY_MS = 24 * 3600e3;
const MAX_RANGE_DAYS = 366; // límite de /v1/windows

async function get(baseUrl, path, params) {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new Error(`No se pudo conectar con la API de datos en ${baseUrl}. ¿Está arrancada? (npm start en data/)`, { cause });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `La API de datos respondió ${response.status}`);
  return body;
}

/** `site` es un id del catálogo, o un objeto { lat, lon, heightKm? } para coordenadas libres. */
const siteParams = (site) => (typeof site === 'string' ? { site } : { lat: site.lat, lon: site.lon, heightKm: site.heightKm });

export const listSites = (baseUrl = DEFAULT_API) => get(baseUrl, '/v1/sites', {});

export const health = (baseUrl = DEFAULT_API) => get(baseUrl, '/v1/health', {});

/**
 * Ventanas de visibilidad del sitio en [start, end], ya en el formato del evaluador. Si el perfil pide un `mode`
 * distinto para el Sol y para la Tierra, hace dos llamadas: la API aplica el mismo `mode` a los dos cuerpos.
 * Con `terrain` pide el relieve (`terrain=1`); si la API lo aplica, `site.horizonModel` pasa a `mask`.
 * `panelHeightM` y `antennaHeightM` (API 1.6.0) son las alturas del panel (decide el Sol) y de la antena (la
 * Tierra); solo se mandan con `terrain`. Con `maxSlopeDeg` pide además la pendiente (`slope=1`, API 1.7.0) para R9.
 * Con `horizonBandDeg` (API 1.18.0) pide la banda de robustez del horizonte: el resultado lleva `horizonBand`, las
 * ventanas con el horizonte subido y bajado esos grados. Con `dsn` (API 1.24.0) pide el modo DSN: el resultado lleva
 * `earthDsn`, las ventanas con la Tierra visible y la Luna sobre alguna estación de la Deep Space Network.
 */
export async function loadWindows({ baseUrl = DEFAULT_API, site, start, end, sunMode = 'full', earthMode = 'full', terrain = false, observerHeightM, panelHeightM, antennaHeightM, maxSlopeDeg, horizonBandDeg, dsn = false }) {
  const startMs = Date.parse(start), endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new Error('start y end deben ser fechas ISO 8601, con end posterior a start');
  if (endMs - startMs > MAX_RANGE_DAYS * DAY_MS) throw new Error(`El periodo no puede pasar de ${MAX_RANGE_DAYS} días: es el límite de /v1/windows`);
  const query = {
    ...siteParams(site), start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(),
    ...(terrain ? { terrain: 1, observerHeightM, panelHeightM, antennaHeightM } : {}),
    ...(horizonBandDeg > 0 ? { horizonBandDeg } : {}),
    ...(dsn ? { dsn: 1 } : {}),
  };
  // The slope depends only on the place: asking once is enough.
  const slope = maxSlopeDeg !== undefined && maxSlopeDeg !== null ? { slope: 1, maxSlopeDeg } : {};
  const sunResponse = await get(baseUrl, '/v1/windows', { ...query, ...slope, mode: sunMode });
  const earthResponse = earthMode === sunMode ? sunResponse : await get(baseUrl, '/v1/windows', { ...query, mode: earthMode });
  const w = fromApi(sunResponse, earthResponse);
  // Con terrain=1 la API dice en `terrain.applied` si encontró máscara; `site.horizonModel` no lo refleja en sitios libres.
  const withMask = sunResponse.terrain?.applied && earthResponse.terrain?.applied;
  return withMask ? { ...w, site: { ...w.site, horizonModel: 'mask' } } : w;
}
