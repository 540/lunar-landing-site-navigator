// The cabin's ground lit by the map's horizon per pixel (light.js), as a patch for three.js materials: the world
// position goes to the fragment, which computes pixelSun of map-light.js (as map-gl.js does) and, inside the grid,
// uses it instead of the region's shadow map for the Sun. Outside the grid (the far relief) nothing changes.
export function lightFromMap(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vMapXZ;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
vMapXZ = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;
#else
vMapXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
#endif`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec2 vMapXZ;
uniform sampler2D uHorizon;
uniform vec4 uHzShape;
uniform vec2 uHzCode;
uniform vec2 uSunAzEl;
uniform float uHzOn, uHzHalf, uHzPenumbra;
uniform sampler2D uHzFix;
float hzTile(vec2 uv, float d) {
  float size = uHzShape.x, cols = uHzShape.z, rows = uHzShape.w;
  vec2 p = clamp(uv * size, vec2(0.5), vec2(size - 0.5));
  vec2 origin = vec2(mod(d, cols), floor(d / cols)) * size;
  return uHzCode.x + texture2D(uHorizon, (origin + p) / vec2(cols * size, rows * size)).r * 255.0 * uHzCode.y;
}
float hzSun(vec2 uv) {
  float dirs = uHzShape.y;
  float f = mod(uSunAzEl.x, 360.0) / (360.0 / dirs);
  float d0 = mod(floor(f), dirs), d1 = mod(d0 + 1.0, dirs);
  float h = mix(hzTile(uv, d0), hzTile(uv, d1), fract(f));
  if (uHzPenumbra < 0.5) return uSunAzEl.y > h ? 1.0 : 0.0;
  return clamp((uSunAzEl.y - h) / 0.53 + 0.5, 0.0, 1.0);
}`)
    .replace('#include <lights_fragment_begin>', `vec2 hzUv = (vMapXZ + uHzHalf) / (2.0 * uHzHalf);
bool hzIn = uHzOn > 0.5 && hzUv.x > 0.0 && hzUv.x < 1.0 && hzUv.y > 0.0 && hzUv.y < 1.0;
float hzLit = hzIn ? clamp(hzSun(hzUv) + (texture2D(uHzFix, hzUv).r * 255.0 - 128.0) / 127.0, 0.0, 1.0) : 1.0;
float hzShadowWeight = hzIn ? 0.0 : 1.0;
#include <lights_fragment_begin>`);
}

// The directional loop of three.js: the Sun (the only light with a shadow) takes hzLit, and its shadow map only
// counts outside the grid. Applied to the expanded lights_fragment_begin chunk.
export function sunFromMapChunk(chunk) {
  const start = '? getShadow( directionalShadowMap[ i ],';
  const end = 'vDirectionalShadowCoord[ i ] ) : 1.0;';
  if (!chunk.includes(start) || !chunk.includes(end)) throw new Error('lights_fragment_begin: unexpected shadow line');
  return chunk
    .replace(start, '? mix( 1.0, getShadow( directionalShadowMap[ i ],')
    .replace(end, 'vDirectionalShadowCoord[ i ] ), hzShadowWeight ) : 1.0;\n\t\tdirectLight.color *= hzLit;');
}
