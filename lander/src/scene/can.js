// The commander's energy drink: a slim 250 ml can with the team's own label: 540 Energy Drink, pistachio, held by a strap.
import * as THREE from 'three';

function labelTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 768;
  const g = c.getContext('2d'), W = c.width, H = c.height;
  const body = g.createLinearGradient(0, 0, 0, H); body.addColorStop(0, '#c9e0ad'); body.addColorStop(1, '#b5d397');
  g.fillStyle = body; g.fillRect(0, 0, W, H);
  // Frost: served ice cold.
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const x = (i * 197) % W, y = (i * 113) % H, r = 9 + (i % 4) * 5;
    for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; g.beginPath(); g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke(); }
  }
  // Two identical faces, so the name and the flavour band read from any side.
  for (const x of [W * 0.25, W * 0.75]) {
    g.save(); g.beginPath(); g.rect(x - W / 4, 0, W / 2, H); g.clip();
    g.fillStyle = '#24401f'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 92px "Space Grotesk", Inter, sans-serif'; g.fillText('540', x, 120);
    g.font = '600 25px Inter, sans-serif'; g.fillStyle = '#2f4a2a'; g.fillText('ENERGY DRINK', x, 190);
    g.translate(x, 400); g.rotate(-0.36);
    g.fillStyle = '#4f7a2e'; g.fillRect(-W * 0.4, -62, W * 0.8, 124);
    g.fillStyle = '#f0f6e4'; g.fillRect(-W * 0.4, -76, W * 0.8, 7); g.fillRect(-W * 0.4, 69, W * 0.8, 7);
    g.fillStyle = '#fff'; g.font = '700 47px "Space Grotesk", Inter, sans-serif'; g.fillText('Pistacho', 0, -8);
    g.font = '600 17px Inter, sans-serif'; g.fillStyle = '#e4f0d4'; g.fillText('PISTACHIO', 0, 36);
    g.restore();
    for (const [dx, colour] of [[-42, '#7da453'], [0, '#4f7a2e'], [42, '#a9c97f']]) { g.fillStyle = colour; g.beginPath(); g.arc(x + dx, 618, 15, 0, 7); g.fill(); }
    g.fillStyle = '#2f4a2a'; g.textAlign = 'center'; g.font = '600 22px Inter, sans-serif'; g.fillText('BEBIDA ENERGÉTICA · 250 ml', x, 690);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}

export const CAN_HEIGHT_M = 0.135;

export function createCan(envMap) {
  const group = new THREE.Group(), R = 0.0265, H = CAN_HEIGHT_M;
  const silver = new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 1, roughness: 0.22, envMap, envMapIntensity: 1.2 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H * 0.83, 40, 1, true), new THREE.MeshStandardMaterial({ map: labelTexture(), metalness: 0.55, roughness: 0.34, envMap, envMapIntensity: 0.7 }));
  body.position.y = H * 0.5; body.rotation.y = 2.38;
  const profile = pts => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 40);
  const top = new THREE.Mesh(profile([[R, H * 0.915], [R * 0.985, H * 0.94], [R * 0.9, H * 0.985], [R * 0.86, H], [R * 0.82, H], [R * 0.8, H * 0.985], [0.0001, H * 0.985]]), silver);
  const base = new THREE.Mesh(profile([[0.0001, H * 0.03], [R * 0.7, H * 0.012], [R * 0.82, 0], [R * 0.9, 0.003], [R, H * 0.085]]), silver);
  const tab = new THREE.Mesh(new THREE.TorusGeometry(0.0055, 0.0016, 6, 16).rotateX(Math.PI / 2), silver);
  tab.position.set(0.004, H * 0.99, 0.004); tab.scale.set(1.5, 1, 1);
  group.add(body, top, base, tab);
  // Holder ring, velcro strap and patch: nothing loose when the engine cuts off.
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.95 });
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.0016, R + 0.0016, 0.014, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x25282d, roughness: 1, side: THREE.DoubleSide }));
  strap.position.y = H * 0.2;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.003), strap.material); tail.position.set(0.012, H * 0.2, R + 0.003); tail.rotation.y = 0.5;
  const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.012, H * 0.4, 0.006), dark); anchor.position.set(0, H * 0.2, -R - 0.004);
  const cup = new THREE.Mesh(new THREE.TorusGeometry(R + 0.004, 0.0035, 8, 32).rotateX(Math.PI / 2), dark); cup.position.y = 0.012;
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.002, 0.09), new THREE.MeshStandardMaterial({ color: 0x3a3d43, roughness: 1 })); pad.position.y = 0.001;
  group.add(strap, tail, anchor, cup, pad);
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return group;
}
