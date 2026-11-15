// SceneFrame: the conversion between lat/lon and the scene of a region. Pure: no three.js, no DOM.
// Scene axes (the convention of direction.js): x east, y up, z south, so azimuth 0° (north) points to -z. Units in km.
// The axes are the local east/north of the region centre (siteFrame() in backend/src/ephemeris.ts), so the azimuths of
// the series (measured from the local north of the site, towards the east) are valid in the scene as they are.
// Near the pole this matters: at -89.45° moving 1 km sideways changes the longitude by about 3.4°.
// The projection is orthographic on the sphere of the Moon: it has an exact inverse, so the round trip has no error.
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * @param {{radiusKm:number, centerLat:number, centerLon:number}} params `sceneFrame` of meta.json (centre in degrees).
 */
export function createSceneFrame({ radiusKm, centerLat, centerLon }) {
  const phi0 = centerLat * D2R;
  const sin0 = Math.sin(phi0);
  const cos0 = Math.cos(phi0);

  /** lat/lon (degrees) → {x, z} in km. x towards the east, z towards the south. */
  function toScene(lat, lon) {
    const phi = lat * D2R;
    const dLam = (lon - centerLon) * D2R;
    const east = radiusKm * Math.cos(phi) * Math.sin(dLam);
    const north = radiusKm * (cos0 * Math.sin(phi) - sin0 * Math.cos(phi) * Math.cos(dLam));
    return { x: east, z: -north };
  }

  /** {x, z} in km → lat/lon (degrees). Inverse of toScene on the visible hemisphere around the centre. */
  function fromScene(x, z) {
    const east = x;
    const north = -z;
    const rho = Math.hypot(east, north);
    if (rho === 0) return { lat: centerLat, lon: centerLon };
    const c = Math.asin(Math.min(1, rho / radiusKm));
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);
    const lat = Math.asin(cosC * sin0 + (north * sinC * cos0) / rho) * R2D;
    // atan2 keeps the right quadrant even when the point is almost on the pole (cosφ0 → 0 is not our case, but cheap to keep)
    const dLam = Math.atan2(east * sinC, rho * cos0 * cosC - north * sin0 * sinC);
    let lon = centerLon + dLam * R2D;
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    return { lat, lon };
  }

  /** Azimuth (degrees from the local north towards the east) → the one of the scene: 0° is -z, 90° is +x, so they are the same. */
  const azimuthToScene = (az) => az;

  return { toScene, fromScene, azimuthToScene };
}
