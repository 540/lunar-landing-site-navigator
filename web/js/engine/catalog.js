// Site catalogue, mission profiles and data sources (ported from prototipo/js/datos.js).
// The sites with real coordinates come from backend/src/sites.ts through web/data/sites.json (web/scripts/build-sites.mjs):
// do not type their coordinates here. This file only adds what the web needs and the illustrative sites the backend lacks.
import CATALOG from '../../data/sites.json' with { type: 'json' };
import { fmtNum } from '../../../shared/format/number.js';
import { t } from '../common/i18n.js';

// Radius of the south-pole map (common/map.js): a site farther from the pole is `offMap`, out of the polar zone of Plan
// and of the simulated engine's invented terrain.
export const POLAR_MAP_RADIUS_KM = 190;
const KM_PER_DEGREE = (Math.PI / 180) * 1737.4;

// Groups of the site pickers, in order. A backend site goes to the group of its `program`; an unknown program, to the last.
// Labels in the dictionary: common.group.<id>.
export const SITE_GROUPS = [
  { id: 'south-pole', programs: ['Artemis (zona)'] },
  { id: 'clps', programs: ['CLPS'] },
  { id: 'apollo', programs: ['Apollo'] },
  { id: 'other', programs: [] },
].map(g => ({ ...g, label: t(`common.group.${g.id}`) }));

// Not in the backend: places of the polar zone with APPROXIMATE coordinates (`approximate: true`), kept because they have
// LOLA relief in viewpoint/data/ and give the zone search and Replan nearby alternatives.
const ILLUSTRATIVE = [
  { id: 'ridge-slope', lat: -89.463, lon: -151.2 },
  { id: 'malapert', lat: -86.0, lon: 0.0 },
  { id: 'gerlache', lat: -87.97, lon: -87.1 },
].map(s => ({ ...s, program: 'Artemis (zona)', verified: false, approximate: true }));
export const APPROXIMATE_LABEL = t('common.site.approximate');
/** Why a control site is in the catalogue, in a few words («¿Dónde?»); '' for any other site. */
export const controlHint = s => (s.control ? t(`common.control.${s.control}.hint`) : '');

// Name, short name and note of each site in the dictionary (common.site.<id>.…); a backend name with no entry is kept.
const text = (key, fallback) => { const v = t(key); return v === key ? fallback : v; };
const groupOf = program => (SITE_GROUPS.find(g => g.programs.includes(program)) ?? SITE_GROUPS.at(-1)).id;
const withWeb = s => {
  const name = text(`common.site.${s.id}.name`, s.name);
  const control = CONTROL_CASES.find(c => c.siteId === s.id)?.id;
  return { ...s, name, short: text(`common.site.${s.id}.short`, name), note: text(`common.site.${s.id}.note`, ''),
    group: groupOf(s.program), offMap: (90 + s.lat) * KM_PER_DEGREE > POLAR_MAP_RADIUS_KM, ...(control ? { control } : {}) };
};

// Control cases (#102): places whose answer is known without any software, the first thing an expert tries. If the tool
// gets one wrong, the error is ours. web/test/control-cases.test.js checks each one with the real and the simulated
// engine. A case of the catalogue (`siteId`) marks its site with `control`, and «¿Dónde?» says why it is there; the exact
// pole is not a landing site, only a check. `source`: where the coordinates come from (the one of backend/src/sites.ts,
// which sites.json leaves out; the test keeps them equal). Texts in the dictionary: common.control.<id>.…
export const CONTROL_CASES = [
  { id: 'far-side', siteId: 'change4', source: 'https://lroc.im-ldi.com/images/1100' },
  { id: 'near-side', siteId: 'apollo15', source: null },
  { id: 'pole', siteId: null, source: null },
];

/** Every site, by group and, inside each group, in the order of the backend catalogue, then the illustrative ones. */
export const SITES = SITE_GROUPS.flatMap(g => [...CATALOG.sites, ...ILLUSTRATIVE].map(withWeb).filter(s => s.group === g.id));

/** Sites grouped for a picker: [{ id, label, sites }], without empty groups. */
export const siteGroups = (sites = SITES) => SITE_GROUPS.map(g => ({ id: g.id, label: g.label, sites: sites.filter(s => s.group === g.id) })).filter(g => g.sites.length);

// EXAMPLE mission profiles. Each mission must provide its real thresholds.
// transitDays: Earth → Moon trip, only to turn the landing date into the launch date (#67). It does not change any
// verdict. Each one comes from a real mission of its kind (transitSource).
// craftClass: its class of spacecraft (CRAFT_CLASSES of coherence.js, #252): it only sets the believable ranges.
// panel: how its solar panel is mounted (engine/panel.js, #254): it only changes the energy, never the verdict. The three
// carry vertical panels, as polar spacecraft do (Astrobotic's Payload User's Guide: «polar missions utilize side-mounted
// panels»; VIPER on three faces; Starship HLS on its side). Of the orientations the engine knows, the nearest is the
// vertical one that turns towards the Sun: panels on several faces, or a rover that turns them, see it all day long.
const profile = (id, p) => ({ id, name: t(`common.profile.${id}.name`), ...p, source: t(`common.profile.${id}.source`), transitSource: t(`common.profile.${id}.transitSource`) });
export const PROFILES = [
  profile('small-robotic', { craftClass: 'small-lander', days: 10, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48, transitDays: 8, transitRef: 'IM-1', panel: 'vertical-rotating' }),
  profile('artemis', { craftClass: 'crewed', days: 6.5, batteryHours: 4, minEarthPct: 80, maxEarthGapHours: 24, transitDays: 6, transitRef: 'Orion en Artemis', panel: 'vertical-rotating' }),
  profile('rover', { craftClass: 'rover', days: 14, batteryHours: 48, minEarthPct: 40, maxEarthGapHours: 72, transitDays: 46, transitRef: 'Blue Ghost M1', panel: 'vertical-rotating' }),
];

/** The assumption behind a launch date, for the user: «si tarda 8 d, como IM-1», or without a mission if the transit is custom. */
export const transitNote = days => {
  const p = PROFILES.find(x => x.transitDays === days);
  return p ? t('common.transit.like', { days: fmtNum(days), ref: t(`common.profile.${p.id}.transitRef`) }) : t('common.transit.custom', { days: fmtNum(days) });
};

// A spacecraft of the user's own (#251): no example thresholds, the user types the requirements.
export const CUSTOM_PROFILE = { id: 'custom', name: t('common.profile.custom.name'), custom: true };

/** The profile with that id: an example one, or the user's own spacecraft for any other id (or none). */
export const profileById = id => PROFILES.find(p => p.id === id) ?? CUSTOM_PROFILE;

/** Where the thresholds and the transit of a profile come from, in one line: for the user's own spacecraft, that the
 * user sets them (#251); empty without a profile (a plan link without ?profile= or with an unknown one). */
export const profileSource = p => (!p ? '' : p.custom
  ? t('common.profile.custom.source')
  : t('common.profile.sourceLine', { source: p.source, days: fmtNum(p.transitDays), transit: p.transitSource }));

// The requirements of a profile, as the Plan form holds them (strings, like the values of its fields).
const REQUIREMENT_KEYS = ['days', 'batteryHours', 'minEarthPct', 'maxEarthGapHours', 'transitDays'];
/** Whether the requirements typed in (days, batteryHours, …; numbers or strings) are still those of example profile p. */
export const matchesProfile = (p, values) => !!p && !p.custom &&
  REQUIREMENT_KEYS.every(k => String(values[k] ?? '').trim() !== '' && +values[k] === p[k]);

/**
 * The profile id of a plan that names `id` and carries these requirements (a link, the history, an adopted plan): the
 * example profile while they are still its own, the user's own spacecraft once one was changed by hand (#251). A plan
 * without a transit takes its profile's.
 */
export function profileFor(id, values) {
  const p = PROFILES.find(x => x.id === id);
  return p && matchesProfile(p, { ...values, transitDays: values.transitDays ?? p.transitDays }) ? p.id : CUSTOM_PROFILE.id;
}

/**
 * What screen readers are told when the chosen profile changes from `before` to `after` by a requirement typed by hand
 * (#251): only the switch from an example spacecraft to the user's own one is announced; anything else, nothing ('').
 */
export function profileSwitchNotice(before, after) {
  return PROFILES.some(p => p.id === before) && after === CUSTOM_PROFILE.id
    ? t('common.profile.switchNotice', { name: CUSTOM_PROFILE.name }) : '';
}

/**
 * The requirements the Plan form shows on choosing profile p, given those on screen (`current`): an example profile's
 * own; for the user's own spacecraft, empty to type them in, except when they are to be kept (`keep`: once there is a
 * result, so the result on screen still answers the requirements beside it, or when it was already the chosen one, so
 * confirming its card does not erase what was typed) (#251).
 */
export function requirementsOnChoose(p, current, { keep = false } = {}) {
  return Object.fromEntries(REQUIREMENT_KEYS.map(k => [k, !p.custom ? p[k] : keep ? current[k] : '']));
}

export const INITIAL_DATE = '2027-04-03T12:00';


// Full bibliographic references of the studies, reports and presentations (#494), copied as published (Crossref and NTRS,
// checked 2026-11-15). Language-neutral: they are not translated, only the conjunction before the last author is.
// authors: «Surname, I.» each; etAl: the list is cut and ends in «et al.». id: { doi } or { ntrs }.
const REFS = {
  glaser2018: { authors: ['Gläser, P.', 'Oberst, J.', 'Neumann, G. A.', 'Mazarico, E.', 'Speyerer, E. J.', 'Robinson, M. S.'], year: 2018, title: 'Illumination conditions at the lunar poles: Implications for future exploration', venue: 'Planetary and Space Science, 162, 170–178', doi: '10.1016/j.pss.2017.07.006' },
  leone2023: { authors: ['Leone, G.', 'Ahrens, C.', 'Korteniemi, J.', 'Gasparri, D.', 'Kereszturi, A.', 'Martynov, A.', 'Schmidt, G. W.', 'Calabrese, G.', 'Joutsenvaara, J.'], year: 2023, title: 'Sverdrup-Henson crater: A candidate location for the first lunar South Pole settlement', venue: 'iScience, 26(10), 107853', doi: '10.1016/j.isci.2023.107853' },
  mazarico2011: { authors: ['Mazarico, E.', 'Neumann, G. A.', 'Smith, D. E.', 'Zuber, M. T.', 'Torrence, M. H.'], year: 2011, title: 'Illumination conditions of the lunar polar regions using LOLA topography', venue: 'Icarus, 211(2), 1066–1081', doi: '10.1016/j.icarus.2010.10.030' },
  barker2021: { authors: ['Barker, M. K.', 'Mazarico, E.', 'Neumann, G. A.', 'Smith, D. E.', 'Zuber, M. T.', 'Head, J. W.'], year: 2021, title: 'Improved LOLA elevation maps for south pole landing sites: Error estimates and their impact on illumination conditions', venue: 'Planetary and Space Science, 203, 105119', doi: '10.1016/j.pss.2020.105119' },
  barker2023: { authors: ['Barker, M. K.', 'Mazarico, E.', 'Neumann, G. A.', 'Smith, D. E.', 'Zuber, M. T.', 'Head, J. W.', 'Sun, X.'], year: 2023, title: 'A New View of the Lunar South Pole from the Lunar Orbiter Laser Altimeter (LOLA)', venue: 'The Planetary Science Journal, 4(9), 183', doi: '10.3847/PSJ/acf3e1' },
  colaprete2010: { authors: ['Colaprete, A.', 'Schultz, P.', 'Heldmann, J.', 'Wooden, D.', 'Shirley, M.', 'Ennico, K.'], etAl: true, year: 2010, title: 'Detection of Water in the LCROSS Ejecta Plume', venue: 'Science, 330(6003), 463–468', doi: '10.1126/science.1186986' },
  archinal2018: { authors: ['Archinal, B. A.', 'Acton, C. H.', 'A’Hearn, M. F.', 'Conrad, A.', 'Consolmagno, G. J.', 'Duxbury, T.'], etAl: true, year: 2018, title: 'Report of the IAU Working Group on Cartographic Coordinates and Rotational Elements: 2015', venue: 'Celestial Mechanics and Dynamical Astronomy, 130(3), 22', doi: '10.1007/s10569-017-9805-5' },
  cataldo2018: { authors: ['Cataldo, R.', 'Zacny, K.', 'Schmitz, P.'], year: 2018, title: 'Radioisotope Power Systems to Enable Extended Lunar Science and In-Situ Resource Utilization Missions', venue: 'Nuclear and Emerging Technologies for Space (NETS 2018), American Nuclear Society', ntrs: '20180004489' },
  compass2022: { authors: ['Oleson, S.', 'Colozza, A. J.', 'Uguccini, N.'], year: 2022, title: 'Overnight Power & Thermal Solutions for Lunar Landers', venue: 'Commercial Lunar Payload Services (CLPS) Survive the Night Technology Workshop', ntrs: '20220018215' },
  bluethmann2024: { authors: ['Bluethmann, B.'], year: 2024, title: 'VIPER Rover Overview and Mobility and Hardware', venue: 'Lunar Surface Innovation Consortium', ntrs: '20240013903' },
  ortiz2025: { authors: ['Ortiz, L.', 'Dwyer Cianciolo, A.'], year: 2025, title: 'Artemis Human Landing System Overview: NASA 2025 International SPACE APPS Challenge', venue: null, ntrs: '20250009323' },
  taylor2023: { authors: ['Taylor, C.', 'Pappa, R.'], year: 2023, title: 'Game Changing Development Program – Vertical Solar Array Technology (VSAT) Project', venue: 'Game Changing Development Annual Program Review', ntrs: '20230012849' },
  captain2026: { authors: ['Captain, J.', 'Aguilar Ayala, B.', 'Hancock, M.', 'Archer, D.', 'McAdam, A.', 'Jarnot, A.', 'Gawronska, A.', 'Kleinhenz, J.'], etAl: true, year: 2026, title: 'Prime-1: MSolo Overview and Results', venue: 'Lunar Surface Science Workshop', ntrs: '20260003150' },
  belbin2024: { authors: ['Belbin, S.', 'Mills, C.', 'Chan, R.'], year: 2024, title: 'Government Reference Design of the Vertical Solar Array Technology Demonstrator', venue: '47th Aerospace Mechanisms Symposium', ntrs: '20240004914' },
  creech2025: { authors: ['Creech, S.'], year: 2025, title: 'Update on NASA’s Human Landing System (HLS) Program: Public-Private Partnership Advancing Artemis Sustainable Lunar Exploration', venue: '76th International Astronautical Congress', ntrs: '20250008728' },
  galedd2007: { authors: ['Gal-Edd, J.', 'Fatig, C.', 'Schier, J.', 'Lee, C.'], year: 2007, title: 'The Earth Based Ground Stations Element of the Lunar Program', venue: '13th Ka and Broadband Communications Conference', ntrs: '20070036261' },
  bleacher2024: { authors: ['Bleacher, J. E.', 'George, T.', 'Esty, C. C.'], year: 2024, title: 'Lunar Site Selection', venue: 'NASA white paper', ntrs: '20230016267' },
};

/** The parts of a reference, ready to render: authors (with the conjunction of the language), year, title, venue and identifier. */
export function citationParts(ref) {
  const a = ref.authors;
  const authors = ref.etAl ? `${a.join(', ')}, et al.` : a.length < 2 ? a[0] : `${a.slice(0, -1).join(', ')} ${t('sources.cite.and')} ${a.at(-1)}`;
  const id = ref.doi ? { text: `doi:${ref.doi}`, href: `https://doi.org/${ref.doi}` } : { text: `NASA NTRS ${ref.ntrs}`, href: `https://ntrs.nasa.gov/citations/${ref.ntrs}` };
  return { authors, year: ref.year, title: ref.title, venue: ref.venue, id };
}

/** A reference as plain text: «Authors (year). Title. Venue. doi:…». */
export function citationText(ref) {
  const { authors, year, title, venue, id } = citationParts(ref);
  return `${authors} (${year}). ${title}. ${venue ? `${venue}. ` : ''}${id.text}`;
}

// Fields with words (organisation, citation) that differ by language are not here but in the dictionary (…i<item>.org, .cite).
// refs: keys of REFS, the full citations of the studies the entry rests on (#494).
// Data sources and what the product does with each one today (#473). Language-neutral fields here (link, organisation,
// version, citation, licence); the name, purpose and group title are in the dictionary by position (sources.g<group>.…
// of i18n/sources.js), in Spanish and in English. status: used (in the calculation), validation (only to check it),
// asset (image, model or library the screens load) or reference (to look at by hand, or not used).
// license.kind: MIT and Apache-2.0 as the project's own LICENSE says; public: «dominio público» as the repo already stated;
// terms: the licence was not confirmed, so only the link to its terms of use is given and none is invented.
const SOURCE_DEFS = [
  [
    { url: 'https://github.com/cosinekitty/astronomy', version: '2.1.19', refs: ['archinal2018'], license: { kind: 'MIT', url: 'https://github.com/cosinekitty/astronomy/blob/master/LICENSE' }, status: 'used' },
    { url: 'https://ssd.jpl.nasa.gov/api/horizons.api', org: 'NASA/JPL Solar System Dynamics', version: 'DE441, MEAN_ME', license: { kind: 'terms', url: 'https://ssd.jpl.nasa.gov/horizons/' }, status: 'validation' },
    { url: 'https://ssd.jpl.nasa.gov/horizons/', org: 'NASA/JPL Solar System Dynamics', license: { kind: 'terms', url: 'https://ssd.jpl.nasa.gov/horizons/' }, status: 'reference' },
    { url: 'https://naif.jpl.nasa.gov/naif/toolkit.html', org: 'NASA/JPL NAIF', license: { kind: 'terms', url: 'https://naif.jpl.nasa.gov/naif/rules.html' }, status: 'reference' },
  ],
  [
    { url: 'https://pgda.gsfc.nasa.gov/products/90', org: 'NASA GSFC, Planetary Geodesy Data Archive (PGDA)', refs: ['barker2023'], license: { kind: 'terms', url: 'https://pgda.gsfc.nasa.gov/products/90' }, status: 'used' },
    { url: 'https://pgda.gsfc.nasa.gov/products/90', org: 'NASA GSFC, PGDA', refs: ['barker2023'], license: { kind: 'terms', url: 'https://pgda.gsfc.nasa.gov/products/90' }, status: 'used' },
    { url: 'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp', org: 'NASA GSFC, PGDA', refs: ['barker2021'], license: { kind: 'terms', url: 'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp' }, status: 'used' },
    { url: 'https://pgda.gsfc.nasa.gov/products/90', license: { kind: 'terms', url: 'https://pgda.gsfc.nasa.gov/products/90' }, status: 'asset' },
    { url: 'https://pgda.gsfc.nasa.gov/products/90', license: { kind: 'terms', url: 'https://pgda.gsfc.nasa.gov/products/90' }, status: 'used' },
    { url: 'https://pgda.gsfc.nasa.gov/products/90', org: 'NASA GSFC, PGDA', refs: ['barker2023'], license: { kind: 'terms', url: 'https://pgda.gsfc.nasa.gov/products/90' }, status: 'validation' },
    { url: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm', org: 'PDS Geosciences Node (Washington University in St. Louis)', license: { kind: 'terms', url: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm' }, status: 'reference' },
  ],
  [
    { url: 'https://pgda.gsfc.nasa.gov/products/69', version: '201608', refs: ['mazarico2011'], license: { kind: 'terms', url: 'https://pgda.gsfc.nasa.gov/products/69' }, status: 'validation' },
    { url: 'https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf', refs: ['glaser2018'], license: { kind: 'terms', url: 'https://ntrs.nasa.gov/citations/20170007365' }, status: 'validation' },
    { url: 'https://doi.org/10.1016/j.isci.2023.107853', org: 'Leone et al.', refs: ['leone2023'], license: { kind: 'terms', url: 'https://doi.org/10.1016/j.isci.2023.107853' }, status: 'validation' },
    { url: 'https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_POLE_ILL_PCT_SOUTH', org: 'NASA/ASU, LROC', license: { kind: 'terms', url: 'https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_POLE_ILL_PCT_SOUTH' }, status: 'reference' },
  ],
  [
    { url: 'https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301D.pdf', org: 'NASA/JPL, Deep Space Network', license: { kind: 'terms', url: 'https://deepspace.jpl.nasa.gov/dsndocs/810-005/' }, status: 'used' },
  ],
  [
    { url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/', org: 'NASA', license: { kind: 'terms', url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' }, status: 'used' },
    { url: 'https://www.nasa.gov/missions/artemis/nasa-shares-plans-to-accelerate-artemis-return-to-moon/', org: 'NASA', license: { kind: 'terms', url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' }, status: 'used' },
    { url: 'https://lroc.im-ldi.com/images/1360', org: 'NASA/ASU, LROC', license: { kind: 'terms', url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' }, status: 'used' },
    { url: 'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html', org: 'NASA GSFC, NSSDC', license: { kind: 'terms', url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' }, status: 'validation' },
    { url: 'https://ntrs.nasa.gov/citations/20260003150', refs: ['captain2026'], license: { kind: 'terms', url: 'https://ntrs.nasa.gov/citations/20260003150' }, status: 'validation' },
    { url: 'https://planetarynames.wr.usgs.gov/', org: 'IAU/USGS Astrogeology', refs: ['colaprete2010'], license: { kind: 'terms', url: 'https://planetarynames.wr.usgs.gov/' }, status: 'used' },
    { url: 'https://quickmap.lroc.asu.edu/', org: 'NASA/ASU, LROC', license: { kind: 'terms', url: 'https://quickmap.lroc.asu.edu/' }, status: 'reference' },
    { url: 'https://trek.nasa.gov/moon/', org: 'NASA JPL, Solar System Exploration', license: { kind: 'terms', url: 'https://trek.nasa.gov/moon/' }, status: 'reference' },
  ],
  [
    { url: 'https://ntrs.nasa.gov/api/citations/20250009323/downloads/ArtemisOverview2025IntSPAPPSChallenge.pdf', org: 'NASA (NTRS 20250009323)', refs: ['ortiz2025'], license: { kind: 'terms', url: 'https://ntrs.nasa.gov/citations/20250009323' }, status: 'used' },
    { url: 'https://ntrs.nasa.gov/api/citations/20230012849/downloads/GCD%20Annual%20Review%20VSAT%20September%202023%20Final.pdf', org: 'NASA (NTRS 20230012849)', refs: ['taylor2023'], license: { kind: 'terms', url: 'https://ntrs.nasa.gov/citations/20230012849' }, status: 'used' },
    { url: 'https://ntrs.nasa.gov/citations/20180004489', org: 'NASA GRC', refs: ['cataldo2018'], license: { kind: 'terms', url: 'https://ntrs.nasa.gov/citations/20180004489' }, status: 'used' },
    { url: 'https://ntrs.nasa.gov/citations/20220018215', refs: ['compass2022'], license: { kind: 'terms', url: 'https://ntrs.nasa.gov/citations/20220018215' }, status: 'used' },
    { url: 'https://ntrs.nasa.gov/citations/20240013903', org: 'NASA JSC', refs: ['bluethmann2024'], license: { kind: 'terms', url: 'https://ntrs.nasa.gov/citations/20240013903' }, status: 'reference' },
    { url: 'https://ntrs.nasa.gov/citations/20240004914', refs: ['belbin2024', 'creech2025', 'galedd2007'], license: { kind: 'terms', url: 'https://ntrs.nasa.gov/citations/20240004914' }, status: 'used' },
  ],
  [
    { url: 'https://svs.gsfc.nasa.gov/4720', org: 'NASA Scientific Visualization Studio', license: { kind: 'terms', url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' }, status: 'asset' },
    { url: 'https://visibleearth.nasa.gov/collection/1484/blue-marble', org: 'NASA Earth Observatory', license: { kind: 'public', url: 'https://visibleearth.nasa.gov/collection/1484/blue-marble' }, status: 'asset' },
    { url: 'https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Z2%20Spacesuit', org: 'NASA 3D Resources', license: { kind: 'public', url: 'https://github.com/nasa/NASA-3D-Resources' }, status: 'asset' },
    { url: 'https://threejs.org/', org: 'three.js authors', version: '0.160.0', license: { kind: 'MIT', url: 'https://github.com/mrdoob/three.js/blob/dev/LICENSE' }, status: 'asset' },
    { url: 'https://github.com/google-ai-edge/mediapipe', org: 'Google', version: '0.10.14', license: { kind: 'Apache-2.0', url: 'https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE' }, status: 'asset' },
    { url: 'https://fonts.google.com/', org: 'Google', license: { kind: 'terms', url: 'https://developers.google.com/fonts/faq' }, status: 'asset' },
  ],
  [
    { url: 'https://svs.gsfc.nasa.gov/', org: 'NASA Scientific Visualization Studio', license: { kind: 'terms', url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' }, status: 'reference' },
    { url: 'https://ntrs.nasa.gov/api/citations/20230016267/downloads/Lunar%20Site%20Selection.pdf', org: 'NASA (NTRS 20230016267)', refs: ['bleacher2024'], license: { kind: 'terms', url: 'https://ntrs.nasa.gov/citations/20230016267' }, status: 'reference' },
    { url: 'https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/', org: 'Spaceflight Now', license: { kind: 'terms', url: 'https://spaceflightnow.com/' }, status: 'reference' },
    { url: 'https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/', org: 'NASA Space Apps Challenge', license: { kind: 'terms', url: 'https://www.spaceappschallenge.org/' }, status: 'reference' },
  ],
];
// The citation is in the item or, if the dictionary has the key (t() returns the key itself when missing), in the dictionary.
const cite = (i, gi, ii) => i.cite ?? (t(`sources.g${gi}.i${ii}.cite`) !== `sources.g${gi}.i${ii}.cite` ? t(`sources.g${gi}.i${ii}.cite`) : undefined);
// Citations of an entry: full references (refs, from REFS) and, in the plain-text field `cite`, all of them joined.
export const SOURCES = SOURCE_DEFS.map((items, gi) => ({
  group: t(`sources.g${gi}.group`),
  note: t(`sources.g${gi}.note`) === `sources.g${gi}.note` ? '' : t(`sources.g${gi}.note`),
  items: items.map((i, ii) => ({
    ...i, name: t(`sources.g${gi}.i${ii}.name`), purpose: t(`sources.g${gi}.i${ii}.purpose`),
    // Organisation and citation that carry words come from the dictionary, so the English view has no Spanish in them.
    org: i.org ?? t(`sources.g${gi}.i${ii}.org`),
    ...(i.refs ? { references: i.refs.map(k => REFS[k]), cite: i.refs.map(k => citationText(REFS[k])).join(' · ') } : cite(i, gi, ii) ? { cite: cite(i, gi, ii) } : {}),
  })),
}));
