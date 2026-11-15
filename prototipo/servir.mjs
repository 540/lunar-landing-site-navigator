#!/usr/bin/env node
// Servidor estático mínimo del prototipo: node prototipo/servir.mjs → http://localhost:4541
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PUERTO) || 4541;
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const fichero = path.join(DIR, ruta === '/' ? 'index.html' : ruta);
  if (!fichero.startsWith(DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(fichero, (err, datos) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': (TIPOS[path.extname(fichero)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(datos);
  });
}).listen(PUERTO, '127.0.0.1', () => console.log(`Prototipo en http://localhost:${PUERTO}  ·  modo explicación: http://localhost:${PUERTO}/?debug=1`));
