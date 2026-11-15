// Verdict of the touchdown. The soft limits are those of the Apollo LM landing gear (3 m/s down with 1.2 m/s sideways).

export const LIMITS = Object.freeze({
  soft: { vertical: 3, horizontal: 1.2, tiltDeg: 6 },
  hard: { vertical: 5.5, horizontal: 3, tiltDeg: 12 },
});

const within = (c, l) => c.vertical <= l.vertical && c.horizontal <= l.horizontal && c.tiltDeg <= l.tiltDeg;

/**
 * contact: { vz, vx (m/s), pitchDeg, slopeDeg (ground along the track, positive uphill), gearDown, fuelKg, distanceM }.
 * Returns { result: 'soft' | 'hard' | 'crash', reasons: [...], vertical, horizontal, tiltDeg, score }.
 */
export function assessLanding(contact) {
  const c = {
    vertical: Math.abs(contact.vz),
    horizontal: Math.abs(contact.vx),
    tiltDeg: Math.abs(contact.pitchDeg + (contact.slopeDeg ?? 0)),
  };
  const reasons = [];
  const over = (key, code) => { if (c[key] > LIMITS.soft[key]) reasons.push(code); };
  over('vertical', 'vertical');
  over('horizontal', 'horizontal');
  over('tiltDeg', 'tilt');
  if (!contact.gearDown) reasons.push('gear');

  let result = within(c, LIMITS.soft) ? 'soft' : within(c, LIMITS.hard) ? 'hard' : 'crash';
  // Without the gear the engine bell takes the hit: a gentle arrival still damages the vehicle.
  if (!contact.gearDown && result === 'soft') result = 'hard';
  else if (!contact.gearDown && result === 'hard') result = 'crash';

  const distanceM = Math.abs(contact.distanceM ?? 0);
  let score = 0;
  if (result !== 'crash') {
    const gentle = 1 - Math.min(1, c.vertical / LIMITS.hard.vertical);
    const precise = 1 - Math.min(1, distanceM / 300);
    const fuel = Math.min(1, (contact.fuelKg ?? 0) / 400);
    score = Math.round((result === 'soft' ? 40 : 15) + 25 * gentle + 25 * precise + 10 * fuel);
  }
  return { result, reasons, ...c, distanceM, score };
}
