// The cos/sin table by step index of horizonRay (#415): a ray whose distances leave the nominal sequence (it crosses
// samples without data and takes the coarse layer's step) neither uses nor corrupts the table, so the rays traced
// afterwards with the same tracer still give the reference's bits. Synthetic grids, without a real DEM nor network.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { RESOLUTIONS, configureDem, layersFor, makeGrid, xyToLL } from '../src/terrain/dem.ts';
import { horizonRay } from '../src/terrain/horizonMask.ts';
import type { Grid, Resolution } from '../src/types.ts';
import { randomAzimuths, seededRandom } from './reference/marchIdentity.ts';
import * as ref from './reference/horizonMarchReference.ts';

const rand = seededRandom(415);
const z = (x: number, y: number): number => 400 * Math.sin(x / 3100) * Math.cos(y / 2300) + 150 * Math.abs(Math.sin((x + 2 * y) / 900));

function grid(name: string, res: number, x0: number, y0: number, w: number, h: number, hole?: (x: number, y: number) => boolean): Grid {
  const a = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = x0 + (i + 0.5) * res, y = y0 - (j + 0.5) * res;
    a[j * w + i] = hole?.(x, y) ? NaN : z(x, y);
  }
  return makeGrid({ name, product: 'sintético', res, X0: x0, Y0: y0, w, h, a });
}

// Coarse layer: 1 km/px, ±200 km around the pole. Fine layer: 20 m/px, 12 × 12 km centred at (20, 10) km, with NaN
// discs of 150 m radius on a 1.5 km lattice (none at the site), which the coarse layer fills.
const C = [20000, 10000];
const COARSE = grid('gruesa', 1000, -200000, 200000, 400, 400);
const hole = (x: number, y: number): boolean => {
  const dx = ((x - C[0] + 750) % 1500 + 1500) % 1500 - 750, dy = ((y - C[1] + 750) % 1500 + 1500) % 1500 - 750;
  return Math.hypot(x - C[0], y - C[1]) > 400 && Math.hypot(dx - 750, dy - 750) < 150;
};
const FINE = grid('fina', 20, C[0] - 6000, C[1] + 6000, 600, 600);
const HOLEY = grid('fina con huecos', 20, C[0] - 6000, C[1] + 6000, 600, 600, hole);

after(() => { configureDem(); });

test('tabla de coseno y seno: los rayos que se desvían no la corrompen', () => {
  const [lat, lon] = xyToLL(C[0], C[1]);
  for (const resolution of Object.keys(RESOLUTIONS) as Resolution[]) {
    configureDem({ grids: [HOLEY, COARSE] });
    const { layers, cfg } = layersFor(lat, lon, resolution)!;
    for (const observerHeightM of [0, 2, 100]) {
      const march = { observerHeightM, stepFrac: cfg.stepFrac, grow: cfg.grow };
      // The nominal sequence of distances: the same layers without holes (every ray takes the same steps).
      const nominal = ref.horizonRay(lat, lon, layers.map((l) => (l.g === HOLEY ? { ...l, g: FINE } : l)), march);
      const refRay = ref.horizonRay(lat, lon, layers, march);
      const azimuths = randomAzimuths(rand, 300);
      const deviating = azimuths.filter((az) => refRay.trace(az).samples !== nominal.trace(az).samples);
      if (layers[0].g === HOLEY) assert.ok(deviating.length > 0 && deviating.length < azimuths.length, `${resolution}: ${deviating.length} rayos desviados`);
      // A fresh tracer whose table is first filled by deviating rays, then every ray, then the deviating ones again.
      const srcRay = horizonRay(lat, lon, layers, march);
      for (const az of [...deviating, ...azimuths, ...deviating]) {
        const a = srcRay.trace(az), b = refRay.trace(az);
        assert.ok(Object.is(a.el, b.el) && a.samples === b.samples && a.miss === b.miss,
          `${resolution}, h=${observerHeightM} m, ${az}°: el ${a.el}/${b.el}, samples ${a.samples}/${b.samples}, miss ${a.miss}/${b.miss}`);
      }
      // And a nominal ray first: the table holds the nominal sequence, a deviating ray must not use its tail.
      const srcRay2 = horizonRay(lat, lon, layers, march);
      for (const az of [...azimuths.filter((x) => !deviating.includes(x)).slice(0, 1), ...deviating, ...azimuths]) {
        const a = srcRay2.trace(az), b = refRay.trace(az);
        assert.ok(Object.is(a.el, b.el) && a.samples === b.samples && a.miss === b.miss, `${resolution}, h=${observerHeightM} m, ${az}° (tras uno nominal)`);
      }
    }
  }
});

test('tabla de coseno y seno: un primer rayo desviado no fija la cola, el siguiente nominal la completa', () => {
  const [lat, lon] = xyToLL(C[0], C[1]);
  configureDem({ grids: [HOLEY, COARSE] });
  const { layers, cfg } = layersFor(lat, lon, 'precise')!;
  assert.equal(layers[0].g, HOLEY);
  const march = { observerHeightM: 2, stepFrac: cfg.stepFrac, grow: cfg.grow };
  const nominal = ref.horizonRay(lat, lon, layers.map((l) => (l.g === HOLEY ? { ...l, g: FINE } : l)), march);
  const refRay = ref.horizonRay(lat, lon, layers, march);
  const azimuths = randomAzimuths(seededRandom(4151), 300);
  const deviatingAz = azimuths.find((az) => refRay.trace(az).samples !== nominal.trace(az).samples)!;
  const nominalAz = azimuths.find((az) => refRay.trace(az).samples === nominal.trace(az).samples)!;
  assert.ok(deviatingAz !== undefined && nominalAz !== undefined);
  // What a nominal ray alone puts in a fresh table (it stops where the ray first leaves li, e.g. at the edge of the window).
  const fresh = horizonRay(lat, lon, layers, march);
  fresh.trace(nominalAz);
  const steps = fresh.tableSize();
  assert.ok(steps > 0);
  const srcRay = horizonRay(lat, lon, layers, march);
  srcRay.trace(deviatingAz);
  assert.ok(srcRay.tableSize() < steps, `tras el rayo desviado: ${srcRay.tableSize()} entradas de ${steps}`);
  srcRay.trace(nominalAz);
  assert.equal(srcRay.tableSize(), steps);
  srcRay.trace(deviatingAz);
  assert.equal(srcRay.tableSize(), steps);
});
