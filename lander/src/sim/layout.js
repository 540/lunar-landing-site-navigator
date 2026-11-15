// Where things are inside the cabin: shared by the scene (what is drawn) and the walking rules (what blocks the way).

// Interior, in metres: x to the right, y up, z towards the back (the windshield is at -z).
export const CABIN = Object.freeze({ halfWidth: 1.7, front: -1.75, back: 2.3, height: 2.25 });
export const SEATS = Object.freeze({
  commander: { x: -0.62, z: -0.35 }, pilot: { x: 0.62, z: -0.35 },
  specialist1: { x: -0.72, z: 1.45 }, specialist2: { x: 0.72, z: 1.45 },
});
export const SEAT_HEIGHT = 0.46;
export const EYE_SEATED = 0.74; // over the seat cushion
export const EYE_STANDING = 1.62;
export const STAND_SPOT = Object.freeze({ x: -0.62, z: 0.42 });

// Footprints the player cannot walk through: [minX, maxX, minZ, maxZ].
export const OBSTACLES = Object.freeze([
  [-1.12, 1.12, -1.75, -1.0], [-0.22, 0.22, -1.12, -0.08],
  [-1.7, -1.24, -1.45, -0.08], [1.24, 1.7, -1.45, -0.08],
  [-0.94, -0.3, -0.75, 0.06], [0.3, 0.94, -0.75, 0.06],
  [-1.04, -0.4, 0.92, 1.86], [0.4, 1.04, 0.92, 1.86],
  [-1.7, -1.04, 0.95, 2.3], [1.04, 1.7, 0.95, 2.3],
]);

export const PLAYER_RADIUS = 0.2;
export const BOUNDS = Object.freeze({ minX: -CABIN.halfWidth, maxX: CABIN.halfWidth, minZ: CABIN.front, maxZ: CABIN.back });
