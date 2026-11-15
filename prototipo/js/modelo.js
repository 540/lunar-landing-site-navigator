// Modelo FALSO del polo sur lunar para el prototipo.
// Imita la forma de los datos reales (efemérides + relieve) para que la interfaz
// se pueda construir ya. El grupo de motor de datos lo sustituirá por:
//   - efemerides(): JPL Horizons o SPICE (posición real del Sol y de la Tierra)
//   - altura(): un DEM de LOLA (relieve real medido por satélite)
// La firma de las funciones es el contrato: si devuelven lo mismo, la interfaz no cambia.

export const R_LUNA_KM = 1737.4;
export const KM_POR_GRADO = (Math.PI / 180) * R_LUNA_KM; // ~30,3 km por grado de latitud
export const ALTURA_OBSERVADOR_KM = 0.002; // 2 m: altura de paneles y antena del lander
const RAD = Math.PI / 180;
const J2000 = Date.UTC(2000, 0, 1, 12);

// ---------- Proyección del mapa polar (equidistante centrada en el polo sur) ----------
// x, y en km; el meridiano 0° (cara que mira a la Tierra) hacia arriba.
export function aMapa(lat, lon) {
  const r = (90 + lat) * KM_POR_GRADO;
  return { x: r * Math.sin(lon * RAD), y: r * Math.cos(lon * RAD) };
}
export function deMapa(x, y) {
  const r = Math.hypot(x, y);
  let lon = Math.atan2(x, y) / RAD;
  if (lon > 180) lon -= 360;
  return { lat: -90 + r / KM_POR_GRADO, lon };
}

// ---------- Relieve inventado (sustituto del DEM de LOLA) ----------
// Cráteres y montes con nombres reales y posición aproximada; formas y alturas inventadas.
const CRATERES = [
  { nombre: 'Shackleton', lat: -89.67, lon: 129.8, r: 10.5, prof: 3.0, borde: 0.6 },
  { nombre: 'de Gerlache', lat: -88.5, lon: -87.1, r: 16, prof: 2.5, borde: 0.5 },
  { nombre: 'Shoemaker', lat: -88.1, lon: 44.9, r: 25, prof: 2.5, borde: 0.4 },
  { nombre: 'Haworth', lat: -87.45, lon: -5.0, r: 25, prof: 2.8, borde: 0.4 },
  { nombre: 'Faustini', lat: -87.3, lon: 77.0, r: 20, prof: 2.0, borde: 0.3 },
  { nombre: 'Sverdrup', lat: -88.3, lon: -152, r: 16, prof: 2.0, borde: 0.3 },
  { nombre: 'Cabeus', lat: -84.9, lon: -35.5, r: 45, prof: 2.5, borde: 0.3 },
].map(c => ({ ...c, ...aMapa(c.lat, c.lon) }));
const MONTES = [
  { nombre: 'Macizo de Malapert', lat: -86.0, lon: 0.0, s: 18, h: 4.5 },
  { nombre: 'Mons Mouton', lat: -84.6, lon: 31.0, s: 22, h: 5.5 },
  { nombre: 'Cresta de conexión', lat: -89.45, lon: -137.3, s: 7, h: 1.2 },
  { nombre: 'Cresta de conexión', lat: -89.05, lon: -112, s: 8, h: 0.9 },
].map(m => ({ ...m, ...aMapa(m.lat, m.lon) }));
export const ACCIDENTES = { crateres: CRATERES, montes: MONTES };

export function altura(x, y) {
  let h = 0.25 * Math.sin(x / 23) * Math.cos(y / 31) + 0.15 * Math.sin((x + y) / 13);
  for (const c of CRATERES) {
    const d = Math.hypot(x - c.x, y - c.y) / c.r;
    if (d < 1) h += -c.prof * (1 - d * d) + c.borde;
    else if (d < 2.2) h += c.borde * Math.exp(-(((d - 1) / 0.35) ** 2));
  }
  for (const m of MONTES) {
    const d2 = ((x - m.x) ** 2 + (y - m.y) ** 2) / (m.s * m.s);
    if (d2 < 9) h += m.h * Math.exp(-d2);
  }
  return h;
}

// Horizonte del relieve: para cada dirección (0..359°), el ángulo más alto que tapa el
// terreno, contando con la curvatura de la Luna. Es lo mismo que se hará con LOLA.
const DISTANCIAS = (() => { const d = []; for (let x = 0.3; x < 220; x *= 1.09) d.push(x); return d; })();
export function horizonteEnDireccion(x0, y0, h0, lat, lon, az) {
  const n = { x: Math.sin(lon * RAD), y: Math.cos(lon * RAD) };     // hacia fuera del polo = norte local
  const e = { x: Math.cos(lon * RAD), y: -Math.sin(lon * RAD) };    // este local
  const dx = Math.cos(az * RAD) * n.x + Math.sin(az * RAD) * e.x;
  const dy = Math.cos(az * RAD) * n.y + Math.sin(az * RAD) * e.y;
  let max = -90;
  for (const d of DISTANCIAS) {
    const dh = altura(x0 + dx * d, y0 + dy * d) - h0 - (d * d) / (2 * R_LUNA_KM);
    const ang = Math.atan2(dh, d) / RAD;
    if (ang > max) max = ang;
  }
  return max;
}
export function calcularHorizonte(sitio) {
  if (sitio.fueraMapa) return horizontePlano(sitio);
  const { x, y } = aMapa(sitio.lat, sitio.lon);
  const h0 = altura(x, y) + ALTURA_OBSERVADOR_KM;
  const mascara = new Float32Array(360);
  for (let az = 0; az < 360; az++) mascara[az] = horizonteEnDireccion(x, y, h0, sitio.lat, sitio.lon, az);
  return { mascara, alturaKm: h0 - ALTURA_OBSERVADOR_KM };
}
function horizontePlano(s) {
  const m = new Float32Array(360);
  for (let a = 0; a < 360; a++) m[a] = 0.3 + 0.4 * Math.sin(a * RAD * 3 + s.lat) + 0.2 * Math.sin(a * RAD * 7);
  return { mascara: m, alturaKm: 0 };
}
export const horizonteEn = (mascara, az) => mascara[((Math.round(az) % 360) + 360) % 360];

// ---------- Efemérides inventadas (sustituto de Horizons / SPICE) ----------
// Subpunto = el sitio de la Luna que tiene el Sol (o la Tierra) justo encima.
export function subpuntos(ms) {
  const d = (ms - J2000) / 864e5;
  const fase = ((((d - 5.26) / 29.530589) % 1) + 1) % 1; // ciclo de 29,5 días: el «día lunar»
  return {
    sol: { lon: 180 - 360 * fase, lat: 1.54 * Math.sin(2 * Math.PI * (d - 40) / 346.62) }, // ±1,54°: «estaciones»
    tierra: {
      lon: 7.9 * Math.sin(2 * Math.PI * (d - 10) / 27.5546),  // libración en longitud
      lat: 6.68 * Math.sin(2 * Math.PI * (d - 3) / 27.2122),  // libración en latitud
    },
  };
}
// Dirección (azimut, 0 = norte) y altura (elevación) de un cuerpo visto desde el sitio, sin relieve.
export function altaz(lat, lon, sub) {
  const f = lat * RAD, b = sub.lat * RAD, dL = (sub.lon - lon) * RAD;
  const el = Math.asin(Math.sin(f) * Math.sin(b) + Math.cos(f) * Math.cos(b) * Math.cos(dL)) / RAD;
  const az = Math.atan2(Math.sin(dL) * Math.cos(b), Math.cos(f) * Math.sin(b) - Math.sin(f) * Math.cos(b) * Math.cos(dL)) / RAD;
  return { el, az: (az + 360) % 360 };
}
export function efemerides(sitio, ms) {
  const p = subpuntos(ms);
  const sol = altaz(sitio.lat, sitio.lon, p.sol);
  const tierra = altaz(sitio.lat, sitio.lon, p.tierra);
  tierra.el -= 0.26 * Math.cos(tierra.el * RAD); // paralaje: la Tierra está «cerca»
  return { sol, tierra };
}

// ---------- Cielo con relieve y métricas ----------
export function cielo(sitio, ms) {
  const { sol, tierra } = efemerides(sitio, ms);
  sol.h = horizonteEn(sitio.horizonte.mascara, sol.az);
  tierra.h = horizonteEn(sitio.horizonte.mascara, tierra.az);
  sol.m = sol.el - sol.h;       // margen sobre el relieve: >0 se ve, <0 tapado
  tierra.m = tierra.el - tierra.h;
  return { sol, tierra };
}

export function evaluar(sitio, t0, dias, pasoHoras = 1) {
  const n = Math.round((dias * 24) / pasoHoras);
  const serie = [];
  let horasSol = null, horasTierra = null, nSol = 0, nTierra = 0, maxSol = -90;
  let rachaOscuro = 0, maxOscuro = 0, rachaSinTierra = 0, maxSinTierra = 0;
  for (let i = 0; i <= n; i++) {
    const c = cielo(sitio, t0 + i * pasoHoras * 36e5);
    serie.push(c);
    if (c.sol.m > 0) { nSol++; rachaOscuro = 0; }
    else if (i > 0) { rachaOscuro += pasoHoras; maxOscuro = Math.max(maxOscuro, rachaOscuro); }
    if (c.tierra.m > 0) { nTierra++; rachaSinTierra = 0; }
    else if (i > 0) { rachaSinTierra += pasoHoras; maxSinTierra = Math.max(maxSinTierra, rachaSinTierra); }
    if (c.sol.el > maxSol) maxSol = c.sol.el;
    if (horasSol === null && c.sol.m <= 0) horasSol = i * pasoHoras;
    if (horasTierra === null && c.tierra.m <= 0) horasTierra = i * pasoHoras;
  }
  const total = n * pasoHoras;
  return {
    t0, dias, paso: pasoHoras, serie,
    horasSol: horasSol ?? total, sigueSol: horasSol === null,
    horasTierra: horasTierra ?? total, sigueTierra: horasTierra === null,
    maxOscuro, maxSinTierra,
    pctSol: (100 * nSol) / (n + 1), pctTierra: (100 * nTierra) / (n + 1), maxSol,
    solAlAlunizar: serie[0].sol.m > 0, tierraAlAlunizar: serie[0].tierra.m > 0,
  };
}

const dh = h => { const d = Math.floor(h / 24), r = Math.round(h % 24); return d ? (r ? `${d} d ${r} h` : `${d} d`) : `${r} h`; };

// Regla de decisión. La nave es solar: necesita Sol durante TODA la misión y solo
// sobrevive a oscuras lo que le dura la batería (req.aguante, en horas).
// Devuelve también la traza para el modo explicación.
export function veredicto(r, req) {
  const okOscuro = r.maxOscuro <= req.aguante;
  const okT = r.pctTierra >= req.minTierra;
  const traza = [
    { regla: 'Sol visible en el momento del alunizaje', ok: r.solAlAlunizar, dato: `margen ${r.serie[0].sol.m.toFixed(2)}°` },
    { regla: 'Tierra visible en el momento del alunizaje', ok: r.tierraAlAlunizar, dato: `margen ${r.serie[0].tierra.m.toFixed(2)}°` },
    { regla: `Mayor tiempo a oscuras ≤ ${req.aguante} h (lo que aguanta la batería)`, ok: okOscuro, dato: r.maxOscuro ? dh(r.maxOscuro) : 'nunca se va el Sol' },
    { regla: `Tierra visible ≥ ${req.minTierra} % de la misión`, ok: okT, dato: `${Math.round(r.pctTierra)} %` },
  ];
  if (!r.solAlAlunizar) return { c: 'no', t: 'No viable', m: 'El Sol está tapado al alunizar: sin energía desde el primer minuto', traza };
  if (!r.tierraAlAlunizar) return { c: 'no', t: 'No viable', m: 'La Tierra está tapada al alunizar: no hay enlace directo', traza };
  if (okOscuro && okT) return { c: 'ok', t: 'Viable', m: r.maxOscuro ? `Cumple: el apagón más largo (${dh(r.maxOscuro)}) lo cubre la batería` : 'Cumple: Sol toda la misión y comunicación suficiente', traza };
  const problemas = [];
  if (!okOscuro) problemas.push(`el Sol se esconde a las ${dh(r.horasSol)} y llega a pasar ${dh(r.maxOscuro)} a oscuras (la batería aguanta ${req.aguante} h)`);
  if (!okT) problemas.push(`solo ve la Tierra el ${Math.round(r.pctTierra)} % del tiempo (pide ${req.minTierra} %)`);
  const texto = problemas.join('; y ');
  const cerca = r.maxOscuro <= Math.max(2 * req.aguante, 6) && r.pctTierra >= 0.8 * req.minTierra;
  return cerca
    ? { c: 'justo', t: 'Justo', m: 'Se queda cerca: ' + texto, traza }
    : { c: 'no', t: 'No viable', m: texto.charAt(0).toUpperCase() + texto.slice(1), traza };
}

// Visibilidad en un punto cualquiera del mapa (para la capa de sombras).
export function visibleEnPunto(x, y, cuerpo, subpunto) {
  const { lat, lon } = deMapa(x, y);
  const { el, az } = altaz(lat, lon, subpunto);
  if (el < -3) return -1;
  const h0 = altura(x, y) + ALTURA_OBSERVADOR_KM;
  return el - horizonteEnDireccion(x, y, h0, lat, lon, az);
}
