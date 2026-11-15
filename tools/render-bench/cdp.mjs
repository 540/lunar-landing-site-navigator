// Headless Chrome driven over the DevTools protocol with Node's own WebSocket and fetch (no npm dependencies).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromeFlags, findChrome } from './lib.mjs';

// Absolute path of an executable (a path or a name in PATH), or null.
function resolveExecutable(name) {
  if (name.includes('/')) return fs.existsSync(name) ? name : null;
  try { return execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

export function chromePath() {
  return findChrome(process.env, resolveExecutable);
}

// Launches Chrome and connects to its first page. Returns { send, on, evaluate, close }.
export async function launch({ gpu = 'hw', extraFlags = [], timeoutMs = 30000 } = {}) {
  const exe = chromePath();
  if (!exe) {
    const err = new Error('No encuentro Chrome. Instala Google Chrome o Chromium, o indica el ejecutable con la variable CHROME.');
    err.code = 'NO_CHROME';
    throw err;
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-bench-'));
  const proc = spawn(exe, [...chromeFlags(gpu, userDataDir), ...extraFlags, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  process.once('exit', cleanup); // also when the bench exits on a signal

  try {
    const port = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('Chrome no ha abierto el puerto de DevTools a tiempo')), timeoutMs);
      proc.stderr.on('data', d => {
        buf += d;
        const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(buf);
        if (m) { clearTimeout(timer); resolve(Number(m[1])); }
      });
      proc.on('exit', code => { clearTimeout(timer); reject(new Error(`Chrome ha salido al arrancar (código ${code})`)); });
    });
    let page;
    for (let i = 0; i < 50 && !page; i++) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find(t => t.type === 'page');
      if (!page) await new Promise(r => setTimeout(r, 100));
    }
    if (!page) throw new Error('Chrome no ha abierto ninguna página');
    const client = await connect(page.webSocketDebuggerUrl);
    return { ...client, close: () => { client.close(); cleanup(); } };
  } catch (err) {
    cleanup();
    throw err;
  }
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('No puedo conectar con DevTools')); });
  let nextId = 1;
  const pending = new Map(), listeners = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result);
    } else if (msg.method) for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
  };
  ws.onclose = () => { for (const { reject } of pending.values()) reject(new Error('DevTools cerrado')); pending.clear(); };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); };
  // Evaluates an expression in the page and returns its value (awaiting promises).
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, on, evaluate, close: () => { try { ws.close(); } catch { /* closed */ } } };
}
