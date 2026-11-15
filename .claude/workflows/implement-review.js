export const meta = {
  name: 'implement-review',
  description: 'Un implementador y un revisor en local, con validación de que el entorno local sigue funcionando',
  whenToUse: 'Para implementar una historia o issue en la copia local (sin worktree) con revisión y validación de tests y servidores. args: { task: "…", maxRounds?: 3 }',
  phases: [
    { title: 'Línea base', detail: 'tests y servidores antes de tocar nada' },
    { title: 'Implementar', detail: 'un único implementador en la copia local' },
    { title: 'Revisar', detail: 'un revisor lee el diff' },
    { title: 'Validar local', detail: 'tests y arranque de servidores frente a la línea base' },
  ],
}

// ---- Entrada ----
const input = typeof args === 'string' ? { task: args } : (args || {})
const TASK = input.task
if (!TASK) throw new Error('Falta args.task: describe la historia o issue a implementar')
const MAX_ROUNDS = input.maxRounds || 3

// ---- Esquemas ----
const CHECK = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'p. ej. "npm test (data)", "sitio /web/", "API data /docs"' },
    ok: { type: 'boolean' },
    detail: { type: 'string', description: 'salida relevante si falla (nombres de tests, código HTTP, error)' },
  },
  required: ['name', 'ok', 'detail'],
}
const LOCAL_STATUS = {
  type: 'object',
  properties: {
    checks: { type: 'array', items: CHECK },
    allOk: { type: 'boolean' },
  },
  required: ['checks', 'allOk'],
}
const IMPL = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'qué se ha cambiado y por qué, en español' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    blocked: { type: 'boolean', description: 'true si no se puede completar sin una decisión humana' },
    blockedReason: { type: 'string' },
  },
  required: ['summary', 'filesChanged', 'blocked'],
}
const REVIEW = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['bloqueante', 'menor'] },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'severity', 'problem', 'fix'],
      },
    },
  },
  required: ['approved', 'issues'],
}

// ---- Validación local (se usa para la línea base y tras cada ronda) ----
const LOCAL_CHECK_PROMPT = `Comprueba que el entorno local del repo funciona. NO edites ningún fichero, NO hagas commit, NO hagas stash ni checkout.

Ejecuta, desde la raíz del repo:
1. \`npm test --prefix data\` y \`npm test --prefix planner\` (un check por cada uno; si faltan node_modules en data/, ejecuta antes \`npm install --prefix data\`).
2. Sitio estático: arranca \`PORT=4599 node serve.mjs\` en segundo plano, espera a que escuche y comprueba con curl que /home/, /web/ y /prototipo/ devuelven 200 (un check por ruta). Para también cualquier carpeta montada que aparezca en MOUNTS de serve.mjs.
3. API de data: arranca \`PORT=3199 npm start --prefix data\` en segundo plano y comprueba que /docs devuelve 200.
4. Mata SIEMPRE los procesos que hayas arrancado (los puertos 4599 y 3199 tienen que quedar libres). No toques procesos en otros puertos: pueden ser los del usuario.

Devuelve un check por comprobación, con la salida relevante en detail cuando falle (nombres de los tests que fallan, código HTTP, error de arranque).`

const failing = s => (s?.checks || []).filter(c => !c.ok)
const names = s => new Set(failing(s).map(c => c.name))

// ---- Línea base ----
phase('Línea base')
const baseline = await agent(LOCAL_CHECK_PROMPT, { label: 'línea base', phase: 'Línea base', schema: LOCAL_STATUS, effort: 'low' })
const baselineFailing = names(baseline)
if (baselineFailing.size) log(`Ya fallaban antes de empezar: ${[...baselineFailing].join(', ')}. No se culpará al cambio por ellos.`)

// ---- Bucle implementar → revisar → validar ----
let impl = null, review = null, local = null, feedback = ''
let round = 0
for (round = 1; round <= MAX_ROUNDS; round++) {
  phase('Implementar')
  impl = await agent(
    `${round === 1 ? 'Implementa' : 'Corrige tu implementación de'} esta tarea en la copia local del repo (directorio de trabajo actual, rama actual):

<tarea>
${TASK}
</tarea>

Reglas:
- Si la tarea cita una historia, lee su PRD en el repo de discovery si está clonado al lado (solo lectura).
- No edites prototipo/. Interfaz en web/. Código en inglés; textos de usuario y docs en español con tildes.
- Cambio mínimo y enfocado: nada fuera del alcance de la tarea.
- NO hagas commit, stash, reset, checkout ni push: en main un commit dispara la release automática. Deja los cambios sin commitear.
- Ejecuta los tests de la carpeta que toques antes de terminar.
${feedback ? `\nEsto es lo que falló en la ronda anterior; arréglalo:\n${feedback}` : ''}`,
    { label: `implementador · ronda ${round}`, phase: 'Implementar', schema: IMPL },
  )
  if (!impl || impl.blocked) {
    log(`El implementador se ha bloqueado: ${impl?.blockedReason || 'sin respuesta'}`)
    break
  }

  phase('Revisar')
  review = await agent(
    `Revisa los cambios sin commitear de la copia local (\`git status\` y \`git diff\`, incluidos ficheros nuevos sin seguimiento) frente a esta tarea:

<tarea>
${TASK}
</tarea>

Resumen del implementador: ${impl.summary}

Busca: bugs de corrección, criterios de aceptación de la historia que no se cumplan, cambios fuera de alcance, ediciones en prototipo/, incumplimientos de las reglas de idioma de CLAUDE.md, y cualquier cosa que pueda romper el arranque local (MOUNTS en serve.mjs, rutas relativas, dependencias nuevas sin declarar).
NO edites ficheros. Marca como "bloqueante" solo lo que de verdad impide aceptar el cambio. approved=true si no hay bloqueantes.`,
    { label: `revisor · ronda ${round}`, phase: 'Revisar', schema: REVIEW },
  )

  phase('Validar local')
  local = await agent(LOCAL_CHECK_PROMPT, { label: `validar local · ronda ${round}`, phase: 'Validar local', schema: LOCAL_STATUS, effort: 'low' })

  const regressions = failing(local).filter(c => !baselineFailing.has(c.name))
  const blockers = (review?.issues || []).filter(i => i.severity === 'bloqueante')
  log(`Ronda ${round}: ${blockers.length} bloqueantes de revisión, ${regressions.length} regresiones locales`)

  if (review?.approved && !blockers.length && !regressions.length) break

  feedback = [
    ...blockers.map(i => `- [revisión] ${i.file}${i.line ? ':' + i.line : ''}: ${i.problem} → ${i.fix}`),
    ...regressions.map(c => `- [local roto] ${c.name}: ${c.detail}`),
  ].join('\n')
}

const regressions = failing(local).filter(c => !baselineFailing.has(c.name))
return {
  ok: Boolean(impl && !impl.blocked && review?.approved && !regressions.length),
  rounds: Math.min(round, MAX_ROUNDS),
  implementation: impl,
  review,
  localRegressions: regressions,
  preexistingFailures: [...baselineFailing],
  note: 'Los cambios quedan sin commitear en la copia local para que los revises antes de hacer commit.',
}
