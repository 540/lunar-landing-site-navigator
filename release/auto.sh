#!/usr/bin/env bash
# Release automática del código: la lanza .githooks/post-commit. Decide en el acto si toca
# (sin gastar nada) y, si toca, publica en segundo plano y avisa al terminar.
set -uo pipefail
RAIZ="$(git rev-parse --show-toplevel)"
LOG="$RAIZ/release/.auto.log"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

avisar() {
  local titulo="$1" texto="$2"
  if command -v terminal-notifier >/dev/null 2>&1; then terminal-notifier -title "$titulo" -message "$texto" >/dev/null 2>&1
  elif command -v osascript >/dev/null 2>&1; then osascript -e "display notification \"${texto//\"/\'}\" with title \"${titulo//\"/\'}\"" >/dev/null 2>&1
  fi
}

# ¿Toca release? Nada de esto llama a Claude.
[ "${SIN_RELEASE:-}" = 1 ] && exit 0
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || exit 0
for d in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD; do
  [ -e "$(git rev-parse --git-path "$d")" ] && exit 0      # en mitad de un rebase o un merge
done
case "$(git log -1 --format=%s)" in "release: "*) exit 0 ;; esac
# Solo documentación o la propia herramienta de release: no hay producto nuevo.
git diff-tree --no-commit-id --name-only -r HEAD | grep -qvE '(\.md$|^release/|^\.githooks/|^\.github/)' || exit 0

# Toca: en segundo plano, una sola a la vez.
(
  unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX   # las define git para el hook
  cd "$RAIZ" || exit 1
  CERROJO="$RAIZ/release/.auto.cerrojo"
  if ! mkdir "$CERROJO" 2>/dev/null; then
    log "Ya hay una release en curso; el commit $(git rev-parse --short HEAD) entrará en ella o en la siguiente"
    exit 0
  fi
  trap 'rm -rf "$CERROJO"' EXIT
  log "Empieza la release por el commit $(git rev-parse --short HEAD)"
  rm -f "$RAIZ/release/.ultima.json"   # que el aviso no lea el resultado de la anterior
  "$RAIZ/release/release.sh" --publicar >> "$LOG" 2>&1
  RESULTADO="$(node -e 'try{const j=require(process.argv[1]);console.log(`${j.estado}\t${j.version||""}\t${(j.bloqueos||[])[0]||j.motivo||""}`)}catch{console.log("fallo\t\tmira release/.auto.log")}' "$RAIZ/release/.ultima.json")"
  IFS=$'\t' read -r ESTADO VERSION DETALLE <<< "$RESULTADO"
  case "$ESTADO" in
    publicada) avisar "Release $VERSION publicada" "Etiqueta, CHANGELOG y release de GitHub listos" ;;
    bloqueada) avisar "Release $VERSION bloqueada" "$DETALLE" ;;
    nada) ;;
    *) avisar "La release no salió" "${DETALLE:-Mira release/.auto.log}" ;;
  esac
  log "Termina: $ESTADO $VERSION $DETALLE"
) > /dev/null 2>&1 &
disown 2>/dev/null || true
exit 0
