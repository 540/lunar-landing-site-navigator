// Semantic versioning of the site (tools/version/): the version each deploy gets, its wiring into the Pages build
// and the badge every screen shows in the bottom left corner (shared/version/badge.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SITE_PATHS, bump, issueRefs, latestVersion, levelFromMessage, levelOf, parseVersion, resolveVersion } from '../tools/version/lib.mjs';
import { gitState } from '../tools/version/next.mjs';
import { aiNoticeText, badgeText } from '../shared/version/badge.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const noLabels = async () => [];
const labels = table => async issue => table[issue] ?? [];

test('parseVersion y latestVersion: solo vX.Y.Z, y gana la mayor por número', () => {
  assert.deepEqual(parseVersion('v1.20.3'), [1, 20, 3]);
  assert.deepEqual(parseVersion('0.2.0'), [0, 2, 0]);
  assert.equal(parseVersion('v1.2'), null);
  assert.equal(parseVersion('v1.2.3-beta'), null);
  assert.deepEqual(latestVersion(['v0.9.0', 'v0.10.0', 'vieja', 'v0.2.11']), [0, 10, 0]);
  assert.equal(latestVersion([]), null);
});

test('bump: patch, minor y major ponen a cero lo que queda a su derecha', () => {
  assert.deepEqual(bump([1, 2, 3], 'patch'), [1, 2, 4]);
  assert.deepEqual(bump([1, 2, 3], 'minor'), [1, 3, 0]);
  assert.deepEqual(bump([1, 2, 3], 'major'), [2, 0, 0]);
});

test('issueRefs: los #N del mensaje, sin repetir y sin confundir entidades HTML', () => {
  assert.deepEqual(issueRefs('#217 #218 Juego de rol (J5), cierra #217'), [217, 218]);
  assert.deepEqual(issueRefs('Merge pull request #204 from 540/fix/x'), [204]);
  assert.deepEqual(issueRefs('color &#39; y abc#12'), []);
});

test('levelFromMessage: marcas explícitas y prefijos convencionales', () => {
  assert.equal(levelFromMessage('#12 Cambio grande [major]'), 'major');
  assert.equal(levelFromMessage('#12 Cambio\n\nBREAKING CHANGE: la URL cambia'), 'major');
  assert.equal(levelFromMessage('feat(api)!: quita la v1'), 'major');
  assert.equal(levelFromMessage('feat: brújula del cielo'), 'minor');
  assert.equal(levelFromMessage('#12 Algo nuevo [minor]'), 'minor');
  assert.equal(levelFromMessage('#12 Planificar: ancho fijo'), null);
  // Only the subject carries the marks: a body that mentions them does not bump
  assert.equal(levelFromMessage('#12 Versión del sitio\n\nSube la mayor con [major] o BREAKING CHANGE, la menor con [minor]'), null);
});

test('levelOf: la etiqueta enhancement de un issue sube la minor; lo demás es patch', async () => {
  const table = labels({ 1: ['bug'], 2: ['enhancement', 'juego'] });
  assert.equal(await levelOf(['#1 Arreglo'], table), 'patch');
  assert.equal(await levelOf(['#1 Arreglo', '#2 Novedad'], table), 'minor');
  assert.equal(await levelOf(['Sin issue'], table), 'patch');
  assert.equal(await levelOf(['#2 Novedad', '#1 Arreglo [major]'], table), 'major');
});

test('levelOf: deja de preguntar etiquetas en cuanto llega a minor', async () => {
  const asked = [];
  await levelOf(['#1 a', '#2 b', '#3 c'], async issue => { asked.push(issue); return issue === 2 ? ['enhancement'] : []; });
  assert.deepEqual(asked, [1, 2]);
});

test('resolveVersion: sube desde la última etiqueta según los cambios del sitio', async () => {
  const base = { tags: ['v0.1.0', 'v0.2.3'], headTags: [], headSubject: '#5 Algo', labelsOf: labels({ 5: ['enhancement'] }) };
  assert.deepEqual(await resolveVersion({ ...base, siteMessages: () => ['#4 Arreglo'] }), { version: '0.2.4', previous: '0.2.3', level: 'patch', create: true });
  assert.deepEqual(await resolveVersion({ ...base, siteMessages: () => ['#5 Algo'] }), { version: '0.3.0', previous: '0.2.3', level: 'minor', create: true });
  assert.deepEqual(await resolveVersion({ ...base, siteMessages: () => ['#5 Algo [major]'] }), { version: '1.0.0', previous: '0.2.3', level: 'major', create: true });
});

test('resolveVersion: sin cambios en el sitio, o con HEAD ya etiquetado, mantiene la versión y no crea etiqueta', async () => {
  const base = { tags: ['v0.2.3'], headTags: [], headSubject: 'Solo documentación', labelsOf: noLabels };
  assert.deepEqual(await resolveVersion({ ...base, siteMessages: () => [] }), { version: '0.2.3', previous: '0.2.3', level: null, create: false });
  const tagged = await resolveVersion({ ...base, headTags: ['v0.2.3'], siteMessages: () => { throw new Error('no debe mirar los commits'); } });
  assert.deepEqual(tagged, { version: '0.2.3', previous: '0.2.3', level: null, create: false });
});

test('resolveVersion: un commit «release: vX.Y.Z» fija su versión y la etiqueta la pone la release', async () => {
  const base = { tags: ['v0.2.3'], headTags: [], siteMessages: () => ['#4 Arreglo'], labelsOf: noLabels };
  assert.deepEqual(await resolveVersion({ ...base, headSubject: 'release: v0.3.0' }), { version: '0.3.0', previous: '0.2.3', level: null, create: false });
  // A release behind the last tag does not send the version backwards
  assert.equal((await resolveVersion({ ...base, headSubject: 'release: v0.2.0' })).version, '0.2.4');
});

test('resolveVersion: sin ninguna etiqueta empieza en 0.1.0', async () => {
  const first = await resolveVersion({ tags: [], headTags: [], headSubject: 'Primer commit', siteMessages: () => ['Primer commit'], labelsOf: noLabels });
  assert.deepEqual(first, { version: '0.1.0', previous: null, level: 'minor', create: true });
});

test('gitState: lee de git las etiquetas y solo los commits que tocan el sitio', async t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'site-version-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  const commit = (file, message) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), message);
    git('add', '.');
    git('commit', '-q', '-m', message);
  };
  git('init', '-q', '-b', 'main');
  commit('home/index.html', 'Portada');
  git('tag', 'v0.9.0');
  git('tag', 'v0.10.0');
  commit('docs/notas.md', 'Solo documentación');

  const before = gitState(repo);
  assert.deepEqual(before.tags.sort(), ['v0.10.0', 'v0.9.0']);
  assert.deepEqual(before.headTags, []);
  assert.deepEqual(await resolveVersion({ ...before, labelsOf: noLabels }), { version: '0.10.0', previous: '0.10.0', level: null, create: false });

  commit('web/index.html', '#7 Planificar: algo nuevo\n\nCon cuerpo');
  commit('backend/src/x.ts', '#8 Solo la API [major]');
  const after = gitState(repo);
  assert.equal(after.headSubject, '#8 Solo la API [major]');
  assert.deepEqual(after.siteMessages('v0.10.0'), ['#7 Planificar: algo nuevo\n\nCon cuerpo']);
  assert.equal((await resolveVersion({ ...after, labelsOf: labels({ 7: ['enhancement'] }) })).version, '0.11.0');

  git('tag', 'v0.11.0');
  assert.equal((await resolveVersion({ ...gitState(repo), labelsOf: noLabels })).create, false);
});

test('aiNoticeText: el aviso de uso de IA nombra a Claude Code, en español salvo en inglés (#96)', () => {
  assert.equal(aiNoticeText('es'), 'Hecho con ayuda de IA · Claude Code');
  assert.equal(aiNoticeText(undefined), 'Hecho con ayuda de IA · Claude Code');
  assert.equal(aiNoticeText('en'), 'Built with AI assistance · Claude Code');
});

test('badgeText: «vX.Y.Z», o nada si version.json no trae una versión', () => {
  assert.equal(badgeText({ version: '0.2.0' }), 'v0.2.0');
  assert.equal(badgeText({ version: '0.2.0-dev' }), 'v0.2.0-dev');
  assert.equal(badgeText({}), null);
  assert.equal(badgeText({ version: '<b>' }), null);
  assert.equal(badgeText(null), null);
});

// ---------- wiring ----------

test('las pantallas del sitio cargan el distintivo de versión', () => {
  for (const screen of ['home', 'web', 'viewpoint', 'rolegame', 'lander']) {
    assert.match(read(`${screen}/index.html`), /<script type="module" src="\.\.\/shared\/version\/badge\.js"><\/script>/, `${screen}/index.html no carga el distintivo`);
  }
});

test('SITE_PATHS son las carpetas que publica pages.yml', () => {
  const yml = read('.github/workflows/pages.yml');
  const copied = yml.match(/cp -R (.*) _site\//)[1].split(/\s+/);
  assert.match(yml, /cp -R planner\/src _site\/planner\//);
  assert.deepEqual([...SITE_PATHS].sort(), [...copied, 'planner/src'].sort());
});

test('pages.yml decide la versión antes de subir el sitio, con todo el historial y permiso para etiquetar', () => {
  const yml = read('.github/workflows/pages.yml');
  const version = yml.indexOf('node tools/version/next.mjs --out _site/version.json');
  assert.ok(version > 0, 'falta el paso de versión');
  assert.ok(version < yml.indexOf('actions/upload-pages-artifact'), 'la versión se decide después de subir el sitio');
  assert.match(yml, /fetch-depth: 0/);
  assert.match(yml, /contents: write/);
});

test('serve.mjs responde /version.json en local', () => {
  assert.match(read('serve.mjs'), /route === '\/version\.json'/);
});
