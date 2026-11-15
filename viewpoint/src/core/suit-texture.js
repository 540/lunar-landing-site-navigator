// A clean astronaut suit (E3, #181): the colour texture of NASA's Z-2 model shows a worn test suit, with dark grime and
// near-black gloves. This turns it into a suit as seen on an EVA: white outer fabric (with its weave and seams, only
// lighter), gloves of light grey fabric, and the red EVA stripes and the blue bands kept as they are. The NASA insignia,
// the flag and the mission patch of NASA's atlas are already painted over in the asset (pipeline/suit-branding.mjs). Pure:
// it works on the RGBA bytes of an ImageData.
//
// What is a colour and what is grime is told by the chroma (the spread between the strongest and the weakest channel),
// not by the saturation of HSL: a dark brown stain has a high HSL saturation, as high as a stripe, and was kept, leaving
// grey blotches with hard edges on the knees and the gloves. And every rule fades in over a band instead of a threshold,
// so a stain that crosses it leaves no edge.

/** Chroma (0..1) above which a pixel is a colour of the suit (the stripes ≈ 0.6) and is kept; grime stays under 0.2. */
export const KEEP_CHROMA = { from: 0.2, to: 0.32 };
/**
 * Grime is brown to olive (hue 12°–70°). Any other hue with this much chroma is a colour of the suit, however dark: the shaded
 * navy of the blue bands (chroma ≈ 0.15) whitened into specks with the threshold of the browns.
 */
export const GRIME_HUE = { from: 12, to: 70 };
export const KEEP_CHROMA_COLOUR = { from: 0.06, to: 0.12 };

function hueOf(r, g, b, max, min) {
  const c = max - min;
  if (c === 0) return 0;
  const h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return (h * 60 + 360) % 360;
}
/** Fabric goes towards this lightness, keeping some of its own variation (the weave, the seams). */
export const FABRIC_WHITE = 0.9;
export const CLEAN = 0.9;
/** Very dark pixels are the bearings and the rubber of the joints: they become a dark metal grey, not black. */
export const DARK = { from: 0.04, to: 0.17 };
export const DARK_TO = 0.26;

const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Cleans the pixels in place.
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {Uint8Array} [dark] one byte per pixel, 1 on the dark parts (core/suit-maps.js darkParts). With it, a pixel is a
 *   bearing or cloth by the piece it lies on, so the darkest stains on the cloth are cleaned too; without it, by its own
 *   lightness.
 */
export function cleanSuitPixels(rgba, dark = null) {
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] / 255, g = rgba[i + 1] / 255, b = rgba[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    // red stripes, blue bands: kept (a dark pixel is never a colour, however it is tinted)
    const brown = hueOf(r, g, b, max, min), grime = brown >= GRIME_HUE.from && brown <= GRIME_HUE.to;
    const band = grime ? KEEP_CHROMA : KEEP_CHROMA_COLOUR;
    const keep = smooth(band.from, band.to, max - min) * (grime ? smooth(0.08, 0.14, l) : 1);
    if (keep >= 1) continue;
    const metal = dark ? dark[i / 4] : 1 - smooth(DARK.from, DARK.to, l); // bearings: dark metal grey
    const target = (l + (FABRIC_WHITE - l) * CLEAN) * (1 - metal) + (DARK_TO + l) * metal; // fabric and gloves: clean, light
    // Neutral: the suit is white, not beige; a trace of warmth so it is not paper.
    const clean = [target, target * 0.995, target * 0.975];
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(Math.min(1, clean[c] * (1 - keep) + [r, g, b][c] * keep) * 255);
  }
  return rgba;
}
