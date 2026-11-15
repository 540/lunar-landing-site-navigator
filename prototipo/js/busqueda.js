// Búsqueda de la mejor opción: BACKEND SIMULADO.
// Imita lo que hemos pedido al equipo de backend (ver CONTRATO-BACKEND.md):
//   buscar(condiciones) ≈ /v1/rank con requisitos de misión y ventana de aterrizaje.
// Cuando el backend lo dé, esta función se sustituye por una llamada y la interfaz no cambia.
import * as M from './modelo.js';

export const PRIORIDADES = [
  { id: 'energia', nombre: 'Más margen de energía', pesos: { e: 0.5, c: 0.2, a: 0.1, r: 0.2 } },
  { id: 'comunicacion', nombre: 'Más comunicación', pesos: { e: 0.2, c: 0.5, a: 0.1, r: 0.2 } },
  { id: 'antes', nombre: 'Aterrizar antes', pesos: { e: 0.2, c: 0.2, a: 0.45, r: 0.15 } },
  { id: 'retrasos', nombre: 'Aguantar retrasos', pesos: { e: 0.2, c: 0.2, a: 0.1, r: 0.5 } },
];

const PASO_H = 12;          // se prueba un aterrizaje cada 12 h dentro de la ventana
const BASE = { ok: 1, justo: 0.3, no: 0 };

const dh = h => { const d = Math.floor(h / 24), r = Math.round(h % 24); return d ? (r ? `${d} d ${r} h` : `${d} d`) : `${r} h`; };

// condiciones: { sitios:[sitio], desde, hasta (ms UTC), dias, aguante (h), minTierra (%), prioridad }
export function buscar(cond) {
  const req = { aguante: cond.aguante, minTierra: cond.minTierra };
  const pesos = (PRIORIDADES.find(p => p.id === cond.prioridad) || PRIORIDADES[0]).pesos;
  const n = Math.max(1, Math.floor((cond.hasta - cond.desde) / (PASO_H * 36e5)) + 1);
  const opciones = [];

  for (const s of cond.sitios) {
    // 1. Evaluar cada aterrizaje posible de la ventana (y unos días más, para medir la robustez).
    const extra = Math.ceil(15 * 24 / PASO_H);
    const cand = [];
    for (let i = 0; i < n + extra; i++) {
      const t = cond.desde + i * PASO_H * 36e5;
      const r = M.evaluar(s, t, cond.dias, 2);
      cand.push({ t, r, ver: M.veredicto(r, req) });
    }
    // 2. Robustez: cuántos días seguidos sigue siendo viable si el aterrizaje se retrasa.
    for (let i = n + extra - 1; i >= 0; i--) {
      cand[i].racha = cand[i].ver.c === 'ok' ? 1 + (cand[i + 1]?.racha || 0) : 0;
    }
    // 3. Puntuar solo los de dentro de la ventana y quedarse con el mejor de este sitio.
    let mejor = null;
    for (let i = 0; i < n; i++) {
      const k = cand[i], r = k.r;
      const robustezDias = Math.max(0, (k.racha - 1) * PASO_H / 24);
      const e = 0.5 * (1 - Math.min(1, r.maxOscuro / Math.max(1, cond.aguante))) + 0.5 * r.pctSol / 100;
      const c = r.pctTierra / 100;
      const a = 1 - i / Math.max(1, n - 1);
      const rb = Math.min(1, robustezDias / 7);
      const p = BASE[k.ver.c] + pesos.e * e + pesos.c * c + pesos.a * a + pesos.r * rb;
      if (!mejor || p > mejor.puntuacion) mejor = { ...k, i, robustezDias, puntuacion: p, partes: { e, c, a, r: rb } };
    }
    // 4. Próxima ventana viable después de que deje de valer.
    let proxima = null;
    for (let j = mejor.i + mejor.racha; j < cand.length; j++) if (cand[j].ver.c === 'ok') { proxima = cand[j].t; break; }

    opciones.push({
      sitio: s,
      aterrizaje: mejor.t,
      r: mejor.r,
      ver: mejor.ver,
      puntuacion: mejor.puntuacion,
      partes: mejor.partes,
      robustez: { retrasoMaxDias: mejor.ver.c === 'ok' ? mejor.robustezDias : 0, proximaVentana: proxima },
      motivos: motivos(mejor, cond, req),
      viablesEnVentana: cand.slice(0, n).filter(x => x.ver.c === 'ok').length,
    });
  }
  opciones.sort((a, b) => b.puntuacion - a.puntuacion);
  return { condiciones: cond, mejor: opciones[0], opciones, probados: n * cond.sitios.length };
}

function motivos(k, cond, req) {
  const r = k.r, m = [];
  if (k.ver.c !== 'ok') return [k.ver.m];
  m.push(r.maxOscuro ? `Mayor sombra ${dh(r.maxOscuro)}: tu batería aguanta ${req.aguante} h` : 'Sol durante toda la misión');
  m.push(`Tierra visible el ${Math.round(r.pctTierra)} % del tiempo (pides ${req.minTierra} %)`);
  m.push(k.robustezDias >= 0.5 ? `Sigue siendo viable aunque te retrases hasta ${fmtDias(k.robustezDias)}` : 'Poco margen: con medio día de retraso ya no vale');
  return m;
}
const fmtDias = d => (d === Math.floor(d) ? d : d.toFixed(1).replace('.', ',')) + (d === 1 ? ' día' : ' días');

// Replanificar: el mismo sitio en la siguiente ventana viable a partir de una fecha.
export function siguienteVentana(s, desde, cond, maxDias = 60) {
  const req = { aguante: cond.aguante, minTierra: cond.minTierra };
  for (let i = 0; i <= maxDias * 24 / PASO_H; i++) {
    const t = desde + i * PASO_H * 36e5, r = M.evaluar(s, t, cond.dias, 2), ver = M.veredicto(r, req);
    if (ver.c === 'ok') return { t, r, ver, esperaDias: i * PASO_H / 24 };
  }
  return null;
}

// Replanificar: otros sitios en la misma fecha, ordenados.
export function otrosSitios(sitios, excluir, t, cond) {
  const req = { aguante: cond.aguante, minTierra: cond.minTierra };
  return sitios.filter(s => s.id !== excluir && !s.fueraMapa)
    .map(s => { const r = M.evaluar(s, t, cond.dias, 2); return { sitio: s, r, ver: M.veredicto(r, req) }; })
    .sort((a, b) => (BASE[b.ver.c] - BASE[a.ver.c]) || (a.r.maxOscuro - b.r.maxOscuro) || (b.r.pctTierra - a.r.pctTierra));
}

// Replanificar: ¿y si el aterrizaje cae desviado? 8 puntos en un círculo de radio R alrededor del sitio.
export function desvio(s, t, cond, radioKm) {
  if (s.fueraMapa || radioKm <= 0) return null;
  const req = { aguante: cond.aguante, minTierra: cond.minTierra };
  const c = M.aMapa(s.lat, s.lon), puntos = [];
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, { lat, lon } = M.deMapa(c.x + radioKm * Math.cos(a), c.y + radioKm * Math.sin(a));
    const p = { lat, lon }; p.horizonte = M.calcularHorizonte(p);
    const r = M.evaluar(p, t, cond.dias, 2);
    puntos.push({ lat, lon, ver: M.veredicto(r, req) });
  }
  return { puntos, viables: puntos.filter(p => p.ver.c === 'ok').length };
}
