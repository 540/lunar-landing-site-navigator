#!/usr/bin/env node
// One measurement of the home page render: node tools/render-bench/bench.mjs [options] (README.md).
// Prints one JSON line on stdout; exit code 1 if the measurement is not valid, 2 if it cannot run.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { QUALITY_STORAGE_KEY, buildResult, parseArgs, qualityQuery } from './lib.mjs';
import { chromePath, launch } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const LOCK = path.join(HERE, '.lock');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Lock: one measurement at a time, they share the GPU ----------
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
let haveLock = false;
async function acquireLock() {
  let warned = false;
  for (;;) {
    try {
      fs.mkdirSync(LOCK); // atomic on Linux and macOS
      haveLock = true;
      fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid));
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // A lock left by a process that no longer exists (killed with -9) is removed
      let pid = NaN;
      try { pid = Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')); } catch { /* being created */ }
      if (Number.isInteger(pid) && pid > 0 && !pidAlive(pid)) { releaseLock(true); continue; }
      if (!warned) { process.stderr.write('Hay otra medición en marcha; espero a que acabe…\n'); warned = true; }
      await sleep(500);
    }
  }
}
function releaseLock(force = false) {
  if (!haveLock && !force) return;
  try { fs.rmSync(LOCK, { recursive: true, force: true }); } catch { /* gone */ }
  haveLock = false;
}

// ---------- Static server of the repo root ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
function serveRoot() {
  const server = http.createServer((req, res) => {
    let route;
    try { route = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
    const file = path.join(ROOT, route.endsWith('/') ? route + 'index.html' : route);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// GPU memory in use (MiB) from nvidia-smi, or null without an NVIDIA card
function gpuMemMiB() {
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    const n = Number(out.trim().split('\n')[0]);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

async function waitFor(chrome, expression, timeoutMs, what) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await chrome.evaluate(expression).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`Tiempo agotado esperando ${what}`);
}

async function measure(opts) {
  let server = null, chrome = null;
  const out = { opts };
  try {
    let base = opts.url;
    if (!base) { server = await serveRoot(); base = `http://127.0.0.1:${server.address().port}`; }
    const memBefore = gpuMemMiB();
    const { w, h, dpr, gpu, cpu } = opts.dev;
    chrome = await launch({ gpu, extraFlags: [`--window-size=${w},${h}`] });
    await chrome.send('Page.enable');
    await chrome.send('Runtime.enable');
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
    if (!opts.motion) await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    if (cpu > 1) await chrome.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    // --fresh: no stored quality level, so the page calibrates (the profile is a new temporary one anyway)
    if (opts.fresh) await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.removeItem(${JSON.stringify(QUALITY_STORAGE_KEY)}); } catch {}` });
    await chrome.send('Page.navigate', { url: `${base.replace(/\/$/, '')}/home/?${qualityQuery(opts.q, opts.level)}` });

    await waitFor(chrome, '!!(window.__bench && __bench.readyAt !== null && __bench.colorReady())', 90000, 'a que cargue la portada');
    if (opts.zone === 'explore') {
      // «Explorar la Luna» opens from the menu once the zones are loaded: retried until it starts
      await waitFor(chrome, '!__bench.animating()', 30000, 'a que pare la cámara');
      await waitFor(chrome, '__bench.explore()', 30000, 'a que se abra «Explorar la Luna»');
      await waitFor(chrome, '__bench.mode() === "explore" && !__bench.animating()', 60000, 'a llegar a «Explorar la Luna»');
    } else if (opts.zone !== 'menu') {
      await chrome.evaluate(`window.__go(${JSON.stringify(opts.zone)})`);
      await waitFor(chrome, '__bench.mode() === "zone" && !__bench.animating()', 60000, `a llegar a la zona ${opts.zone}`);
    } else await waitFor(chrome, '!__bench.animating()', 30000, 'a que pare la cámara');
    await sleep(500); // let the first frames after the move (shader compiles, uploads) pass

    const from = await chrome.evaluate(`__bench.sync = ${opts.sync}, __bench.frames.length`);
    await sleep(opts.secs * 1000);
    out.frames = await chrome.evaluate(`(__bench.sync = false, __bench.frames.slice(${from}))`);
    out.page = await chrome.evaluate('({ lost: __bench.lost, readyAt: __bench.readyAt, colorAt: __bench.colorAt, tex: __bench.tex, quality: __bench.quality, gpu: __bench.gpu(), info: __bench.info() })');
    const heap = await chrome.send('Runtime.getHeapUsage').catch(() => null);
    out.heapMB = heap ? heap.usedSize / 1048576 : null;
    const memAfter = gpuMemMiB();
    out.gpuMemDeltaMiB = memBefore !== null && memAfter !== null ? memAfter - memBefore : null;
    if (opts.shot) {
      const url = await chrome.evaluate('__bench.shot()');
      fs.writeFileSync(opts.shot, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      out.shot = opts.shot;
    }
    // --lose: once everything is measured, the context is lost on purpose and the page should show #glost (#144)
    if (opts.lose) {
      await chrome.evaluate('__bench.loseContext()');
      await sleep(500);
      out.lostNotice = await chrome.evaluate('__bench.lostNotice()');
    }
  } catch (err) {
    out.error = err.message;
  } finally {
    chrome?.close();
    server?.close();
  }
  return buildResult(out);
}

let opts;
try { opts = parseArgs(process.argv.slice(2)); } catch (err) {
  process.stderr.write(`${err.message}\nOpciones en tools/render-bench/README.md\n`);
  process.exit(2);
}
if (!chromePath()) {
  process.stderr.write('No encuentro Chrome. Instala Google Chrome o Chromium, o indica el ejecutable con la variable CHROME.\n');
  process.exit(2);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { releaseLock(); process.exit(130); });
process.on('exit', () => releaseLock());
await acquireLock();
const { result, exitCode } = await measure(opts);
process.stdout.write(JSON.stringify(result) + '\n');
process.exit(exitCode);
