// Sparks and small fragments thrown around the cabin by an impact: points that fall at lunar gravity and fade.
import * as THREE from 'three';

const COUNT = 260, GRAVITY = 1.62;

export function createDebris(scene) {
  const pos = new Float32Array(COUNT * 3), col = new Float32Array(COUNT * 3), vel = new Float32Array(COUNT * 3);
  const life = new Float32Array(COUNT), span = new Float32Array(COUNT), tint = new Float32Array(COUNT * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.011, map: dot(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  points.frustumCulled = false; points.visible = false; points.renderOrder = 7;
  scene.add(points);
  let next = 0, alive = 0;

  return {
    /** Throws `n` sparks from `origin` (a Vector3 in cabin space), mostly towards +z (into the cabin) and up. */
    burst(origin, n = 40, rand = Math.random) {
      for (let k = 0; k < n; k++, next = (next + 1) % COUNT) {
        const i = next;
        pos.set([origin.x + (rand() - 0.5) * 0.3, origin.y + (rand() - 0.5) * 0.1, origin.z], i * 3);
        vel.set([(rand() - 0.5) * 2.6, rand() * 2.2 + 0.4, rand() * 2.4 + 0.3], i * 3);
        span[i] = life[i] = 0.6 + rand() * 1.4;
        // White-hot sparks and orange ones; a few dark grey fragments.
        const r = rand();
        tint.set(r < 0.15 ? [0.35, 0.33, 0.3] : r < 0.55 ? [1, 0.95, 0.8] : [1, 0.55, 0.15], i * 3);
      }
      points.visible = true;
    },
    update(dt) {
      if (!points.visible) return;
      alive = 0;
      for (let i = 0; i < COUNT; i++) {
        if (life[i] <= 0) { col.set([0, 0, 0], i * 3); continue; }
        life[i] -= dt; alive++;
        vel[i * 3 + 1] -= GRAVITY * dt;
        for (let a = 0; a < 3; a++) pos[i * 3 + a] += vel[i * 3 + a] * dt;
        if (pos[i * 3 + 1] < 0.02) { pos[i * 3 + 1] = 0.02; vel[i * 3 + 1] *= -0.3; vel[i * 3] *= 0.6; vel[i * 3 + 2] *= 0.6; }
        const k = Math.max(0, life[i] / span[i]);
        col.set([tint[i * 3] * k, tint[i * 3 + 1] * k, tint[i * 3 + 2] * k], i * 3);
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      if (!alive) points.visible = false;
    },
    clear() { life.fill(0); col.fill(0); points.visible = false; },
  };
}

// Soft round dot, so sparks read as glowing specks rather than squares.
function dot() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,.8)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
