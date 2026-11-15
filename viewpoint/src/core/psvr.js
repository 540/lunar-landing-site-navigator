// PlayStation VR (the PS4 headset) straight from the browser (#396): no driver and no SteamVR. Chrome and Edge reach its
// processor unit with WebHID: a control interface, to power the headset on and put it in VR mode, and a sensor one, with
// its gyroscope and accelerometer (a BMI055) at 2000 Hz. Its screen is a monitor of the computer (HDMI from the processor
// unit); the page draws both eyes on it, with the lenses' distortion. Pure: bytes and numbers, no WebHID, no DOM.
//
// The protocol is not published by Sony: it comes from the community (OpenHMD's psvr driver, PSVRFramework and
// psvr-protocol), and so do the optical measurements.

/** USB ids of the processor unit (CUH-ZVR1 and CUH-ZVR2). */
export const PSVR_VENDOR_ID = 0x054c;
export const PSVR_PRODUCT_ID = 0x09af;

/**
 * Control commands, as WebHID output reports: the first byte of a command is its report id; then a byte (0 but for power,
 * as OpenHMD sends it), the magic 0xAA and the length of the payload.
 */
export const COMMANDS = {
  powerOn: { reportId: 0x17, data: [0x76, 0xaa, 0x04, 0x01, 0x00, 0x00, 0x00] },
  vrMode: { reportId: 0x23, data: [0x00, 0xaa, 0x04, 0x01, 0x00, 0x00, 0x00] },
  cinematicMode: { reportId: 0x23, data: [0x00, 0xaa, 0x04, 0x00, 0x00, 0x00, 0x00] },
  tracking: { reportId: 0x11, data: [0x00, 0xaa, 0x08, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00] },
};

/**
 * The same command as a raw USB frame, for WebUSB (the control interface bound to WinUSB on Windows): the command id
 * first, then the rest as in the report. On USB the control interface is number 5.
 */
export const commandFrame = ({ reportId, data }) => Uint8Array.from([reportId, ...data]);
export const CONTROL_INTERFACE = 5;

/** The control interface is the one with output reports 0x23 (VR mode); the sensor one only sends 64-byte reports. */
export function isControlInterface(collections) {
  return (collections ?? []).some(c => (c.outputReports ?? []).some(r => r.reportId === 0x23));
}

const G = 9.81;
/** m/s² per unit of the accelerometer, and rad/s per unit of the gyroscope (OpenHMD). */
export const ACCEL_SCALE = G / 16384;
export const GYRO_SCALE = 0.00105;
/** The sensor counts microseconds in 24 bits. */
export const TICK_S = 1e-6;

const i16 = (b, o) => { const v = b[o] | (b[o + 1] << 8); return v & 0x8000 ? v - 0x10000 : v; };
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/**
 * The two samples of a sensor report (64 bytes, OpenHMD's layout), in the frame of the head as three.js has it: x to the
 * right, y up, z towards the back of the head. The accelerometer reads the reaction to gravity: +9.81 up, at rest.
 * @param {Uint8Array} b 64 bytes (or 63, without the first)
 * @returns {{samples:{tick:number, gyro:{x,y,z}, accel:{x,y,z}}[], buttons:number, worn:boolean}|null}
 */
export function parseSensorReport(b) {
  // 64 bytes; some systems hand the report without its first byte (63): put it back, so the offsets hold
  if (b?.length === 63) { const full = new Uint8Array(64); full.set(b, 1); b = full; }
  if (!b || b.length < 64) return null;
  const sample = o => {
    const g = [i16(b, o + 4), i16(b, o + 6), i16(b, o + 8)], a = [i16(b, o + 10), i16(b, o + 12), i16(b, o + 14)];
    return {
      tick: u32(b, o),
      gyro: { x: g[1] * GYRO_SCALE, y: g[0] * GYRO_SCALE, z: -g[2] * GYRO_SCALE },
      accel: { x: a[1] * ACCEL_SCALE, y: a[0] * ACCEL_SCALE, z: -a[2] * ACCEL_SCALE },
    };
  };
  return { samples: [sample(16), sample(32)], buttons: b[0], worn: i16(b, 55) > 600 }; // proximity ~150 off, ~1023 worn
}

/** Seconds between two ticks of the 24-bit microsecond counter (it rolls over); 0.5 ms if it makes no sense. */
export function tickDelta(next, last) {
  if (!last) return 0.0005;
  let d = (next - last) & 0xffffff;
  return d >= 475 && d <= 525 ? d * TICK_S : 0.0005;
}

// Quaternions {x, y, z, w}.
const qmul = (a, b) => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const qnorm = q => { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }; };
/** A vector of the world in the frame of the body, for an orientation q (body to world). */
const toBody = (q, v) => {
  const c = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const r = qmul(qmul(c, { x: v.x, y: v.y, z: v.z, w: 0 }), q);
  return { x: r.x, y: r.y, z: r.z };
};

/**
 * Orientation of the head from the gyroscope, kept level by the accelerometer (Mahony's filter): the gyroscope turns it,
 * and the gravity it reads pulls the tilt back where it is, so it does not drift up or down. Yaw has nothing to hold it
 * (no magnetometer): it drifts slowly, and recenter() sets where you look as ahead.
 * @param {{kp?:number, ki?:number}} [gains]
 */
export function createHeadFusion({ kp = 0.8, ki = 0.02 } = {}) {
  let q = { x: 0, y: 0, z: 0, w: 1 }, bias = { x: 0, y: 0, z: 0 }, yawZero = { x: 0, y: 0, z: 0, w: 1 };
  return {
    /** One sample: gyro (rad/s) and accel (any unit), in the frame of the head; dt in seconds. */
    update(gyro, accel, dt) {
      let w = { x: gyro.x, y: gyro.y, z: gyro.z };
      const al = Math.hypot(accel.x, accel.y, accel.z);
      if (al > 0.5 * G && al < 1.5 * G) { // only near 1 g: a jolt says nothing about where down is
        const a = { x: accel.x / al, y: accel.y / al, z: accel.z / al };
        const up = toBody(q, { x: 0, y: 1, z: 0 });
        const e = { x: a.y * up.z - a.z * up.y, y: a.z * up.x - a.x * up.z, z: a.x * up.y - a.y * up.x };
        bias = { x: bias.x + ki * e.x * dt, y: bias.y + ki * e.y * dt, z: bias.z + ki * e.z * dt };
        w = { x: w.x + kp * e.x + bias.x, y: w.y + kp * e.y + bias.y, z: w.z + kp * e.z + bias.z };
      }
      const h = 0.5 * dt;
      q = qnorm(qmul(q, { x: w.x * h, y: w.y * h, z: w.z * h, w: 1 }));
      return this.orientation;
    },
    /** Body to world, with the yaw of recenter() taken off. */
    get orientation() { return qnorm(qmul(yawZero, q)); },
    /** Where you look now becomes ahead (the yaw only: the tilt is kept). */
    recenter() {
      const f = toBody({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, { x: 0, y: 0, z: -1 }); // forward in the world
      const yaw = Math.atan2(-f.x, -f.z);
      yawZero = { x: 0, y: Math.sin(-yaw / 2), z: 0, w: Math.cos(-yaw / 2) };
    },
    /** Starts level (for the first accelerometer samples). */
    reset() { q = { x: 0, y: 0, z: 0, w: 1 }; bias = { x: 0, y: 0, z: 0 }; yawZero = { x: 0, y: 0, z: 0, w: 1 }; },
  };
}

/**
 * The optics of the headset, as Monado (the OpenXR runtime that supports the PS VR) sets them: a screen of 0.13 × 0.07 m
 * and 1920 × 1080, half an eye each, the lens centred on each half; each eye sees 85° across, and up and down what the
 * same distance to the screen gives (about 89°). Its lens distortion is the panotools polynomial with these coefficients,
 * scaled to 1.2 times the width of an eye, and each colour bends a little differently. (An earlier guess with the barrel
 * of the Oculus DK1 and a 100° field magnified too much: the sky warped as you turned your head.)
 */
const EYE_W_M = 0.13 / 2, EYE_H_M = 0.07, FOV_H_DEG = 85;
const EYE_DIST_M = (EYE_W_M / 2) / Math.tan(FOV_H_DEG / 2 * Math.PI / 180);
export const PSVR_OPTICS = {
  width: 1920, height: 1080,
  k: [0.75, -0.01, 0.75, 0, 3.8],
  aberration: { r: 0.999, g: 1.008, b: 1.018 },
  scale: 1.2, // of the width of an eye (Monado: 1.2 × 990 px)
  viewport: [990, 1080], // the eye's pixels Monado's coefficients are given in
  fovHDeg: FOV_H_DEG,
  fovVDeg: 2 * Math.atan((EYE_H_M / 2) / EYE_DIST_M) * 180 / Math.PI,
};

/**
 * Where a point of the screen of one eye takes its colour in the picture drawn for that eye (both 0..1), as Monado's
 * u_compute_distortion_panotools: from the lens centre, the radius in units of the scale, through the polynomial.
 * @param {{x:number,y:number}} uv the point of the screen of the eye
 * @param {number} [aberration] per colour (PSVR_OPTICS.aberration)
 * @returns {{x:number,y:number}} the point of the picture; outside 0..1 is black
 */
export function lensSample(uv, aberration = 1, optics = PSVR_OPTICS) {
  const [vw, vh] = optics.viewport, s = optics.scale * vw, k = optics.k;
  const rx = (uv.x * vw - vw / 2) / s, ry = (uv.y * vh - vh / 2) / s, r = Math.hypot(rx, ry);
  const m = k[0] + k[1] * r + k[2] * r * r + k[3] * r ** 3 + k[4] * r ** 4;
  return { x: (rx * m * s * aberration + vw / 2) / vw, y: (ry * m * s * aberration + vh / 2) / vh };
}

/**
 * Whether the PS VR is offered: it is experimental, so only with `?psvr=1` in the address, and only where WebHID works
 * (a secure context). Without the parameter nothing of the PS VR is created and nothing of WebHID or WebUSB is called.
 * @param {{ search?: string, hasHid?: boolean, secure?: boolean }} env
 */
export const offersPSVR = ({ search = '', hasHid = false, secure = false } = {}) =>
  new URLSearchParams(search).get('psvr') === '1' && !!hasHid && !!secure;
