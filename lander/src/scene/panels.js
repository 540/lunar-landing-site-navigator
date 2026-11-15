// Control panels: where each control sits, its engraved label and its 3D parts (instanced, one draw call per part).
import * as THREE from 'three';
import { CONTROLS, controlById } from '../sim/controls.js';
import { UI } from '../texts.js';

const row = (ids, u0, v, du) => ids.map((id, i) => ({ id, u: u0 + i * du, v }));
const seq = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
const HALF_PI = Math.PI / 2;

// Panel frame: u to the reader's right, v up, the controls stick out along the normal.
export const PANELS = [
  {
    id: 'main', w: 2.2, h: 0.6, pos: [0, 0.69, -1.25], rx: -0.449, ry: 0, res: 1500,
    groups: [
      { title: 'PROPULSIÓN', u: -1.085, v: -0.285, w: 0.245, h: 0.3 }, { title: 'VUELO', u: -0.84, v: -0.285, w: 0.44, h: 0.085 },
      { title: 'PANTALLAS', u: -0.24, v: -0.285, w: 0.48, h: 0.085 }, { title: 'COMUNICACIONES', u: 0.4, v: -0.285, w: 0.44, h: 0.085 },
      { title: 'EXTERIOR', u: 0.84, v: -0.285, w: 0.245, h: 0.3 }, { title: 'MOTOR', u: -1.085, v: 0.03, w: 0.245, h: 0.255 }, { title: 'ENERGÍA', u: 0.84, v: 0.03, w: 0.245, h: 0.255 },
    ],
    items: [
      { id: 'autopilot', u: -0.72, v: 0.248, big: true }, { id: 'masterAlarm', u: -0.52, v: 0.248, big: true },
      { id: 'landingLights', u: 0.5, v: 0.255 }, { id: 'panelLights', u: 0.62, v: 0.255 }, { id: 'cabinLights', u: 0.74, v: 0.25 },
      ...row(seq('keyL', 1, 6), -0.785, -0.15, 0.066), ...row(seq('keyC', 1, 6), -0.165, -0.15, 0.066), ...row(seq('keyR', 1, 6), 0.455, -0.15, 0.066),
      ...row(['rcs', 'gnc', 'radarAlt', 'propValves'], -0.785, -0.238, 0.11),
      ...row(['mfdLeft', 'mfdCenter', 'mfdRight'], -0.18, -0.238, 0.105), { id: 'camera', u: 0.165, v: -0.24 },
      ...row(seq('comm', 1, 4), 0.455, -0.238, 0.11),
      ...row(seq('prop', 1, 3), -1.04, -0.09, 0.075), ...row(seq('prop', 4, 6), -1.04, -0.225, 0.075),
      ...row(seq('ext', 1, 3), 0.89, -0.09, 0.075), ...row(seq('ext', 4, 6), 0.89, -0.225, 0.075),
      ...row(seq('comm', 5, 6), 0.92, 0.075, 0.09),
    ],
    screens: [
      { id: 'left', u: -0.62, v: 0.035, w: 0.4, h: 0.3 }, { id: 'center', u: 0, v: 0.035, w: 0.4, h: 0.3 }, { id: 'right', u: 0.62, v: 0.035, w: 0.4, h: 0.3 },
      { id: 'warnings', u: 0, v: 0.247, w: 0.4, h: 0.07 },
    ],
    gauges: [
      { id: 'thrust', label: 'EMPUJE %', u: -1.02, v: 0.215 }, { id: 'fuel', label: 'COMB %', u: -0.91, v: 0.215 },
      { id: 'pressure', label: 'PRES CAB', u: -1.02, v: 0.105 }, { id: 'oxygen', label: 'O₂', u: -0.91, v: 0.105 },
      { id: 'volts', label: 'BUS V', u: 0.91, v: 0.215 }, { id: 'temp', label: 'TEMP °C', u: 1.02, v: 0.215 },
    ],
  },
  {
    id: 'pedestal', w: 0.4, h: 1, pos: [0, 0.56, -0.61], rx: -HALF_PI, ry: 0, res: 1900,
    groups: [{ title: 'GUIADO', u: -0.19, v: 0.22, w: 0.38, h: 0.265 }, { title: 'DESCENSO', u: -0.19, v: 0.05, w: 0.38, h: 0.16 }, { title: 'MANDOS DE VUELO', u: -0.19, v: -0.49, w: 0.38, h: 0.4 }],
    items: [
      ...row(seq('ped', 1, 6), -0.15, 0.4, 0.06), { id: 'pedMode', u: -0.09, v: 0.29 }, { id: 'pedRate', u: 0.09, v: 0.29 },
      { id: 'engineArm', u: -0.125, v: 0.125 }, { id: 'gear', u: 0, v: 0.125 }, { id: 'abort', u: 0.125, v: 0.125 },
      { id: 'throttle', u: -0.115, v: -0.29 }, { id: 'stick', u: 0.115, v: -0.3 },
    ],
    screens: [{ id: 'numeric', u: 0, v: -0.02, w: 0.3, h: 0.085 }],
  },
  {
    id: 'overhead', w: 1.7, h: 0.8, pos: [0, 2.085, -0.8], rx: 1.2915, ry: 0, res: 1500,
    groups: [{ title: 'ELÉCTRICO', u: -0.8, v: 0.2, w: 1.15, h: 0.15 }, { title: 'SOPORTE VITAL', u: -0.8, v: 0.04, w: 1.15, h: 0.15 }, { title: 'AMBIENTE', u: 0.4, v: 0.04, w: 0.4, h: 0.31 }, { title: 'DISYUNTORES', u: -0.8, v: -0.36, w: 1.6, h: 0.38 }],
    items: [
      ...row(seq('bat', 1, 10), -0.72, 0.285, 0.11), ...row(seq('ecl', 1, 10), -0.72, 0.125, 0.11),
      { id: 'ohTemp', u: 0.5, v: 0.21 }, { id: 'ohPress', u: 0.69, v: 0.21 },
      ...row(seq('cb', 1, 12), -0.66, -0.07, 0.12), ...row(seq('cb', 13, 24), -0.66, -0.17, 0.12), ...row(seq('cb', 25, 36), -0.66, -0.27, 0.12),
    ],
  },
  {
    id: 'sideLeft', w: 1.3, h: 0.4, pos: [-1.47, 0.62, -0.75], rx: -HALF_PI, ry: HALF_PI, res: 1400,
    groups: [{ title: 'AUDIO · COMANDANTE', u: -0.6, v: 0.01, w: 0.8, h: 0.17 }],
    items: [...row(seq('sideL', 1, 6), -0.36, 0.1, 0.09), { id: 'sideLVol', u: -0.5, v: 0.09 }],
  },
  {
    id: 'sideRight', w: 1.3, h: 0.4, pos: [1.47, 0.62, -0.75], rx: -HALF_PI, ry: -HALF_PI, res: 1400,
    groups: [{ title: 'AUDIO · PILOTO', u: -0.2, v: 0.01, w: 0.8, h: 0.17 }],
    items: [...row(seq('sideR', 1, 6), -0.09, 0.1, 0.09), { id: 'sideRVol', u: 0.5, v: 0.09 }],
  },
  {
    id: 'rack', w: 0.8, h: 0.36, pos: [1.1, 1.32, 2.265], rx: 0, ry: Math.PI, res: 1400,
    groups: [{ title: 'BASTIDOR DE CARGA ÚTIL', u: -0.38, v: -0.16, w: 0.76, h: 0.3 }],
    items: row(seq('rack', 1, 6), -0.275, -0.02, 0.11),
  },
];

const LIGHT = { green: [0.25, 1, 0.45], amber: [1, 0.68, 0.15], red: [1, 0.16, 0.12], white: [0.85, 0.93, 1], blue: [0.35, 0.65, 1] };
const DARK = 0.07;

function panelMatrix(p) {
  const o = new THREE.Object3D();
  o.rotation.order = 'YXZ';
  o.position.set(...p.pos); o.rotation.set(p.rx, p.ry, 0); o.updateMatrix();
  return o.matrix.clone();
}

function drawFace(g, p, glow) {
  const W = p.w * p.res, H = p.h * p.res, px = u => (u + p.w / 2) * p.res, py = v => (p.h / 2 - v) * p.res, mm = p.res / 1000;
  if (glow) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
  else {
    const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, '#3a3f47'); grad.addColorStop(1, '#2c3037');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    // Brushed finish and fastening screws.
    g.globalAlpha = 0.05; g.fillStyle = '#fff';
    for (let y = 0; y < H; y += 3) if ((y * 7919) % 5 < 2) g.fillRect(0, y, W, 1);
    g.globalAlpha = 1;
    g.strokeStyle = '#191b1f'; g.lineWidth = 6 * mm; g.strokeRect(3 * mm, 3 * mm, W - 6 * mm, H - 6 * mm);
    for (const [x, y] of [[14, 14], [W / mm - 14, 14], [14, H / mm - 14], [W / mm - 14, H / mm - 14], [W / mm / 2, 14], [W / mm / 2, H / mm - 14]]) {
      g.fillStyle = '#8b9097'; g.beginPath(); g.arc(x * mm, y * mm, 4.5 * mm, 0, 7); g.fill();
      g.strokeStyle = '#2a2d31'; g.lineWidth = 1.2 * mm; g.beginPath(); g.moveTo((x - 3) * mm, (y - 3) * mm); g.lineTo((x + 3) * mm, (y + 3) * mm); g.stroke();
    }
  }
  const ink = glow ? '#ffe9bf' : '#e9ecef', line = glow ? '#6a5a3a' : '#7d848d';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const grp of p.groups ?? []) {
    g.strokeStyle = line; g.lineWidth = 1.4 * mm;
    g.beginPath(); g.roundRect(px(grp.u), py(grp.v + grp.h), grp.w * p.res, grp.h * p.res, 8 * mm); g.stroke();
    g.font = `600 ${8.5 * mm}px Inter, system-ui, sans-serif`;
    const title = UI.cockpit(grp.title);
    const tw = g.measureText(title).width + 10 * mm;
    g.fillStyle = glow ? '#000' : '#30343b'; g.fillRect(px(grp.u) + 12 * mm, py(grp.v + grp.h) - 6 * mm, tw, 12 * mm);
    g.fillStyle = ink; g.fillText(title, px(grp.u) + 12 * mm + tw / 2, py(grp.v + grp.h) + 0.5 * mm);
  }
  for (const it of p.items) {
    const def = controlById(it.id);
    const x = px(it.u), y = py(it.v), k = def.kind;
    const below = k === 'button' ? (it.big ? 30 : 17) : k === 'rotary' ? 31 : k === 'breaker' ? 16 : k === 'guarded' ? 40 : k === 'lever' ? 118 : k === 'stick' ? 82 : 22;
    const size = k === 'breaker' ? 5.5 : it.big || k === 'guarded' || k === 'lever' || k === 'stick' ? 9 : 6.6;
    g.font = `600 ${size * mm}px Inter, system-ui, sans-serif`;
    g.fillStyle = ink;
    const label = k === 'breaker' ? def.label : UI.cockpit(def.label);
    const words = label.split(' ');
    const lines = k !== 'breaker' && words.length > 1 && g.measureText(label).width > 62 * mm ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [label];
    lines.forEach((t, i) => g.fillText(k === 'breaker' ? t.replace('DISY ', '') : t, x, y + below * mm + i * size * 1.15 * mm));
    g.strokeStyle = line; g.lineWidth = 1 * mm;
    if (k === 'rotary') {
      const n = def.positions.length;
      g.font = `600 ${5.4 * mm}px Inter, system-ui, sans-serif`;
      def.positions.forEach((t, i) => { const a = (i - (n - 1) / 2) * 0.7; g.fillText(UI.cockpit(t), x + Math.sin(a) * 27 * mm, y - Math.cos(a) * 25 * mm); });
    } else if (k === 'toggle') {
      g.font = `600 ${4.6 * mm}px Inter, system-ui, sans-serif`; g.fillStyle = line; g.fillText('ON', x + 13 * mm, y - 8 * mm);
    } else if (k === 'lever') {
      g.strokeRect(x - 9 * mm, y - 95 * mm, 18 * mm, 190 * mm);
      g.font = `600 ${6 * mm}px Inter, system-ui, sans-serif`; g.fillStyle = ink;
      for (let i = 0; i <= 4; i++) { const yy = y + (95 - i * 47.5) * mm; g.beginPath(); g.moveTo(x - 20 * mm, yy); g.lineTo(x - 10 * mm, yy); g.stroke(); g.fillText(String(i * 25), x - 32 * mm, yy); }
    } else if (k === 'guarded') {
      g.setLineDash([5 * mm, 4 * mm]); g.strokeStyle = glow ? '#7a3a20' : '#d9a23a'; g.lineWidth = 2 * mm;
      g.strokeRect(x - 26 * mm, y - 32 * mm, 52 * mm, 62 * mm); g.setLineDash([]);
    }
  }
}

function faceTextures(p) {
  return [false, true].map(glow => {
    const c = document.createElement('canvas');
    c.width = Math.round(p.w * p.res); c.height = Math.round(p.h * p.res);
    drawFace(c.getContext('2d'), p, glow);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
    return t;
  });
}

function gaugeTexture(label) {
  const c = document.createElement('canvas'); c.width = c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#0c0e11'; g.beginPath(); g.arc(96, 96, 94, 0, 7); g.fill();
  g.strokeStyle = '#e8ebee'; g.fillStyle = '#e8ebee'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i <= 20; i++) {
    const a = (-225 + i * 13.5) * Math.PI / 180, major = i % 5 === 0;
    g.lineWidth = major ? 4 : 2; g.strokeStyle = i >= 17 ? '#ff5a45' : '#e8ebee';
    g.beginPath(); g.moveTo(96 + Math.cos(a) * 84, 96 + Math.sin(a) * 84); g.lineTo(96 + Math.cos(a) * (major ? 66 : 74), 96 + Math.sin(a) * (major ? 66 : 74)); g.stroke();
    if (major) { g.font = '600 17px Inter, sans-serif'; g.fillText(String(i * 5), 96 + Math.cos(a) * 50, 96 + Math.sin(a) * 50); }
  }
  g.font = '600 16px Inter, sans-serif'; g.fillStyle = '#ffe9bf'; g.fillText(label, 96, 150);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function createPanels(scene) {
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.9, roughness: 0.3 });
  const black = new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.2, roughness: 0.55 });
  const lit = new THREE.MeshBasicMaterial({ toneMapped: false });
  const counts = { toggle: 0, button: 0, rotary: 0, breaker: 0 };
  const placed = [];
  for (const p of PANELS) {
    p.matrix = panelMatrix(p);
    for (const it of p.items) {
      const def = controlById(it.id);
      const kind = def.kind === 'guarded' ? 'toggle' : def.kind;
      if (kind in counts) counts[kind]++;
      placed.push({ ...it, def, panel: p, kind });
    }
  }
  const missing = CONTROLS.filter(c => !placed.some(pl => pl.id === c.id)).map(c => c.id);
  if (missing.length) throw new Error(`Controls without a place on a panel: ${missing.join(', ')}`);

  const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); m.frustumCulled = false; scene.add(m); return m; };
  const along = geo => geo.rotateX(HALF_PI); // cylinders are built along y: lay them along the panel normal
  const parts = {
    toggleBase: inst(along(new THREE.CylinderGeometry(0.0075, 0.0085, 0.006, 6)).translate(0, 0, 0.003), metal, counts.toggle),
    toggleLever: inst(along(new THREE.CapsuleGeometry(0.0032, 0.02, 3, 8)).translate(0, 0, 0.013), metal, counts.toggle),
    led: inst(along(new THREE.CylinderGeometry(0.0038, 0.0038, 0.003, 10)).translate(0, 0, 0.0015), lit, counts.toggle),
    bezel: inst(new THREE.BoxGeometry(0.03, 0.022, 0.006).translate(0, 0, 0.003), black, counts.button),
    cap: inst(new THREE.BoxGeometry(0.025, 0.017, 0.006).translate(0, 0, 0.007), lit, counts.button),
    knob: inst(along(new THREE.CylinderGeometry(0.0125, 0.0155, 0.017, 20)).translate(0, 0, 0.0085), black, counts.rotary),
    pointer: inst(new THREE.BoxGeometry(0.003, 0.012, 0.002).translate(0, 0.008, 0.0178), lit, counts.rotary),
    breaker: inst(along(new THREE.CylinderGeometry(0.0065, 0.0065, 0.011, 12)).translate(0, 0, 0.0085), black, counts.breaker),
    stem: inst(along(new THREE.CylinderGeometry(0.0042, 0.0042, 0.014, 10)).translate(0, 0, 0.007), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }), counts.breaker),
  };

  // Panel faces: the legends glow with the panel lighting.
  const faces = [];
  for (const p of PANELS) {
    const [map, emissiveMap] = faceTextures(p);
    const mat = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.62, metalness: 0.35 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), mat);
    face.matrixAutoUpdate = false; face.matrix.copy(p.matrix); face.receiveShadow = true;
    scene.add(face); faces.push(mat);
  }

  const at = (panel, u, v, lift = 0) => new THREE.Matrix4().makeTranslation(u, v, lift).premultiply(panel.matrix);
  const next = { toggle: 0, button: 0, rotary: 0, breaker: 0 };
  const m4 = new THREE.Matrix4(), rot = new THREE.Matrix4(), colour = new THREE.Color();
  const controls = new Map();
  const guardMat = new THREE.MeshStandardMaterial({ color: 0xd22b1e, transparent: true, opacity: 0.62, roughness: 0.25 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xe8b53a, roughness: 0.6 });

  for (const c of placed) {
    const base = at(c.panel, c.u, c.v), centre = new THREE.Vector3().setFromMatrixPosition(at(c.panel, c.u, c.v, 0.012));
    const entry = { ...c, base, centre, radius: 0.02, index: c.kind in next ? next[c.kind]++ : -1 };
    if (c.kind === 'toggle') {
      parts.toggleBase.setMatrixAt(entry.index, base);
      entry.ledBase = at(c.panel, c.u, c.v + (c.def.kind === 'guarded' ? 0.04 : 0.02));
      parts.led.setMatrixAt(entry.index, entry.ledBase);
      if (c.def.kind === 'guarded') {
        // Hinged safety cover over the switch, with its hazard plate behind.
        const hinge = new THREE.Group();
        hinge.matrixAutoUpdate = false; hinge.matrix.copy(at(c.panel, c.u, c.v + 0.026));
        const pivot = new THREE.Group();
        const cover = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.05, 0.03).translate(0, -0.025, 0.016), guardMat);
        pivot.add(cover); hinge.add(pivot);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.006, 0.004).translate(0, 0.004, 0.002), stripe);
        hinge.add(plate); scene.add(hinge);
        entry.cover = pivot; entry.coverAngle = 0; entry.radius = 0.032;
      }
    } else if (c.kind === 'button') {
      const s = c.big ? 1.9 : 1;
      entry.scale = new THREE.Matrix4().makeScale(s, s, 1);
      parts.bezel.setMatrixAt(entry.index, m4.multiplyMatrices(base, entry.scale));
      entry.radius = c.big ? 0.03 : 0.017;
    } else if (c.kind === 'breaker') {
      parts.stem.setMatrixAt(entry.index, base); entry.radius = 0.013;
    } else if (c.kind === 'rotary') entry.radius = 0.024;
    else if (c.kind === 'lever') {
      // Throttle: a T handle that travels along its slot.
      const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(base);
      const arm = new THREE.Group();
      const shaft = new THREE.Mesh(along(new THREE.CylinderGeometry(0.006, 0.008, 0.11, 10)).translate(0, 0, 0.055), metal);
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.05, 4, 12).rotateZ(HALF_PI).translate(0, 0, 0.12), new THREE.MeshStandardMaterial({ color: 0xd8482f, roughness: 0.55 }));
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.012).translate(0, 0, 0.006), black);
      arm.add(shaft, grip, boot); g.add(arm); scene.add(g);
      entry.arm = arm; entry.radius = 0.075; entry.centre.setFromMatrixPosition(at(c.panel, c.u, c.v, 0.09)); entry.shown = 0;
    } else if (c.kind === 'stick') {
      const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(base);
      const arm = new THREE.Group();
      const boot = new THREE.Mesh(along(new THREE.CylinderGeometry(0.018, 0.034, 0.03, 16)).translate(0, 0, 0.015), new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.9 }));
      const shaft = new THREE.Mesh(along(new THREE.CapsuleGeometry(0.014, 0.1, 4, 12)).translate(0, 0, 0.085), black);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.03, 0.03).translate(0, 0.004, 0.15), black);
      const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.008, 0.008).translate(0, 0.02, 0.15), new THREE.MeshStandardMaterial({ color: 0xd8482f, roughness: 0.5 }));
      arm.add(shaft, head, trigger); g.add(boot, arm); scene.add(g);
      entry.arm = arm; entry.radius = 0.07; entry.centre.setFromMatrixPosition(at(c.panel, c.u, c.v, 0.1));
    }
    controls.set(c.id, entry);
  }

  const setColour = (mesh, i, rgb, k) => { mesh.setColorAt(i, colour.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k)); mesh.instanceColor.needsUpdate = true; };

  function refresh(id, v) {
    const e = controls.get(id);
    if (!e) return;
    const rgb = LIGHT[e.def.color] ?? (e.kind === 'button' ? LIGHT.white : LIGHT.green);
    if (e.kind === 'toggle') {
      parts.toggleLever.setMatrixAt(e.index, m4.multiplyMatrices(e.base, rot.makeRotationX(v.on ? -0.5 : 0.5)));
      parts.toggleLever.instanceMatrix.needsUpdate = true;
      setColour(parts.led, e.index, rgb, v.on ? 1 : DARK);
      if (e.cover) e.coverTarget = v.cover ? -1.9 : 0;
    } else if (e.kind === 'button') {
      parts.cap.setMatrixAt(e.index, m4.multiplyMatrices(e.base, e.scale)); parts.cap.instanceMatrix.needsUpdate = true;
      setColour(parts.cap, e.index, rgb, v.on ? 1 : 0.12);
    } else if (e.kind === 'rotary') {
      const n = e.def.positions.length;
      m4.multiplyMatrices(e.base, rot.makeRotationZ(-(v.pos - (n - 1) / 2) * 0.7));
      parts.knob.setMatrixAt(e.index, m4); parts.pointer.setMatrixAt(e.index, m4);
      parts.knob.instanceMatrix.needsUpdate = parts.pointer.instanceMatrix.needsUpdate = true;
      setColour(parts.pointer, e.index, LIGHT.white, 0.9);
    } else if (e.kind === 'breaker') {
      parts.breaker.setMatrixAt(e.index, m4.multiplyMatrices(e.base, rot.makeTranslation(0, 0, v.on ? 0 : 0.009)));
      parts.breaker.instanceMatrix.needsUpdate = true;
    } else if (e.kind === 'lever') e.target = v.value;
  }

  // Analogue gauges: a printed face and a needle.
  const gauges = new Map();
  const needleGeo = new THREE.BoxGeometry(0.0022, 0.034, 0.0015).translate(0, 0.012, 0.004);
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xff8a3c, toneMapped: false });
  const ringGeo = new THREE.TorusGeometry(0.046, 0.004, 8, 28);
  for (const p of PANELS) for (const gz of p.gauges ?? []) {
    const m = at(p, gz.u, gz.v, 0.002);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.045, 28), new THREE.MeshBasicMaterial({ map: gaugeTexture(UI.cockpit(gz.label)), toneMapped: false }));
    face.matrixAutoUpdate = false; face.matrix.copy(m);
    const ring = new THREE.Mesh(ringGeo, metal); ring.matrixAutoUpdate = false; ring.matrix.copy(m);
    const holder = new THREE.Group(); holder.matrixAutoUpdate = false; holder.matrix.copy(m);
    const needle = new THREE.Mesh(needleGeo, needleMat); holder.add(needle);
    scene.add(face, ring, holder);
    gauges.set(gz.id, { needle, face: face.material, value: 0 });
  }

  for (const part of Object.values(parts)) part.instanceMatrix.needsUpdate = true;

  const toCentre = new THREE.Vector3();
  return {
    controls, refresh, at,
    panel: id => PANELS.find(p => p.id === id),
    /** Control under a ray, forgiving: nearest one whose centre the ray passes close to. */
    pick(ray, maxDistance) {
      let best = null, bestT = maxDistance;
      for (const e of controls.values()) {
        const t = toCentre.subVectors(e.centre, ray.origin).dot(ray.direction);
        if (t < 0.05 || t > bestT) continue;
        if (ray.distanceSqToPoint(e.centre) > e.radius * e.radius) continue;
        best = e; bestT = t;
      }
      return best && { id: best.id, distance: bestT, entry: best };
    },
    setGauge(id, value) { const gz = gauges.get(id); if (gz) gz.value = Math.min(1, Math.max(0, value)); },
    setPanelLights(level) {
      for (const f of faces) f.emissiveIntensity = level;
      for (const gz of gauges.values()) gz.face.color.setScalar(0.25 + 0.75 * level);
    },
    update(dt, stickTilt) {
      for (const e of controls.values()) {
        if (e.cover && e.coverAngle !== e.coverTarget) {
          e.coverAngle += (e.coverTarget - e.coverAngle) * Math.min(1, dt * 14);
          if (Math.abs(e.coverTarget - e.coverAngle) < 0.002) e.coverAngle = e.coverTarget;
          e.cover.rotation.x = e.coverAngle;
        }
        if (e.kind === 'lever') {
          e.shown += ((e.target ?? 0) - e.shown) * Math.min(1, dt * 10);
          e.arm.position.y = -0.095 + e.shown * 0.19;
          e.arm.rotation.x = 0.25 - e.shown * 0.5;
        } else if (e.kind === 'stick') e.arm.rotation.x += (stickTilt * 0.3 - e.arm.rotation.x) * Math.min(1, dt * 10);
      }
      for (const gz of gauges.values()) gz.needle.rotation.z += ((0.75 - gz.value * 1.5) * Math.PI - gz.needle.rotation.z) * Math.min(1, dt * 6);
    },
  };
}
