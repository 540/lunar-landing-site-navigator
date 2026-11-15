// Look of the lunar surface (#393): the regolith of the Mirador. Pure: no DOM, no three.js. The numbers and their JS
// mirrors live here, so node:test can check them; surfaceGlsl() writes the same numbers into the shader that
// terrain-material.js plugs into the material of the relief.
//
// What it adds is ILLUSTRATIVE and only changes the shading: grain (noise) and small craters and stones that tilt the normal,
// and a faint mottling of the brightness. It never moves the geometry and does not enter shadows, masks or the verdict.
// Two limits keep it honest and steady:
// - above: a feature is only added while it is smaller than what the LOLA grid under it resolves (`cell`, the step of that
//   mesh). Whatever the relief can show comes from the relief.
// - below: a feature fades out before it gets smaller than a few pixels on screen (`footprint`), so nothing flickers.
// No photo and no albedo map: everything is computed from the position on the ground.

/** Grain: octaves of value noise, each one `ratio` times smaller than the one before. `slope` is tan of the tilt of one octave. */
export const NOISE = Object.freeze({ baseKm: 1.2, ratio: 2.1, octaves: 16, slope: 0.03, albedo: 0.03 });
/**
 * Small craters: one per cell of a grid, in `layers` grids, each `ratio` times smaller. Radius between `radiusMin` and
 * `radiusMax` of its cell (the rim, at 1.5 radii, stays inside the cell). `depthMin`…`depthMax` is depth over radius.
 * Under `stonesBelowKm` of cell some become stones: bumps instead of bowls.
 */
export const CRATERS = Object.freeze({ baseKm: 0.6, ratio: 2.6, layers: 10, radiusMin: 0.06, radiusMax: 0.2, depthMin: 0.03, depthMax: 0.16, presence: 0.6, stonesBelowKm: 0.004, stoneShare: 0.4 });
/** A feature fades in between LOW[0] and LOW[1] pixels of size, and out between HIGH[0] and HIGH[1] grid steps of the relief. */
export const BAND = Object.freeze({ low: [1.5, 4], noiseHigh: [2, 4], craterHigh: [1, 2] });
/** The largest tilt the detail can add, as tan(slope): about 17°. */
export const MAX_SLOPE = 0.3;
/** Steep ground is a little brighter (fresh material slides down and uncovers it): up to this share, between these sines of the slope. */
export const SLOPE_BRIGHTENING = Object.freeze({ share: 0.14, from: 0.2, to: 0.55 });
/**
 * Shoulder of the ground, before the tone mapping of the renderer: ceiling · (1 − exp(−light / ceiling)). The dark end stays
 * as it was (shadows and the ground the Sun grazes do not change), and the light of a slope facing the Sun, many times
 * brighter, never passes `ceiling`: it keeps its detail instead of burning to flat white.
 */
export const TONE = Object.freeze({ ceiling: 0.62 });
/**
 * Where the Sun grazes the ground, its light is the cosine of a very large angle, so a bump of a couple of degrees is many
 * times brighter or goes black: the full detail would paint blotches. Its tilt follows how the relief faces the Sun at
 * each point: `min` of it where the Sun grazes or is behind, all of it from `fullCos` (cosine of the angle to the Sun) up.
 */
export const GRAZING = Object.freeze({ min: 0.24, fullCos: 0.12 });

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Size on the ground (km) of a pixel at `distanceKm`, with `pixelRad` radians per pixel, seen at `cosView` from the normal. */
export function footprintKm(distanceKm, pixelRad, cosView) {
  // Across the view a pixel covers distance · angle; along it, that over cos. The geometric mean of both.
  return distanceKm * pixelRad / Math.sqrt(Math.max(Math.abs(cosView), 0.02));
}

/** Weight 0…1 of a feature of `sizeKm`: 0 under a few pixels, 0 when the grid of the relief (`cellKm`) already resolves it. */
export function bandWeight(sizeKm, footprint, cellKm, high) {
  return smoothstep(BAND.low[0] * footprint, BAND.low[1] * footprint, sizeKm) * (1 - smoothstep(high[0] * cellKm, high[1] * cellKm, sizeKm));
}
export const noiseWeight = (wavelengthKm, footprint, cellKm) => bandWeight(wavelengthKm, footprint, cellKm, BAND.noiseHigh);
export const craterWeight = (diameterKm, footprint, cellKm) => bandWeight(diameterKm, footprint, cellKm, BAND.craterHigh);

/** Wavelength (km) of each octave of the grain, coarse to fine. */
export const noiseWavelengths = () => Array.from({ length: NOISE.octaves }, (_, k) => NOISE.baseKm / NOISE.ratio ** k);
/** Cell (km) of each layer of craters, coarse to fine. */
export const craterCells = () => Array.from({ length: CRATERS.layers }, (_, k) => CRATERS.baseKm / CRATERS.ratio ** k);

/** The shoulder on one channel of linear light. */
export function tone(light) {
  return TONE.ceiling * (1 - Math.exp(-Math.max(0, light) / TONE.ceiling));
}

/**
 * How much of the illustrative detail is drawn (0 or 1). «Textura fina» (E3, #181) is its switch on foot, where you can
 * turn it off to see only the data; from the drone and in the mission viewer it is always there.
 */
export const detailStrength = ({ foot = false, micro = true } = {}) => (foot && !micro ? 0 : 1);

/** Share 0…1 of the tilt of the detail where the relief faces the Sun with cosine `cosSun` (see GRAZING). */
export function grazingStrength(cosSun) {
  return GRAZING.min + (1 - GRAZING.min) * smoothstep(0, GRAZING.fullCos, cosSun);
}

const f = (n) => { const s = String(+n.toPrecision(7)); return /[.e]/.test(s) ? s : s + '.0'; };

/**
 * The GLSL of the surface, to plug into a three.js material (terrain-material.js).
 * @param {{craterPasses?: number, octaves?: number, cell?: string}} options craters per cell and layer: 2, or 1 on modest devices;
 *   `octaves`: how many octaves of grain, coarse to fine (all of NOISE.octaves by default; fewer leaves out the finest);
 *   `cell`: GLSL expression of the grid step (km) under each pixel, `uSurfCell` by default (one step per mesh). The 3D sky of
 *   web/ (#393), whose rings get sparser with the distance, gives one that grows with it (it may read vSurfP).
 * @returns {{vertexPars:string, vertexMain:string, fragmentPars:string, fragmentColor:string, fragmentNormal:string, fragmentTone:string}}
 */
export function surfaceGlsl({ craterPasses = 2, octaves = NOISE.octaves, cell = 'uSurfCell' } = {}) {
  const C = CRATERS, N = NOISE, B = BAND;
  const fragmentPars = `
uniform float uSurfCell;   // km: grid step of the relief under this mesh
uniform float uSurfPixel;  // radians per pixel of the camera
uniform float uSurfDetail; // 0…1: how much of the illustrative detail
uniform vec3 uSurfSun;     // towards the Sun, in the scene
varying vec3 vSurfP;       // position in the scene, km

float sfHash1( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
vec2 sfHash2( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.xx + q.yz ) * q.zy ); }
// Value noise in -1…1 with its derivatives (x: value, yz: d/dx, d/dy). The lattice repeats every 4096 cells.
vec3 sfNoise( vec2 x ) {
  vec2 i = floor( x ), t = fract( x );
  vec2 u = t * t * t * ( t * ( t * 6.0 - 15.0 ) + 10.0 ), du = 30.0 * t * t * ( t * ( t - 2.0 ) + 1.0 );
  float a = sfHash1( mod( i, 4096.0 ) ), b = sfHash1( mod( i + vec2( 1.0, 0.0 ), 4096.0 ) );
  float c = sfHash1( mod( i + vec2( 0.0, 1.0 ), 4096.0 ) ), d = sfHash1( mod( i + vec2( 1.0, 1.0 ), 4096.0 ) );
  float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  return vec3( 2.0 * ( a + k1 * u.x + k2 * u.y + k4 * u.x * u.y ) - 1.0, 2.0 * du * vec2( k1 + k4 * u.y, k2 + k4 * u.x ) );
}
float sfLow( float size, float foot ) { return smoothstep( ${f(B.low[0])} * foot, ${f(B.low[1])} * foot, size ); }
// xy: slope added to the ground (dh/dx, dh/dz); z: change of brightness, around 0.
vec3 sfDetail( vec2 p, float foot, float cell ) {
  vec3 acc = vec3( 0.0 );
  // grain
  float lambda = ${f(N.baseKm)};
  vec2 q = p;
  mat2 back = mat2( 1.0, 0.0, 0.0, 1.0 );
  for ( int k = 0; k < ${Math.min(octaves, N.octaves)}; k ++ ) {
    float lo = sfLow( lambda, foot );
    if ( lo > 0.0 ) {
      vec3 n = sfNoise( q / lambda + float( k ) * 17.0 );
      float w = lo * ( 1.0 - smoothstep( ${f(B.noiseHigh[0])} * cell, ${f(B.noiseHigh[1])} * cell, lambda ) );
      acc.xy += w * ${f(N.slope)} * ( back * n.yz );
      acc.z += lo * ${f(N.albedo)} * n.x;
    }
    q = mat2( 0.8, 0.6, -0.6, 0.8 ) * q;
    back = back * mat2( 0.8, -0.6, 0.6, 0.8 );
    lambda /= ${f(N.ratio)};
  }
  // small craters, and stones at the scale of your boots
  float grid = ${f(C.baseKm)};
  for ( int k = 0; k < ${C.layers}; k ++ ) {
    if ( 2.0 * ${f(C.radiusMax)} * grid > ${f(B.low[0])} * foot && 2.0 * ${f(C.radiusMin)} * grid < ${f(B.craterHigh[1])} * cell ) {
      for ( int j = 0; j < ${craterPasses}; j ++ ) {
        vec2 g = p / grid + float( j ) * 0.5 + float( k ) * vec2( 7.3, 3.1 );
        vec2 id = floor( g ), seed = mod( id, 4096.0 ) + float( j ) * 131.0 + float( k ) * 17.0;
        float pick = sfHash1( seed + 71.0 );
        if ( pick < ${f(C.presence)} ) {
          float size = sfHash1( seed + 29.0 );
          float radius = ${f(C.radiusMin)} + ${f(C.radiusMax - C.radiusMin)} * size * size;
          vec2 d = g - ( id + 0.3 + 0.4 * sfHash2( seed ) );
          float r = length( d ), qn = r / radius;
          if ( qn < 1.5 ) {
            float diameter = 2.0 * radius * grid;
            float w = sfLow( diameter, foot ) * ( 1.0 - smoothstep( ${f(B.craterHigh[0])} * cell, ${f(B.craterHigh[1])} * cell, diameter ) );
            float fresh = fract( pick * 57.0 ); // most are worn and shallow, a few fresh and deep
            float depth = ${f(C.depthMin)} + ${f(C.depthMax - C.depthMin)} * fresh * fresh;
            float s;
            if ( grid < ${f(C.stonesBelowKm)} && fract( size * 91.0 ) < ${f(C.stoneShare)} ) {
              s = -3.0 * depth * qn * ( 1.0 - smoothstep( 0.6, 1.0, qn ) ); // a stone: a dome
            } else {
              // a bowl up to the rim, then the rim falling away outside
              s = depth * ( 2.0 * qn * ( 1.0 - smoothstep( 0.8, 1.05, qn ) ) - 1.1 * smoothstep( 0.95, 1.1, qn ) * ( 1.0 - smoothstep( 1.1, 1.5, qn ) ) );
            }
            acc.xy += w * s * d / max( r, 1e-5 );
          }
        }
      }
    }
    grid /= ${f(C.ratio)};
  }
  float len = length( acc.xy );
  if ( len > ${f(MAX_SLOPE)} ) acc.xy *= ${f(MAX_SLOPE)} / len;
  return acc * uSurfDetail;
}
vec3 sfTone( vec3 light ) { return ${f(TONE.ceiling)} * ( 1.0 - exp( - max( light, 0.0 ) / ${f(TONE.ceiling)} ) ); }
`;
  // The normal of the relief in the scene (y up), the detail at this point, and the brightness of the ground.
  const fragmentColor = `
vec3 sfUp = normalize( inverseTransformDirection( normalize( vNormal ), viewMatrix ) );
float sfCos = abs( dot( normalize( vViewPosition ), normalize( vNormal ) ) );
float sfFoot = length( vViewPosition ) * uSurfPixel / sqrt( max( sfCos, 0.02 ) );
vec3 sfD = sfDetail( vSurfP.xz, sfFoot, ${cell} );
sfD.xy *= ${f(GRAZING.min)} + ${f(1 - GRAZING.min)} * smoothstep( 0.0, ${f(GRAZING.fullCos)}, dot( sfUp, uSurfSun ) );
float sfSteep = sqrt( max( 0.0, 1.0 - sfUp.y * sfUp.y ) );
diffuseColor.rgb *= ( 1.0 + sfD.z ) * ( 1.0 + ${f(SLOPE_BRIGHTENING.share)} * smoothstep( ${f(SLOPE_BRIGHTENING.from)}, ${f(SLOPE_BRIGHTENING.to)}, sfSteep ) );
`;
  // The ground is y = relief + detail: its normal is ( -dy/dx, 1, -dy/dz ).
  const fragmentNormal = `
if ( sfUp.y > 0.05 ) {
  vec3 sfN = normalize( vec3( sfUp.x / sfUp.y - sfD.x, 1.0, sfUp.z / sfUp.y - sfD.y ) );
  normal = normalize( ( viewMatrix * vec4( sfN, 0.0 ) ).xyz );
}
`;
  return {
    vertexPars: 'varying vec3 vSurfP;',
    vertexMain: 'vSurfP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
    fragmentPars,
    fragmentColor,
    fragmentNormal,
    fragmentTone: 'gl_FragColor.rgb = sfTone( gl_FragColor.rgb );',
  };
}
