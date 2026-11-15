// Human view of the validation matrix (`npm run validate -- --view`): the rows of matrix.ts with every point, as JSON
// (validation/out/validation-points.json, written by every run) and as one self-contained HTML page
// (validation/out/validation-view.html) drawn by view-page.js and view-page.css, inlined. Nothing here computes: the
// statistics are the ones of VALIDATION.md, formatted by the same function.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { llToXY } from '../src/terrain/dem.ts';
import { formatNumber, limitsText } from './matrix.ts';
import type { RowResult } from './matrix.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Where the view is written (ignored by git). */
export const OUT_DIR = path.join(HERE, 'out');
export const POINTS_FILE = 'validation-points.json';
export const HTML_FILE = 'validation-view.html';

/** Points south of this latitude get south-polar stereographic coordinates (the map of the page). */
const POLAR_LAT = -60;
/** Latitude circles the map may draw, with their radius in the projection of the DEM. */
const GRATICULE = [-60, -65, -70, -75, -80, -82.5, -85, -87, -88, -89, -89.5];

export interface ViewMeta {
  /** When the measurement ran (ISO). */
  generatedAt: string;
  demVersion: string | null;
  /** Short git commit of the measured code, with «+cambios» if the working tree had changes. */
  commit: string | null;
  seconds: number | null;
  workers: number | null;
}

/** One point: id, lat, lon, ours, ref, d, tol, ok, x, y (km, south-polar stereographic; null north of 60°S). */
export type ViewPoint = [string, number | null, number | null, number | null, number | null, number | null, number | null, boolean, number | null, number | null];

export interface ViewRow {
  /** Text and reference of the row in Markdown, as VALIDATION.md (renderHtml turns them into HTML). */
  section: string; what: string; source: string;
  unit: string; digits: number; tolText: string; limits: string;
  known: number | null; informative: boolean;
  status: RowResult['status']; note: string; signed: boolean; check: boolean;
  /** Statistics formatted as in VALIDATION.md (— when they do not apply). */
  stats: { n: string; bias: string; mae: string; rms: string; pctRef: string; max: string; within: string };
  points: ViewPoint[];
}

export interface ViewData { meta: ViewMeta; graticule: { lat: number; rKm: number }[]; rows: ViewRow[] }

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The little Markdown of the row sources: links and code. */
export function markdownInline(md: string): string {
  return escapeHtml(md)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, url: string) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

const round = (x: number | null, digits = 6): number | null => (x === null ? null : Number(x.toPrecision(digits)));

export function toViewData(rows: readonly RowResult[], meta: ViewMeta): ViewData {
  return {
    meta,
    graticule: GRATICULE.map((lat) => ({ lat, rKm: llToXY(lat, 0)[1] / 1000 })),
    rows: rows.map((r): ViewRow => {
      const d = r.spec.digits, v = (x: number | null, digits = d): string => (x === null ? '—' : formatNumber(x, digits));
      return {
        section: r.spec.section, what: r.spec.what, source: r.spec.source,
        unit: r.spec.unit, digits: d, tolText: r.spec.tolText, limits: limitsText(r.spec),
        known: r.spec.known ?? null, informative: r.spec.informative === true,
        status: r.status, note: r.note, signed: r.signed, check: r.points.length > 0 && r.points[0].d === null,
        stats: {
          n: r.n === null ? '—' : String(r.n), bias: v(r.bias), mae: v(r.mae), rms: v(r.rms),
          pctRef: r.pctRef === null ? '—' : `${formatNumber(r.pctRef, 1)} %`, max: v(r.max), within: r.within === null ? '—' : `${formatNumber(r.within, 1)} %`,
        },
        points: r.points.map((p): ViewPoint => {
          const [x, y] = p.lat !== null && p.lon !== null && p.lat < POLAR_LAT ? llToXY(p.lat, p.lon).map((m) => m / 1000) : [null, null];
          return [p.id, p.lat, p.lon, round(p.ours), round(p.ref), round(p.d), round(p.tol), p.ok, round(x, 7), round(y, 7)];
        }),
      };
    }),
  };
}

/** The page, with its style, its code and its data inline: it opens from file:// with no network. */
export function renderHtml(data: ViewData): string {
  const css = fs.readFileSync(path.join(HERE, 'view-page.css'), 'utf8');
  const js = fs.readFileSync(path.join(HERE, 'view-page.js'), 'utf8');
  const page = { ...data, rows: data.rows.map((r) => ({ ...r, whatHtml: markdownInline(r.what), sourceHtml: markdownInline(r.source) })) };
  const json = JSON.stringify(page).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Matriz de validación</title>
<style>
${css}</style>
</head>
<body>
<noscript>Esta página necesita JavaScript para dibujar la matriz.</noscript>
<div id="app"></div>
<script type="application/json" id="validation-data">${json}</script>
<script>
${js}</script>
</body>
</html>
`;
}

/** Writes the per-point JSON (every run, so that `--view --cached` can reuse it). */
export function writePoints(data: ViewData, dir = OUT_DIR): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, POINTS_FILE);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

export function readPoints(dir = OUT_DIR): ViewData {
  const file = path.join(dir, POINTS_FILE);
  if (!fs.existsSync(file)) throw new Error(`no hay una medición anterior en ${file}: ejecuta antes \`npm run validate\` (o \`npm run validate -- --view\`)`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ViewData;
}

/** Writes the page and returns its absolute path. */
export function writeHtml(data: ViewData, dir = OUT_DIR): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.resolve(dir, HTML_FILE);
  fs.writeFileSync(file, renderHtml(data));
  return file;
}
