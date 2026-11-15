#!/usr/bin/env bash
# Release del código con release/workflow.mjs. Lee las iniciativas del repo de discovery
# (lunar-landing-site-navigator-discovery) si está clonado al lado, o en $DISCOVERY.
#
#   ./release/release.sh                      prepara: versión, verificación y notas; no toca nada
#   ./release/release.sh --publicar           publica: CHANGELOG, iniciativas a midiendo, etiqueta, push y release de GitHub
#   ./release/release.sh --version 0.3.0      fuerza la versión en vez de calcularla
#   ./release/release.sh --publicar --forzar  publica aunque haya bloqueos (tests en rojo, criterios sin cumplir)
set -uo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RAIZ" || exit 1

# El repo de discovery: $DISCOVERY, o la carpeta hermana cuyo remoto es el de discovery.
if [ -z "${DISCOVERY:-}" ]; then
  for d in "$RAIZ"/../*/; do
    url="$(git -C "$d" remote get-url origin 2>/dev/null || true)"
    case "$url" in *lunar-landing-site-navigator-discovery*|*540/lunar-landing-site-navigator.git*|*540/lunar-landing-site-navigator) DISCOVERY="$(cd "$d" && pwd)"; break ;; esac
  done
fi
[ -n "${DISCOVERY:-}" ] && [ ! -f "$DISCOVERY/embudo/cli.mjs" ] && DISCOVERY=""
[ -z "${DISCOVERY:-}" ] && echo "Aviso: no encuentro el repo de discovery al lado (o en \$DISCOVERY): la release no unirá cambios con iniciativas." >&2
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  NVM_NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$NVM_NODE" ] && export PATH="$NVM_NODE:$PATH"
fi

PUBLICAR=false; FORZAR=false; VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --publicar) PUBLICAR=true ;;
    --forzar) FORZAR=true ;;
    --version) VERSION="${2:-}"; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$PUBLICAR" = true ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Hay cambios sin commitear. Guárdalos o apártalos antes de publicar una release." >&2
  exit 1
fi

ARGS=$(node -e 'console.log(JSON.stringify({hoy: process.argv[1], discovery: process.argv[5] || "", publicar: process.argv[2] === "true", forzar: process.argv[3] === "true", ...(process.argv[4] ? {version: process.argv[4]} : {})}))' "$(date +%F)" "$PUBLICAR" "$FORZAR" "$VERSION" "${DISCOVERY:-}")

# Preparar solo lee: git, gh y los comandos de test del código. Publicar además escribe y sube.
PERMISOS=(Workflow Read Grep Glob "Bash(git describe:*)" "Bash(git log:*)" "Bash(git status:*)" "Bash(git tag -l:*)" "Bash(gh pr list:*)" "Bash(gh issue list:*)" "Bash(npm:*)" "Bash(npx:*)" "Bash(pnpm:*)" "Bash(yarn:*)" "Bash(bun:*)" "Bash(node:*)")
if [ "$PUBLICAR" = true ]; then
  PERMISOS+=("Write(release/.notas.md)" "Write(CHANGELOG.md)" "Edit(CHANGELOG.md)" "Bash(git pull:*)" "Bash(git add:*)" "Bash(git commit:*)" "Bash(git tag:*)" "Bash(git push:*)" "Bash(git -C:*)" "Bash(gh release create:*)")
fi

SALIDA="$RAIZ/release/.ultima.json"
echo "Preparando la release$( [ "$PUBLICAR" = true ] && echo ' y publicándola' )… (unos minutos)"
. "$RAIZ/release/claude-headless.sh"
claude_headless "$SALIDA.tmp" "$RAIZ/release/.error.txt" '{"mcpServers":{}}' \
  "Ejecuta con el Workflow tool el fichero de workflow $RAIZ/release/workflow.mjs, exactamente así: Workflow({scriptPath: \"$RAIZ/release/workflow.mjs\", args: $ARGS}). Ejecuta ese fichero exacto; no resuelvas ningún workflow por nombre. Cuando termine, imprime SOLO el objeto JSON que devuelve, sin texto alrededor." \
  --allowedTools "${PERMISOS[@]}" ${DISCOVERY:+--add-dir "$DISCOVERY"}
CODIGO=$?

node - "$SALIDA.tmp" "$SALIDA" <<'EOF'
const fs = require('fs');
const [entrada, salida] = process.argv.slice(2);
const texto = fs.readFileSync(entrada, 'utf8');
let j = null;
for (let fin = texto.lastIndexOf('}'); fin !== -1 && !j; fin = texto.lastIndexOf('}', fin - 1)) {
  for (let i = texto.lastIndexOf('{', fin); i !== -1; i = texto.lastIndexOf('{', i - 1)) {
    try { j = JSON.parse(texto.slice(i, fin + 1)); if (j.estado) break; j = null; } catch { /* sigue buscando */ }
  }
}
if (!j) { console.error('La salida no trae el resultado del workflow. Mira release/.ultima.json.tmp y release/.error.txt'); process.exit(1); }
fs.writeFileSync(salida, JSON.stringify(j, null, 2));
fs.unlinkSync(entrada);
const linea = (t) => console.log(t);
linea(`\nEstado: ${j.estado}${j.version ? `  ·  ${j.anterior || 'sin versión previa'} → ${j.version}` : ''}`);
if (j.motivo) linea(j.motivo);
if (j.bloqueos?.length) { linea('\nBloqueos:'); j.bloqueos.forEach((b) => linea(`  ✗ ${b}`)); }
if (j.avisos?.length) { linea('\nAvisos:'); j.avisos.forEach((a) => linea(`  ! ${a}`)); }
if (j.iniciativas_entregadas?.length) linea(`\nIniciativas entregadas: ${j.iniciativas_entregadas.join(', ')}`);
if (j.notas_md) linea(`\n${j.notas_md}`);
if (j.resumen) linea(`Para la demo:\n${j.resumen}\n`);
if (j.publicacion) { j.publicacion.pasos.forEach((p) => linea(`  ${p.ok ? '✓' : '✗'} ${p.paso}${p.ok ? '' : `: ${p.detalle}`}`)); if (j.publicacion.url_release) linea(`\n${j.publicacion.url_release}`); }
if (j.siguiente) linea(j.siguiente);
EOF
RESULTADO=$?
[ $CODIGO -ne 0 ] && echo "claude salió con $CODIGO; detalle en release/.error.txt" >&2
exit $(( CODIGO || RESULTADO ))
