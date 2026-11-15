// Map relief in WebGL (J4.1): one rectangle and a fragment shader that combines the pipeline textures (normals,
// albedo, occlusion), the direction of the Sun and the Sun fraction: per cell (sun.bin at the hour, 48 × 48, linear
// filter) until the horizon atlas arrives, then per pixel (J4.2, pixelSun). Plain WebGL, no three.js. The shader
// repeats shade(), sunVector(), horizonAt() and pixelSun() of map-light.js.
import { sunVector, AMBIENT, AMBIENT_TINT } from './map-light.js';

const VERTEX = `
attribute vec2 pos;
varying vec2 uv;
void main() {
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

// Mirrors shade() of map-light.js; normals come as (n + 1) / 2 and occlusion as aoMin..aoMax in 0..1.
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
uniform sampler2D horizon;
uniform float useHorizon;
uniform float penumbra;
uniform vec2 sunAzEl;
// size, directions, cols, rows of the atlas; offset and step of the encoding.
uniform vec4 hzShape;
uniform vec2 hzCode;
uniform sampler2D normals;
uniform sampler2D albedo;
uniform sampler2D occlusion;
uniform sampler2D sunGrid;
uniform vec3 light;
uniform vec2 aoRange;
// AMBIENT and AMBIENT_TINT of map-light.js.
uniform vec2 ambient;
uniform vec3 ambientTint;

// Horizon of direction d at uv, bilinear inside its tile (the texture filter does it; clamped to the tile's centres).
float tile(float d) {
  float size = hzShape.x, cols = hzShape.z, rows = hzShape.w;
  vec2 p = clamp(uv * size, vec2(0.5), vec2(size - 0.5));
  vec2 origin = vec2(mod(d, cols), floor(d / cols)) * size;
  return hzCode.x + texture2D(horizon, (origin + p) / vec2(cols * size, rows * size)).r * 255.0 * hzCode.y;
}

// pixelSun of map-light.js: SUN_DISC 0.53 and LIT 0.5.
float pixelSun() {
  float dirs = hzShape.y;
  float f = mod(sunAzEl.x, 360.0) / (360.0 / dirs);
  float d0 = mod(floor(f), dirs), d1 = mod(d0 + 1.0, dirs);
  float h = mix(tile(d0), tile(d1), fract(f));
  if (penumbra < 0.5) return sunAzEl.y > h ? 1.0 : 0.0;
  return clamp((sunAzEl.y - h) / 0.53 + 0.5, 0.0, 1.0);
}

void main() {
  vec3 n = normalize(texture2D(normals, uv).rgb * 2.0 - 1.0);
  float ao = mix(aoRange.x, aoRange.y, texture2D(occlusion, uv).r);
  float a = texture2D(albedo, uv).r * ao;
  float sun = useHorizon > 0.5 ? pixelSun() : texture2D(sunGrid, uv).r;
  float lam = max(0.0, dot(n, light));
  float val = pow(1.0 - exp(-1.7 * a * sun * lam * 7.0), 0.85);
  float es = max(0.0, -0.5 * n.y + 0.85 * n.z);
  float amb = (ambient.x + ambient.y * es) * a * ao;
  gl_FragColor = vec4(min(vec3(1.0), val * vec3(0.99, 0.965, 0.92) + amb * ambientTint), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader');
  return sh;
}

function texture(gl, unit, source, format, filter = gl.LINEAR) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  if (source) gl.texImage2D(gl.TEXTURE_2D, 0, format, format, gl.UNSIGNED_BYTE, source);
  return tex;
}

// Context of the map canvas, or null (no WebGL or it fails). Kept apart so the caller can read the renderer.
export function mapContext(canvas) {
  try {
    return canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false }) || null;
  } catch { return null; }
}

/**
 * Relief of the map on `canvas` with its context `gl`. textures: { normals, albedo, ao } (images), aoRange [min, max]
 * and n (side of the sun grid). Returns { draw({ sunAz, sunEl, grid }), resize(width, height), dispose() } or null.
 */
export function createMapGl(canvas, gl, { normals, albedo, ao, aoRange, n }) {
  if (!gl) return null;
  try {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'link');
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    // The PNGs carry data, not colour: no colour-space conversion and no premultiplied alpha.
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const textures = [
      texture(gl, 0, normals, gl.RGB),
      texture(gl, 1, albedo, gl.LUMINANCE),
      texture(gl, 2, ao, gl.LUMINANCE),
      texture(gl, 3, null, gl.LUMINANCE),
    ];
    gl.activeTexture(gl.TEXTURE3);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, n, n, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(n * n));
    const u = (name) => gl.getUniformLocation(program, name);
    gl.uniform1i(u('normals'), 0);
    gl.uniform1i(u('albedo'), 1);
    gl.uniform1i(u('occlusion'), 2);
    gl.uniform1i(u('sunGrid'), 3);
    gl.uniform2f(u('aoRange'), aoRange[0], aoRange[1]);
    gl.uniform2f(u('ambient'), AMBIENT[0], AMBIENT[1]);
    gl.uniform3fv(u('ambientTint'), AMBIENT_TINT);
    const light = u('light');
    gl.uniform1i(u('horizon'), 4);
    gl.uniform1f(u('useHorizon'), 0);
    gl.uniform1f(u('penumbra'), 1);
    const sunAzEl = u('sunAzEl');
    let horizonTex = null;
    return {
      gl,
      program,
      // Horizon atlas (J4.2): an image and its description ({ size, directions, cols, rows, offset, step });
      // penumbra false (low quality, J4.3) makes the Sun all or nothing.
      setHorizon(image, meta, { penumbra = true } = {}) {
        horizonTex = texture(gl, 4, image, gl.LUMINANCE);
        gl.uniform4f(u('hzShape'), meta.size, meta.directions, meta.cols, meta.rows);
        gl.uniform2f(u('hzCode'), meta.offset, meta.step);
        gl.uniform1f(u('penumbra'), penumbra ? 1 : 0);
        gl.uniform1f(u('useHorizon'), 1);
      },
      draw({ sunAz, sunEl, grid }) {
        if (grid) {
          gl.activeTexture(gl.TEXTURE3);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, n, gl.LUMINANCE, gl.UNSIGNED_BYTE, grid);
        }
        gl.uniform3fv(light, sunVector(sunAz, sunEl));
        gl.uniform2f(sunAzEl, sunAz, sunEl);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      resize(width, height) {
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      },
      dispose() {
        for (const t of textures) gl.deleteTexture(t);
        if (horizonTex) gl.deleteTexture(horizonTex);
        gl.deleteBuffer(buf);
        gl.deleteProgram(program);
      },
    };
  } catch {
    return null;
  }
}
