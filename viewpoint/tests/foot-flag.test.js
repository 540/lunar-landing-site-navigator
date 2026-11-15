// E3.6: the states of the flag on foot (planted, within reach, on your arm) and their transitions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagState, actionOf, press, climb, plantPoint, piecesDelta, plantOnly, moveWithPieces, REACH_KM } from '../src/core/foot-flag.js';

const flag = { x: 0, z: 0 };

test('planted far away, within reach, or on your arm', () => {
  assert.equal(flagState({ carried: false, me: { x: 0.1, z: 0 }, flag }), 'planted');
  assert.equal(flagState({ carried: false, me: { x: REACH_KM / 2, z: 0 }, flag }), 'reach');
  assert.equal(flagState({ carried: true, me: { x: 5, z: 5 }, flag }), 'carried');
});

test('the action: only within reach (pick up) or on the arm (plant)', () => {
  assert.equal(actionOf('planted'), null);
  assert.equal(actionOf('reach'), 'grab');
  assert.equal(actionOf('carried'), 'plant');
});

test('transitions: pick up, carry, plant', () => {
  assert.deepEqual(press('planted', { insideGrid: true }), { carried: false, did: null });
  assert.deepEqual(press('reach', { insideGrid: true }), { carried: true, did: 'grab' });
  assert.deepEqual(press('carried', { insideGrid: true }), { carried: false, did: 'plant' });
});

test('outside the grid the flag cannot be planted: you keep carrying it', () => {
  assert.deepEqual(press('carried', { insideGrid: false }), { carried: true, did: null, blocked: 'outside' });
});

test('going up to the drone plants a carried flag, and a planted one stays', () => {
  assert.deepEqual(climb({ carried: true }), { carried: false, plant: true });
  assert.deepEqual(climb({ carried: false }), { carried: false, plant: false });
});

test('the flag is planted a little ahead of you, where you look', () => {
  const p = plantPoint({ x: 1, z: 1, yaw: 0 }, 0.001); // north: towards -z
  assert.ok(Math.abs(p.x - 1) < 1e-12 && Math.abs(p.z - 0.999) < 1e-12);
  const e = plantPoint({ x: 1, z: 1, yaw: 90 }, 0.001); // east: +x
  assert.ok(Math.abs(e.x - 1.001) < 1e-12 && Math.abs(e.z - 1) < 1e-12);
});

test('the astronaut and the rockets shift from where they stand, not from the flag planted elsewhere', () => {
  const pieces = { x: 1, z: 1 }; // the flag was planted on foot at (1.5, 1.25): pieces did not follow
  assert.deepEqual(piecesDelta(pieces, 1.5, 1.25), { dx: 0.5, dz: 0.25 });
  assert.deepEqual(piecesDelta(pieces, 1, 1), { dx: 0, dz: 0 });
});

test('plant on foot → go up → move again: the pieces follow from where they stood, never from the flag', () => {
  let st = { flag: { x: 1, z: 1 }, pieces: { x: 1, z: 1 } };
  st = plantOnly(st, 1.5, 1.25);
  assert.deepEqual(st, { flag: { x: 1.5, z: 1.25 }, pieces: { x: 1, z: 1 } }, 'planting moves only the flag');
  const up = moveWithPieces(st, 1.5, 1.25);
  assert.deepEqual([up.dx, up.dz], [0.5, 0.25]);
  assert.deepEqual(up.pieces, up.flag, 'after going up the pieces are with the flag');
  const again = moveWithPieces(up, 2, 2);
  assert.deepEqual([again.dx, again.dz], [0.5, 0.75], 'the next move shifts from where the pieces stand');
});
