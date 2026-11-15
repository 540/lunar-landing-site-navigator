// Curated list of sites. Selenographic lat/lon in degrees, east-positive longitude (Mean Earth frame).
// `verified: true` → coordinate checked against a published source (LROC/ASU or NASA), given in `source` when available.
// `verified: false` → approximate coordinate or no official source (see the site's comment).
// `source` is internal: public API v1 does not expose it (publicSite in data/src/v1.ts maps field by field).
import type { Site } from './types.ts';

export const SITES: readonly Site[] = [
  // Apollo (LROC coordinates of the lunar modules)
  { id: 'apollo11', name: 'Apollo 11', region: 'Mare Tranquillitatis', program: 'Apollo', lat: 0.67408, lon: 23.47297, verified: true },
  { id: 'apollo12', name: 'Apollo 12', region: 'Oceanus Procellarum', program: 'Apollo', lat: -3.01239, lon: -23.42157, verified: true },
  { id: 'apollo14', name: 'Apollo 14', region: 'Fra Mauro', program: 'Apollo', lat: -3.6453, lon: -17.47136, verified: true },
  { id: 'apollo15', name: 'Apollo 15', region: 'Hadley-Apennino', program: 'Apollo', lat: 26.13222, lon: 3.63386, verified: true },
  { id: 'apollo16', name: 'Apollo 16', region: 'Descartes', program: 'Apollo', lat: -8.97301, lon: 15.50019, verified: true },
  { id: 'apollo17', name: 'Apollo 17', region: 'Taurus-Littrow', program: 'Apollo', lat: 20.1908, lon: 30.77168, verified: true },
  // CLPS / commercial
  // IM-1 Odysseus (22 Feb 2024). LROC https://lroc.im-ldi.com/images/1360 : "Odysseus came to rest at 80.13°S, 1.44°E,
  //   2579 m elevation" (2 decimals: ≈ ±150 m in latitude, ±26 m in longitude).
  { id: 'im1', name: 'IM-1 Odysseus', region: 'Malapert A', program: 'CLPS', lat: -80.13, lon: 1.44, verified: true, source: 'https://lroc.im-ldi.com/images/1360' },
  // IM-2 Athena (6 Mar 2025). Sources per point, below (NASA/NTRS and LROC/ASU).
  //  - target (-84.7754, 29.1280): NASA, MSolo Science Team, "PRIME-1: MSolo Overview and Results" (Lunar Surface Science
  //    Workshop, Apr 2026), https://ntrs.nasa.gov/citations/20260003150 : "Target Landing: 84.7754° S, 29.1280° E"
  //    (4 decimals, ≈ ±1.5 m). Matches, after rounding, LROC https://lroc.im-ldi.com/images/1401 (-84.78°, 29.13°E).
  //    Target → actual ≈ 497 m, bearing ≈ 158° (SSE). Consistent with NASA RELEASE25-025 ("more than 1,300 feet (400 meters)")
  //    and with the "~500m from target" of the same source; Intuitive Machines said "250 meters" (7 Mar 2025), which does not fit.
  //  - actual landing (-84.7906, 29.1957): https://lroc.im-ldi.com/images/1408 (~20 m crater, lander tipped over; 4 decimals, ≈ ±5 m).
  { id: 'im2-objetivo', name: 'IM-2 Athena (objetivo)', region: 'Mons Mouton', program: 'CLPS', lat: -84.7754, lon: 29.128, verified: true, source: 'https://ntrs.nasa.gov/citations/20260003150' },
  { id: 'im2-alunizaje', name: 'IM-2 Athena (alunizaje real)', region: 'Mons Mouton', program: 'CLPS', lat: -84.7906, lon: 29.1957, verified: true, source: 'https://lroc.im-ldi.com/images/1408' },
  // Blue Ghost M1 (2 Mar 2025). LROC https://lroc.im-ldi.com/images/1407 : "The Blue Ghost lander (18.5623°N, 61.8103°E,
  //   -3650 meters elevation)" (4 decimals, ≈ ±1.5 m).
  { id: 'blueghost1', name: 'Blue Ghost M1', region: 'Mare Crisium', program: 'CLPS', lat: 18.5623, lon: 61.8103, verified: true, source: 'https://lroc.im-ldi.com/images/1407' },
  // Other programs
  // Chandrayaan-3 (23 Aug 2023). LROC https://lroc.im-ldi.com/images/1314 : "The Chandrayaan-3 landing site is located about
  //   600 kilometers from the south pole (69.3741°S, 32.32°E, 532 m elevation)" (latitude with 4 decimals; longitude with
  //   2 decimals, ≈ ±53 m at this latitude).
  { id: 'chandrayaan3', name: 'Chandrayaan-3', region: 'Shiv Shakti', program: 'ISRO', lat: -69.3741, lon: 32.32, verified: true, source: 'https://lroc.im-ldi.com/images/1314' },
  // SLIM (19 Jan 2024). LROC https://lroc.im-ldi.com/images/1358 : "The SLIM lander on the lunar surface (13.3160°S, 25.2510°E,
  //   -912 m elevation)" (4 decimals, ≈ ±1.5 m).
  { id: 'slim', name: 'SLIM', region: 'Cráter Shioli', program: 'JAXA', lat: -13.316, lon: 25.251, verified: true, source: 'https://lroc.im-ldi.com/images/1358' },
  // Chang'e 4 (3 Jan 2019). LROC https://lroc.im-ldi.com/images/1100 (NAC stereo DTM): "Arrow shows location of Chang'e 4
  //   lander with coordinates -5927 elevation, 45.4561°S latitude, 177.5885°E longitude"; "the uncertainty of the lander
  //   position is about 3 meters in latitude and longitude". Replaces the catalogue's previous value (-45.4446, 177.5991), ~415 m away.
  { id: 'change4', name: "Chang'e 4", region: 'Von Kármán', program: 'CNSA', lat: -45.4561, lon: 177.5885, verified: true, source: 'https://lroc.im-ldi.com/images/1100' },
  // Chang'e 6 (1 Jun 2024). LROC https://lroc.im-ldi.com/images/1374 : "The LROC team computed the landing site coordinates as
  //   41.6385°S, 206.0148°E, at -5256 meters elevation [...] with an estimated horizontal accuracy of plus-or-minus 30 meters"
  //   (206.0148°E = -153.9852 in −180..180).
  { id: 'change6', name: "Chang'e 6", region: 'Apollo (cuenca)', program: 'CNSA', lat: -41.6385, lon: -153.9852, verified: true, source: 'https://lroc.im-ldi.com/images/1374' },
  // South pole (points of interest, not landings)
  // shackleton-rim: point of interest, NOT a landing. It is the connecting ridge between Shackleton and de Gerlache (point C1
  //   of Gläser et al. 2018, "Illumination conditions at the lunar poles: Implications for future exploration", Planetary and
  //   Space Science 162, https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf : -89.4398°, 222.83°E,
  //   i.e. -137.17°), not the crater rim. The coordinate is the local maximum of the mean visible solar disc fraction in 2027
  //   (LOLA 20 m DEM, observer at 2 m), about 20 m from C1. It is ours, hence verified: false. The id is kept so as not to
  //   break its users (tour, game, planner, evals). Until Nov 2026 it was (-89.45, -137.0), ~300 m away, off the crest:
  //   mean visible solar disc fraction in 2027 at 2 m, 0.64 there against 0.87 here.
  {
    id: 'shackleton-rim', name: 'Cresta de conexión de Shackleton', region: 'Polo sur', program: 'Artemis (zona)', lat: -89.44027, lon: -137.12649, verified: false,
    source: 'https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf',
  },
];

export const getSite = (id: string | null): Site | null => SITES.find((s) => s.id === id) ?? null;
