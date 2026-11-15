// The stars of the Mirador's sky (#396): the Yale Bright Star Catalogue (BSC5, 5th revised edition, Hoffleit & Warren
// 1991; public domain, NASA/ADC and Harvard) to viewpoint/assets/stars-bsc5.bin, the 9096 stars with a position to
// magnitude 6.5, J2000.
//
// Usage (the catalogue is not in the repo):
//   curl -L -o /tmp/bsc5.dat.gz http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz && gunzip /tmp/bsc5.dat.gz
//   node pipeline/stars.mjs /tmp/bsc5.dat viewpoint/assets/stars-bsc5.bin
//
// Format: little-endian 16-bit integers, four per star, the brightest first: right ascension in hundredths of a degree
// (unsigned, 0–35999), declination, V magnitude and B−V in hundredths (signed). 0.01° is 36″, far under a pixel.
import fs from 'node:fs';
import { parseBsc5 } from '../viewpoint/src/core/star-sky.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Uso: node pipeline/stars.mjs <bsc5.dat> <salida.bin>');
  process.exit(1);
}
const stars = parseBsc5(fs.readFileSync(input, 'latin1')).sort((a, b) => a[2] - b[2]);
const buf = Buffer.alloc(stars.length * 8);
stars.forEach(([ra, dec, mag, bv], i) => {
  buf.writeUInt16LE(Math.round(ra * 100) % 36000, i * 8);
  buf.writeInt16LE(Math.round(dec * 100), i * 8 + 2);
  buf.writeInt16LE(Math.round(mag * 100), i * 8 + 4);
  buf.writeInt16LE(Math.round(bv * 100), i * 8 + 6);
});
fs.writeFileSync(output, buf);
console.log(`Escrito ${output}: ${stars.length} estrellas, ${(buf.length / 1024).toFixed(1)} KB (magnitud ${stars[0][2]} a ${stars.at(-1)[2]})`);
