// Suited crew, built from capsules, spheres and tori, with jointed arms so they can reach, rest and cheer.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const HALF_PI = Math.PI / 2;

export const POSES = {
  rest: { l: [0.25, 0.08, 0.8], r: [0.25, -0.08, 0.8] },
  reach: { l: [0.62, -0.85, 0.42], r: [0.25, -0.08, 0.8] },
  tablet: { l: [0.38, 0.2, 0.92], r: [0.38, -0.2, 0.92] },
  stick: { l: [0.25, 0.08, 0.8], r: [0.42, 0.3, 0.78] },
  cheer: { l: [2.7, 0.35, 0.35], r: [2.7, -0.35, 0.35] },
  brace: { l: [1.45, -0.5, 1.95], r: [1.45, 0.5, 1.95] },
};

function tagTexture(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 128, 48);
  g.fillStyle = fg; g.font = '700 30px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 26);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function patchTexture(accent) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#10151c'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
  g.strokeStyle = accent; g.lineWidth = 7; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.stroke();
  g.fillStyle = '#d9d9d6'; g.beginPath(); g.arc(64, 96, 50, Math.PI * 1.12, Math.PI * 1.88); g.fill();
  g.fillStyle = accent; g.beginPath(); g.moveTo(64, 26); g.lineTo(76, 62); g.lineTo(52, 62); g.fill();
  g.fillStyle = '#fff'; g.font = '700 17px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('540', 64, 112);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createCrewKit(envMap) {
  const geo = {
    torso: new THREE.CapsuleGeometry(0.165, 0.22, 6, 20),
    pelvis: new THREE.CapsuleGeometry(0.13, 0.12, 4, 14).rotateZ(HALF_PI),
    upperArm: new THREE.CapsuleGeometry(0.062, 0.2, 4, 14).translate(0, -0.15, 0),
    forearm: new THREE.CapsuleGeometry(0.053, 0.17, 4, 14).translate(0, -0.135, 0),
    thigh: new THREE.CapsuleGeometry(0.088, 0.27, 4, 14).translate(0, -0.2, 0),
    shin: new THREE.CapsuleGeometry(0.07, 0.25, 4, 14).translate(0, -0.2, 0),
    joint: new THREE.SphereGeometry(1, 16, 12),
    band: new THREE.TorusGeometry(1, 0.16, 8, 20).rotateX(HALF_PI),
    cuff: new THREE.CylinderGeometry(0.052, 0.056, 0.03, 16),
    finger: new THREE.CapsuleGeometry(0.0125, 0.045, 3, 8),
    boot: new RoundedBoxGeometry(0.12, 0.1, 0.27, 3, 0.035),
    sole: new RoundedBoxGeometry(0.125, 0.03, 0.285, 2, 0.012),
    ring: new THREE.TorusGeometry(0.125, 0.024, 10, 32).rotateX(HALF_PI),
    shell: new THREE.SphereGeometry(0.168, 32, 24),
    visor: new THREE.SphereGeometry(0.172, 32, 20, Math.PI * 1.5 - 1.15, 2.3, 0.72, 1.2),
    visorRim: new THREE.TorusGeometry(0.15, 0.012, 8, 36),
    ear: new THREE.CylinderGeometry(0.045, 0.05, 0.03, 16).rotateZ(HALF_PI),
    pack: new RoundedBoxGeometry(0.34, 0.4, 0.11, 3, 0.04),
    chest: new RoundedBoxGeometry(0.21, 0.13, 0.07, 3, 0.02),
    knob: new THREE.CylinderGeometry(0.012, 0.012, 0.02, 10).rotateX(HALF_PI),
    strap: new THREE.BoxGeometry(0.045, 0.5, 0.012),
    buckle: new RoundedBoxGeometry(0.07, 0.05, 0.02, 2, 0.008),
    tag: new THREE.PlaneGeometry(0.085, 0.032),
    patch: new THREE.CircleGeometry(0.036, 20),
  };
  const mat = {
    suit: new THREE.MeshStandardMaterial({ color: 0xe6e4df, roughness: 0.88 }),
    joint: new THREE.MeshStandardMaterial({ color: 0x9da1a6, roughness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.7 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x4c5158, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc3c7cc, metalness: 0.95, roughness: 0.28, envMap, envMapIntensity: 0.9 }),
    visor: new THREE.MeshStandardMaterial({ color: 0xe2a53a, metalness: 1, roughness: 0.2, envMap, envMapIntensity: 2.6, emissive: 0x3a2206 }),
    strap: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.95 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0x66ffa0, toneMapped: false }),
  };
  return { geo, mat };
}

/**
 * One astronaut seated with the hips at the origin, facing -z.
 * Options: role (chest tag), accent colour, headless (the player's own body) and tablet (held in both hands).
 */
export function createAstronaut(kit, { role, accent, headless = false, tablet = false, seed = 0 }) {
  const { geo, mat } = kit;
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 });
  const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; return o; };
  const ball = (r, m, x, y, z) => { const o = mesh(geo.joint, m, x, y, z); o.scale.setScalar(r); return o; };
  const band = (r, y) => { const o = mesh(geo.band, accentMat, 0, y, 0); o.scale.setScalar(r); return o; };
  const root = new THREE.Group();
  root.add(mesh(geo.pelvis, mat.suit, 0, 0.11, 0.02));

  const torso = new THREE.Group();
  torso.position.set(0, 0.12, 0.03); torso.rotation.x = 0.13;
  const body = mesh(geo.torso, mat.suit, 0, 0.27, 0); body.scale.set(1.12, 1, 0.86);
  torso.add(body, mesh(geo.pack, mat.joint, 0, 0.3, 0.15), mesh(geo.ring, mat.metal, 0, 0.5, -0.005));
  const chest = mesh(geo.chest, mat.joint, 0, 0.31, -0.15);
  torso.add(chest);
  [-0.06, -0.02, 0.02].forEach((x, i) => torso.add(mesh(geo.knob, i ? mat.dark : accentMat, x, 0.335, -0.19)));
  const lamp = mesh(new THREE.BoxGeometry(0.05, 0.014, 0.004), mat.lamp, 0.055, 0.29, -0.187); lamp.castShadow = false; torso.add(lamp);
  const tag = new THREE.Mesh(geo.tag, new THREE.MeshBasicMaterial({ map: tagTexture(role, '#0f1318', '#ffffff') })); tag.position.set(-0.045, 0.285, -0.1865); tag.rotation.y = Math.PI; torso.add(tag);
  // Harness: two shoulder straps to a buckle on the chest.
  for (const s of [-1, 1]) { const strap = mesh(geo.strap, mat.strap, s * 0.1, 0.3, -0.148); strap.rotation.set(0.1, 0, s * -0.16); strap.castShadow = false; torso.add(strap); }
  torso.add(mesh(geo.buckle, mat.metal, 0, 0.17, -0.165));
  // The player's own body keeps arms and legs only: a torso right under the camera would fill the view.
  if (headless) torso.children.forEach(o => { o.visible = false; });
  root.add(torso);

  const head = new THREE.Group();
  head.position.set(0, 0.53, -0.01);
  if (!headless) {
    head.add(mesh(geo.shell, mat.suit, 0, 0.125, 0), mesh(geo.visor, mat.visor, 0, 0.125, 0));
    const rim = mesh(geo.visorRim, mat.dark, 0, 0.125, -0.085); head.add(rim);
    for (const s of [-1, 1]) head.add(mesh(geo.ear, mat.joint, s * 0.165, 0.11, 0.01));
    const crest = mesh(new RoundedBoxGeometry(0.07, 0.03, 0.2, 2, 0.012), mat.joint, 0, 0.285, 0.03); crest.rotation.x = -0.25; head.add(crest);
    torso.add(head);
  }

  const arms = {};
  for (const [key, s] of [['l', -1], ['r', 1]]) {
    const shoulder = new THREE.Group(); shoulder.position.set(s * 0.225, 0.43, 0); shoulder.rotation.order = 'ZXY';
    shoulder.add(ball(0.09, mat.suit, 0, 0, 0), mesh(geo.upperArm, mat.suit), band(0.066, -0.11));
    const patch = new THREE.Mesh(geo.patch, new THREE.MeshBasicMaterial({ map: patchTexture(`#${new THREE.Color(accent).getHexString()}`) }));
    patch.position.set(s * 0.066, -0.13, 0); patch.rotation.y = s * HALF_PI; shoulder.add(patch);
    const elbow = new THREE.Group(); elbow.position.y = -0.3;
    elbow.add(ball(0.066, mat.joint, 0, 0, 0), mesh(geo.forearm, mat.suit), mesh(geo.cuff, mat.metal, 0, -0.27, 0));
    const hand = new THREE.Group(); hand.position.y = -0.3;
    const palm = ball(1, mat.glove, 0, -0.03, 0); palm.scale.set(0.047, 0.05, 0.028); hand.add(palm);
    for (let i = 0; i < 4; i++) { const f = mesh(geo.finger, mat.glove, -0.033 + i * 0.022, -0.085, -0.012); f.rotation.x = 0.45; hand.add(f); }
    const thumb = mesh(geo.finger, mat.glove, s * -0.05, -0.04, -0.01); thumb.rotation.z = s * -0.9; hand.add(thumb);
    elbow.add(hand); shoulder.add(elbow); torso.add(shoulder);
    arms[key] = { shoulder, elbow, pose: [0.25, s * -0.08, 0.8] };
  }

  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.105, 0.1, -0.03); hip.rotation.set(HALF_PI - 0.08, 0, s * 0.07);
    hip.add(mesh(geo.thigh, mat.suit), band(0.092, -0.2));
    const knee = new THREE.Group(); knee.position.y = -0.42; knee.rotation.x = -(HALF_PI - 0.22);
    knee.add(ball(0.09, mat.joint, 0, 0, 0), mesh(geo.shin, mat.suit));
    const foot = new THREE.Group(); foot.position.y = -0.4; foot.rotation.x = -0.14;
    foot.add(mesh(geo.boot, mat.joint, 0, -0.03, -0.07), mesh(geo.sole, mat.dark, 0, -0.085, -0.07));
    knee.add(foot); hip.add(knee); root.add(hip);
  }

  if (tablet) {
    const pad = new THREE.Group();
    pad.add(mesh(new RoundedBoxGeometry(0.24, 0.012, 0.17, 2, 0.006), mat.dark));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.14).rotateX(-HALF_PI), new THREE.MeshBasicMaterial({ color: 0x2a6a8c, toneMapped: false }));
    screen.position.y = 0.007; pad.add(screen);
    pad.position.set(0, 0.3, -0.43); pad.rotation.x = 0.6; root.add(pad);
  }

  const state = { pose: 'rest', look: [0, 0], lookTarget: [0, 0], nextLook: 1 + seed, phase: seed * 2.1, cheer: 0 };
  const apply = (arm, p, k) => {
    for (let i = 0; i < 3; i++) arm.pose[i] += (p[i] - arm.pose[i]) * k;
    arm.shoulder.rotation.set(arm.pose[0], 0, arm.pose[1]); arm.elbow.rotation.x = arm.pose[2];
  };

  return {
    root, head, state,
    setPose(name) { state.pose = name; },
    /** `focus` is a point the astronaut wants to look at, in the astronaut's own frame, or null to idle. */
    update(dt, time, focus, lively = 1) {
      const breath = Math.sin(time * 1.25 + state.phase);
      body.scale.set(1.12 + breath * 0.012, 1 + breath * 0.008, 0.86 + breath * 0.02);
      chest.position.z = -0.15 - breath * 0.004;
      const pose = POSES[state.pose] ?? POSES.rest, k = Math.min(1, dt * 4.5);
      apply(arms.l, pose.l, k); apply(arms.r, pose.r, k);
      if (state.pose === 'rest' || state.pose === 'tablet') {
        const idle = Math.sin(time * 0.7 + state.phase * 3) * 0.035 * lively;
        arms.r.elbow.rotation.x += idle; arms.l.elbow.rotation.x -= idle * 0.6;
      }
      if (headless) return;
      if (focus) state.lookTarget = [Math.atan2(-focus.x, -focus.z), Math.atan2(focus.y - 0.75, Math.hypot(focus.x, focus.z))];
      else if ((state.nextLook -= dt) < 0) {
        state.nextLook = 2.5 + ((Math.sin(time * 12.9898 + state.phase) * 43758.5453) % 1 + 1) % 1 * 4;
        const r = a => (((Math.sin(time * a + state.phase * 7) * 43758.5453) % 1) + 1) % 1 - 0.5;
        state.lookTarget = [r(3.1) * 1.3 * lively, r(5.7) * 0.5 * lively - 0.08];
      }
      const lim = (v, m) => Math.max(-m, Math.min(m, v));
      state.look[0] += (lim(state.lookTarget[0], 1.1) - state.look[0]) * Math.min(1, dt * 2.2);
      state.look[1] += (lim(state.lookTarget[1], 0.5) - state.look[1]) * Math.min(1, dt * 2.2);
      head.rotation.set(state.look[1] - 0.13, state.look[0], 0, 'YXZ');
    },
  };
}
