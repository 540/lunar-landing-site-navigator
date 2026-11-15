// Entering and leaving VR (#396) and the PS VR switch: the decisions that need no headset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceSpaceFor, xrRestoreSteps, SEATED_EYE_M } from '../src/core/xr-session.js';
import { offersPSVR } from '../src/core/psvr.js';

test('the reference space follows the granted features: the floor if given, else local with a standing height', () => {
  assert.deepEqual(referenceSpaceFor(['local-floor', 'hand-tracking']), { type: 'local-floor', floor: true, eyeOffsetM: 0 });
  assert.equal(referenceSpaceFor(['bounded-floor']).type, 'local-floor');
  const seated = referenceSpaceFor(['local', 'hand-tracking']);
  assert.deepEqual(seated, { type: 'local', floor: false, eyeOffsetM: SEATED_EYE_M });
  assert.equal(referenceSpaceFor([]).type, 'local');
  assert.equal(referenceSpaceFor(undefined).type, 'local-floor'); // a browser that does not say
});

test('the restore runs once and in order: camera out of the rig before its planes, the drone\'s planes last', () => {
  const toFoot = xrRestoreSteps({ destination: 'foot' });
  assert.ok(!toFoot.includes('drone-planes'));
  assert.equal(toFoot[0], 'stop-loop');
  assert.ok(toFoot.indexOf('detach-camera') < toFoot.indexOf('foot-planes'));
  assert.ok(toFoot.indexOf('foot-view') < toFoot.indexOf('listeners'));
  const toDrone = xrRestoreSteps({ destination: 'drone' });
  assert.equal(toDrone.at(-1), 'drone-planes');
  assert.ok(toDrone.indexOf('detach-camera') < toDrone.indexOf('drone-planes'));
  assert.equal(new Set(toDrone).size, toDrone.length, 'no step twice');
});

test('PS VR is only offered with ?psvr=1, WebHID and a secure context', () => {
  const ok = { search: '?psvr=1', hasHid: true, secure: true };
  assert.equal(offersPSVR(ok), true);
  assert.equal(offersPSVR({ ...ok, search: '' }), false);
  assert.equal(offersPSVR({ ...ok, search: '?lang=en' }), false);
  assert.equal(offersPSVR({ ...ok, search: '?psvr=0' }), false);
  assert.equal(offersPSVR({ ...ok, search: '?lang=en&psvr=1' }), true);
  assert.equal(offersPSVR({ ...ok, hasHid: false }), false);
  assert.equal(offersPSVR({ ...ok, secure: false }), false);
  assert.equal(offersPSVR({}), false);
  assert.equal(offersPSVR(), false);
});
