// Material of the relief (#393): the regolith look of core/surface-detail.js on a three.js Lambert material. The Sun, the
// fills and the shadow map light it as before; this only adds the illustrative grain and small craters to the shading, and
// a shoulder before the tone mapping of the renderer, so the slopes that face the Sun keep their detail.
import * as THREE from 'three';
import { detailStrength, surfaceGlsl } from './core/surface-detail.js';
import { REGOLITH } from '../../shared/render/lighting.js';

// The regolith of every scene (shared/render/lighting.js, #339), the same as the cabin's and the 3D sky's.
export const TERRAIN_COLOR = REGOLITH;

/**
 * Plugs the GLSL of surfaceGlsl() into a three.js shader that has vNormal and vViewPosition (Lambert, Standard): the
 * game's cabin uses it on its own ground materials (#393). `uniforms`: uSurfCell, uSurfPixel, uSurfDetail and uSurfSun.
 */
export function plugSurface(shader, glsl, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${glsl.vertexPars}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${glsl.vertexMain}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${glsl.fragmentPars}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${glsl.fragmentColor}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${glsl.fragmentNormal}`)
    .replace('#include <tonemapping_fragment>', `${glsl.fragmentTone}\n#include <tonemapping_fragment>`);
}

/**
 * @param {{level?: string, extend?: (shader: object, cellKm: number) => void, cacheKey?: string, cell?: string}} options quality level
 *   (shared/render/quality.js): in «bajo», one crater per cell instead of two. `extend` (the game's cabin, #403): more
 *   changes to the shader after the regolith, so another screen draws the very same ground with its own light on it;
 *   `cacheKey` names that variant for three.js's program cache. `cell` (the 3D sky of web/): a GLSL expression of the grid step
 *   under each pixel instead of the one of the mesh (surfaceGlsl), with its uniforms added by `extend`. The Mirador passes none.
 * @returns {{material: (cellKm: number) => THREE.Material, track: (mesh: THREE.Mesh) => void, setSun: (direction: {x:number, y:number, z:number}) => void, setFoot: (on: boolean) => void, setMicro: (on: boolean) => void, micro: boolean}}
 *   `material(cellKm)`: a material for a mesh whose grid step is `cellKm`; `track(mesh)`: keeps the size of a pixel up to
 *   date with the camera that draws the mesh; `setSun(d)`: where the Sun is (unit vector of the scene), which the detail follows;
 *   `setFoot(on)` and `setMicro(on)`: on foot, «Textura fina» switches the illustrative detail (`micro`: whether it is on)
 */
export function createTerrainLook({ level = 'alto', extend = null, cacheKey = '', cell } = {}) {
  const craterPasses = level === 'bajo' ? 1 : 2;
  const glsl = surfaceGlsl({ craterPasses, cell });
  const pixel = { value: 0.001 }, detail = { value: 1 }, sun = { value: new THREE.Vector3(0, 1, 0) };
  const size = new THREE.Vector2();

  function material(cellKm) {
    const m = new THREE.MeshLambertMaterial({ color: TERRAIN_COLOR });
    m.onBeforeCompile = (shader) => {
      plugSurface(shader, glsl, { uSurfCell: { value: cellKm }, uSurfPixel: pixel, uSurfDetail: detail, uSurfSun: sun });
      extend?.(shader, cellKm);
    };
    m.customProgramCacheKey = () => `mirador-surface-${craterPasses}${cacheKey}`;
    return m;
  }

  function track(mesh) {
    mesh.onBeforeRender = (renderer, scene, camera) => {
      // projectionMatrix[5] is 1 / tan(fov / 2): the angle of one pixel of the drawing buffer
      pixel.value = 2 / (camera.projectionMatrix.elements[5] * renderer.getDrawingBufferSize(size).y);
    };
  }

  const state = { foot: false, micro: true };
  const apply = () => { detail.value = detailStrength(state); };
  return {
    material, track,
    setSun(d) { sun.value.set(d.x, d.y, d.z).normalize(); },
    setFoot(on) { state.foot = !!on; apply(); },
    setMicro(on) { state.micro = !!on; apply(); },
    get micro() { return state.micro; },
  };
}
