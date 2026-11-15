// Your own suit on foot in the Mirador (E3, #181): prepares NASA's Z-2 spacesuit model for viewpoint/assets/suit-z2.glb.
//
// Source: NASA 3D Resources, "Z2 Spacesuit" (public domain, NASA media guidelines; no endorsement implied):
//   https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Z2%20Spacesuit
// What it does: decodes the Draco geometry (so the browser needs no decoder), keeps only the WebP textures (drops the
// JPEG copies, 15 MB) and the specular map, paints over the NASA branding of the textures (insignia, flag, mission patch
// and the credit of NASA's Advanced Concepts Lab: suit-branding.mjs) and writes a plain glb of about 3.5 MB. The helmet
// is removed and the body rigged in the browser (viewpoint/src/suit-body.js), so the geometry stays as NASA published it.
//
// Usage (the tools are not dependencies of the repo; they are installed only to run this):
//   cd pipeline && npm i --no-save @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 @gltf-transform/functions@4.1.1 draco3dgltf@1.5.7 sharp@0.35.5
//   curl -L -o /tmp/z2.glb "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Z2%20Spacesuit/Z2%20Spacesuit.glb"
//   node suit.mjs /tmp/z2.glb ../viewpoint/assets/suit-z2.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { removeBranding } from './suit-branding.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Uso: node suit.mjs <Z2 Spacesuit.glb> <salida.glb>');
  process.exit(1);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(input);
const root = doc.getRoot();

// No Draco on output: the geometry goes plain.
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_draco_mesh_compression') ext.dispose();
// The material keeps colour and relief; the specular colour is dropped (it barely shows on matte cloth).
for (const material of root.listMaterials()) {
  for (const ext of material.listExtensions()) if (ext.extensionName === 'KHR_materials_specular') material.setExtension(ext.extensionName, null);
}
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_specular') ext.dispose();
// Only the WebP images: the JPEG copies are a fallback for old readers.
for (const texture of root.listTextures()) if (texture.getMimeType() === 'image/jpeg') texture.dispose();
await doc.transform(dedup(), prune());

// No NASA branding on the suit (NASA Space Apps rules): the colour atlas and its relief map are painted over.
for (const texture of root.listTextures()) {
  const kind = /bump/i.test(texture.getName()) ? 'bump' : /color/i.test(texture.getName()) ? 'color' : null;
  if (!kind) continue;
  const { data, info } = await sharp(texture.getImage()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const painted = removeBranding(data, info, kind);
  texture.setImage(new Uint8Array(await sharp(data, { raw: info }).webp({ quality: 80 }).toBuffer()));
  console.log(`${texture.getName()}: sin ${painted.join(', ')}`);
}

await io.write(output, doc);
const kept = root.listTextures().map(t => `${t.getName()} ${t.getMimeType()} ${(t.getImage().byteLength / 1e6).toFixed(2)} MB`);
console.log(`Escrito ${output}: ${kept.join(' · ')}`);
