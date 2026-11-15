// PlayStation VR from the browser (#396): commands, sensor reports, head fusion and lenses, with made-up bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, commandFrame, CONTROL_INTERFACE, isControlInterface, parseSensorReport, tickDelta, createHeadFusion, lensSample, PSVR_OPTICS, GYRO_SCALE } from '../src/core/psvr.js';

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);

test('psvr: the commands are the report id, then 0xAA and the length of their payload', () => {
  for (const c of Object.values(COMMANDS)) {
    assert.equal(c.data[1], 0xaa);
    assert.equal(c.data[2], c.data.length - 3, 'the length counts the payload');
  }
  assert.equal(COMMANDS.vrMode.data[3], 1); assert.equal(COMMANDS.cinematicMode.data[3], 0);
  assert.equal(isControlInterface([{ outputReports: [{ reportId: 0x23 }] }]), true);
  assert.equal(isControlInterface([{ inputReports: [{ reportId: 0 }], outputReports: [] }]), false);
});

/** A sensor report with these raw readings in both samples. */
function report({ gyro = [0, 0, 0], accel = [0, 0, 0], tick = 1000, proximity = 1000 } = {}) {
  const b = new Uint8Array(64), dv = new DataView(b.buffer);
  for (const [k, o] of [[0, 16], [1, 32]]) {
    dv.setUint32(o, tick + k * 500, true);
    gyro.forEach((v, i) => dv.setInt16(o + 4 + i * 2, v, true));
    accel.forEach((v, i) => dv.setInt16(o + 10 + i * 2, v, true));
  }
  dv.setInt16(55, proximity, true);
  return b;
}

test('psvr: a sensor report gives two samples in the frame of the head (x right, y up, z back)', () => {
  // at rest and level the accelerometer reads +1 g on its own x, which is up for the head (OpenHMD swaps x and y)
  const r = parseSensorReport(report({ accel: [16384, 0, 0], gyro: [0, 1000, 0] }));
  assert.equal(r.samples.length, 2);
  close(r.samples[0].accel.y, 9.81, 1e-9);
  close(r.samples[0].gyro.x, 1000 * GYRO_SCALE, 1e-12);
  assert.equal(r.samples[1].tick - r.samples[0].tick, 500);
  assert.equal(r.worn, true);
  assert.equal(parseSensorReport(new Uint8Array(10)), null);
  close(tickDelta(1500, 1000), 0.0005, 1e-12);
  close(tickDelta(0x10, 0xffffff - 483), 0.0005, 1e-12, 'over the rollover of the 24-bit counter');
});

test('psvr: the head fusion turns with the gyroscope and the accelerometer keeps it level', () => {
  const f = createHeadFusion();
  const up = { x: 0, y: 9.81, z: 0 };
  // a quarter turn to the left (about +y) in one second, at 2000 Hz
  for (let i = 0; i < 2000; i++) f.update({ x: 0, y: Math.PI / 2, z: 0 }, up, 0.0005);
  const q = f.orientation;
  close(2 * Math.atan2(q.y, q.w), Math.PI / 2, 0.01);
  // started tilted (as if put on bent forward), the gravity it reads brings it level in a few seconds
  const g = createHeadFusion({ kp: 2 });
  const tilted = { x: 0, y: 9.81 * Math.cos(0.4), z: -9.81 * Math.sin(0.4) }; // the head pitched 0.4 rad
  for (let i = 0; i < 2000 * 5; i++) g.update({ x: 0, y: 0, z: 0 }, tilted, 0.0005);
  const p = g.orientation;
  close(Math.abs(2 * Math.asin(p.x)), 0.4, 0.02);
});

test('psvr: recentring makes where you look ahead, keeping the tilt', () => {
  const f = createHeadFusion();
  for (let i = 0; i < 2000; i++) f.update({ x: 0, y: 1, z: 0 }, { x: 0, y: 9.81, z: 0 }, 0.0005); // 1 rad to the left
  f.recenter();
  const q = f.orientation;
  close(2 * Math.atan2(q.y, q.w), 0, 1e-6);
});

test('psvr: the optics of Monado: the lens centre stays, the edges bend outwards, blue more than red, 85° across', () => {
  const s = lensSample({ x: 0.5, y: 0.5 });
  close(s.x, 0.5, 1e-12); close(s.y, 0.5, 1e-12);
  // near the centre the picture is magnified (0.75: k0), towards the edge pushed out more and more
  const near = lensSample({ x: 0.55, y: 0.5 }), far = lensSample({ x: 0.95, y: 0.5 });
  assert.ok((near.x - 0.5) / 0.05 < 0.8);
  assert.ok((far.x - 0.5) / 0.45 > (near.x - 0.5) / 0.05, 'the barrel grows outwards');
  const red = lensSample({ x: 0.8, y: 0.6 }, PSVR_OPTICS.aberration.r), blue = lensSample({ x: 0.8, y: 0.6 }, PSVR_OPTICS.aberration.b);
  assert.ok(blue.x > red.x);
  close(PSVR_OPTICS.fovHDeg, 85, 1e-12);
  close(PSVR_OPTICS.fovVDeg, 89.2, 0.1);
});

test('psvr: over USB a command is a frame with its id first (WebUSB, the control interface with WinUSB)', () => {
  assert.deepEqual([...commandFrame(COMMANDS.vrMode)], [0x23, 0x00, 0xaa, 0x04, 0x01, 0x00, 0x00, 0x00]);
  assert.deepEqual([...commandFrame(COMMANDS.tracking)].slice(0, 4), [0x11, 0x00, 0xaa, 0x08]);
  assert.equal(CONTROL_INTERFACE, 5);
});
