// Starry background, like the other 540 pages (home/, discovery funnel): white stars with a fixed seed and a slow
// twinkle; still if the system asks for reduced motion. Colour and visibility come from the tokens
// (--color-star, --sky-opacity). Off by default: the page background is the lunar ground (styles/tokens.css).
import { css } from './util.js';

export function initSky(canvas) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stars = [], seed = 540, frame = 0;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const visible = () => parseFloat(css('--sky-opacity')) > 0;

  function build() {
    const dpr = devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed = 540;
    stars = Array.from({ length: Math.round(innerWidth * innerHeight / 2600) }, () => ({
      x: rnd() * innerWidth, y: rnd() * innerHeight, r: rnd() < 0.92 ? 0.6 + rnd() * 0.5 : 1.2 + rnd() * 0.6,
      a: 0.12 + rnd() * 0.5, p: rnd() * 6.28, s: 0.3 + rnd() * 0.9,
    }));
  }
  function draw(t) {
    frame = 0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!visible()) return; // sky turned off (--sky-opacity: 0): nothing drawn, no animation loop
    ctx.fillStyle = css('--color-star');
    for (const s of stars) {
      ctx.globalAlpha = still ? s.a : s.a * (0.65 + 0.35 * Math.sin(t / 1000 * s.s + s.p));
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!still) frame = requestAnimationFrame(draw);
  }
  const restart = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
  build();
  addEventListener('resize', () => { build(); restart(); });
  restart();
  return restart; // call it after a theme change
}
