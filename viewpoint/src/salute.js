import { prefersReducedMotion } from './core/motion.js';
import { UI } from './texts.js';

// Celebration of a salute with the hands (hands.js): when the user salutes as the astronaut beside the flag does, a burst
// of stars, 540 patches, «540»s and orange confetti comes out of the astronaut's helmet and falls slowly, under the
// gravity of the Moon, while a badge answers the salute. A canvas over the page that takes no clicks and goes away
// when the burst is over. With reduced motion, only the badge.

const PATCH = new URL('../assets/patch-540.png', import.meta.url).href;
const ORANGE = '#f3a83a', NAVY = '#101c3d', GOLD = '#ffd27a';
const DURATION = 3200; // ms of a burst
const MOON_G = 260; // px/s², about a sixth of what would look like a fall on the Earth
const COUNT = { star: 34, patch: 9, text: 8, confetti: 46 };

let patchImage = null;
const loadPatch = () => {
  if (!patchImage) { patchImage = new Image(); patchImage.src = PATCH; }
  return patchImage;
};

function star(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r * 0.45 : r;
    ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fill();
}

/** Particles of one burst from (x, y): a fan upwards, the stars and confetti faster than the patches and the «540»s. */
function burst(x, y, scale) {
  const list = [];
  const add = (kind, n, speed, size, colours) => {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25, v = speed * (0.45 + Math.random() * 0.75) * scale;
      list.push({
        kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: size * (0.6 + Math.random() * 0.7) * scale,
        spin: (Math.random() - 0.5) * 6, turn: Math.random() * Math.PI * 2, colour: colours[i % colours.length],
        delay: Math.random() * 180, twinkle: Math.random() * Math.PI * 2,
      });
    }
  };
  add('star', COUNT.star, 620, 11, ['#ffffff', GOLD, ORANGE]);
  add('confetti', COUNT.confetti, 680, 7, [ORANGE, '#ffffff', NAVY, GOLD]);
  add('patch', COUNT.patch, 480, 34, ['']);
  add('text', COUNT.text, 520, 24, [ORANGE, '#ffffff']);
  return list;
}

function draw(ctx, p, life) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.turn);
  ctx.globalAlpha = Math.max(0, Math.min(1, (1 - life) * 2.2));
  if (p.kind === 'star') {
    ctx.fillStyle = p.colour;
    ctx.shadowColor = p.colour; ctx.shadowBlur = 12;
    star(ctx, p.size * (0.8 + 0.25 * Math.sin(p.twinkle)));
  } else if (p.kind === 'confetti') {
    ctx.fillStyle = p.colour;
    ctx.scale(1, Math.cos(p.twinkle)); // a paper flipping over
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
  } else if (p.kind === 'patch') {
    const img = loadPatch();
    if (img.complete && img.naturalWidth) ctx.drawImage(img, -p.size / 2, -p.size / 2, p.size, p.size);
  } else {
    ctx.fillStyle = p.colour;
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6;
    ctx.font = `800 ${p.size}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('540', 0, 0);
  }
  ctx.restore();
}

/** The badge that answers the salute: the 540 patch and a line of text, in the middle of the screen. */
function showBadge() {
  const badge = document.createElement('div');
  badge.className = 'salute-badge';
  badge.setAttribute('role', 'status');
  const img = document.createElement('img');
  img.src = PATCH; img.alt = ''; img.width = 56; img.height = 56;
  const text = document.createElement('span');
  text.textContent = UI.salute;
  badge.append(img, text);
  document.body.append(badge);
  setTimeout(() => badge.remove(), DURATION);
}

let canvas = null, particles = [], raf = 0, last = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const ctx = canvas.getContext('2d'), dpr = canvas.width / innerWidth;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  // Ages count the frames drawn, not the clock: on a slow screen the burst runs slower, but it still opens before it fades.
  for (const p of particles) p.age += dt * 1000;
  particles = particles.filter(p => p.age < DURATION);
  for (const p of particles) {
    if (p.age < p.delay) continue;
    p.vy += MOON_G * dt;
    p.vx *= 1 - 0.35 * dt; // a little drag, so the fan opens and then rains
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.turn += p.spin * dt; p.twinkle += 9 * dt;
    draw(ctx, p, p.age / DURATION);
  }
  if (particles.length) raf = requestAnimationFrame(frame);
  else { canvas.remove(); canvas = null; raf = 0; }
}

/**
 * Celebrates a salute. `from`: the point of the screen where the burst starts (the astronaut's helmet, from
 * astronautOnScreen()); when it is null or off the screen, the middle of the screen.
 */
export function celebrateSalute(from) {
  showBadge();
  if (prefersReducedMotion()) return;
  loadPatch();
  const origin = from?.onScreen ? from : { x: innerWidth / 2, y: innerHeight * 0.55 };
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'salute-burst';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.append(canvas);
  }
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  const scale = Math.max(0.6, Math.min(1.2, innerHeight / 800));
  for (const p of burst(origin.x, origin.y, scale)) { p.age = 0; particles.push(p); }
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
}
