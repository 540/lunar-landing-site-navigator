// The ascent vehicle (J12.8, #398), drawn in the cabin: what ASCENSO really is. A descent stage with four
// splayed legs and gold foil, the crew's ascent stage on top with its window, dish and thrusters, and a red beacon
// that blinks so it can be found from kilometres away. On a win, the ascent stage lifts off from the descent stage (as
// the Apollo LM did): a flash, the pad lit from below, regolith thrown in parabolas and no smoke, because there is no
// air. The timeline and the physics are pure (launch.js, dust.js); this file only builds and moves the meshes.
// Units: km (the cabin's scene); the model is built in metres and scaled by 1/1000, like the rover's hood.
import { launchAt, beaconOn, plumeGrains, stillPose, LAUNCH, LAUNCH_MS, BEACON_KM, BEACON_COLOR } from './launch.js';
import { G_KM } from './dust.js';

/** Where the vehicle stands inside its pad cell (km from the cell centre): off the centre, so the rover parks beside it. */
export const VEHICLE_OFFSET_KM = { x: 0.045, z: -0.035 };

function glowTexture(THREE, inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner); grad.addColorStop(0.25, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildModel(THREE, lowQuality) {
  const root = new THREE.Group();
  const seg = lowQuality ? 6 : 12;
  const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.2, ...o });
  const gold = mat({ color: 0xc9a14a, roughness: 0.32, metalness: 0.75 });
  const silver = mat({ color: 0xd8d8d4, roughness: 0.4, metalness: 0.45 });
  const grey = mat({ color: 0x77767a, roughness: 0.65, metalness: 0.35 });
  const dark = mat({ color: 0x18191c, roughness: 0.3, metalness: 0.6 });
  const add = (parent, geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };

  // No pad under it (the user asked for none): the vehicle stands on its four legs right on the relief.

  // Descent stage: an octagonal box in gold foil, on four legs with round footpads. It stays on the Moon.
  const descent = new THREE.Group();
  root.add(descent);
  const body = add(descent, new THREE.CylinderGeometry(2.1, 2.1, 1.7, 8), gold, 0, 2.35, 0);
  body.rotation.y = Math.PI / 8;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
    const top = new THREE.Vector3(ca * 1.7, 2.6, sa * 1.7), foot = new THREE.Vector3(ca * 3.7, 0.45, sa * 3.7);
    const len = top.distanceTo(foot);
    const leg = add(descent, new THREE.CylinderGeometry(0.09, 0.11, len, seg), silver, 0, 0, 0);
    leg.position.copy(top).add(foot).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot.clone().sub(top).normalize());
    add(descent, new THREE.CylinderGeometry(0.42, 0.48, 0.12, seg), silver, foot.x, 0.38, foot.z);
    // A strut from the leg back to the body.
    const mid = top.clone().lerp(foot, 0.55), base = new THREE.Vector3(ca * 1.9, 1.6, sa * 1.9);
    const s = add(descent, new THREE.CylinderGeometry(0.05, 0.05, mid.distanceTo(base), 6), grey, 0, 0, 0);
    s.position.copy(mid).add(base).multiplyScalar(0.5);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), base.clone().sub(mid).normalize());
  }
  // Ladder on the front leg.
  for (let k = 0; k < 6; k++) add(descent, new THREE.BoxGeometry(0.6, 0.05, 0.05), silver, 2.55 - k * 0.24, 0.8 + k * 0.28, 2.55 - k * 0.24).rotation.y = Math.PI / 4;

  // Ascent stage: the crew's cabin, faceted, silver, with a dark window, a docking hatch, a dish, thrusters and,
  // under it, the engine bell (seen only when it lifts off).
  const ascent = new THREE.Group();
  ascent.position.y = 3.2;
  root.add(ascent);
  const cabin = add(ascent, new THREE.CylinderGeometry(1.55, 1.75, 2.3, 7), silver, 0, 1.15, 0);
  cabin.rotation.y = Math.PI / 7;
  add(ascent, new THREE.CylinderGeometry(1.1, 1.55, 0.7, 7), grey, 0, 2.65, 0).rotation.y = Math.PI / 7;
  // The window doubles as the hatch light: it lights up warm when the crew arrives (#398).
  const hatchMat = new THREE.MeshStandardMaterial({ color: 0x15171a, emissive: 0xffc070, emissiveIntensity: 0, roughness: 0.4 });
  const win = add(ascent, new THREE.PlaneGeometry(0.9, 0.7), hatchMat, 0, 1.5, 1.66);
  win.rotation.x = -0.08;
  add(ascent, new THREE.CylinderGeometry(0.55, 0.6, 0.45, seg), grey, 0, 3.2, 0);
  const mast = add(ascent, new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), grey, -1.0, 3.3, -0.6);
  mast.rotation.z = 0.35;
  const dish = add(ascent, new THREE.SphereGeometry(0.55, lowQuality ? 10 : 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.8), silver, -1.3, 4.0, -0.6);
  dish.rotation.x = -1.0;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, r = 1.9;
    const q = add(ascent, new THREE.BoxGeometry(0.35, 0.35, 0.35), grey, Math.cos(a) * r, 2.1, Math.sin(a) * r);
    q.rotation.y = -a;
  }
  add(ascent, new THREE.ConeGeometry(0.55, 0.9, seg, 1, true), dark, 0, -0.35, 0).rotation.x = Math.PI;

  // Red beacon on the top: the mesh, and a glow sprite that keeps its size on screen so it reads from far away.
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 0 });
  add(ascent, new THREE.SphereGeometry(0.16, 10, 8), beaconMat, 0, 3.55, 0).castShadow = false;
  const beaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'), color: 0xff4a30, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  beaconGlow.position.set(0, 3.55, 0);
  ascent.add(beaconGlow);

  // The engine at work: a faint vacuum plume (nearly invisible, a pale cone), the ignition flash, and the light on
  // the pad from below.
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.9, 7, seg, 1, true), new THREE.MeshBasicMaterial({ color: 0xbfd6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
  plume.position.y = -4.2;
  ascent.add(plume);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(255,248,235,1)', 'rgba(255,220,170,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }));
  flash.position.y = -0.8;
  ascent.add(flash);

  root.scale.setScalar(0.001);
  return { root, ascent, beaconMat, beaconGlow, plume, flash, hatchMat };
}

/**
 * The vehicle and its lift-off. Returns { group, place({ x, z }), launch(), reset(), launching(), update(now, camera) }.
 *   groundAt(x, z)  height of the relief (km)
 *   quality         'bajo' | 'medio' | 'alto': low quality has no grains and no pad light
 */
const lowQ = (q) => q === 'bajo';

export function createAscentVehicle(THREE, { groundAt, quality = 'medio' } = {}) {
  const low = quality === 'bajo';
  const m = buildModel(THREE, low);
  const group = new THREE.Group();
  group.add(m.root);
  group.visible = false;
  // Light from the engine on the pad and the vehicle (km units: inverse square over a few metres).
  const padLight = low ? null : new THREE.PointLight(0xffe2b8, 0, 0.08, 2);
  if (padLight) { padLight.position.set(0, 0.002, 0); group.add(padLight); }

  // Regolith thrown by the engine: a pool of points flying in parabolas from the pad.
  const grains = low ? [] : plumeGrains(260, 398);
  const gPos = new Float32Array(grains.length * 3).fill(-1e6);
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  const gPts = new THREE.Points(gGeo, new THREE.PointsMaterial({ color: 0xd6cfc2, size: 0.00035, transparent: true, opacity: 0.9, depthWrite: false }));
  gPts.frustumCulled = false;
  group.add(gPts);

  let base = null; // { x, y, z } of the pad
  let launchT0 = null; // ms, while launching
  let beaconWas = null;
  // How the vehicle greets the crew (#398): 'idle', 'waiting' (here but not cleared) or 'ready' (cleared).
  let mode = 'idle';
  const hatchLight = lowQ(quality) ? null : new THREE.PointLight(0xffc070, 0, 0.03, 2);
  if (hatchLight) { hatchLight.position.set(0, 4.7, 2.4); m.root.add(hatchLight); }
  const v = new THREE.Vector3();

  function place({ x, z }) {
    const px = x + VEHICLE_OFFSET_KM.x, pz = z + VEHICLE_OFFSET_KM.z;
    // On the relief, with no pad: the lowest of its four feet (3.7 m out, 0.38 m up in the model) touches the ground
    // and the others sink a little into the regolith, so no foot floats on a slope.
    const feet = [0, 1, 2, 3].map((i) => { const a = (i * Math.PI) / 2 + Math.PI / 4; return groundAt(px + Math.cos(a) * 0.0037, pz + Math.sin(a) * 0.0037); });
    base = { x: px, y: Math.min(...feet) - 0.00038, z: pz };
    group.position.set(base.x, base.y, base.z);
    group.visible = true;
  }

  function reset() {
    launchT0 = null;
    still = false;
    m.ascent.position.y = 3.2;
    m.ascent.visible = true;
    m.plume.material.opacity = 0; m.flash.material.opacity = 0;
    if (padLight) padLight.intensity = 0;
    gPos.fill(-1e6); gGeo.attributes.position.needsUpdate = true;
  }

  // The lift-off as a still frame (reduced motion, #398): the ascent stage in the air with its engine lit.
  let still = false;
  function showStill(altitudeKm) {
    if (!base) return;
    reset();
    still = true;
    pose(stillPose(altitudeKm));
  }
  function pose(at) {
    m.ascent.position.y = 3.2 + at.altitudeKm * 1000;
    m.ascent.visible = !at.done;
    m.plume.material.opacity = 0.32 * at.thrust;
    m.plume.scale.set(1, 0.6 + 0.8 * at.thrust, 1);
    m.flash.material.opacity = Math.min(1, at.flash * 1.4 + 0.25 * at.thrust);
    const fs = 14 + 50 * at.flash;
    m.flash.scale.set(fs, fs, 1);
  }

  /** Moves the vehicle and its effects to `now`; true while something on screen changed (the caller redraws). */
  function update(now, camera) {
    if (!base) return false;
    let changed = false;
    // Beacon: blinks, and its glow keeps ~0.5° on screen within BEACON_KM, so it reads from the start.
    const on = launchT0 === null && !still && beaconOn(now, mode);
    if (on !== beaconWas) { beaconWas = on; changed = true; }
    m.beaconMat.emissiveIntensity = on ? 3 : 0.15;
    // The hatch lights up warm when the crew arrives, and stays lit once the lift-off is cleared.
    const hatch = mode === 'idle' ? 0 : 2.2;
    if (m.hatchMat.emissiveIntensity !== hatch) { m.hatchMat.emissiveIntensity = hatch; if (hatchLight) hatchLight.intensity = hatch ? 0.00025 : 0; changed = true; }
    const d = camera ? camera.getWorldPosition(v).distanceTo(m.beaconGlow.getWorldPosition(new THREE.Vector3())) : 1;
    const s = (on && d < BEACON_KM ? Math.max(1.2, d * 1000 * 0.012) : 0.001); // metres, in the model's scale
    m.beaconGlow.scale.set(s, s, 1);
    if (launchT0 === null) return changed;

    const at = launchAt(now - launchT0);
    pose(at);
    if (padLight) padLight.intensity = (0.0008 * at.flash + 0.0004 * at.thrust) * (at.altitudeKm < 0.15 ? 1 : 0);
    // Grains: thrown at ignition, flying until they fall back to the pad's height.
    if (grains.length) {
      const tS = Math.max(0, (now - launchT0 - LAUNCH.board - LAUNCH.count) / 1000); // from the ignition
      for (let i = 0; i < grains.length; i++) {
        const g = grains[i], k = i * 3;
        const ti = tS - (i % 20) * 0.03; // a burst over the first 0.6 s
        const y = g.vy * ti - 0.5 * G_KM * ti * ti;
        if (ti <= 0 || y < 0) { gPos[k + 1] = -1e6; continue; }
        gPos[k] = g.dx + g.vx * ti; gPos[k + 1] = y + 0.0003; gPos[k + 2] = g.dz + g.vz * ti;
      }
      gGeo.attributes.position.needsUpdate = true;
    }
    if (now - launchT0 > LAUNCH_MS + 3000) launchT0 = null; // the stage is gone; the beacon stays off (ascent hidden)
    return true;
  }

  // Grains are in the group's frame (km from the pad), the model in metres: grains are placed in a child at scale 1.
  return {
    group, place, reset, update,
    launch(now = performance.now()) { if (!base) return; still = false; launchT0 = now; },
    /** The lift-off as a still frame, for reduced motion (#398). */
    still: showStill,
    /** The beacon and the hatch as the crew arrives: 'idle' | 'waiting' | 'ready' (beaconMode of liftoff.js). */
    setMode(next) {
      if (next === mode || !BEACON_COLOR[next]) return false;
      mode = next;
      m.beaconMat.color.setHex(BEACON_COLOR[next]); m.beaconMat.emissive.setHex(BEACON_COLOR[next]);
      m.beaconGlow.material.color.setHex(next === 'idle' ? 0xff4a30 : BEACON_COLOR[next]);
      return true;
    },
    launching: () => launchT0 !== null,
    /** World position of the ascent stage (km), for the camera to follow it. */
    stageAt: (out) => m.ascent.getWorldPosition(out),
    padAt: () => base,
  };
}
