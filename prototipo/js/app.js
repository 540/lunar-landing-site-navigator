import * as M from './modelo.js';
import { SITIOS, PERFILES, FECHA_INICIAL, FUENTES } from './datos.js';
import { EXPLICA, GLOSARIO } from './explicaciones.js';
import * as B from './busqueda.js';

const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmtDH = h => { const d = Math.floor(h / 24), r = Math.round(h % 24); return d ? (r ? `${d} d ${r} h` : `${d} d`) : `${r} h`; };
const fmtFecha = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const enlazar = s => esc(s).replace(/https?:\/\/[^\s)]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

SITIOS.forEach(s => { s.horizonte = M.calcularHorizonte(s); });

const estado = {
  sel: ['cresta', 'ladera', 'malapert'],
  capa: 'sol',
  vista: 'comparar',
  debug: new URLSearchParams(location.search).get('debug') === '1',
  ficha: null,          // { clave, sitio }
  cache: {},            // id → { s, r, ver }
  jugando: null,
  propios: 0,
  claveBarrido: '',
  busqueda: null,       // resultado de la última búsqueda (mejor + opciones)
  plan: null,           // opción elegida como plan
  form: { perfil: 'robotico', prioridad: 'energia', zona: null },
  paso: 1,              // Planificar: 1 = características de la misión, 2 = resultado
};
const isoLocal = ms => new Date(ms).toISOString().slice(0, 16);
const opcionDe = id => estado.busqueda?.opciones.find(o => o.sitio.id === id);

// ---------------- Configuración de la misión ----------------
function iniciarFormulario() {
  $('perfil').innerHTML = PERFILES.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
  $('fecha').value = FECHA_INICIAL;
  aplicarPerfil(PERFILES[0]);
}
function aplicarPerfil(p) {
  $('dias').value = p.dias; $('aguante').value = p.aguante; $('min-tierra').value = p.minTierra;
  $('perfil-fuente').textContent = 'Umbrales: ' + p.fuente;
}
function config() {
  const base = Date.parse($('fecha').value + ':00Z') || Date.parse(FECHA_INICIAL + ':00Z');
  const retraso = +$('retraso').value;
  return {
    base, retraso, t0: base + retraso * 864e5,
    dias: Math.max(1, Math.min(30, +$('dias').value || 10)),
    req: { aguante: Math.max(0, +$('aguante').value || 0), minTierra: Math.max(0, Math.min(100, +$('min-tierra').value || 0)) },
  };
}

// ---------------- Cálculo ----------------
function calcular() {
  const c = config();
  for (const s of SITIOS) {
    // Cada opción encontrada se evalúa en su propia fecha; el resto, en la fecha del plan. El retraso se suma a todas.
    const o = opcionDe(s.id), t0 = (o && s.id !== estado.plan?.sitio.id ? o.aterrizaje : c.base) + c.retraso * 864e5;
    const r = M.evaluar(s, t0, c.dias, 1);
    estado.cache[s.id] = { s, r, ver: M.veredicto(r, c.req), t0 };
  }
  $('hora').max = c.dias * 24;
  if (+$('hora').value > c.dias * 24) $('hora').value = c.dias * 24;
  $('retraso-v').textContent = `+${c.retraso} días · ${fmtFecha(c.t0)}`;
}
const horaActual = () => +$('hora').value;

// ---------------- Lista de sitios ----------------
function pintarSitios() {
  $('sitios').innerHTML = SITIOS.map(s => {
    const { ver } = estado.cache[s.id];
    return `<button type="button" class="sitio" data-id="${s.id}" aria-pressed="${estado.sel.includes(s.id)}" title="${esc(s.nota)}">
      <span class="marca-sel" aria-hidden="true"></span><span class="nombre">${esc(s.nombre)}</span><span class="pill ${ver.c}">${ver.t}</span></button>`;
  }).join('');
}
function alternarSitio(id) {
  // El plan siempre va primero y no se quita de la comparación.
  const plan = estado.plan?.sitio.id;
  if (estado.sel.includes(id)) { if (estado.sel.length > 1 && id !== plan) estado.sel = estado.sel.filter(x => x !== id); }
  else { estado.sel.push(id); if (estado.sel.length > 3) estado.sel.splice(plan && estado.sel[0] === plan ? 1 : 0, 1); }
  render();
}
$('sitios').addEventListener('click', e => { const b = e.target.closest('.sitio'); if (b && !e.target.closest('.explica-btn')) alternarSitio(b.dataset.id); });

// ---------------- Mapa ----------------
const MAPA = { tam: 360, radioKm: 190 };
MAPA.escala = MAPA.tam / 2 / MAPA.radioKm;
const aPx = (x, y) => ({ px: MAPA.tam / 2 + x * MAPA.escala, py: MAPA.tam / 2 - y * MAPA.escala });
const aKm = (px, py) => ({ x: (px - MAPA.tam / 2) / MAPA.escala, y: (MAPA.tam / 2 - py) / MAPA.escala });
let relieveImg = null;
function construirRelieve() {
  const cv = document.createElement('canvas'); cv.width = cv.height = MAPA.tam;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(MAPA.tam, MAPA.tam);
  const oscuro = true;
  for (let py = 0; py < MAPA.tam; py++) for (let px = 0; px < MAPA.tam; px++) {
    const { x, y } = aKm(px, py);
    if (Math.hypot(x, y) > MAPA.radioKm) continue;
    const h = M.altura(x, y), hx = M.altura(x + 1, y) - h, hy = M.altura(x, y + 1) - h;
    const sombra = Math.max(0, Math.min(1, 0.55 - 1.6 * hx + 1.6 * hy + h * 0.04));
    const g = oscuro ? 38 + sombra * 95 : 95 + sombra * 140;
    const i = (py * MAPA.tam + px) * 4;
    img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g + 4; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  relieveImg = cv;
}
const capaCache = { clave: '', cv: null };
function capaLuz(ms) {
  const clave = estado.capa + Math.round(ms / 36e5);
  if (capaCache.clave === clave) return capaCache.cv;
  const N = 140, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(N, N);
  const sub = M.subpuntos(ms)[estado.capa === 'sol' ? 'sol' : 'tierra'];
  const tinte = estado.capa === 'sol' ? [5, 8, 20] : [10, 15, 40];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const { x, y } = aKm((i + 0.5) * MAPA.tam / N, (j + 0.5) * MAPA.tam / N);
    if (Math.hypot(x, y) > MAPA.radioKm) continue;
    const v = M.visibleEnPunto(x, y, estado.capa, sub);
    const k = (j * N + i) * 4;
    img.data[k] = tinte[0]; img.data[k + 1] = tinte[1]; img.data[k + 2] = tinte[2];
    img.data[k + 3] = v > 0 ? 0 : 175;
  }
  ctx.putImageData(img, 0, 0);
  capaCache.clave = clave; capaCache.cv = cv;
  return cv;
}
function pintarMapa() {
  const cv = $('mapa'), dpr = devicePixelRatio || 1;
  cv.width = MAPA.tam * dpr; cv.height = MAPA.tam * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, MAPA.tam, MAPA.tam);
  if (!relieveImg) construirRelieve();
  ctx.save(); ctx.beginPath(); ctx.arc(MAPA.tam / 2, MAPA.tam / 2, MAPA.tam / 2, 0, 2 * Math.PI); ctx.clip();
  ctx.drawImage(relieveImg, 0, 0, MAPA.tam, MAPA.tam);
  const ms = config().t0 + horaActual() * 36e5;
  if (estado.capa !== 'relieve') { ctx.imageSmoothingEnabled = true; ctx.drawImage(capaLuz(ms), 0, 0, MAPA.tam, MAPA.tam); }
  ctx.restore();
  // rejilla
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1;
  ctx.font = '9px ' + css('--font-data');
  for (let g = 1; g <= 6; g++) {
    ctx.beginPath(); ctx.arc(MAPA.tam / 2, MAPA.tam / 2, g * M.KM_POR_GRADO * MAPA.escala, 0, 2 * Math.PI); ctx.stroke();
    if (g % 2 === 0) { const rr = g * M.KM_POR_GRADO * MAPA.escala * 0.7071; ctx.fillText(`${-90 + g}°`, MAPA.tam / 2 + rr + 2, MAPA.tam / 2 + rr - 2); }
  }
  for (const [lon, t] of [[0, '0° · hacia la Tierra'], [90, '90°E'], [180, '180°'], [-90, '90°O']]) {
    const p = M.aMapa(-84, lon), { px, py } = aPx(p.x, p.y);
    ctx.beginPath(); ctx.moveTo(MAPA.tam / 2, MAPA.tam / 2); ctx.lineTo(px, py); ctx.stroke();
    const w = ctx.measureText(t).width;
    ctx.fillText(t, Math.min(MAPA.tam - w - 2, Math.max(2, px - w / 2)), Math.min(MAPA.tam - 4, Math.max(10, py + (lon === 0 ? 10 : 0))));
  }
  // nombres de accidentes
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = 'italic 9px ' + css('--font-body');
  for (const c of M.ACCIDENTES.crateres) { const { px, py } = aPx(c.x, c.y); ctx.fillText(c.nombre, px - ctx.measureText(c.nombre).width / 2, py + 3); }
  // sitios
  const color = { ok: css('--ok'), justo: css('--warn'), no: css('--bad') };
  ctx.font = '600 10px ' + css('--font-body');
  for (const s of SITIOS) {
    if (s.fueraMapa) continue;
    const p = M.aMapa(s.lat, s.lon), { px, py } = aPx(p.x, p.y);
    const sel = estado.sel.includes(s.id);
    ctx.beginPath(); ctx.arc(px, py, sel ? 6 : 4.5, 0, 2 * Math.PI);
    ctx.fillStyle = color[estado.cache[s.id].ver.c]; ctx.fill();
    ctx.lineWidth = sel ? 2.5 : 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    if (sel || s.propio) {
      const t = s.corto, w = ctx.measureText(t).width;
      const tx = Math.min(MAPA.tam - w - 4, px + 8);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(tx - 3, py - 8, w + 6, 14);
      ctx.fillStyle = '#fff'; ctx.fillText(t, tx, py + 3);
    }
  }
  $('mapa-capa-txt').textContent = estado.capa === 'sol' ? 'Oscuro = sin Sol ahora' : estado.capa === 'tierra' ? 'Oscuro = sin Tierra ahora' : 'Solo relieve';
}
function eventoMapa(e) {
  const r = $('mapa').getBoundingClientRect();
  return { px: (e.clientX - r.left) * MAPA.tam / r.width, py: (e.clientY - r.top) * MAPA.tam / r.height };
}
$('mapa').addEventListener('mousemove', e => {
  const { px, py } = eventoMapa(e), { x, y } = aKm(px, py);
  if (Math.hypot(x, y) > MAPA.radioKm) return;
  const { lat, lon } = M.deMapa(x, y);
  $('mapa-cursor').textContent = `${lat.toFixed(2)}°, ${lon.toFixed(1)}° · altura ${M.altura(x, y).toFixed(1)} km (inventada)`;
});
$('mapa').addEventListener('click', e => {
  const { px, py } = eventoMapa(e);
  for (const s of SITIOS) {
    if (s.fueraMapa) continue;
    const p = M.aMapa(s.lat, s.lon), q = aPx(p.x, p.y);
    if (Math.hypot(q.px - px, q.py - py) < 10) return alternarSitio(s.id);
  }
  const { x, y } = aKm(px, py);
  if (Math.hypot(x, y) > MAPA.radioKm) return;
  const { lat, lon } = M.deMapa(x, y);
  const n = ++estado.propios;
  const s = { id: 'propio-' + n, nombre: `Punto propio ${n}`, corto: `Punto ${n}`, lat, lon, propio: true,
    nota: 'Creado pulsando en el mapa. Su horizonte se calcula al momento con el relieve inventado.' };
  s.horizonte = M.calcularHorizonte(s);
  SITIOS.push(s);
  estado.sel.push(s.id); if (estado.sel.length > 3) estado.sel.shift();
  render();
});
document.querySelectorAll('[data-capa]').forEach(b => b.addEventListener('click', e => {
  if (e.target.closest('.explica-btn')) return;
  estado.capa = b.dataset.capa;
  document.querySelectorAll('[data-capa]').forEach(x => x.setAttribute('aria-pressed', x === b));
  pintarMapa();
}));

// ---------------- Gráficos de las tarjetas ----------------
function prepCanvas(cv, alto) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth || 300;
  cv.width = w * dpr; cv.height = alto * dpr; cv.style.height = alto + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: alto };
}
function dibujarCielo(cv, s, r, idx, alto = 150) {
  const { ctx, w, h } = prepCanvas(cv, alto);
  const pad = { l: 30, r: 8, t: 8, b: 20 };
  let yMax = 6; const yMin = -3;
  for (const c of r.serie) yMax = Math.max(yMax, c.sol.el + 1, c.tierra.el + 1);
  for (let a = 0; a < 360; a++) yMax = Math.max(yMax, s.horizonte.mascara[a] + 1);
  yMax = Math.min(90, Math.ceil(yMax));
  const X = az => pad.l + (az / 360) * (w - pad.l - pad.r);
  const Y = el => pad.t + (1 - (Math.max(yMin, Math.min(yMax, el)) - yMin) / (yMax - yMin)) * (h - pad.t - pad.b);
  ctx.font = '10px ' + css('--font-data'); ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
  const paso = yMax > 30 ? 20 : yMax > 12 ? 5 : 2;
  for (let e = Math.ceil(yMin / paso) * paso; e <= yMax; e += paso) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(e)); ctx.lineTo(w - pad.r, Y(e)); ctx.stroke(); ctx.fillText(e + '°', 2, Y(e) + 3);
  }
  [['N', 0], ['E', 90], ['S', 180], ['O', 270], ['N', 360]].forEach(([t, a]) => ctx.fillText(t, X(a) - 3, h - 5));
  const trazo = (k, col) => { ctx.fillStyle = col; ctx.globalAlpha = 0.4; r.serie.forEach((c, i) => { if (i % 2 === 0) ctx.fillRect(X(c[k].az) - 0.8, Y(c[k].el) - 0.8, 1.6, 1.6); }); ctx.globalAlpha = 1; };
  trazo('sol', css('--sun')); trazo('tierra', css('--earth'));
  ctx.fillStyle = css('--regolith'); ctx.beginPath(); ctx.moveTo(X(0), Y(yMin));
  for (let a = 0; a <= 360; a++) ctx.lineTo(X(a), Y(M.horizonteEn(s.horizonte.mascara, a)));
  ctx.lineTo(X(360), Y(yMin)); ctx.closePath(); ctx.fill();
  const c = r.serie[Math.min(idx, r.serie.length - 1)];
  const disco = (b, col, rad) => {
    ctx.beginPath(); ctx.arc(X(b.az), Y(b.el), rad, 0, 2 * Math.PI);
    ctx.fillStyle = col; ctx.globalAlpha = b.m > 0 ? 1 : 0.35; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = css('--panel'); ctx.lineWidth = 1.5; ctx.stroke();
  };
  disco(c.sol, css('--sun'), 6); disco(c.tierra, css('--earth'), 5);
}
function dibujarLinea(cv, r, idx, dias) {
  const { ctx, w, h } = prepCanvas(cv, 120);
  const pad = { l: 30, r: 8, t: 8, b: 20 };
  let yMin = -2, yMax = 4;
  for (const c of r.serie) { yMin = Math.min(yMin, c.sol.m, c.tierra.m); yMax = Math.max(yMax, c.sol.m, c.tierra.m); }
  yMin = Math.max(-15, Math.floor(yMin)); yMax = Math.min(70, Math.ceil(yMax));
  const n = r.serie.length - 1;
  const X = i => pad.l + (i / n) * (w - pad.l - pad.r);
  const Y = v => pad.t + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * (h - pad.t - pad.b);
  ctx.font = '10px ' + css('--font-data'); ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
  const pasoD = dias > 14 ? 5 : 2;
  for (let d = 0; d <= dias; d += pasoD) { const x = X(d * 24 / r.paso); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); ctx.fillText('d' + d, x - 6, h - 5); }
  ctx.fillText(yMax + '°', 2, Y(yMax) + 8); ctx.fillText(yMin + '°', 2, Y(yMin));
  ctx.strokeStyle = css('--muted'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(w - pad.r, Y(0)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillText('horizonte', w - pad.r - 52, Y(0) - 3);
  const serie = (k, col) => {
    ctx.fillStyle = col; ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    r.serie.forEach((c, i) => ctx.lineTo(X(i), Y(Math.max(0, c[k].m)))); ctx.lineTo(X(n), Y(0)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); r.serie.forEach((c, i) => i ? ctx.lineTo(X(i), Y(c[k].m)) : ctx.moveTo(X(i), Y(c[k].m))); ctx.stroke();
  };
  serie('tierra', css('--earth')); serie('sol', css('--sun'));
  ctx.strokeStyle = css('--ink'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(idx), pad.t); ctx.lineTo(X(idx), h - pad.b); ctx.stroke();
}

// ---------------- Vista Comparar ----------------
function pintarTarjetas() {
  const c = config();
  const cont = $('tarjetas');
  cont.innerHTML = estado.sel.map(id => {
    const { s, r, ver } = estado.cache[id];
    const m = s.horizonte.mascara, media = m.reduce((a, b) => a + b, 0) / 360;
    return `<article class="tarjeta" data-sitio="${s.id}">
      <div class="tarjeta-cab">
        <div><h3>${esc(s.nombre)}</h3><span class="coords">${s.lat.toFixed(2)}°, ${s.lon.toFixed(1)}° · aprox.</span><br><span class="aterriza">Aterrizaje ${fmtFecha(estado.cache[id].t0)}${estado.plan?.sitio.id === id ? ' · plan' : ''}</span></div>
        <span class="pill ${ver.c}" data-explica="veredicto">${ver.t}</span>
      </div>
      <p class="motivo">${esc(ver.m)}</p>
      <div class="metricas">
        <div class="metrica sol" data-explica="puesta-sol"><span>Hasta la puesta de Sol</span><b>${r.solAlAlunizar ? (r.sigueSol ? '> ' : '') + fmtDH(r.horasSol) : 'tapado'}</b></div>
        <div class="metrica tierra" data-explica="puesta-tierra"><span>Hasta la puesta de Tierra</span><b>${r.tierraAlAlunizar ? (r.sigueTierra ? '> ' : '') + fmtDH(r.horasTierra) : 'tapada'}</b></div>
        <div class="metrica sol" data-explica="pct-sol"><span>Misión con Sol</span><b>${Math.round(r.pctSol)} %</b></div>
        <div class="metrica tierra" data-explica="pct-tierra"><span>Misión con Tierra</span><b>${Math.round(r.pctTierra)} %</b></div>
        <div class="metrica sol" data-explica="sin-sol"><span>Mayor tiempo sin Sol</span><b>${r.maxOscuro ? fmtDH(r.maxOscuro) : '0 h'}</b></div>
        <div class="metrica tierra" data-explica="sin-tierra"><span>Mayor tiempo sin Tierra</span><b>${r.maxSinTierra ? fmtDH(r.maxSinTierra) : '0 h'}</b></div>
        <div class="metrica" data-explica="elev-sol"><span>Elevación solar máx.</span><b>${r.maxSol.toFixed(1)}°</b></div>
        <div class="metrica" data-explica="horizonte"><span>Horizonte medio</span><b>${media >= 0 ? '+' : ''}${media.toFixed(1)}°</b></div>
      </div>
      <div class="grafico" data-explica="panorama"><span class="eyebrow">Cielo local · 360°</span><canvas class="cv-cielo" aria-label="Sol y Tierra sobre el horizonte de ${esc(s.nombre)}"></canvas></div>
      <div class="grafico" data-explica="linea"><span class="eyebrow">Altura sobre el relieve · ${c.dias} días</span><canvas class="cv-linea" aria-label="Ventanas de Sol y Tierra"></canvas></div>
      <p class="nota">${esc(s.nota)}</p>
    </article>`;
  }).join('');
  dibujarTarjetas();
}
function dibujarTarjetas() {
  const c = config(), hora = horaActual();
  $('hora-v').textContent = hora === 0 ? `Aterrizaje · ${fmtFecha(c.t0)}` : `+${fmtDH(hora)} · ${fmtFecha(c.t0 + hora * 36e5)}`;
  document.querySelectorAll('#tarjetas .tarjeta').forEach(t => {
    const { s, r } = estado.cache[t.dataset.sitio];
    dibujarCielo(t.querySelector('.cv-cielo'), s, r, hora);
    dibujarLinea(t.querySelector('.cv-linea'), r, hora, c.dias);
  });
}

// ---------------- Vista Replanificar ----------------
let barrido = {};
function calcularBarrido() {
  const c = config();
  const clave = [c.base, c.dias, c.req.aguante, c.req.minTierra, SITIOS.length].join('|');
  if (clave === estado.claveBarrido) return;
  estado.claveBarrido = clave; barrido = {};
  for (const s of SITIOS) barrido[s.id] = Array.from({ length: 61 }, (_, d) => {
    const r = M.evaluar(s, c.base + d * 864e5, c.dias, 2);
    return { r, ver: M.veredicto(r, c.req) };
  });
}
function pintarReplanificar() {
  calcularBarrido();
  const c = config();
  let html = '<thead><tr><th></th>';
  for (let d = 0; d < 61; d++) html += `<th scope="col">${d % 5 === 0 ? '+' + d : ''}</th>`;
  html += '</tr></thead><tbody>';
  for (const s of SITIOS) {
    html += `<tr><th scope="row">${esc(s.nombre)}</th>`;
    barrido[s.id].forEach(({ ver }, d) => {
      html += `<td><button type="button" class="celda ${ver.c}${d === c.retraso ? ' actual' : ''}" data-d="${d}" title="${esc(s.corto)} · +${d} d · ${ver.t}: ${esc(ver.m)}" aria-label="${esc(s.nombre)}, +${d} días: ${ver.t}"></button></td>`;
    });
    html += '</tr>';
  }
  $('barrido').innerHTML = html + '</tbody>';

  const prin = SITIOS.find(s => s.id === estado.sel[0]);
  const fila = barrido[prin.id];
  const actual = fila[c.retraso].ver;
  const reabre = fila.findIndex((x, d) => d > c.retraso && x.ver.c === 'ok');
  const alternativas = SITIOS.filter(s => s.id !== prin.id && barrido[s.id][c.retraso].ver.c === 'ok')
    .sort((a, b) => (barrido[a.id][c.retraso].r.maxOscuro - barrido[b.id][c.retraso].r.maxOscuro) || (barrido[b.id][c.retraso].r.pctTierra - barrido[a.id][c.retraso].r.pctTierra));
  const mejor = alternativas[0];
  $('alternativa').innerHTML = `
    <span class="eyebrow">Sitio principal: el primero seleccionado · retraso +${c.retraso} días (${fmtFecha(c.t0)})</span>
    <p><b>${esc(prin.nombre)}</b>: <span class="pill ${actual.c}">${actual.t}</span> ${esc(actual.m)}.</p>
    ${actual.c === 'ok' ? '<p>Tu sitio sigue valiendo con este retraso.</p>' :
      `<p>${mejor ? `Mejor alternativa en esa fecha: <b>${esc(mejor.nombre)}</b> (${barrido[mejor.id][c.retraso].r.maxOscuro ? 'apagón máximo de ' + fmtDH(barrido[mejor.id][c.retraso].r.maxOscuro) : 'Sol toda la misión'}, Tierra el ${Math.round(barrido[mejor.id][c.retraso].r.pctTierra)} %).` : 'Ningún sitio del catálogo es viable en esa fecha.'}
      ${reabre > 0 ? ` Tu sitio vuelve a ser viable con <b>+${reabre} días</b> de retraso.` : ' Tu sitio no vuelve a ser viable en los próximos 60 días.'}</p>`}`;
}
$('barrido').addEventListener('click', e => {
  const b = e.target.closest('.celda'); if (!b) return;
  $('retraso').value = b.dataset.d; render();
});

// ---------------- Vista Fuentes ----------------
function pintarFuentes() {
  $('vista-fuentes').innerHTML = `
    <div class="caja"><h2>Fuentes de datos</h2>
    <p class="ayuda">Todo lo que ves en el prototipo es simulado. Esta es la lista de dónde saldrá cada dato en el producto y quién lo trae.</p></div>
    ${FUENTES.map(g => `<section class="caja"><h3>${esc(g.grupo)}</h3><div class="tabla-scroll"><table class="tabla">
      <thead><tr><th>Recurso</th><th>Para qué</th><th>Quién</th><th>Estado</th></tr></thead><tbody>
      ${g.items.map(i => `<tr><td><a href="${i.url}" target="_blank" rel="noopener">${esc(i.nombre)}</a></td><td>${esc(i.para)}</td><td>${esc(i.quien)}</td><td><span class="estado ${i.estado}">${i.estado}</span></td></tr>`).join('')}
      </tbody></table></div></section>`).join('')}`;
}


// ---------------- Vista Inicio (reloj lunar) ----------------
const RELOJ = { tam: 460, horas: 720 };
let relojDatos = null;
function ventanaReloj() {
  const c = config();
  const inicio = c.base + Math.floor(c.retraso / 30) * 30 * 864e5;
  return { c, inicio };
}
function calcularReloj(s) {
  const { inicio } = ventanaReloj();
  const clave = s.id + inicio;
  if (relojDatos?.clave === clave) return relojDatos;
  const sol = new Uint8Array(RELOJ.horas), tierra = new Uint8Array(RELOJ.horas);
  for (let h = 0; h < RELOJ.horas; h++) {
    const k = M.cielo(s, inicio + h * 36e5);
    sol[h] = k.sol.m > 0; tierra[h] = k.tierra.m > 0;
  }
  relojDatos = { clave, inicio, sol, tierra };
  return relojDatos;
}
const angHora = h => -Math.PI / 2 + (h / RELOJ.horas) * 2 * Math.PI;
function dibujarReloj() {
  const s = SITIOS.find(x => x.id === estado.sel[0]);
  const { c } = ventanaReloj();
  const d = calcularReloj(s);
  const { ver } = estado.cache[s.id];
  const cv = $('reloj'), dpr = devicePixelRatio || 1, T = RELOJ.tam, C = T / 2;
  cv.width = T * dpr; cv.height = T * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, T, T);
  const anillo = (radio, grosor, arr, color) => {
    ctx.lineWidth = grosor; ctx.lineCap = 'butt';
    ctx.strokeStyle = css('--panel-2'); ctx.beginPath(); ctx.arc(C, C, radio, 0, 2 * Math.PI); ctx.stroke();
    ctx.strokeStyle = color;
    let i = 0;
    while (i < RELOJ.horas) {
      if (!arr[i]) { i++; continue; }
      let j = i; while (j < RELOJ.horas && arr[j]) j++;
      ctx.beginPath(); ctx.arc(C, C, radio, angHora(i), angHora(j)); ctx.stroke(); i = j;
    }
  };
  anillo(C - 46, 26, d.sol, css('--sun'));
  anillo(C - 78, 16, d.tierra, css('--earth'));
  // marcas de días
  ctx.strokeStyle = css('--muted'); ctx.fillStyle = css('--muted'); ctx.lineWidth = 1; ctx.font = '10px ' + css('--font-data');
  for (let dia = 0; dia < 30; dia++) {
    const a = angHora(dia * 24), r1 = C - 30, r2 = C - (dia % 5 === 0 ? 22 : 26);
    ctx.beginPath(); ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1); ctx.lineTo(C + Math.cos(a) * r2, C + Math.sin(a) * r2); ctx.stroke();
    if (dia % 5 === 0) {
      const f = new Date(d.inicio + dia * 864e5), t = `${f.getUTCDate()} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][f.getUTCMonth()]}`;
      const rr = C - 10, w = ctx.measureText(t).width;
      ctx.fillText(t, C + Math.cos(a) * rr - w / 2, C + Math.sin(a) * rr + 4);
    }
  }
  // arco de la misión
  const h0 = (c.retraso % 30) * 24, h1 = h0 + c.dias * 24;
  const colV = { ok: css('--ok'), justo: css('--warn'), no: css('--bad') }[ver.c];
  ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.strokeStyle = colV;
  ctx.beginPath(); ctx.arc(C, C, C - 112, angHora(h0), angHora(h1)); ctx.stroke();
  const ax = C + Math.cos(angHora(h0)) * (C - 112), ay = C + Math.sin(angHora(h0)) * (C - 112);
  ctx.beginPath(); ctx.arc(ax, ay, 10, 0, 2 * Math.PI); ctx.fillStyle = css('--panel'); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = colV; ctx.stroke();
  // instante actual
  const ha = h0 + horaActual(), aa = angHora(ha);
  ctx.strokeStyle = css('--ink'); ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(C + Math.cos(aa) * (C - 96), C + Math.sin(aa) * (C - 96)); ctx.lineTo(C + Math.cos(aa) * (C - 30), C + Math.sin(aa) * (C - 30)); ctx.stroke();
  // centro
  ctx.textAlign = 'center';
  ctx.fillStyle = css('--muted'); ctx.font = '600 11px ' + css('--font-data'); ctx.fillText('ATERRIZAJE', C, C - 34);
  ctx.fillStyle = css('--ink'); ctx.font = '500 16px ' + css('--font-data'); ctx.fillText(fmtFecha(c.t0), C, C - 12);
  ctx.fillStyle = colV; ctx.font = '700 30px ' + css('--font-display'); ctx.fillText(ver.t, C, C + 24);
  ctx.fillStyle = css('--muted'); ctx.font = '12px ' + css('--font-data'); ctx.fillText(`${c.dias} días de misión`, C, C + 46);
  ctx.textAlign = 'start';
}
function dibujarInicioCielo() {
  const s = SITIOS.find(x => x.id === estado.sel[0]);
  const { r, ver } = estado.cache[s.id], c = config(), hora = horaActual();
  dibujarCielo($('inicio-panorama'), s, r, hora, 300);
  $('inicio-hora').max = c.dias * 24;
  $('inicio-hora-v').textContent = `+${fmtDH(hora)} · ${fmtFecha(c.t0 + hora * 36e5)}`;
  const k = r.serie[Math.min(hora, r.serie.length - 1)];
  const est = (b, si, no) => b.m > 0 ? `<span class="ok-t">${si}</span>` : `<span class="bad-t">${no}</span>`;
  $('inicio-ahora').innerHTML = `Sol ${k.sol.el.toFixed(1)}° · relieve ${k.sol.h.toFixed(1)}° → ${est(k.sol, 'luz', 'sombra')} &nbsp;·&nbsp; Tierra ${k.tierra.el.toFixed(1)}° · relieve ${k.tierra.h.toFixed(1)}° → ${est(k.tierra, 'comunicación', 'sin comunicación')}`;
  if (estado.vista === 'inicio') dibujarReloj();
}
// ---------------- Planificar: condiciones → mejor opción ----------------
const POLARES = () => SITIOS.filter(s => !s.fueraMapa);
function iniciarPlan() {
  estado.form.zona = new Set(POLARES().map(s => s.id));
  $('plan-desde').value = '2027-03-25'; $('plan-hasta').value = '2027-05-10';
  elegirPerfilPlan(estado.form.perfil);
  pintarFormPlan();
}
function elegirPerfilPlan(id) {
  const p = PERFILES.find(x => x.id === id); estado.form.perfil = id;
  $('plan-dias').value = p.dias; $('plan-aguante').value = p.aguante; $('plan-tierra').value = p.minTierra;
}
function pintarFormPlan() {
  $('plan-perfiles').innerHTML = PERFILES.map(p => `<button type="button" class="perfil" role="radio" aria-checked="${p.id === estado.form.perfil}" data-id="${p.id}"><b>${esc(p.nombre)}</b><span>${p.dias} días · aguanta ${p.aguante} h sin Sol · Tierra ≥ ${p.minTierra} %</span></button>`).join('');
}
function condicionesPlan() {
  const desde = Date.parse($('plan-desde').value + 'T00:00:00Z'), hasta = Date.parse($('plan-hasta').value + 'T12:00:00Z');
  return {
    perfil: estado.form.perfil, prioridad: estado.form.prioridad,
    sitios: SITIOS.filter(s => estado.form.zona.has(s.id)),
    desde, hasta: Math.max(desde, hasta),
    dias: Math.max(1, Math.min(30, +$('plan-dias').value || 10)),
    aguante: Math.max(0, +$('plan-aguante').value || 0),
    minTierra: Math.max(0, Math.min(100, +$('plan-tierra').value || 0)),
  };
}
function ejecutarBusqueda() {
  const cond = condicionesPlan();
  if (!cond.sitios.length || !(cond.desde > 0)) return;
  estado.busqueda = B.buscar(cond);
  const ops = estado.busqueda.opciones;
  adoptar(ops[0], ops.slice(0, 3).map(o => o.sitio.id), false);
}
// Fija una opción como plan: su fecha y los requisitos pasan al resto de vistas.
function adoptar(op, sel, ir = true) {
  const cond = estado.busqueda?.condiciones;
  estado.plan = op;
  $('fecha').value = isoLocal(op.aterrizaje); $('retraso').value = 0;
  if (cond) { $('dias').value = cond.dias; $('aguante').value = cond.aguante; $('min-tierra').value = cond.minTierra; $('perfil').value = cond.perfil; $('perfil-fuente').textContent = 'Umbrales: ' + PERFILES.find(x => x.id === cond.perfil).fuente; }
  estado.sel = sel || [op.sitio.id, ...estado.sel.filter(x => x !== op.sitio.id)].slice(0, 3);
  $('rp-retraso').value = 0; $('rp-desvio').value = 0; $('rp-aguante').value = $('aguante').value; $('rp-dias').value = $('dias').value;
  if (ir && location.hash !== '#inicio') location.hash = '#inicio'; else render();
}
$('plan-form').addEventListener('submit', e => { e.preventDefault(); ejecutarBusqueda(); });
$('plan-perfiles').addEventListener('click', e => { const b = e.target.closest('.perfil'); if (!b || e.target.closest('.explica-btn')) return; elegirPerfilPlan(b.dataset.id); pintarFormPlan(); decorar(); });

function pintarInicio() {
  const c = config(), s = SITIOS.find(x => x.id === estado.sel[0]);
  const { ver, t0 } = estado.cache[s.id];
  const res = estado.busqueda, esMejor = res && res.mejor.sitio.id === s.id && c.retraso === 0;
  $('res-eyebrow').textContent = esMejor ? `Mejor opción · ${res.probados} aterrizajes probados en ${res.condiciones.sitios.length} sitios · simulado` : 'Plan elegido';
  $('res-sitio').textContent = s.nombre;
  $('res-fecha').textContent = 'Aterrizaje ' + fmtFecha(t0);
  $('res-ver').className = 'pill grande ' + ver.c; $('res-ver').textContent = ver.t;
  $('res-motivo').textContent = ver.m;
  const r = estado.cache[s.id].r, cl = v => v ? 'ok-t' : 'bad-t';
  $('res-cifras').innerHTML = `
    <div data-explica="pct-sol"><span>Sol</span><b class="${cl(r.maxOscuro <= c.req.aguante)}">${Math.round(r.pctSol)} %</b></div>
    <div data-explica="sin-sol"><span>Sombra más larga</span><b class="${cl(r.maxOscuro <= c.req.aguante)}">${r.maxOscuro ? fmtDH(r.maxOscuro) : '0 h'}</b><small>aguanta ${c.req.aguante} h</small></div>
    <div data-explica="pct-tierra"><span>Tierra visible</span><b class="${cl(r.pctTierra >= c.req.minTierra)}">${Math.round(r.pctTierra)} %</b><small>pides ${c.req.minTierra} %</small></div>`;
  dibujarInicioCielo();
}
$('inicio-hora').addEventListener('input', () => { $('hora').value = $('inicio-hora').value; alCambiarHora(); });
$('inicio-play').addEventListener('click', () => { $('play').click(); $('inicio-play').textContent = $('play').textContent; });
(() => {
  let arrastrando = false;
  const mover = e => {
    const r = $('reloj').getBoundingClientRect();
    const x = (e.clientX - r.left) * RELOJ.tam / r.width - RELOJ.tam / 2, y = (e.clientY - r.top) * RELOJ.tam / r.height - RELOJ.tam / 2;
    let a = Math.atan2(y, x) + Math.PI / 2; if (a < 0) a += 2 * Math.PI;
    const dia = Math.round((a / (2 * Math.PI)) * 30) % 30;
    const base = Math.floor(+$('retraso').value / 30) * 30;
    const nuevo = Math.min(60, base + dia);
    if (nuevo !== +$('retraso').value) { $('retraso').value = nuevo; render(); }
  };
  $('reloj').addEventListener('pointerdown', e => { arrastrando = true; $('reloj').setPointerCapture(e.pointerId); mover(e); });
  $('reloj').addEventListener('pointermove', e => { if (arrastrando) mover(e); });
  $('reloj').addEventListener('pointerup', () => { arrastrando = false; });
})();



// ---------------- Replanificar: ¿qué ha cambiado? ----------------
function planActual() {
  const c = config();
  const p = estado.plan || { sitio: SITIOS.find(s => s.id === estado.sel[0]), aterrizaje: c.base };
  return p;
}
function pintarCambios() {
  const p = planActual(), s = p.sitio;
  const cond = { dias: Math.max(1, +$('rp-dias').value || +$('dias').value), aguante: Math.max(0, +$('rp-aguante').value), minTierra: +$('min-tierra').value };
  const ret = Math.max(0, +$('rp-retraso').value || 0), desvioM = Math.max(0, +$('rp-desvio').value || 0);
  const t = p.aterrizaje + ret * 864e5;
  $('rp-plan').textContent = `Plan actual: ${s.nombre} · aterrizaje ${fmtFecha(p.aterrizaje)} · ${$('dias').value} días · aguanta ${$('aguante').value} h sin Sol · Tierra ≥ ${$('min-tierra').value} %. Cambia lo que haga falta:`;
  const r = M.evaluar(s, t, cond.dias, 1), ver = M.veredicto(r, cond);
  const a = ver.c === 'ok' ? null : B.siguienteVentana(s, t, cond);
  const otros = B.otrosSitios(SITIOS, s.id, t, cond), b = otros.find(o => o.ver.c === 'ok');
  const d = desvioM > 0 ? B.desvio(s, t, cond, desvioM / 1000) : null;
  const col = c => ({ ok: 'var(--ok)', justo: 'var(--warn)', no: 'var(--bad)' }[c]);
  estado.salidas = { a, b, t, cond };
  $('rp-salidas').innerHTML = `
    <article class="salida" data-explica="cambios"><span class="eyebrow">Tu plan con los cambios</span>
      <p class="grande">${esc(s.nombre)}</p><span class="num">${fmtFecha(t)}</span>
      <span class="pill ${ver.c}" style="justify-self:start">${ver.t}</span><p class="motivo">${esc(ver.m)}</p></article>
    <article class="salida" data-explica="salida-a"><span class="eyebrow">A · Mismo sitio, siguiente ventana</span>
      ${ver.c === 'ok' ? '<p class="grande">No hace falta</p><p class="motivo">El plan sigue valiendo con estos cambios.</p>' :
        a ? `<p class="grande">${fmtFecha(a.t)}</p><p class="motivo">Esperar ${String(a.esperaDias).replace('.', ',')} días más. ${esc(a.ver.m)}.</p><button type="button" class="boton" data-adoptar="a">Adoptar</button>` :
        '<p class="grande">Sin ventana</p><p class="motivo">No vuelve a ser viable en los próximos 60 días.</p>'}</article>
    <article class="salida" data-explica="salida-b"><span class="eyebrow">B · Otro sitio, misma fecha</span>
      ${b ? `<p class="grande">${esc(b.sitio.nombre)}</p><p class="motivo">${esc(b.ver.m)}.</p><button type="button" class="boton" data-adoptar="b">Adoptar</button>` :
        '<p class="grande">Ninguno</p><p class="motivo">Ningún sitio del catálogo es viable en esa fecha.</p>'}</article>
    ${d ? `<article class="salida" data-explica="desvio"><span class="eyebrow">Si el aterrizaje cae a ${desvioM} m</span>
      <p class="grande">${d.viables} de 8 puntos viables</p><div class="puntos-desvio">${d.puntos.map(x => `<i style="background:${col(x.ver.c)}" title="${x.lat.toFixed(3)}°, ${x.lon.toFixed(2)}°: ${esc(x.ver.t)}"></i>`).join('')}</div>
      <p class="motivo">${d.viables === 8 ? 'El plan aguanta un desvío así.' : d.viables >= 5 ? 'Riesgo moderado: algunos puntos cercanos quedan sin Sol o sin Tierra.' : 'Riesgo alto: un desvío así puede dejar la nave sin Sol o sin Tierra, como le pasó a Athena.'}</p></article>` : ''}`;
  decorar();
}
$('rp-salidas').addEventListener('click', e => {
  const b = e.target.closest('[data-adoptar]'); if (!b) return;
  const { a, b: ob, t, cond } = estado.salidas, pl = planActual();
  const elegido = b.dataset.adoptar === 'a' ? { sitio: pl.sitio, aterrizaje: a.t, r: a.r, ver: a.ver } : { sitio: ob.sitio, aterrizaje: t, r: ob.r, ver: ob.ver };
  const op = { ...elegido, motivos: [elegido.ver.m], robustez: null };
  $('aguante').value = cond.aguante; $('dias').value = cond.dias;
  adoptar(op);
});
['rp-retraso', 'rp-aguante', 'rp-dias', 'rp-desvio'].forEach(id => $(id).addEventListener('input', pintarCambios));

// ---------------- Modo explicación ----------------
function decorar() {
  document.querySelectorAll('[data-explica]').forEach(el => {
    if (el.querySelector(':scope > .explica-btn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'explica-btn'; b.textContent = '?';
    b.setAttribute('aria-label', 'Explicar: ' + (EXPLICA[el.dataset.explica]?.titulo || el.dataset.explica));
    el.appendChild(b);
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('.explica-btn'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const el = b.parentElement;
  document.querySelectorAll('.resaltado').forEach(x => x.classList.remove('resaltado'));
  el.classList.add('resaltado');
  estado.ficha = { clave: el.dataset.explica, sitio: el.closest('[data-sitio]')?.dataset.sitio || null };
  pintarFicha();
}, true);
function contextoVivo(sitio) {
  const id = sitio || estado.sel[0];
  const k = estado.cache[id]; if (!k) return null;
  return { ...k, ahora: k.r.serie[Math.min(horaActual(), k.r.serie.length - 1)] };
}
function pintarFicha() {
  if (!estado.debug) return;
  const f = estado.ficha, x = f && EXPLICA[f.clave];
  const glosario = `<div class="glosario"><span class="eyebrow">Glosario rápido</span>${GLOSARIO.map(([t, d]) => `<p><b>${t}.</b> ${esc(d)}</p>`).join('')}</div>`;
  if (!x) {
    $('ficha').innerHTML = `<span class="eyebrow">Modo explicación</span><h2>Pulsa un «?»</h2>
      <p>Cada elemento marcado en morado tiene su ficha: qué es, qué te dice, de dónde sale hoy (simulado) y de dónde saldrá en el producto real.</p>
      <p class="ayuda">Para salir, pulsa «Modo explicación» arriba o quita <code>?debug=1</code> de la dirección.</p>${glosario}`;
    return;
  }
  const ctx = x.vivo ? contextoVivo(f.sitio) : null;
  const sitioTxt = ctx && f.sitio ? ` · ${esc(ctx.s.nombre)}` : '';
  $('ficha').innerHTML = `<span class="eyebrow">Modo explicación${sitioTxt}</span><h2>${esc(x.titulo)}</h2>
    <dl>
      <dt>Qué es</dt><dd>${enlazar(x.que)}</dd>
      <dt>Qué te dice</dt><dd>${enlazar(x.indica)}</dd>
      <dt>De dónde sale hoy (prototipo)</dt><dd>${enlazar(x.demo)}</dd>
      <dt>De dónde saldrá (producto)</dt><dd>${enlazar(x.real)}</dd>
      <dt>Cómo se calcula</dt><dd>${enlazar(x.calculo)}</dd>
      <dt>Quién lo construye</dt><dd>${esc(x.grupo)}</dd>
      ${ctx ? `<dt>Valores en este momento</dt><dd class="vivo">${esc(x.vivo(ctx))}</dd>` : ''}
    </dl>${glosario}`;
}
function aplicarDebug() {
  document.body.classList.toggle('debug', estado.debug);
  $('btn-debug').classList.toggle('activo', estado.debug);
  $('btn-debug').setAttribute('aria-pressed', estado.debug);
  const u = new URL(location.href);
  if (estado.debug) u.searchParams.set('debug', '1'); else u.searchParams.delete('debug');
  history.replaceState(null, '', u);
  if (!estado.debug) document.querySelectorAll('.resaltado').forEach(x => x.classList.remove('resaltado'));
  pintarFicha();
  requestAnimationFrame(() => { pintarMapa(); if (estado.vista === 'comparar') dibujarTarjetas(); });
}
$('btn-debug').addEventListener('click', () => { estado.debug = !estado.debug; aplicarDebug(); });

// ---------------- Render y eventos ----------------
function vistaDesdeHash() {
  const v = location.hash.slice(1);
  estado.vista = ['inicio', 'comparar', 'replanificar', 'fuentes'].includes(v) ? v : 'inicio';
}
function render() {
  calcular();
  pintarSitios();
  pintarMapa();
  ['inicio', 'comparar', 'replanificar', 'fuentes'].forEach(v => { $('vista-' + v).hidden = v !== estado.vista; });
  document.querySelectorAll('.vistas a').forEach(a => { if (a.dataset.vista === estado.vista) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('play').textContent = estado.jugando ? '❚❚' : '▶';
  const sinLateral = estado.vista === 'fuentes' || estado.vista === 'inicio';
  $('lateral').hidden = sinLateral;
  $('app').classList.toggle('sin-lateral', sinLateral);
  if (estado.vista === 'inicio') pintarInicio();
  if (estado.vista === 'comparar') pintarTarjetas();
  if (estado.vista === 'replanificar') { pintarCambios(); pintarReplanificar(); }
  if (estado.vista === 'fuentes') pintarFuentes();
  decorar();
  pintarFicha();
}
function alCambiarHora() {
  $('inicio-hora').value = $('hora').value;
  dibujarTarjetas(); pintarMapa();
  if (estado.vista === 'inicio') dibujarInicioCielo();
  if (estado.ficha && EXPLICA[estado.ficha.clave]?.vivo) pintarFicha();
}
$('perfil').addEventListener('change', () => { aplicarPerfil(PERFILES.find(p => p.id === $('perfil').value)); render(); });
['fecha', 'retraso', 'dias', 'aguante', 'min-tierra'].forEach(id => $(id).addEventListener('input', render));
$('hora').addEventListener('input', alCambiarHora);
$('play').addEventListener('click', () => {
  if (estado.jugando) { clearInterval(estado.jugando); estado.jugando = null; $('play').textContent = '▶'; return; }
  $('play').textContent = '❚❚';
  estado.jugando = setInterval(() => {
    const h = horaActual() + 2, max = +$('hora').max;
    $('hora').value = h > max ? 0 : h; alCambiarHora();
  }, 90);
});
window.addEventListener('hashchange', () => { vistaDesdeHash(); render(); });
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => estado.vista === 'comparar' && dibujarTarjetas(), 120); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { relieveImg = null; render(); });

iniciarFormulario();
iniciarPlan();
vistaDesdeHash();
aplicarDebug();
ejecutarBusqueda();
