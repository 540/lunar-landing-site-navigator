// Compass on foot (E3.4, #185). Pure: no three.js, no DOM.
// The axes of the scene are the local north and east of the CENTRE of the region (core/scene-frame.js). Near the pole the
// local north of another point is turned: at Shackleton, about 3.4° per km sideways. The azimuths of the series are measured
// from the north of the centre, and in the scene the Sun and the Earth (far away) are in the same direction from any point,
// so seen from a point their azimuth from ITS local north is the one of the series minus the turn of that north.
import { norm360 } from './foot-camera.js';

/** A step along the meridian to find the local north (degrees of latitude): about 3 m, well inside the precision needed. */
const NORTH_STEP_DEG = 1e-4;

/**
 * Bearing in the scene (degrees from -z towards +x, like an azimuth of the centre) of the local north at (x, z).
 * @param {{toScene:Function, fromScene:Function}} frame createSceneFrame(meta.sceneFrame)
 */
export function localNorthAt(frame, x, z) {
  const { lat, lon } = frame.fromScene(x, z);
  const p = frame.toScene(lat + NORTH_STEP_DEG, lon);
  return norm360(Math.atan2(p.x - x, -(p.z - z)) * 180 / Math.PI);
}

/** Azimuth from the local north of (x, z) of a direction given in the scene (or by the series). */
export const localAzimuth = (sceneAz, north) => norm360(sceneAz - north);

/** Signed angle (−180..180) from where you look to a direction: negative on your left. */
export const relativeAngle = (yaw, az) => ((az - yaw + 540) % 360) - 180;

/** Eight points of the compass, from the local azimuth: 0 N, 1 NE, … 7 NO. */
export const octant = az => Math.round(norm360(az) / 45) % 8;

/** Where a direction is for you: ahead (±30°), behind (beyond ±150°), or on your left or right. */
export function sideOf(yaw, az) {
  const a = relativeAngle(yaw, az);
  if (Math.abs(a) <= 30) return 'ahead';
  if (Math.abs(a) >= 150) return 'behind';
  return a < 0 ? 'left' : 'right';
}

/**
 * Everything the compass draws, in degrees on its dial (0 at the top = where you look, clockwise).
 * @param {{frame:object, x:number, z:number, yaw:number, sun:{az:number,el:number}, earth?:{az:number,el:number}|null}} at
 *   yaw and the azimuths of sun and earth in the scene (the series)
 */
export function compassReading({ frame, x, z, yaw, sun, earth = null }) {
  const north = localNorthAt(frame, x, z);
  const dial = az => norm360(az - yaw);
  return {
    heading: localAzimuth(yaw, north), // your heading from the local north
    north: dial(north),
    sun: { dial: dial(sun.az), az: localAzimuth(sun.az, north), up: sun.el > 0, side: sideOf(yaw, sun.az) },
    earth: earth && { dial: dial(earth.az), az: localAzimuth(earth.az, north), up: earth.el > 0, side: sideOf(yaw, earth.az) },
  };
}
