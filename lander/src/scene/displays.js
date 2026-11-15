// The glass of the cabin: three multifunction displays, the warning matrix and the numeric readout, drawn on canvases.
import * as THREE from 'three';
import { LANDER, START, massOf } from '../sim/physics.js';
import { PAD_RADIUS_M } from '../sim/terrain.js';
import { SITE } from '../site.js';
import { UI as TEXTS, LANG, fixed } from '../texts.js';
import { dateTime } from '../../../shared/format/time.js';

const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
const C = { bg: '#04080c', grid: '#18303c', dim: '#4d7686', text: '#bfeaf5', green: '#58f29a', amber: '#ffb347', red: '#ff5a48', blue: '#58b4ff', white: '#f1fbff' };
const num = (v, d = 0) => fixed(v, d);
const L = text => TEXTS.cockpit(text);

function screen(w, h) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return { canvas, g: canvas.getContext('2d'), texture, w, h };
}

function header(g, w, title, right, colour = C.text) {
  g.fillStyle = C.bg; g.fillRect(0, 0, w, 400);
  g.fillStyle = '#0b1820'; g.fillRect(0, 0, w, 34);
  g.font = `500 18px ${MONO}`; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = C.dim; g.fillText(L(title), 12, 18);
  g.textAlign = 'right'; g.fillStyle = colour; g.fillText(right, w - 12, 18);
}

function field(g, x, y, label, value, unit, colour = C.white, size = 30) {
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = `500 13px ${MONO}`; g.fillStyle = C.dim; g.fillText(L(label), x, y);
  g.font = `500 ${size}px ${MONO}`; g.fillStyle = colour; g.fillText(value, x, y + size + 2);
  const w = g.measureText(value).width;
  g.font = `500 14px ${MONO}`; g.fillStyle = C.dim; g.fillText(unit, x + w + 6, y + size + 2);
}

export function createDisplays(scene, panels, { cameraTarget, terrain, nominal }) {
  const main = panels.panel('main'), pedestal = panels.panel('pedestal');
  const spec = id => [...main.screens, ...pedestal.screens].find(s => s.id === id);
  const off = new THREE.MeshBasicMaterial({ color: 0x020304 });
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.4, metalness: 0.4 });
  const mount = (panel, s, px, py) => {
    const sc = screen(px, py);
    const mat = new THREE.MeshBasicMaterial({ map: sc.texture, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
    mesh.matrixAutoUpdate = false; mesh.matrix.copy(panels.at(panel, s.u, s.v, 0.007));
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.03, s.h + 0.03, 0.012), bezelMat);
    bezel.matrixAutoUpdate = false; bezel.matrix.copy(panels.at(panel, s.u, s.v, 0));
    scene.add(mesh, bezel);
    return { ...sc, mesh, mat, centre: new THREE.Vector3().setFromMatrixPosition(mesh.matrix) };
  };
  const left = mount(main, spec('left'), 512, 384), center = mount(main, spec('center'), 512, 384), right = mount(main, spec('right'), 512, 384);
  const warnings = mount(main, spec('warnings'), 800, 140), numeric = mount(pedestal, spec('numeric'), 600, 170);
  const cameraMat = new THREE.MeshBasicMaterial({ map: cameraTarget.texture, toneMapped: false });

  function drawLeft(d) {
    const { g, w, h } = left, s = d.state;
    header(g, w, 'ACTITUD', d.sys.autopilot ? TEXTS.hud.auto : TEXTS.hud.manual, d.sys.autopilot ? C.green : C.amber);
    // Attitude ball: the horizon drops as the nose pitches up.
    const cx = 196, cy = 204, r = 128, k = 3.4;
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip();
    const hy = cy + s.pitchDeg * k;
    g.fillStyle = '#0d2b4d'; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    g.fillStyle = '#5a4a3c'; g.fillRect(cx - r, hy, 2 * r, 2 * r + 400);
    g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - r, hy); g.lineTo(cx + r, hy); g.stroke();
    g.font = `500 12px ${MONO}`; g.fillStyle = C.white; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let p = -80; p <= 80; p += 10) {
      if (!p) continue;
      const y = hy - p * k, half = p % 20 ? 18 : 34;
      g.beginPath(); g.moveTo(cx - half, y); g.lineTo(cx + half, y); g.stroke();
      if (p % 20 === 0) { g.fillText(String(Math.abs(p)), cx - half - 14, y); g.fillText(String(Math.abs(p)), cx + half + 14, y); }
    }
    g.restore();
    g.strokeStyle = C.dim; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
    g.strokeStyle = C.amber; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - 62, cy); g.lineTo(cx - 20, cy); g.lineTo(cx, cy + 14); g.lineTo(cx + 20, cy); g.lineTo(cx + 62, cy); g.stroke();
    // Velocity cue: where the vehicle is really going.
    const fx = Math.max(-1, Math.min(1, s.vx / 40)) * r * 0.8, fy = Math.max(-1, Math.min(1, -s.vz / 40)) * r * 0.8;
    g.strokeStyle = C.green; g.lineWidth = 2; g.beginPath(); g.arc(cx + fx, cy + fy, 9, 0, 7); g.moveTo(cx + fx - 18, cy + fy); g.lineTo(cx + fx - 9, cy + fy); g.moveTo(cx + fx + 9, cy + fy); g.lineTo(cx + fx + 18, cy + fy); g.stroke();
    const alt = d.sys.radar ? num(Math.max(0, d.height)) : '----';
    field(g, 350, 62, 'ALTURA', alt, 'm', d.height < 150 ? C.amber : C.white, 34);
    field(g, 350, 130, 'VEL V', num(s.vz, 1), 'm/s', d.warnings.sinkRate ? C.red : C.white);
    field(g, 350, 194, 'VEL H', num(s.vx, 1), 'm/s');
    field(g, 350, 258, 'CABECEO', num(s.pitchDeg, 1), '°');
    g.font = `500 15px ${MONO}`; g.fillStyle = C.blue; g.textAlign = 'left'; g.fillText(TEXTS.phases[d.phase].toUpperCase(), 350, 350);
    g.fillStyle = C.dim; g.fillText(`T+${num(s.t, 0).padStart(3, '0')} s`, 350, 372);
    g.fillStyle = C.dim; g.fillText(L('EMPUJE'), 20, 360);
    g.strokeStyle = C.dim; g.lineWidth = 1; g.strokeRect(90, 348, 230, 14);
    g.fillStyle = C.amber; g.fillRect(91, 349, 228 * s.throttle, 12);
    left.texture.needsUpdate = true;
  }

  const plot = { x: 46, y: 52, w: 300, h: 250, range: Math.abs(START.x) * 1.08, top: START.alt * 1.12, floor: -260 };
  const px = x => plot.x + plot.w * (1 - Math.min(1.02, -x / plot.range)), py = a => plot.y + plot.h * (1 - Math.min(1, Math.max(0, a - plot.floor) / (plot.top - plot.floor)));
  const ground = Array.from({ length: 61 }, (_, i) => { const x = -plot.range * (1 - i / 60); return [x, terrain.heightAt(x, 0)]; });

  function drawCenter(d) {
    const { g, w } = center, s = d.state;
    header(g, w, 'DESCENSO', TEXTS.phases[d.phase].toUpperCase(), C.blue);
    g.strokeStyle = C.grid; g.lineWidth = 1; g.font = `500 11px ${MONO}`; g.fillStyle = C.dim; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let a = 0; a <= 2000; a += 500) { g.beginPath(); g.moveTo(plot.x, py(a)); g.lineTo(plot.x + plot.w, py(a)); g.stroke(); g.fillText(String(a), plot.x - 5, py(a)); }
    g.textAlign = 'center';
    for (let x = -4000; x <= 0; x += 1000) { g.beginPath(); g.moveTo(px(x), plot.y); g.lineTo(px(x), plot.y + plot.h); g.stroke(); g.fillText(`${-x / 1000} km`, px(x), plot.y + plot.h + 12); }
    g.fillStyle = '#2a2622'; g.beginPath(); g.moveTo(px(ground[0][0]), plot.y + plot.h + 4);
    for (const [x, hgt] of ground) g.lineTo(px(x), py(hgt));
    g.lineTo(px(0), plot.y + plot.h + 4); g.fill();
    g.strokeStyle = C.dim; g.setLineDash([5, 5]); g.lineWidth = 1.5; g.beginPath();
    nominal.forEach(([x, a], i) => (i ? g.lineTo(px(x), py(a)) : g.moveTo(px(x), py(a))));
    g.stroke(); g.setLineDash([]);
    g.strokeStyle = C.green; g.lineWidth = 2; g.beginPath();
    d.trail.forEach(([x, a], i) => (i ? g.lineTo(px(x), py(a)) : g.moveTo(px(x), py(a))));
    g.stroke();
    const lx = px(s.x), ly = py(s.alt);
    g.fillStyle = C.white; g.beginPath(); g.moveTo(lx, ly - 8); g.lineTo(lx + 7, ly + 6); g.lineTo(lx - 7, ly + 6); g.fill();
    g.strokeStyle = C.amber; g.lineWidth = 2; g.beginPath(); g.moveTo(px(0) - 8, py(0)); g.lineTo(px(0) + 8, py(0)); g.moveTo(px(0), py(0) - 12); g.lineTo(px(0), py(0)); g.stroke();
    const fuelPct = (s.fuelKg / LANDER.fuelKg) * 100;
    field(g, 372, 58, 'DISTANCIA', num(Math.abs(s.x)), 'm', C.white, 24);
    field(g, 372, 112, 'COMBUSTIBLE', num(s.fuelKg), 'kg', fuelPct < 12 ? C.red : C.white, 24);
    field(g, 372, 166, 'MASA', num(massOf(s)), 'kg', C.white, 24);
    field(g, 372, 220, 'EMPUJE/PESO', num(s.thrustN / (massOf(s) * 1.62), 2), '', C.white, 24);
    g.strokeStyle = C.dim; g.strokeRect(372, 290, 120, 14);
    g.fillStyle = fuelPct < 12 ? C.red : C.green; g.fillRect(373, 291, 118 * fuelPct / 100, 12);
    g.font = `500 12px ${MONO}`; g.fillStyle = C.dim; g.textAlign = 'left'; g.fillText(`${L('COMB')} ${num(fuelPct)} %`, 372, 322);
    g.fillText(`${L('TREN')} ${L(d.gear >= 1 ? 'ABAJO' : d.gear > 0 ? 'EN TRÁNSITO' : 'ARRIBA')}`, 372, 344);
    g.fillStyle = C.dim; g.fillText(L('ALTURA SOBRE EL SITIO (m)'), 46, 352);
    center.texture.needsUpdate = true;
  }

  function drawSystems(d) {
    const { g, w } = right, v = d.sys;
    header(g, w, 'SISTEMAS', L(SITE.name.toUpperCase()));
    const rows = [
      ['MOTOR DE DESCENSO', v.engineArmed ? 'ARMADO' : 'SEGURO', v.engineArmed ? C.green : C.amber],
      ['VÁLVULAS DE PROPELENTE', d.values.propValves.on ? 'ABIERTAS' : 'CERRADAS', d.values.propValves.on ? C.green : C.red],
      ['CONTROL DE REACCIÓN', v.rcs ? 'ACTIVO' : 'APAGADO', v.rcs ? C.green : C.red],
      ['ORDENADOR GNC', d.values.gnc.on ? 'EN LÍNEA' : 'APAGADO', d.values.gnc.on ? C.green : C.red],
      ['RADAR ALTÍMETRO', v.radar ? 'ENGANCHADO' : 'APAGADO', v.radar ? C.green : C.amber],
      ['TREN DE ATERRIZAJE', d.gear >= 1 ? 'ABAJO' : d.gear > 0 ? `${num(d.gear * 100)} %` : 'ARRIBA', d.gear >= 1 ? C.green : C.amber],
      ['BUS A / BUS B', `${num(28.1, 1)} V`, C.green], ['CABINA', '57 kPa · 21 °C', C.green], ['OXÍGENO', '96 %', C.green],
    ];
    g.font = `500 16px ${MONO}`; g.textBaseline = 'middle';
    rows.forEach(([label, value, colour], i) => {
      const y = 62 + i * 30;
      g.fillStyle = i % 2 ? '#071016' : '#0a1820'; g.fillRect(10, y - 14, w - 20, 28);
      g.textAlign = 'left'; g.fillStyle = C.text; g.fillText(L(label), 20, y);
      g.textAlign = 'right'; g.fillStyle = colour; g.fillText(L(value), w - 20, y);
    });
    g.textAlign = 'left'; g.font = `500 12px ${MONO}`; g.fillStyle = C.dim;
    g.fillText(`${num(-SITE.latDeg, 1)}° S  ${num(-SITE.lonDeg, 1)}° ${L('O')} · ${dateTime(LANG, SITE.date)}`, 20, 344);
    g.fillText(`${L('SOL')} ${num(SITE.sun.elDeg, 1)}° ${L('SOBRE EL HORIZONTE')} · ${L('TIERRA')} ${num(SITE.earth.elDeg, 1)}°`, 20, 364);
    right.texture.needsUpdate = true;
  }

  function drawRoute(d) {
    const { g, w, h } = right, s = d.state, cx = w / 2, cy = 206, scale = 150 / Math.max(260, Math.min(5200, Math.abs(s.x) * 1.15 + 120));
    header(g, w, 'RUTA', `${num(Math.abs(s.x))} m`);
    g.save(); g.beginPath(); g.rect(10, 40, w - 20, h - 80); g.clip();
    // Up is the approach heading: the lander comes from the bottom of the screen.
    const sx = z => cx + z * scale, sy = x => cy - x * scale;
    g.lineWidth = 1.5;
    for (const c of terrain.craters) {
      const r = c.radius * scale;
      if (r < 1.5 || Math.abs(sx(c.z) - cx) > 260 + r || Math.abs(sy(c.x) - cy) > 170 + r) continue;
      g.strokeStyle = '#3e5560'; g.fillStyle = '#0a141a'; g.beginPath(); g.arc(sx(c.z), sy(c.x), r, 0, 7); g.fill(); g.stroke();
    }
    g.strokeStyle = C.amber; g.beginPath(); g.arc(cx, cy, Math.max(4, PAD_RADIUS_M * scale), 0, 7); g.moveTo(cx - 14, cy); g.lineTo(cx + 14, cy); g.moveTo(cx, cy - 14); g.lineTo(cx, cy + 14); g.stroke();
    g.fillStyle = C.green; g.beginPath(); g.moveTo(cx, sy(s.x) - 10); g.lineTo(cx + 7, sy(s.x) + 7); g.lineTo(cx - 7, sy(s.x) + 7); g.fill();
    g.restore();
    const arrow = (az, label, colour, x) => {
      const a = ((az - SITE.approachAzDeg) * Math.PI) / 180;
      g.strokeStyle = colour; g.fillStyle = colour; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, 348); g.lineTo(x + Math.sin(a) * 16, 348 - Math.cos(a) * 16); g.stroke();
      g.beginPath(); g.arc(x + Math.sin(a) * 16, 348 - Math.cos(a) * 16, 3.5, 0, 7); g.fill();
      g.font = `500 12px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(L(label), x + 24, 348);
    };
    arrow(SITE.sun.azDeg, 'SOL', C.amber, 40); arrow(SITE.earth.azDeg, 'TIERRA', C.blue, 150); arrow(0, 'NORTE', C.text, 290);
    right.texture.needsUpdate = true;
  }

  const TILES = [
    ['AUTO', C.green, d => d.sys.autopilot], ['MANUAL', C.amber, d => !d.sys.autopilot], ['MOTOR ARMADO', C.green, d => d.sys.engineArmed],
    ['TREN ABAJO', C.green, d => d.gear >= 1 || (d.gear > 0 && d.blink)], ['RCS', C.green, d => d.sys.rcs], ['CONTACTO', C.blue, d => d.phase === 'contact'],
    ['COMB BAJO', C.amber, d => d.warnings.lowFuel], ['VEL DESCENSO', C.red, d => d.warnings.sinkRate && d.blink], ['TREN ARRIBA', C.red, d => d.warnings.gearUp && d.blink],
    ['MOTOR', C.red, d => d.warnings.noEngine], ['SIN RCS', C.amber, d => d.warnings.noRcs], ['ABORTO', C.red, d => d.phase === 'abort'],
  ];
  function drawWarnings(d) {
    const { g, w, h } = warnings;
    g.fillStyle = '#050607'; g.fillRect(0, 0, w, h);
    g.font = `600 17px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    TILES.forEach(([label, colour, test], i) => {
      const x = 6 + (i % 6) * 132, y = 6 + Math.floor(i / 6) * 66, on = test(d);
      g.fillStyle = on ? colour : '#14181c'; g.fillRect(x, y, 126, 60);
      g.fillStyle = on ? '#06090b' : '#3a444c'; g.fillText(L(label), x + 63, y + 31);
    });
    warnings.texture.needsUpdate = true;
  }

  function drawNumeric(d) {
    const { g, w, h } = numeric, s = d.state;
    g.fillStyle = '#030605'; g.fillRect(0, 0, w, h);
    const cell = (x, label, value) => {
      g.font = `500 17px ${MONO}`; g.fillStyle = '#3f8f5e'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(L(label), x, 40);
      g.font = `500 62px ${MONO}`; g.fillStyle = '#6dffa6'; g.fillText(value, x, 128);
    };
    cell(20, 'ALT m', d.sys.radar ? num(Math.max(0, d.height)).padStart(4, ' ') : '----');
    cell(222, 'V VERT', num(s.vz, 1));
    cell(430, 'V HOR', num(Math.abs(s.vx), 1));
    numeric.texture.needsUpdate = true;
  }

  let frame = 0;
  return {
    screens: { left, center, right },
    update(d) {
      frame++;
      const power = d.sys.mfd;
      left.mesh.material = power.left ? left.mat : off;
      center.mesh.material = power.center ? center.mat : off;
      right.mesh.material = !power.right ? off : d.sys.camera === 1 ? cameraMat : right.mat;
      if (frame % 2 === 0 && power.left) drawLeft(d);
      const slot = frame % 8;
      if (slot === 1 && power.center) drawCenter(d);
      else if (slot === 3 && power.right && d.sys.camera !== 1) (d.sys.camera === 2 ? drawRoute : drawSystems)(d);
      else if (slot === 5) drawWarnings(d);
      else if (slot === 7) drawNumeric(d);
    },
    cameraActive: d => d.sys.mfd.right && d.sys.camera === 1,
  };
}
