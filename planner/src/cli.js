#!/usr/bin/env node
// Evalúa un aterrizaje desde la terminal contra la API de datos.
//
//   node src/cli.js --site shackleton-rim --date 2027-01-15
//   node src/cli.js --site apollo11 --date 2027-01-14 --profile short
//   node src/cli.js --site im1 --date 2027-02-01 --scan 90        ventanas de aterrizaje de los 90 días siguientes
//   node src/cli.js --site apollo11 --date 2027-01-14 --delay 10  replanificar con 10 días de retraso
//   node src/cli.js --lat -84.79 --lon 29.2 --date 2027-03-01     coordenadas libres
//   node src/cli.js --sites                                       catálogo de sitios
//
// Opciones: --profile <id> (clps-lunar-day por defecto) · --api <url> · --tolerance <días> · --json
//
// Relieve: por defecto se pide (terrain=1) en los sitios al sur de 60°S, donde hay DEM LOLA; en el resto, Luna lisa.
//   --terrain / --no-terrain               pedirlo o no, en cualquier sitio
//   --panel-height <m> --antenna-height <m>  alturas del panel (Sol) y de la antena (Tierra); implican --terrain
//   --max-slope <grados>                    activa R9 (pendiente en 100 m; el alunizaje tripulado de Artemis pide menos de 10°)
import { DEFAULT_API, listSites, loadWindows } from './api.js';
import { PROFILES } from './profiles.js';
import { VERDICT, evaluate, evaluateRange, formatHours, landingWindows, launchDate, nextViable } from './rules.js';

const DAY_MS = 24 * 3600e3;
/** South of this latitude the API has the LOLA DEM (LDEM_60S_240MPP), so terrain is asked for by default. */
const TERRAIN_DEFAULT_SOUTH_OF_DEG = -60;
const LABEL = { viable: 'VIABLE', marginal: 'MARGINAL', 'not-viable': 'NO VIABLE', 'no-data': 'SIN DATOS' };
const fmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const when = (iso) => `${fmt.format(new Date(iso))} UTC`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Argumento inesperado: ${argv[i]}`);
    const key = argv[i].slice(2);
    args[key] = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i];
  }
  return args;
}

// Como en la API de datos: una fecha sin zona horaria es UTC. JavaScript interpretaría «2027-01-15T06:00» como
// hora local, así que se le añade la Z.
function parseUtc(text) {
  if (typeof text !== 'string') return NaN;
  const hasZone = /([zZ]|[+-]\d\d:?\d\d)$/.test(text);
  return Date.parse(text.includes('T') && !hasZone ? `${text}Z` : text);
}

function why(r) {
  const l = r.limiting;
  if (!l) return 'No hay reglas activas.';
  if (l.passes === null) return `No se puede certificar ${l.id}. ${l.reason}.`;
  if (r.verdict === VERDICT.NOT_VIABLE) return `Falla ${l.id}. ${l.reason}.`;
  if (r.verdict === VERDICT.MARGINAL) return `Cumple ${l.id} por poco. ${l.reason}.`;
  if (r.verdict === VERDICT.NO_DATA) return `${l.reason}.`;
  return `Lo que más aprieta es ${l.id}. ${l.reason}.`;
}

function printEvaluation(r, profile) {
  console.log(`\n  ${LABEL[r.verdict]}${r.provisional ? ' (provisional)' : ''}  ·  ${why(r)}`);
  if (r.worstCase) console.log(`  Con ±${profile.toleranceDays} días de tolerancia manda el peor caso: aterrizar el ${when(r.worstCase.t0)}.`);
  if (r.verdict !== VERDICT.NO_DATA) {
    console.log('');
    for (const x of r.rules) {
      const state = !x.active ? '  ·  ' : x.passes === null ? '  ¿? ' : x.passes ? (x.normalized < 1 ? ' justo' : '   ok') : 'FALLA';
      const margin = !x.active ? 'no aplica' : !Number.isFinite(x.margin) ? '' : `${x.margin >= 0 ? '+' : '−'}${Math.round(Math.abs(x.margin) * 100)} %`;
      console.log(`  ${state}  ${x.id}  ${x.name.padEnd(26)} ${x.reason}${margin ? `  [${margin}]` : ''}`);
    }
    console.log(`\n  Lanzamiento: ${when(launchDate(r.t0, profile))} (viaje de ${profile.transitDays} días)`);
  }
  for (const w of r.warnings) console.log(`\n  Aviso · ${w.message}`);
}

/** Which horizon the verdict was computed with: LOLA terrain (with the heights) or a smooth Moon. */
function horizonLine(h) {
  if (h.model === 'mask') return `Calculado con relieve LOLA (panel a ${h.panelHeightM} m, antena a ${h.antennaHeightM} m)`;
  return 'Calculado con Luna lisa, sin relieve: veredicto provisional';
}

// Terrain is asked for when forced with --terrain or a height, or by default south of 60°S. For a catalog site the
// latitude comes from /v1/sites.
async function wantsTerrain(args, baseUrl, site) {
  const heights = args['panel-height'] !== undefined || args['antenna-height'] !== undefined;
  if (args['no-terrain']) {
    if (heights) throw new Error('--panel-height y --antenna-height necesitan relieve: quita --no-terrain');
    return false;
  }
  if (args.terrain || heights) return true;
  const lat = typeof site === 'string' ? (await listSites(baseUrl)).sites.find((s) => s.id === site)?.latDeg : site.lat;
  return lat !== undefined && lat <= TERRAIN_DEFAULT_SOUTH_OF_DEG;
}

const optionalNumber = (args, key) => {
  if (args[key] === undefined) return undefined;
  const n = Number(args[key]);
  if (args[key] === true || !Number.isFinite(n)) throw new Error(`--${key} necesita un número`);
  return n;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.api ?? DEFAULT_API;

  if (args.sites) {
    const { sites } = await listSites(baseUrl);
    for (const s of sites) console.log(`${s.id.padEnd(16)} ${String(s.latDeg).padStart(9)} ${String(s.lonDeg).padStart(10)}  ${s.name}${s.coordinatesVerified ? '' : '  (coordenadas aproximadas)'}`);
    return;
  }

  const profileId = args.profile ?? 'clps-lunar-day';
  if (!PROFILES[profileId]) throw new Error(`Perfil desconocido: ${profileId}. Disponibles: ${Object.keys(PROFILES).join(', ')}`);
  const profile = { ...PROFILES[profileId] };
  if (args.tolerance !== undefined) profile.toleranceDays = Number(args.tolerance);
  const maxSlopeDeg = optionalNumber(args, 'max-slope');
  if (maxSlopeDeg !== undefined) profile.rules = { ...profile.rules, R9: { active: true, threshold: maxSlopeDeg } };

  const site = args.site ?? (args.lat !== undefined && args.lon !== undefined ? { lat: Number(args.lat), lon: Number(args.lon) } : null);
  if (!site) throw new Error('Indica --site <id> o --lat <grados> --lon <grados>. Con --sites se lista el catálogo.');
  const t0 = parseUtc(args.date);
  if (!Number.isFinite(t0)) throw new Error('Indica --date <fecha ISO 8601>, por ejemplo 2027-01-15 o 2027-01-15T06:00Z');

  const scanDays = args.scan !== undefined ? Number(args.scan) : 0;
  const delayDays = args.delay !== undefined ? Number(args.delay) : 0;
  const tolMs = (profile.toleranceDays ?? 0) * DAY_MS;
  // Hay que cubrir la misión de la última fecha que se vaya a evaluar, más la tolerancia.
  const horizonDays = Math.max(scanDays, delayDays ? delayDays + 120 : 0) + profile.durationDays + (profile.toleranceDays ?? 0) + 1;
  const terrain = await wantsTerrain(args, baseUrl, site);
  const w = await loadWindows({
    baseUrl, site, start: new Date(t0 - tolMs).toISOString(), end: new Date(t0 + horizonDays * DAY_MS).toISOString(),
    sunMode: profile.sunMode, earthMode: profile.earthMode,
    terrain, panelHeightM: optionalNumber(args, 'panel-height'), antennaHeightM: optionalNumber(args, 'antenna-height'), maxSlopeDeg,
  });

  const result = evaluate(w, profile, t0);
  const scan = scanDays ? landingWindows(evaluateRange(w, profile, t0, t0 + scanDays * DAY_MS)) : null;
  const replan = delayDays ? { delayed: evaluate(w, profile, t0 + delayDays * DAY_MS), next: nextViable(w, profile, t0 + delayDays * DAY_MS) } : null;

  if (args.json) {
    console.log(JSON.stringify({ site: w.site, profile: profileId, result, scan, replan }, null, 2));
    return;
  }

  console.log(`${w.site.name} (${w.site.latDeg}°, ${w.site.lonDeg}°) · aterrizaje ${when(result.t0)}`);
  console.log(`Perfil: ${profile.name} · misión de ${profile.durationDays} días · Sol «${profile.sunMode}», Tierra «${profile.earthMode}»`);
  console.log(horizonLine(result.horizon));
  printEvaluation(result, profile);

  if (scan) {
    console.log(`\nVentanas de aterrizaje en los ${scanDays} días siguientes (fechas candidatas cada 6 h):`);
    const good = scan.filter((x) => x.verdict === VERDICT.VIABLE || x.verdict === VERDICT.MARGINAL);
    if (!good.length) console.log('  Ninguna fecha cumple en ese periodo.');
    for (const x of good) {
      console.log(x.count === 1
        ? `  ${LABEL[x.verdict].padEnd(9)} solo el ${when(x.firstT0)}`
        : `  ${LABEL[x.verdict].padEnd(9)} del ${when(x.firstT0)} al ${when(x.lastT0)}  (${formatHours((x.count - 1) * 6)})`);
    }
  }
  if (replan) {
    console.log(`\nCon ${delayDays} días de retraso (${when(replan.delayed.t0)}): ${LABEL[replan.delayed.verdict]}. ${why(replan.delayed)}`);
    console.log(replan.next
      ? `  Primera fecha que cumple a partir de ahí: ${when(replan.next.t0)} (${LABEL[replan.next.verdict]}), ${formatHours((Date.parse(replan.next.t0) - t0) / 3600e3)} después del plan.`
      : '  Ninguna fecha cumple en los 120 días siguientes.');
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
});
