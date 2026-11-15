// Fixed texts of public API v1 that the tests also need without importing the engine (importing v1.ts loads the
// terrain catalogue, and some tests must set LUNAR_TERRAIN_DIR first).

/** Added to the `note` of /v1/rank when no `panel` is asked for (since 1.9.0; /v1/landing-dates already said it). */
export const TRACKING_NOTE = 'La energía supone un panel que sigue al Sol (incidencia normal); usa panel para otra orientación.';

/**
 * Where the battery defaults come from, as the response says it since 1.22.1 (#255): the 100 W from Cataldo et al. 2018
 * and 200 Wh/kg and 0.9 from COMPASS. Until 1.22.0 it credited COMPASS for the three; test/contract.ts puts the old text
 * back to keep comparing with the stored bodies. The checked passages are in BATTERY_DEFAULTS (backend/src/night.ts).
 */
export const BATTERY_DEFAULTS_SOURCES = 'Valores por defecto: 100 W de Cataldo, Zacny y Schmitz (NASA GRC, NETS 2018, apartado IV); '
  + '200 Wh/kg y profundidad de descarga 0,9 del estudio COMPASS de NASA GRC «Overnight Power & Thermal Solutions for '
  + 'Lunar Landers» (2022, transparencia 15).';
