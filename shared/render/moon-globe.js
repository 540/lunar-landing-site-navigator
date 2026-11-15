// The lunar globe shared by the screens (G1.2, #140): a sphere without its southern cap plus a high-resolution polar
// cap (azimuthal grid, ~2 km between vertices), the Moon material with the per-pixel texture coordinates that avoid
// the pinch at the pole, the pole-smoothed displacement (POLE_DISP), the depth material of the shadows and the
// progressive load of the colour texture (2k, then 4k) with a procedural stand-in if a texture fails.
// Used by the home page (home/index.html) and the 3D Moon of the role-playing game (rolegame/src/moon3d.js, J8.1).
// Needs three.js through the import map of the page (version in shared/render/three-version.js).
import * as THREE from 'three';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/** Textures of the CGI Moon Kit of NASA SVS (LROC colour, LOLA height), next to this module. */
export const MOON_TEX = {
  color2k: new URL('tex/moon-color-2k.jpg', import.meta.url).href,
  color4k: new URL('tex/moon-color-4k.jpg', import.meta.url).href,
  height: new URL('tex/moon-height.jpg', import.meta.url).href,
};

/** Degrees of the southern cap drawn by its own mesh (the sphere stops 2° inside it, so they overlap). */
export const CAP = 16;

/** Relief drawn by the globe: displacementScale over the unit sphere (1737.4 km) for the whole range of moon-height.jpg
 *  (−9.03 to +10.60 km against the 240 m LOLA DEM, 19.6 km), so it is drawn at factor ≈ 0.75 of its real height (#328),
 *  and lower still south of 85° S, where POLE_DISP smooths it. */
export const MOON_RELIEF = Object.freeze({ rangeKm: 19.6, scale: .0085, get factor() { return this.scale * 1737.4 / this.rangeKm; } });

/** Unit vector of a latitude and longitude on the globe (y up, longitude 0 on +x, 90° E on −z). */
export const moonDir = (lat, lon) => new THREE.Vector3(Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.sin(lat * D2R), -Math.cos(lat * D2R) * Math.sin(lon * D2R));

/* Coordenadas de textura calculadas por píxel a partir de la dirección: sin pellizco en el polo.
   The 12-sample ring average only near the pole (pf<1.): elsewhere mix() returns the direct sample anyway */
export const POLE_DISP = `#ifdef USE_DISPLACEMENTMAP
  float pcol=acos(clamp(-normalize(position).y,-1.,1.));float pf=smoothstep(.012,.085,pcol);
  float hh=texture2D(displacementMap,vDisplacementMapUv).x;
  if(pf<1.){float ra=0.;for(int i=0;i<12;i++)ra+=textureLod(displacementMap,vec2(fract(vDisplacementMapUv.x+float(i)/12.),vDisplacementMapUv.y),2.).x;ra/=12.;hh=mix(ra,hh,pf);}
  transformed+=normalize(objectNormal)*(hh*displacementScale+displacementBias);
  #endif`;

/** Grid of the polar cap with N × N quads. */
export function capGeometry(N) {
  const pos = [], nor = [], uv = [], idx = [], C = CAP * D2R;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const px = (i / N * 2 - 1) * C, py = (j / N * 2 - 1) * C, col = Math.hypot(px, py), az = Math.atan2(py, px);
    const lat = -90 + col * R2D, lon = az * R2D, d = moonDir(lat, lon);
    pos.push(d.x, d.y, d.z); nor.push(d.x, d.y, d.z); uv.push(.5 + lon / 360, .5 + lat / 180);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Procedural grey Moon with craters, from a fixed seed: the stand-in when a texture does not load. */
export function moonFallback(seed) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d'); x.fillStyle = '#8a8a86'; x.fillRect(0, 0, 1024, 512);
  let s = seed; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 900; i++) { const R = 2 + r() * r() * 40; const v = r() < .5 ? 40 : 200; x.fillStyle = `rgba(${v},${v},${v},${.05 + r() * .12})`; x.beginPath(); x.arc(r() * 1024, r() * 512, R, 0, 7); x.fill(); }
  return c;
}

/** Plain loader: (url, srgb, seed, cb) → texture; on error, the procedural stand-in of `seed` (if any). */
export function textureLoader(renderer, { anisotropy = 4 } = {}) {
  const loader = new THREE.TextureLoader();
  return (url, srgb, seed, cb) => {
    const t = loader.load(url, () => cb && cb(t), undefined, () => { if (seed) { t.image = moonFallback(seed); t.needsUpdate = true; } cb && cb(t, true); });
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(anisotropy, renderer.capabilities.getMaxAnisotropy());
    return t;
  };
}

/**
 * The globe: { group, material, depthMaterial, height, globe, cap, setCapGrid(N), useColor(texture), dispose() }.
 * group holds the sphere and the cap (both cast and receive shadows) with no rotation of its own.
 *   load        (url, srgb, seed, cb) → texture; by default textureLoader(renderer). The home page passes its own,
 *               which wakes the render loop and tracks anisotropy.
 *   samples     () → samples of the polar average of the colour (fs of the quality level); read when the shader compiles.
 *   capGrid     quads per side of the polar cap (cap of the quality level).
 *   segments    [width, height] segments of the sphere.
 *   onHeight(t, err), onColor(t, err)  when the height and the 2k colour textures are in (or failed).
 * The 4k colour is not asked for here: the caller decides (quality level) and swaps it in with useColor().
 */
export function createMoonGlobe(renderer, { load = textureLoader(renderer), samples = () => 12, capGrid = 320, segments = [256, 128], onHeight, onColor } = {}) {
  const height = load(MOON_TEX.height, false, 5, (t, err) => onHeight && onHeight(t, err));
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, bumpMap: height, bumpScale: 2.6, displacementMap: height, displacementScale: MOON_RELIEF.scale, displacementBias: -MOON_RELIEF.scale / 2 });
  /* The shader text depends on the samples: a level change needs another program, not the cached one */
  material.customProgramCacheKey = () => 'fs' + samples();
  material.onBeforeCompile = sh => {
    const fs = samples();
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDir;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDir=normalize(position);')
      .replace('#include <displacementmap_vertex>', POLE_DISP);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDir;\nvec2 myUv;')
      .replace('#include <common>', '#include <common>\nfloat poleLod;float poleFade;\nvec2 seamD(vec2 d){d.x-=floor(d.x+.5);return d;}')
      /* seamD: the per-pixel longitude wraps at 180°; without it the mip level jumps there and a line shows on the far side */
      .replace('#include <bumpmap_pars_fragment>', THREE.ShaderChunk.bumpmap_pars_fragment.replaceAll('vBumpMapUv', 'myUv').replaceAll('bumpScale *', 'bumpScale*poleFade*')
        .replace('dFdx( myUv )', 'seamD(dFdx( myUv ))').replace('dFdy( myUv )', 'seamD(dFdy( myUv ))').replace(/texture2D\( bumpMap, ([^)]*) \)/g, 'textureGrad( bumpMap, $1, dSTdx, dSTdy )'))
      .replace('#include <map_fragment>', `#ifdef USE_MAP\n vec4 sampledDiffuseColor=textureGrad(map,myUv,seamD(dFdx(myUv)),seamD(dFdy(myUv)));\n if(poleFade<1.){vec4 ra=vec4(0.);for(int i=0;i<${fs};i++)ra+=textureLod(map,vec2(fract(myUv.x+float(i)/${fs}.),myUv.y),3.);sampledDiffuseColor=mix(ra/${fs}.,sampledDiffuseColor,poleFade);}\n diffuseColor*=sampledDiffuseColor;\n#endif`)
      .replace('void main() {', 'void main() {\n float pcol=acos(clamp(-vDir.y,-1.,1.));poleFade=smoothstep(.012,.085,pcol);poleLod=6.*(1.-poleFade);\n myUv=vec2(.5+atan(-vDir.z,vDir.x)/6.2831853,.5+asin(clamp(vDir.y,-1.,1.))/3.14159265);');
  };
  material.map = load(MOON_TEX.color2k, true, 4, (t, err) => onColor && onColor(t, err));

  const group = new THREE.Group();
  /* Esfera global sin el casquete sur… */
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, segments[0], segments[1], 0, Math.PI * 2, 0, Math.PI - (CAP - 2) * D2R), material);
  /* …y un casquete polar de alta resolución */
  const cap = new THREE.Mesh(capGeometry(capGrid), material);
  /* Las sombras usan el mismo relieve suavizado en el polo */
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, displacementMap: height, displacementScale: material.displacementScale, displacementBias: material.displacementBias });
  depthMaterial.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <displacementmap_vertex>', POLE_DISP); };
  [globe, cap].forEach(m => { m.castShadow = true; m.receiveShadow = true; m.customDepthMaterial = depthMaterial; group.add(m); });

  return {
    group, material, depthMaterial, height, globe, cap,
    /** Rebuilds the polar cap with N × N quads, freeing the old grid. */
    setCapGrid(N) { const g = cap.geometry; cap.geometry = capGeometry(N); g.dispose(); },
    /** Puts a colour texture in (the 4k one once it is in) and frees the one it replaces; returns the old one. */
    useColor(texture) { const prev = material.map; material.map = texture; material.needsUpdate = true; prev.dispose(); return prev; },
    dispose() {
      globe.geometry.dispose(); cap.geometry.dispose(); material.map?.dispose(); height.dispose(); material.dispose(); depthMaterial.dispose();
    },
  };
}
