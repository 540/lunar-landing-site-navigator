// The cabin: hull with its windows, seats, consoles, stowage and the details that make it read as a real vehicle.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { UI } from '../texts.js';
import { CABIN, EYE_SEATED, EYE_STANDING, OBSTACLES, SEATS, SEAT_HEIGHT, STAND_SPOT } from '../sim/layout.js';

const HALF_PI = Math.PI / 2;

export { CABIN, EYE_SEATED, EYE_STANDING, OBSTACLES, SEATS, SEAT_HEIGHT, STAND_SPOT };

function wallTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},.035)`; g.fillRect((i * 97) % 512, (i * 61) % 512, 2, 2); }
  g.strokeStyle = 'rgba(40,44,50,.55)'; g.lineWidth = 3;
  g.strokeRect(6, 6, 500, 500); g.beginPath(); g.moveTo(256, 6); g.lineTo(256, 506); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.strokeRect(10, 10, 492, 492);
  g.fillStyle = '#7f858c';
  for (const [x, y] of [[20, 20], [492, 20], [20, 492], [492, 492], [246, 20], [266, 20], [246, 492], [266, 492], [20, 256], [492, 256]]) { g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(50,54,60,.8)'; g.fillRect(60, 380, 70, 34); g.fillRect(330, 110, 34, 70);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function floorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3b3f45'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#2a2d32';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.beginPath(); g.ellipse(x * 32 + (y % 2 ? 16 : 0) + 8, y * 32 + 16, 9, 3.5, y % 2 ? 0.8 : -0.8, 0, 7); g.fill(); }
  g.strokeStyle = '#22252a'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function signTexture(lines, bg, fg, w = 256, h = 96) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(5, 5, w - 10, h - 10);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const size = Math.min(h / (lines.length + 0.6), 34);
  g.font = `700 ${size}px Inter, sans-serif`;
  lines.forEach((t, i) => g.fillText(UI.cockpit(t), w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.1));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function createCabin(envMap) {
  const group = new THREE.Group();
  const M = {
    wall: new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 }),
    floor: new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.75, metalness: 0.3 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x2a2d32, roughness: 0.55, metalness: 0.5 }),
    console: new THREE.MeshStandardMaterial({ color: 0x555b64, roughness: 0.65, metalness: 0.25 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x3d4350, roughness: 0.92 }),
    seatTrim: new THREE.MeshStandardMaterial({ color: 0x555b64, roughness: 0.6, metalness: 0.5 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0xe1ddd2, roughness: 1 }),
    strap: new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 1 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb4b9bf, metalness: 0.95, roughness: 0.3, envMap, envMapIntensity: 0.8 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xe0b23a, roughness: 0.5, metalness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc23122, roughness: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fc4e0, transparent: true, opacity: 0.07, roughness: 0.03, metalness: 0.2, envMap, envMapIntensity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc69a3e, metalness: 1, roughness: 0.4, envMap, envMapIntensity: 0.9 }),
    hull: new THREE.MeshStandardMaterial({ color: 0xdcdfe2, roughness: 0.6, metalness: 0.3 }),
  };
  const add = (geo, mat, x, y, z, { cast = true, receive = true, parent = group } = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = receive; parent.add(m); return m;
  };
  const box = (w, h, d, mat, x, y, z, o) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, o);
  const rbox = (w, h, d, r, mat, x, y, z, o) => add(new RoundedBoxGeometry(w, h, d, 3, r), mat, x, y, z, o);

  /**
   * A wall with window openings: `u` and `v` span it and u × v points into the cabin. Leaves boxes around each
   * opening (so the Sun only comes in through the glass), a gasket frame and the pane.
   */
  function wall({ origin, u, v, w, h, openings = [], mat = M.wall, thickness = 0.08, tile = 1 }) {
    const g = new THREE.Group();
    const U = new THREE.Vector3(...u).normalize(), V = new THREE.Vector3(...v).normalize(), N = new THREE.Vector3().crossVectors(U, V);
    g.matrixAutoUpdate = false;
    g.matrix.makeBasis(U, V, N).setPosition(...origin);
    const piece = (u0, u1, v0, v1) => {
      if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4) return;
      const geo = new THREE.BoxGeometry(u1 - u0, v1 - v0, thickness), a = geo.attributes.uv, p = geo.attributes.position;
      for (let i = 0; i < a.count; i++) a.setXY(i, (p.getX(i) + (u0 + u1) / 2) / tile, (p.getY(i) + (v0 + v1) / 2) / tile);
      add(geo, mat, (u0 + u1) / 2, (v0 + v1) / 2, -thickness / 2, { parent: g });
    };
    const sorted = [...openings].sort((a, b) => a.u0 - b.u0), panes = [];
    let cursor = 0;
    for (const o of sorted) {
      piece(cursor, o.u0, 0, h); piece(o.u0, o.u1, 0, o.v0); piece(o.u0, o.u1, o.v1, h);
      cursor = o.u1;
      const t = 0.035, d = 0.11, cu = (o.u0 + o.u1) / 2, cv = (o.v0 + o.v1) / 2, ow = o.u1 - o.u0, oh = o.v1 - o.v0;
      box(ow + 2 * t, t, d, M.frame, cu, o.v0 - t / 2 + 0.004, -0.04, { parent: g }); box(ow + 2 * t, t, d, M.frame, cu, o.v1 + t / 2 - 0.004, -0.04, { parent: g });
      box(t, oh, d, M.frame, o.u0 - t / 2 + 0.004, cv, -0.04, { parent: g }); box(t, oh, d, M.frame, o.u1 + t / 2 - 0.004, cv, -0.04, { parent: g });
      const pane = add(new THREE.PlaneGeometry(ow, oh), M.glass, cu, cv, -0.04, { cast: false, receive: false, parent: g });
      pane.renderOrder = 5; panes.push(pane);
    }
    piece(cursor, w, 0, h);
    group.add(g);
    g.userData.panes = panes;
    return g;
  }

  const { halfWidth: X, front: F, back: B, height: H } = CABIN;
  wall({ origin: [-X, 0, B], u: [0, 0, -1], v: [0, 1, 0], w: B - F, h: H, openings: [{ u0: 0.72, u1: 1.6, v0: 0.95, v1: 1.62 }, { u0: 2.42, u1: 3.88, v0: 0.76, v1: 1.74 }] });
  wall({ origin: [X, 0, F], u: [0, 0, 1], v: [0, 1, 0], w: B - F, h: H, openings: [{ u0: 0.17, u1: 1.63, v0: 0.76, v1: 1.74 }, { u0: 2.45, u1: 3.33, v0: 0.95, v1: 1.62 }] });
  wall({ origin: [X, 0, B], u: [-1, 0, 0], v: [0, 1, 0], w: 2 * X, h: H });
  wall({ origin: [-X, 0, F], u: [1, 0, 0], v: [0, 1, 0], w: 2 * X, h: 0.9 });
  const SHIELD = { y0: 0.9, z0: F, y1: 1.98, z1: -1.22 };
  const shieldLen = Math.hypot(SHIELD.y1 - SHIELD.y0, SHIELD.z1 - SHIELD.z0);
  const shield = wall({ origin: [-X, SHIELD.y0, SHIELD.z0], u: [1, 0, 0], v: [0, SHIELD.y1 - SHIELD.y0, SHIELD.z1 - SHIELD.z0], w: 2 * X, h: shieldLen, mat: M.frame,
    openings: [{ u0: 0.1, u1: 1.08, v0: 0.07, v1: shieldLen - 0.07 }, { u0: 1.2, u1: 2.2, v0: 0.07, v1: shieldLen - 0.07 }, { u0: 2.32, u1: 3.3, v0: 0.07, v1: shieldLen - 0.07 }] });
  wall({ origin: [-X, SHIELD.y1, SHIELD.z1], u: [1, 0, 0], v: [0, 1, 0], w: 2 * X, h: H - SHIELD.y1 });
  wall({ origin: [-X, H, SHIELD.z1], u: [1, 0, 0], v: [0, 0, 1], w: 2 * X, h: B - SHIELD.z1 });
  wall({ origin: [-X, 0, B], u: [1, 0, 0], v: [0, 0, -1], w: 2 * X, h: B - F, mat: M.floor, tile: 0.5, openings: [{ u0: 1.25, u1: 2.15, v0: 1.5, v1: 2.05 }] });

  // Main console and pedestal bodies (their faces come from panels.js).
  rbox(2.3, 0.04, 0.37, 0.015, M.console, 0, 0.972, -1.575);
  const consoleBody = box(2.24, 0.62, 0.3, M.console, 0, 0.66, -1.42); consoleBody.rotation.x = -0.449;
  box(2.24, 0.5, 0.5, M.console, 0, 0.25, -1.5);
  box(0.42, 0.56, 1.02, M.console, 0, 0.275, -0.61);
  rbox(0.46, 0.03, 1.06, 0.012, M.frame, 0, 0.54, -0.61);
  for (const s of [-1, 1]) {
    box(0.44, 0.615, 1.34, M.console, s * 1.47, 0.305, -0.75);
    rbox(0.48, 0.03, 1.38, 0.012, M.frame, s * 1.47, 0.598, -0.75);
  }

  // Seats.
  const seatGeo = {
    base: new RoundedBoxGeometry(0.36, 0.3, 0.4, 2, 0.03), cushion: new RoundedBoxGeometry(0.54, 0.11, 0.52, 3, 0.045),
    back: new RoundedBoxGeometry(0.52, 0.78, 0.11, 3, 0.05), wing: new RoundedBoxGeometry(0.06, 0.5, 0.2, 2, 0.025),
    head: new RoundedBoxGeometry(0.3, 0.2, 0.1, 3, 0.045), arm: new RoundedBoxGeometry(0.07, 0.045, 0.36, 2, 0.02),
    post: new THREE.BoxGeometry(0.03, 0.2, 0.03), rail: new THREE.BoxGeometry(0.06, 0.03, 0.9),
  };
  const seats = {};
  for (const [name, at] of Object.entries(SEATS)) {
    const s = new THREE.Group(); s.position.set(at.x, 0, at.z);
    const part = (geo, mat, x, y, z) => add(geo, mat, x, y, z, { parent: s });
    part(seatGeo.base, M.seatTrim, 0, 0.17, 0.04);
    part(seatGeo.cushion, M.seat, 0, SEAT_HEIGHT - 0.055, -0.02);
    const back = part(seatGeo.back, M.seat, 0, 0.9, 0.3); back.rotation.x = 0.13;
    const head = part(seatGeo.head, M.seat, 0, 1.36, 0.36); head.rotation.x = 0.13;
    for (const k of [-1, 1]) {
      const wing = part(seatGeo.wing, M.seat, k * 0.27, 0.86, 0.22); wing.rotation.x = 0.13;
      part(seatGeo.arm, M.seat, k * 0.31, 0.66, 0.02); part(seatGeo.post, M.seatTrim, k * 0.31, 0.55, 0.12);
      part(seatGeo.rail, M.seatTrim, k * 0.2, 0.015, 0.05);
    }
    group.add(s); seats[name] = s;
  }

  // Ceiling: light panels, handrails, cable trays and the docking hatch.
  const lampGeo = new RoundedBoxGeometry(0.5, 0.02, 0.16, 2, 0.008);
  const lamps = [[-0.9, 0.3], [0.9, 0.3], [-0.9, 1.5], [0.9, 1.5]].map(([x, z]) => add(lampGeo, M.lamp.clone(), x, H - 0.015, z, { cast: false, receive: false }));
  const tube = (points, r, mat) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 24, r, 8), mat, 0, 0, 0);
  for (const s of [-1, 1]) {
    tube([[s * 0.45, H - 0.02, 0.1], [s * 0.45, H - 0.11, 0.2], [s * 0.45, H - 0.11, 1.9], [s * 0.45, H - 0.02, 2.0]], 0.016, M.rail);
    tube([[s * (X - 0.02), 1.9, 0.0], [s * (X - 0.1), 1.9, 0.1], [s * (X - 0.1), 1.9, 0.62], [s * (X - 0.02), 1.9, 0.72]], 0.016, M.rail);
    box(0.12, 0.04, 3.3, M.frame, s * 1.3, H - 0.03, 0.55);
    tube([[s * 1.25, H - 0.07, -1.0], [s * 1.28, H - 0.09, 0], [s * 1.24, H - 0.08, 1.2], [s * 1.3, H - 0.07, 2.25]], 0.012, M.strap);
    tube([[s * 1.34, H - 0.07, -1.0], [s * 1.31, H - 0.08, 0.4], [s * 1.36, H - 0.075, 2.25]], 0.008, M.red);
  }
  add(new THREE.TorusGeometry(0.4, 0.045, 12, 40).rotateX(HALF_PI), M.metal, 0, H - 0.03, 1.25);
  add(new THREE.CylinderGeometry(0.38, 0.38, 0.03, 40), M.frame, 0, H - 0.01, 1.25);
  add(new THREE.TorusGeometry(0.13, 0.014, 8, 24).rotateX(HALF_PI), M.rail, 0, H - 0.07, 1.25);
  for (let i = 0; i < 3; i++) { const spoke = box(0.26, 0.014, 0.018, M.rail, 0, H - 0.07, 1.25); spoke.rotation.y = i * Math.PI / 3; }
  const sign = (lines, bg, fg, w, h, x, y, z, ry = 0, rx = 0) => {
    const m = add(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signTexture(lines, bg, fg, Math.round(256 * w / h * 0.375), 96), roughness: 0.8 }), x, y, z, { cast: false });
    m.rotation.order = 'YXZ'; m.rotation.set(rx, ry, 0); return m;
  };
  sign(['ATRAQUE'], '#e0b23a', '#16181b', 0.3, 0.08, 0, H - 0.005, 0.75, 0, HALF_PI);

  // Floor window: its frame stands slightly proud so it catches the light.
  for (const [w, d, x, z] of [[1.0, 0.05, 0, 0.225], [1.0, 0.05, 0, 0.825], [0.05, 0.55, -0.475, 0.525], [0.05, 0.55, 0.475, 0.525]]) rbox(w, 0.02, d, 0.008, M.rail, x, 0.006, z, { cast: false });
  const floorGlass = add(new THREE.PlaneGeometry(0.9, 0.55).rotateX(-HALF_PI), M.glass, 0, -0.02, 0.525, { cast: false, receive: false }); floorGlass.renderOrder = 5;

  // Back wall: airlock hatch, lockers, stowed bags and safety gear.
  const hatch = new THREE.Group(); hatch.position.set(0, 1.05, B - 0.02);
  add(new THREE.TorusGeometry(0.47, 0.05, 12, 48), M.metal, 0, 0, 0, { parent: hatch });
  add(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 48).rotateX(HALF_PI), M.hull, 0, 0, 0.01, { parent: hatch });
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 24).rotateX(HALF_PI), new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.1, metalness: 0.6, envMap }), 0, 0.2, -0.025, { parent: hatch });
  add(new THREE.TorusGeometry(0.105, 0.014, 8, 24), M.frame, 0, 0.2, -0.03, { parent: hatch });
  const wheel = new THREE.Group(); wheel.position.set(0, -0.12, -0.09);
  add(new THREE.TorusGeometry(0.15, 0.016, 8, 32), M.red, 0, 0, 0, { parent: wheel });
  for (let i = 0; i < 3; i++) { const spoke = box(0.3, 0.016, 0.016, M.red, 0, 0, 0, { parent: wheel }); spoke.rotation.z = i * Math.PI / 3; }
  add(new THREE.CylinderGeometry(0.025, 0.025, 0.09, 12).rotateX(HALF_PI), M.metal, 0, 0, 0.045, { parent: wheel });
  hatch.add(wheel);
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.39; add(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 8).rotateX(HALF_PI), M.frame, Math.cos(a) * 0.47, Math.sin(a) * 0.47, -0.045, { parent: hatch }); }
  group.add(hatch);
  sign(['ESCLUSA', 'COMPROBAR PRESIÓN'], '#b3261a', '#ffffff', 0.5, 0.13, 0, 1.72, B - 0.005, Math.PI);
  const lockerGeo = new RoundedBoxGeometry(0.3, 0.4, 0.26, 2, 0.02), latchGeo = new THREE.BoxGeometry(0.07, 0.022, 0.02);
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) for (let j = 0; j < (s < 0 ? 4 : 2); j++) {
    const x = s * (1.2 + i * 0.32), y = 0.24 + j * 0.42 + (s > 0 && j === 1 ? 1.04 : 0);
    add(lockerGeo, M.wall, x, y, B - 0.14); add(latchGeo, M.metal, x, y + 0.13, B - 0.275);
  }
  const bagGeo = new RoundedBoxGeometry(0.42, 0.26, 0.22, 4, 0.08), bandGeo = new THREE.BoxGeometry(0.03, 0.275, 0.235);
  for (const [x, y, z, r] of [[-0.78, 0.15, 2.12, 0.1], [0.72, 0.15, 2.14, -0.15], [-0.74, 0.42, 2.14, -0.06]]) {
    const bag = add(bagGeo, M.cloth, x, y, z); bag.rotation.y = r;
    for (const k of [-0.11, 0.11]) add(bandGeo, M.strap, k, 0, 0, { parent: bag });
  }
  const extinguisher = new THREE.Group(); extinguisher.position.set(-1.62, 0.72, 0.45);
  add(new THREE.CapsuleGeometry(0.05, 0.22, 4, 14), M.red, 0, 0, 0, { parent: extinguisher });
  add(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 10), M.frame, 0, 0.19, 0, { parent: extinguisher });
  add(new THREE.BoxGeometry(0.02, 0.012, 0.09), M.frame, 0, 0.22, 0.03, { parent: extinguisher });
  add(new THREE.BoxGeometry(0.02, 0.05, 0.13), M.strap, -0.045, 0, 0, { parent: extinguisher });
  group.add(extinguisher);
  sign(['EXTINTOR'], '#b3261a', '#ffffff', 0.2, 0.055, -X + 0.006, 1.02, 0.45, HALF_PI);
  sign(['BOTIQUÍN'], '#f2f2ee', '#1c7a43', 0.22, 0.06, X - 0.006, 0.6, 0.45, -HALF_PI);
  rbox(0.05, 0.22, 0.3, 0.015, M.cloth, X - 0.03, 0.4, 0.45);
  sign(['NO PISAR EL CRISTAL', 'CON BOTAS MAGNÉTICAS'], '#e0b23a', '#16181b', 0.36, 0.09, 0, 0.004, 0.96, 0, -HALF_PI);
  // Checklist clipped next to the commander.
  const card = sign(['LISTA DE DESCENSO', '1 ARMAR MOTOR · 2 RCS', '3 TREN A 700 m · 4 CONTACTO'], '#f4f1e6', '#1b1d21', 0.24, 0.096, -X + 0.006, 1.86, -0.85, HALF_PI);
  card.material.roughness = 1;

  // Outside, seen through the side windows: an RCS quad on its boom and the top of a landing leg.
  const plumes = [];
  const plumeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  for (const s of [-1, 1]) {
    const quad = new THREE.Group(); quad.position.set(s * (X + 0.75), 1.42, -0.2);
    box(0.7, 0.05, 0.05, M.hull, s * -0.38, 0, 0, { parent: quad, receive: false });
    rbox(0.2, 0.2, 0.2, 0.03, M.gold, 0, 0, 0, { parent: quad, receive: false });
    for (const [dy, dz, rx] of [[1, 0, 0], [-1, 0, Math.PI], [0, 1, HALF_PI], [0, -1, -HALF_PI]]) {
      const nozzle = add(new THREE.CylinderGeometry(0.055, 0.03, 0.1, 14, 1, true), M.frame, 0, dy * 0.15, dz * 0.15, { parent: quad, receive: false });
      nozzle.rotation.x = rx; nozzle.material.side = THREE.DoubleSide;
      const plume = new THREE.Sprite(new THREE.SpriteMaterial({ map: plumeTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      plume.position.set(0, dy * 0.34, dz * 0.34); plume.scale.setScalar(0.34); quad.add(plume);
      plumes.push({ sprite: plume, up: dy, back: dz });
    }
    group.add(quad);
    const leg = new THREE.Group(); leg.position.set(s * (X + 0.5), 0.2, 1.1);
    const strut = add(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 12), M.gold, s * 0.35, -0.5, 0, { parent: leg, receive: false }); strut.rotation.z = s * 0.6;
    group.add(leg);
  }

  // Crash damage: cracks over each windshield pane and red emergency lamps, all off until setCrash() says.
  const crackMeshes = shield.userData.panes.map((pane, i) => {
    const mat = new THREE.MeshBasicMaterial({ map: crackTexture(7 + i * 13, i === 1), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const crack = new THREE.Mesh(pane.geometry, mat);
    crack.position.copy(pane.position); crack.position.z += 0.012; crack.renderOrder = 6; crack.visible = false;
    pane.parent.add(crack);
    return crack;
  });
  const emergency = [[-0.9, 0.9], [0.9, 0.9]].map(([x, z]) => { const l = new THREE.PointLight(0xff2412, 0, 6, 1.3); l.position.set(x, H - 0.25, z); group.add(l); return l; });
  const beacons = [[-1.5, 1.95, 0.1], [1.5, 1.95, 0.1], [0, 2.17, 2.0]].map(p => add(new THREE.BoxGeometry(0.12, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0x220504 }), ...p, { cast: false, receive: false }));

  // Lighting: two dimmable floods, a faint fill, and the Sun (aimed every frame from the vehicle attitude).
  const floods = [[0, 2.05, 0.2], [0, 2.05, 1.5]].map(p => { const l = new THREE.PointLight(0xfff0dc, 0, 7, 1.6); l.position.set(...p); group.add(l); return l; });
  const fill = new THREE.HemisphereLight(0xb8c4d6, 0x38322c, 0.12); group.add(fill);
  const sun = new THREE.DirectionalLight(0xfff3df, 5.5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.012;
  Object.assign(sun.shadow.camera, { left: -3.2, right: 3.2, top: 3.2, bottom: -3.2, near: 1, far: 16 });
  sun.target.position.set(0, 1.1, 0.2); group.add(sun, sun.target);

  return {
    group, seats, plumes, sun, materials: M,
    setLights(level) {
      const k = [0, 0.45, 1][level] ?? 0;
      floods.forEach(l => { l.intensity = k * 5.5; });
      fill.intensity = 0.05 + k * 0.42;
      lamps.forEach(l => l.material.color.setRGB(0.05 + k * 1.0, 0.05 + k * 0.94, 0.05 + k * 0.84));
    },
    /** Crash damage, 0–1 each: how visible the windshield cracks are and how bright the red emergency lamps. */
    setCrash({ cracks = 0, emergency: red = 0 } = {}) {
      crackMeshes.forEach(m => { m.material.opacity = cracks * 0.9; m.visible = cracks > 0; });
      emergency.forEach(l => { l.intensity = red * 12; });
      beacons.forEach(b => b.material.color.setRGB(0.13 + red * 0.87, 0.02 + red * 0.1, 0.015 + red * 0.05));
    },
  };
}

/** Fractured glass: radial cracks from an impact point with broken rings around it, on a transparent canvas. */
function crackTexture(seed, heavy) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  const cx = 160 + rand() * 190, cy = 150 + rand() * 210;
  g.lineCap = 'round'; g.lineJoin = 'round';
  // The crushed spot where the glass took the hit.
  g.fillStyle = 'rgba(230,236,242,.28)';
  g.beginPath();
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, r = 14 + rand() * 22; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  g.fill();
  const rays = heavy ? 22 : 15, ends = [];
  for (let k = 0; k < rays; k++) {
    let a = (k / rays) * Math.PI * 2 + rand() * 0.3, x = cx, y = cy;
    const len = 160 + rand() * 360;
    g.strokeStyle = `rgba(235,240,246,${0.55 + rand() * 0.35})`; g.lineWidth = 1 + rand() * 1.8;
    g.beginPath(); g.moveTo(x, y);
    for (let d = 0; d < len; d += 18 + rand() * 22) {
      a += (rand() - 0.5) * 0.35; x += Math.cos(a) * 24; y += Math.sin(a) * 24; g.lineTo(x, y);
      if (rand() < 0.12) { const b = a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.6); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * 40, y + Math.sin(b) * 40); g.moveTo(x, y); }
    }
    g.stroke(); ends.push(a);
  }
  // Broken rings: short arcs between neighbouring rays.
  for (const r of heavy ? [38, 80, 135, 200] : [45, 105, 170]) {
    g.strokeStyle = 'rgba(235,240,246,.55)'; g.lineWidth = 1.1;
    for (let k = 0; k < rays; k++) {
      if (rand() < 0.35) continue;
      const a0 = (k / rays) * Math.PI * 2, a1 = ((k + 1) / rays) * Math.PI * 2, rr = r * (0.85 + rand() * 0.3);
      g.beginPath(); g.moveTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr); g.lineTo(cx + Math.cos(a1) * rr * (0.9 + rand() * 0.2), cy + Math.sin(a1) * rr); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
