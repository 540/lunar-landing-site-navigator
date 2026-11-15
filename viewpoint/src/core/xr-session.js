// Entering and leaving a WebXR session (#396): the decisions that do not need a headset. Pure: no WebXR, no three.js.

/** The head's height (m) over the floor that the app assumes when the headset has no floor ('local' space). */
export const SEATED_EYE_M = 1.7;

/**
 * The reference space for the granted features of a session (`session.enabledFeatures`): the floor space if the headset
 * gave it, and else 'local' (the origin at the head when the session starts). A browser that does not list the granted
 * features is given the benefit of the doubt: the floor space.
 * @param {string[]|undefined} enabledFeatures
 * @returns {{ type: 'local-floor'|'local', floor: boolean, eyeOffsetM: number }} eyeOffsetM: what to add to the
 *   height of the poses so the head is at a standing height over the ground
 */
export function referenceSpaceFor(enabledFeatures) {
  const floor = !Array.isArray(enabledFeatures) || enabledFeatures.includes('local-floor') || enabledFeatures.includes('bounded-floor');
  return floor ? { type: 'local-floor', floor: true, eyeOffsetM: 0 } : { type: 'local', floor: false, eyeOffsetM: SEATED_EYE_M };
}

/**
 * The steps to undo what entering VR did, in the order they must run, once: the loop first, then the camera out of the rig
 * and its planes back, the lights, sprites and stars (the shared field back), the view on foot as it was (third person and the tilt of the gaze), the
 * listeners and, at the end, the drone's planes if the way out was to the drone.
 * @param {{ destination: 'foot'|'drone' }} where
 * @returns {string[]}
 */
export function xrRestoreSteps({ destination }) {
  const steps = ['stop-loop', 'detach-camera', 'foot-planes', 'body-lights', 'sprites', 'stars', 'foot-view', 'listeners', 'resize'];
  if (destination === 'drone') steps.push('drone-planes');
  return steps;
}
