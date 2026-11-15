// Copies the catalogue horizon mask of a region (backend/terrain/masks/<id>.json) to viewpoint/data/<id>/mask.json, for the
// horizon ring of the exploration (E1.1, #122). It is a copy, not a resampling: the same 720 elevations the engine used to
// compute the visibleFraction of series-2027.json, with its provenance (`source`, `demVersion`).
// Usage: node pipeline/horizon-mask.mjs [--site <id>]   (without --site: every region that has a catalogue mask)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Regions of the exploration with a series and a catalogue mask (viewpoint/src/core/regions.js). */
export const MASK_SITE_IDS = ['shackleton-rim', 'im2-objetivo'];
export const sourceFileFor = (siteId) => new URL(`../backend/terrain/masks/${siteId}.json`, import.meta.url);
export const outFileFor = (siteId) => new URL(`../viewpoint/data/${siteId}/mask.json`, import.meta.url);

/** The fields the client needs, in a fixed order so the file is deterministic. */
export function buildMask(catalogMask) {
  const { id, lat, lon, observerHeightM, stepDeg, el, source, demVersion } = catalogMask;
  if (!Array.isArray(el) || el.length * stepDeg !== 360) throw new Error(`La máscara de ${id} no cubre 360° (${el?.length} × ${stepDeg}°)`);
  return { version: 1, siteId: id, lat, lon, observerHeightM, stepDeg, source, demVersion, el };
}

export const serialize = (doc) => JSON.stringify(doc) + '\n';

export function writeMask(siteId) {
  const src = sourceFileFor(siteId);
  if (!existsSync(src)) throw new Error(`No hay máscara de ${siteId} en backend/terrain/masks/`);
  const doc = buildMask(JSON.parse(readFileSync(src, 'utf8')));
  writeFileSync(outFileFor(siteId), serialize(doc));
  return doc;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.length && (argv[0] !== '--site' || argv.length !== 2)) throw new Error('Uso: node pipeline/horizon-mask.mjs [--site <id>]');
  for (const id of argv.length ? [argv[1]] : MASK_SITE_IDS) {
    const doc = writeMask(id);
    console.log(`Máscara de ${id} (${doc.el.length} azimuts, ${doc.demVersion}) escrita en viewpoint/data/${id}/mask.json`);
  }
}
