export const meta = {
  name: 'release',
  description: 'Prepara una release del código y, con publicar: true, la publica: recoge lo entregado desde la última etiqueta, lo une con las historias e iniciativas del repo de discovery, verifica tests y criterios de aceptación, decide la versión en código y escribe las notas',
  whenToUse: 'Lo lanza release/release.sh. args = { hoy: "AAAA-MM-DD", discovery: "/ruta/al/repo/de/discovery" o "", publicar?: boolean, version?: "0.2.0", forzar?: boolean }. Sin publicar no escribe nada: devuelve el plan.',
  phases: [
    { title: 'Recoger', detail: 'commits, PR e issues desde la última etiqueta, unidos con discovery' },
    { title: 'Verificar', detail: 'tests y criterios de aceptación de cada historia entregada' },
    { title: 'Notas', detail: 'release notes en español y resumen para la demo' },
    { title: 'Publicar', detail: 'CHANGELOG, iniciativas a midiendo, etiqueta, push y release de GitHub' },
  ],
}

const A = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : args || {}
const HOY = A.hoy || ''
const PUBLICAR = A.publicar === true
const FORZAR = A.forzar === true
const MAX_HISTORIAS = 8
const DISCOVERY = A.discovery || ''

const COMUN = [
  'Trabajas en el repo de código de 540 para NASA Space Apps 2026 (Lunar Landing Site Navigator). El discovery (embudo e iniciativas con su PRD) vive en otro repo' + (DISCOVERY ? ', clonado en ' + DISCOVERY + '.' : ', que no está disponible en esta máquina: trabaja sin iniciativas.'),
  DISCOVERY ? 'Las iniciativas viven en ' + DISCOVERY + '/iniciativas/<slug>/prd.md; sus historias de usuario, con criterios de aceptación y, si existe, el issue de GitHub, están en la sección «8. Historias».' : '',
  'No inventes: si un dato no está en git, en GitHub o en el repo, déjalo vacío. Escribe en español, con tildes.',
].join('\n')

const TIPOS = ['nueva', 'mejora', 'arreglo', 'interno', 'rompe']

const SCHEMA_RECOGER = {
  type: 'object', additionalProperties: false,
  required: ['etiqueta_anterior', 'cambios', 'iniciativas', 'comandos_verificacion'],
  properties: {
    etiqueta_anterior: { type: 'string', description: 'La última etiqueta vX.Y.Z, o vacío si no hay ninguna' },
    cambios: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['ref', 'titulo', 'tipo', 'es_producto', 'issues', 'iniciativa', 'historia'],
        properties: {
          ref: { type: 'string', description: '#número del PR o hash corto del commit' },
          titulo: { type: 'string' },
          tipo: { type: 'string', enum: TIPOS, description: 'nueva: funcionalidad nueva; mejora: cambia algo que ya había; arreglo: corrige un fallo; interno: sin efecto para el usuario; rompe: incompatible con lo anterior' },
          es_producto: { type: 'boolean', description: 'true si cambia el producto; false si solo toca documentación, CI o la propia herramienta de release' },
          issues: { type: 'array', items: { type: 'integer' }, description: 'Issues que cierra o referencia' },
          iniciativa: { type: 'string', description: 'Slug de la iniciativa de discovery a la que pertenece, o vacío' },
          historia: { type: 'string', description: 'Título de la historia de la sección 8 que entrega, o vacío' },
        },
      },
    },
    iniciativas: {
      type: 'array', description: 'Solo las iniciativas con alguna historia en la sección 8',
      items: {
        type: 'object', additionalProperties: false,
        required: ['slug', 'titulo', 'fase', 'historias'],
        properties: {
          slug: { type: 'string' }, titulo: { type: 'string' }, fase: { type: 'string' },
          historias: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              required: ['titulo', 'issue', 'criterios', 'entregada'],
              properties: {
                titulo: { type: 'string' },
                issue: { type: ['integer', 'null'] },
                criterios: { type: 'array', items: { type: 'string' } },
                entregada: { type: 'boolean', description: 'true si su issue está cerrado o un cambio de esta release la entrega' },
              },
            },
          },
        },
      },
    },
    comandos_verificacion: { type: 'array', items: { type: 'string' }, description: 'Comandos de test, lint y build del repo, desde su CLAUDE.md, README.md o package.json; vacío si no hay' },
  },
}

const SCHEMA_TESTS = {
  type: 'object', additionalProperties: false, required: ['resultados'],
  properties: { resultados: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['comando', 'ok', 'resumen'], properties: { comando: { type: 'string' }, ok: { type: 'boolean' }, resumen: { type: 'string' } } } } },
}

const SCHEMA_CRITERIOS = {
  type: 'object', additionalProperties: false, required: ['criterios'],
  properties: {
    criterios: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['criterio', 'cumple', 'evidencia'],
        properties: {
          criterio: { type: 'string' },
          cumple: { type: 'string', enum: ['si', 'no', 'no_verificable'] },
          evidencia: { type: 'string', description: 'Fichero y línea, test o razonamiento concreto' },
        },
      },
    },
  },
}

const SCHEMA_NOTAS = {
  type: 'object', additionalProperties: false, required: ['notas_md', 'resumen'],
  properties: {
    notas_md: { type: 'string', minLength: 80, description: 'Notas de la release en Markdown, sin el encabezado de versión' },
    resumen: { type: 'string', description: 'Tres líneas para contar la release en la demo' },
  },
}

const SCHEMA_PUBLICAR = {
  type: 'object', additionalProperties: false, required: ['hecho', 'pasos', 'url_release'],
  properties: {
    hecho: { type: 'boolean' },
    pasos: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['paso', 'ok', 'detalle'], properties: { paso: { type: 'string' }, ok: { type: 'boolean' }, detalle: { type: 'string' } } } },
    url_release: { type: 'string' },
  },
}

// ---------- versión: la decide el código ----------

function parsear(v) {
  const m = String(v || '').match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  return m ? m.slice(1).map(Number) : null
}

function siguienteVersion(anterior, cambios) {
  const base = parsear(anterior)
  if (!base) return '0.1.0'
  const [ma, mi, pa] = base
  const tipos = new Set(cambios.map((c) => c.tipo))
  if (tipos.has('rompe') && ma >= 1) return (ma + 1) + '.0.0'
  if (tipos.has('rompe') || tipos.has('nueva') || tipos.has('mejora')) return ma + '.' + (mi + 1) + '.0'
  return ma + '.' + mi + '.' + (pa + 1)
}

// ---------- 1. Recoger ----------

phase('Recoger')
const rec = await agent(
  COMUN + '\n\nRecoge lo que entra en la próxima release:\n' +
  '1. Última etiqueta: `git describe --tags --abbrev=0 --match "v*"` (si falla, no hay ninguna y se toma todo el historial).\n' +
  '2. Commits desde ella: `git log <etiqueta>..HEAD --no-merges --format="%h %s" --name-only` (o todo `git log` si no hay etiqueta). Agrupa por PR cuando `gh pr list --state merged --limit 100 --json number,title,mergedAt,closingIssuesReferences,files` lo permita; si gh no responde, trabaja con los commits.\n' +
  '3. Issues cerrados: `gh issue list --state closed --limit 100 --json number,title,closedAt` (si gh no responde, déjalo).\n' +
  (DISCOVERY ? '4. Lee la sección 8 de cada ' + DISCOVERY + '/iniciativas/*/prd.md y une cada cambio con su iniciativa e historia (por número de issue, por enlace o por el texto).\n' : '4. Sin repo de discovery: deja iniciativas vacío y los campos iniciativa e historia en blanco.\n') +
  '5. Comandos para verificar el código: los que digan CLAUDE.md o README.md de este repo, o los scripts test, lint y build de su package.json. Escríbelos listos para ejecutar desde la raíz.\n' +
  'Un cambio que solo toca documentación, CI o release/ es tipo interno y es_producto false. No ejecutes nada que modifique el repo.',
  { label: 'recoger cambios', phase: 'Recoger', schema: SCHEMA_RECOGER, model: 'sonnet', effort: 'low' })
if (!rec) throw new Error('El agente de recogida no devolvió resultado')

const producto = rec.cambios.filter((c) => c.es_producto)
log(rec.cambios.length + ' cambios desde ' + (rec.etiqueta_anterior || 'el principio') + '; ' + producto.length + ' de producto')
if (!producto.length && !FORZAR) {
  return { estado: 'nada', motivo: 'No hay cambios de producto desde ' + (rec.etiqueta_anterior || 'el principio') + '. Con --forzar se prepara igualmente.', etiqueta_anterior: rec.etiqueta_anterior }
}

const version = A.version && parsear(A.version) ? String(A.version).replace(/^v/, '') : siguienteVersion(rec.etiqueta_anterior, producto)
const etiqueta = 'v' + version
log('Versión: ' + (rec.etiqueta_anterior || 'ninguna') + ' → ' + etiqueta)

// ---------- 2. Verificar ----------

phase('Verificar')
const entregadas = rec.iniciativas.flatMap((i) => i.historias.filter((h) => h.entregada && h.criterios.length).map((h) => ({ ...h, iniciativa: i.slug })))
const aVerificar = entregadas.slice(0, MAX_HISTORIAS)
if (entregadas.length > MAX_HISTORIAS) log('Se verifican ' + MAX_HISTORIAS + ' de ' + entregadas.length + ' historias entregadas; el resto queda como aviso')

const [tests, ...criterios] = await parallel([
  () => (rec.comandos_verificacion.length
    ? agent(COMUN + '\n\nEjecuta estos comandos desde la raíz del repo de código, uno a uno, y di si cada uno pasa. No arregles nada: solo informa.\n' + rec.comandos_verificacion.map((c) => '- `' + c + '`').join('\n'),
      { label: 'tests del código', phase: 'Verificar', schema: SCHEMA_TESTS, model: 'sonnet', effort: 'low' })
    : Promise.resolve({ resultados: [] })),
  ...aVerificar.map((h) => () => agent(
    COMUN + '\n\nComprueba, leyendo el código de este repo y sus tests (sin modificar nada), si esta historia cumple sus criterios de aceptación.\n' +
    'Iniciativa: ' + h.iniciativa + '\nHistoria: ' + h.titulo + (h.issue ? ' (issue #' + h.issue + ')' : '') + '\nCriterios:\n' + h.criterios.map((c) => '- ' + c).join('\n') + '\n\n' +
    'Para cada criterio: si (hay código o test que lo demuestra; cita fichero y línea), no (el código hace otra cosa o falta), no_verificable (depende de algo que no se puede comprobar leyendo, como el aspecto visual).',
    { label: 'criterios · ' + h.titulo.slice(0, 40), phase: 'Verificar', schema: SCHEMA_CRITERIOS, model: 'sonnet', effort: 'medium' },
  ).then((r) => (r ? { ...h, ...r } : null))),
])

const bloqueos = []
const avisos = []
if (!tests) bloqueos.push('El agente de tests no devolvió resultado')
else if (!rec.comandos_verificacion.length) avisos.push('El repo no declara comandos de test ni de build: no se ha verificado que funcione')
else tests.resultados.filter((t) => !t.ok).forEach((t) => bloqueos.push('Falla `' + t.comando + '`: ' + t.resumen))
criterios.forEach((c, i) => {
  if (!c) { bloqueos.push('No se pudo verificar la historia «' + aVerificar[i].titulo + '»'); return }
  c.criterios.filter((k) => k.cumple === 'no').forEach((k) => bloqueos.push('«' + c.titulo + '» no cumple: ' + k.criterio + ' (' + k.evidencia + ')'))
  c.criterios.filter((k) => k.cumple === 'no_verificable').forEach((k) => avisos.push('«' + c.titulo + '», sin verificar: ' + k.criterio))
})
entregadas.slice(MAX_HISTORIAS).forEach((h) => avisos.push('Historia sin verificar por el límite: «' + h.titulo + '»'))

// Una iniciativa está entregada cuando todas sus historias lo están y ninguna falla
// la verificación de sus criterios.
const fallidas = new Set(aVerificar.filter((h, i) => !criterios[i] || criterios[i].criterios.some((k) => k.cumple === 'no')).map((h) => h.iniciativa))
const completas = !DISCOVERY ? [] : rec.iniciativas.filter((i) => i.historias.length && i.historias.every((h) => h.entregada) && !fallidas.has(i.slug) && !['midiendo', 'cerrada'].includes(i.fase))
log(bloqueos.length + ' bloqueos, ' + avisos.length + ' avisos; iniciativas completas: ' + (completas.map((i) => i.slug).join(', ') || 'ninguna'))

// ---------- 3. Notas ----------

phase('Notas')
const notas = await agent(
  COMUN + '\n\nEscribe las notas de la release ' + etiqueta + ' (' + HOY + ') para el equipo y para quien vea la demo. Markdown, sin encabezado de versión, con estas secciones si tienen contenido:\n' +
  '- **Novedades**: agrupadas por iniciativa (usa su título y, en una frase, el problema que resuelve según su prd.md).\n- **Mejoras** y **Arreglos**: una línea cada uno, con su referencia.\n- **Pendiente o conocido**: los avisos y bloqueos.\n' +
  'Nada de lo interno salvo que importe. Frases cortas, sin marketing. Además, un resumen de tres líneas para contar la release en la demo.\n\n' +
  'Cambios:\n' + JSON.stringify(producto, null, 1) + '\n\nIniciativas que quedan entregadas: ' + JSON.stringify(completas.map((i) => i.slug)) +
  '\nBloqueos: ' + JSON.stringify(bloqueos) + '\nAvisos: ' + JSON.stringify(avisos),
  { label: 'notas ' + etiqueta, phase: 'Notas', schema: SCHEMA_NOTAS, model: 'sonnet', effort: 'medium' })
if (!notas) throw new Error('El agente de notas no devolvió resultado')

const plan = {
  version: etiqueta,
  anterior: rec.etiqueta_anterior || '',
  cambios: producto,
  iniciativas_entregadas: completas.map((i) => i.slug),
  bloqueos,
  avisos,
  notas_md: '## ' + etiqueta + ' · ' + HOY + '\n\n' + notas.notas_md.trim() + '\n',
  resumen: notas.resumen,
}

if (!PUBLICAR) return { estado: 'plan', ...plan, siguiente: bloqueos.length ? 'Resuelve los bloqueos (o usa --forzar) antes de publicar' : 'Revisa las notas y lanza release/release.sh --publicar' }
if (bloqueos.length && !FORZAR) return { estado: 'bloqueada', ...plan }

// ---------- 4. Publicar ----------

phase('Publicar')
const pub = await agent(
  COMUN + '\n\nPublica la release ' + etiqueta + '. Haz exactamente estos pasos, en orden, desde la raíz del repo; si uno falla, para y dilo:\n' +
  '1. `git pull --rebase --autostash` y comprueba con `git tag -l ' + etiqueta + '` que la etiqueta no existe.\n' +
  '2. Escribe las notas en release/.notas.md (fichero temporal) con este contenido exacto:\n\n' + plan.notas_md + '\n' +
  '3. Añade esas mismas notas al principio de CHANGELOG.md, debajo de la línea «# Changelog» (créalo con esa línea si no existe).\n' +
  completas.map((i, n) => (4 + n) + '. `node ' + DISCOVERY + '/embudo/cli.mjs guardar-iniciativa ' + i.slug + ' --quien release --mensaje "entregada en ' + etiqueta + '" --fase midiendo --historial "Entregada en ' + etiqueta + ' (' + HOY + '); pasa a medir"` (commitea en el repo de discovery)').join('\n') + (completas.length ? '\n' : '') +
  (4 + completas.length) + '. `git add CHANGELOG.md && git commit -m "release: ' + etiqueta + '"`\n' +
  (5 + completas.length) + '. `git tag -a ' + etiqueta + ' -m "' + etiqueta + '"`\n' +
  (6 + completas.length) + '. `git push && git push origin ' + etiqueta + '`\n' +
  (7 + completas.length) + '. `gh release create ' + etiqueta + ' --title "' + etiqueta + '" --notes-file release/.notas.md`\n' +
  (completas.length ? (8 + completas.length) + '. `git -C ' + DISCOVERY + ' pull --rebase --autostash && git -C ' + DISCOVERY + ' push` (sube el cambio de fase de las iniciativas)\n' : '') +
  'No hagas nada más. Devuelve cada paso con su resultado y la URL de la release.',
  { label: 'publicar ' + etiqueta, phase: 'Publicar', schema: SCHEMA_PUBLICAR, model: 'sonnet', effort: 'low' })

return { estado: pub && pub.hecho ? 'publicada' : 'fallo_al_publicar', ...plan, publicacion: pub }
