// The 3D Moon of the game (J8.1, #234): the shared globe (shared/render/moon-globe.js, #140), the play zone marked on
// the south pole, the Sun and the Earth where they are now, their trail over the next 4 days and their apparent orbit
// of one period. Ported from Moon3D of the prototype (docs/juego-rol/index.html, l. 303-354), with the Sun and the
// Earth from the scenario series (moon-sky.js) instead of its toy ephemeris.
// Only loaded with a dynamic import() from moon-panel.js in full map mode: the light mode never asks for three.js.
import * as THREE from 'three';
import { createMoonGlobe } from '../../shared/render/moon-globe.js';
import { earthMapPixels, earthSpin } from '../../shared/render/earth.js';
import { useRealEarth } from '../../shared/render/earth-texture.js';
import { pixelRatio, readSignals, resolveQuality, decodeStored, STORAGE_KEY } from '../../shared/render/quality.js';
import {
  skyAt, trail, orbitPath, chevrons, SYNODIC_H, EARTH_PERIOD_H, SUN_RADIUS, EARTH_RADIUS, ORBIT_POINTS,
  SUN_CHEVRONS, EARTH_CHEVRONS, TRAIL,
} from './moon-sky.js';
import { gameColors, withAlpha } from './palette.js';

const PULSE_MS = 1600;
const DIST = { min: 1.7, max: 9, start: 6.6 };
const TRAIL_POINTS = TRAIL.hours / TRAIL.step + 1;

const set = (v, p) => v.set(p.x, p.y, p.z);

function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Stars from a fixed seed (as the home page), so two screenshots compare.
function stars() {
  let s = 233;
  const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const N = 1800, pos = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, q = Math.sqrt(1 - u * u);
    pos.set([60 * q * Math.cos(a), 60 * u, 60 * q * Math.sin(a)], k * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9aa3ad, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.7 }));
}

/**
 * Builds the scene inside `el` (a sized box). Returns { setTime(t), setActive(on), resize(), dispose() }.
 * Throws if WebGL is not available (the caller shows the notice).
 *   series, startMs  the scenario series and its start (ms); t is in game hours.
 *   isReduced        () → true with reduced motion: no pulse of the ring.
 *   onRender         () → called after each frame painted (tests and benches).
 */
export function createMoonScene(el, { series, startMs, isReduced = () => false, onRender } = {}) {
  // The Sun and the Earth in the colours of --sun and --earth (game.css, #341).
  const { sun: sunColor, earth: earthColor } = gameColors();
  const canvas = document.createElement('canvas');
  canvas.className = 'moon__canvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); // throws without WebGL
  el.prepend(canvas);
  // Same quality level as the home page on this device (stored by its calibration, keyed by the GPU name).
  const gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  let stored = null;
  try { stored = decodeStored(localStorage.getItem(STORAGE_KEY), { renderer: gpu, now: Date.now() }); } catch { /* none */ }
  const quality = resolveQuality({ params: new URLSearchParams(location.search), signals: readSignals(renderer.getContext(), navigator), stored });
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030405);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
  let dirty = true;
  const wake = () => { dirty = true; };

  const globe = createMoonGlobe(renderer, {
    capGrid: Math.min(quality.values.cap, 160), samples: () => quality.values.fs, segments: [128, 96],
    onHeight: () => { wake(); schedule(); }, onColor: () => { wake(); schedule(); },
  });
  scene.add(globe.group);
  const light = new THREE.DirectionalLight(0xfff4e6, 2.1); scene.add(light);
  scene.add(new THREE.AmbientLight(0x6a88b0, 0.05));
  scene.add(stars());

  // The Earth: Blue Marble (the shared procedural map until it loads), turning on its axis with the mission clock.
  const earthTex = canvasTexture(512, 256, (g, w, h) => g.putImageData(new ImageData(earthMapPixels(w, h), w, h), 0, 0));
  useRealEarth(earthTex, { onChange: () => { wake(); schedule(); } }); // Blue Marble once loaded (#487)
  const earth = new THREE.Mesh(new THREE.SphereGeometry(0.17, 48, 32), new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.8 }));
  scene.add(earth);
  // The Sun: a sprite with its halo.
  const sunTex = canvasTexture(128, 128, (g, w) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,248,230,1)'); r.addColorStop(0.18, 'rgba(255,226,160,1)');
    r.addColorStop(0.32, withAlpha(sunColor, 0.45)); r.addColorStop(1, withAlpha(sunColor, 0));
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, depthWrite: false, transparent: true }));
  sun.scale.set(1.1, 1.1, 1); scene.add(sun);
  const haloTex = (col) => canvasTexture(64, 64, (g) => { g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); g.arc(32, 32, 26, 0, 7); g.stroke(); });
  const haloS = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(sunColor), transparent: true, depthWrite: false }));
  haloS.scale.set(0.42, 0.42, 1); scene.add(haloS);
  const haloE = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(earthColor), transparent: true, depthWrite: false }));
  haloE.scale.set(0.5, 0.5, 1); scene.add(haloE);

  // Trails: the colour fades towards the end (prototype, l. 319).
  const makeTrail = (hex) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
    const c = new Float32Array(TRAIL_POINTS * 3), cc = new THREE.Color(hex);
    for (let k = 0; k < TRAIL_POINTS; k++) { const a = 1 - k / TRAIL_POINTS; c[k * 3] = cc.r * a; c[k * 3 + 1] = cc.g * a; c[k * 3 + 2] = cc.b * a; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
    scene.add(line); return line;
  };
  const trailS = makeTrail(sunColor), trailE = makeTrail(earthColor);
  // Orbits at 32 % (l. 321) and their chevrons (l. 323).
  const makeOrbit = (hex) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ORBIT_POINTS + 1) * 3), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.32, depthWrite: false }));
    scene.add(line); return line;
  };
  const orbitS = makeOrbit(sunColor), orbitE = makeOrbit(earthColor);
  const makeChevrons = (hex, n, size) => Array.from({ length: n }, () => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(size * 0.45, size, 12), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.6, depthWrite: false }));
    scene.add(m); return m;
  });
  const chevS = makeChevrons(sunColor, SUN_CHEVRONS, 0.11), chevE = makeChevrons(earthColor, EARTH_CHEVRONS, 0.045);
  // The play zone on the south pole (enlarged): a fixed ring and one that pulses every 1.6 s (l. 329-330, 351).
  const ringMat = new THREE.MeshBasicMaterial({ color: sunColor, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.165, 0.212, 96), ringMat);
  marker.rotation.x = Math.PI / 2; marker.position.set(0, -1.022, 0); scene.add(marker);
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.236, 96), ringMat.clone());
  pulse.rotation.x = Math.PI / 2; pulse.position.set(0, -1.021, 0); scene.add(pulse);

  // Camera: orbit around the Moon, looking a little under the centre so the pole shows.
  let th = 0, ph = 2.2, dist = DIST.start;
  const first = skyAt(series, startMs, 0);
  th = -(first.sun.az / 2) * Math.PI / 180;
  const turn = (dx, dy) => { th -= dx; ph = Math.max(0.15, Math.min(Math.PI - 0.05, ph - dy)); wake(); };
  const zoom = (sign) => { dist = Math.max(DIST.min, Math.min(DIST.max, dist * (1 + sign * 0.08))); wake(); };
  let drag = null;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; turn((e.clientX - drag.x) * 0.008, (e.clientY - drag.y) * 0.008); drag = { x: e.clientX, y: e.clientY }; });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.sign(e.deltaY)); }, { passive: false });
  // Keyboard on the box: arrows turn, + and − zoom.
  const onKey = (e) => {
    const k = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key];
    if (k) { e.preventDefault(); turn(k[0], k[1]); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(-1); }
    else if (e.key === '-' || e.key === '−' || e.key === '_') { e.preventDefault(); zoom(1); }
  };
  el.addEventListener('keydown', onKey);

  let lastT = null;
  function setTime(t) {
    if (t === lastT) return;
    lastT = t;
    const now = skyAt(series, startMs, t);
    light.position.set(now.sun.pos.x, now.sun.pos.y, now.sun.pos.z).multiplyScalar(10 / SUN_RADIUS);
    set(sun.position, now.sun.pos); set(haloS.position, now.sun.pos);
    set(earth.position, now.earth.pos); set(haloE.position, now.earth.pos);
    earth.rotation.y = earthSpin(startMs + t * 3600e3);
    const tr = trail(series, startMs, t);
    const ps = trailS.geometry.attributes.position, pe = trailE.geometry.attributes.position;
    tr.sun.forEach((p, k) => ps.setXYZ(k, p.x, p.y, p.z)); tr.earth.forEach((p, k) => pe.setXYZ(k, p.x, p.y, p.z));
    ps.needsUpdate = true; pe.needsUpdate = true;
    const orbit = (line, chev, periodH, body) => {
      const path = orbitPath(series, startMs, t, periodH, ORBIT_POINTS, body);
      const P = line.geometry.attributes.position;
      path.forEach((p, k) => P.setXYZ(k, p.x, p.y, p.z)); P.needsUpdate = true;
      const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
      chevrons(path, chev.length).forEach((c, j) => { set(chev[j].position, c.pos); chev[j].quaternion.setFromUnitVectors(up, set(d, c.dir)); });
    };
    orbit(orbitS, chevS, SYNODIC_H, 'sun'); orbit(orbitE, chevE, EARTH_PERIOD_H, 'earth');
    wake();
  }

  function resize() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(pixelRatio(quality.level, w, h, devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    wake();
  }
  const ro = new ResizeObserver(resize); ro.observe(el);

  // Render on demand: when something changed, and for the pulse of the ring while the box is seen.
  let active = true, seen = true, raf = 0, lost = false;
  const io = new IntersectionObserver((entries) => { seen = entries.some((e) => e.isIntersecting); schedule(); });
  io.observe(el);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; el.classList.add('moon--lost'); });
  const pulsing = () => !isReduced();
  function frame(now) {
    raf = 0;
    if (!active || !seen || document.hidden || lost) return;
    if (pulsing()) {
      const k = (now % PULSE_MS) / PULSE_MS;
      pulse.scale.setScalar(1 + k * 0.9); pulse.material.opacity = 0.8 * (1 - k); pulse.visible = true;
      dirty = true;
    } else pulse.visible = false;
    if (dirty) {
      dirty = false;
      camera.position.set(dist * Math.sin(ph) * Math.cos(th), dist * Math.cos(ph), dist * Math.sin(ph) * Math.sin(th));
      camera.lookAt(0, -0.15, 0);
      renderer.render(scene, camera);
      onRender?.();
    }
    if (pulsing() || dirty) schedule();
  }
  function schedule() { if (!raf && active && seen && !document.hidden) raf = requestAnimationFrame(frame); }
  const onVisibility = () => { wake(); schedule(); };
  document.addEventListener('visibilitychange', onVisibility);
  // Wake on any change, then draw on the next frame.
  const wakeAndDraw = () => { wake(); schedule(); };
  for (const type of ['pointermove', 'wheel', 'keydown']) el.addEventListener(type, wakeAndDraw, { passive: true });
  resize();
  setTime(0);
  schedule();

  return {
    setTime(t) { setTime(t); schedule(); },
    /** Shown (true) or hidden behind the map tab (false): hidden, it paints nothing. */
    setActive(on) { active = on; if (on) { resize(); wakeAndDraw(); } },
    resize,
    lost: () => lost,
    dispose() {
      active = false; if (raf) cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVisibility);
      el.removeEventListener('keydown', onKey);
      globe.dispose(); renderer.dispose(); canvas.remove();
    },
  };
}
