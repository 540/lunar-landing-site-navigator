#!/usr/bin/env node
// Static server for the whole site: node serve.mjs → http://localhost:4540
// URLs mirror the repo folders (/home/, /web/, /viewpoint/, /rolegame/, /lander/, /prototipo/), so relative links between them
// work the same here and on any static host. PORT=… changes the port; ENTRY=… the folder "/" opens.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { latestVersion, formatVersion } from './tools/version/lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4540;
const MOUNTS = ['home', 'web', 'viewpoint', 'prototipo', 'planner', 'rolegame', 'lander', 'shared']; // planner/: the domain web/ imports (docs/adr/0001); shared/: code the screens share (shared/README.md)
// Old URLs of the screens renamed in #126 → their folder now. Keep in sync with the redirects of pages.yml.
const RENAMED = { tour: 'viewpoint', juego: 'rolegame' };
const ENTRY = ['home', 'web', 'viewpoint', 'rolegame', 'lander', 'prototipo'].includes(process.env.ENTRY) ? process.env.ENTRY : 'home';
const TEXT = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/markdown' };
const BINARY = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.m4a': 'audio/mp4' };

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return TEXT[ext] ? TEXT[ext] + '; charset=utf-8' : BINARY[ext] || 'application/octet-stream';
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let route;
  try { route = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  const redirect = to => { res.writeHead(302, { Location: to + url.search }); res.end(); };
  if (route === '/') return redirect(`/${ENTRY}/`);
  // The version badge (shared/version/badge.js): in Pages the build writes this file; here, the last version tag plus "-dev"
  if (route === '/version.json') {
    return execFile('git', ['tag', '--merged', 'HEAD', '--list', 'v*'], { cwd: ROOT }, (err, out) => {
      const latest = err ? null : latestVersion(out.split('\n'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ version: `${latest ? formatVersion(latest) : '0.0.0'}-dev` }));
    });
  }

  const mount = route.split('/')[1];
  if (Object.hasOwn(RENAMED, mount)) return redirect(`/${RENAMED[mount]}${route.slice(mount.length + 1) || '/'}`);
  if (!MOUNTS.includes(mount)) { res.writeHead(404); return res.end('Not found'); }
  if (route === '/' + mount) return redirect(route + '/');

  const base = path.join(ROOT, mount);
  const file = path.join(ROOT, route.endsWith('/') ? route + 'index.html' : route);
  if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  const at = `http://localhost:${PORT}`;
  console.log(`Sitio en ${at}  (abre /${ENTRY}/)\n  Portada:      ${at}/home/\n  Planificador: ${at}/web/  ·  modo explicación: ${at}/web/?debug=1\n  Mirador:      ${at}/viewpoint/\n  Juego de rol: ${at}/rolegame/\n  Aterrizaje:   ${at}/lander/\n  Prototipo:    ${at}/prototipo/  (referencia)`);
});
