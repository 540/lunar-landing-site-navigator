#!/usr/bin/env bash
# Hook de Claude Code (.claude/settings.json) que no deja que la API REST v1 y GraphQL diverjan (#71). Lee el JSON del
# hook por la entrada estándar y, solo si el cambio toca backend/ o data/ de un checkout de este repo, ejecuta
# api-parity.sh en ese checkout. Si falla, sale con 2: Claude ve el motivo y tiene que arreglarlo.
#
#   parity-hook.sh post-edit   PostToolUse de Edit|Write|MultiEdit|NotebookEdit: el checkout del fichero editado
#   parity-hook.sh pre-bash    PreToolUse de Bash: `git commit` o `git push` (también con git -C o tras cd … &&)
#   parity-hook.sh stop        Stop y SubagentStop: cambios sin commit o sin subir en el checkout de `cwd`
#
# Los agentes trabajan en worktrees fuera del proyecto: el checkout sale del propio fichero o comando, no del proyecto.
# Sin nada relevante sale con 0 sin decir nada. PARITY_SCRIPT cambia el script de paridad (solo para los tests).
set -euo pipefail

mode="${1:?uso: parity-hook.sh post-edit|pre-bash|stop}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="${PARITY_SCRIPT:-${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/.claude/scripts/api-parity.sh}}"
script="${script:-$here/api-parity.sh}"

input="$(cat)"
# Campos del JSON del hook (sin jq): field <ruta.con.puntos>
field() {
  node -e '
    let v = JSON.parse(process.argv[1] || "{}");
    for (const k of process.argv[2].split(".")) v = v == null ? undefined : v[k];
    if (v != null) process.stdout.write(String(v));
  ' "$input" "$1"
}

# Raíz del checkout que contiene `dir` si es de este repo (con los tests de paridad); vacío si no.
checkout_of() {
  local dir="$1" top
  [[ -n "$dir" ]] || return 0
  while [[ -n "$dir" && ! -d "$dir" ]]; do dir="$(dirname "$dir")"; done
  top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || return 0
  if [[ -f "$top/data/test/api-parity.test.ts" && -f "$top/data/openapi.yaml" && -f "$top/backend/src/useCases.ts" ]]; then
    printf '%s' "$top"
  fi
}

# ¿Toca backend/ o data/ algo sin commit, o algún commit que origin/main no tiene? Sin contar los enlaces simbólicos
# que se ponen en los worktrees (node_modules y la caché del DEM, que git no ignora por ser enlaces).
touches_api() {
  local top="$1" base
  local -a links=(':(exclude)backend/node_modules' ':(exclude)data/node_modules' ':(exclude)backend/terrain/cache')
  [[ -n "$(git -C "$top" status --porcelain -- backend data "${links[@]}" 2>/dev/null)" ]] && return 0
  if base="$(git -C "$top" merge-base origin/main HEAD 2>/dev/null)"; then
    [[ -n "$(git -C "$top" diff --name-only "$base" HEAD -- backend data)" ]] && return 0
  fi
  return 1
}

run_parity() {
  local top="$1" out
  if ! out="$(bash "$script" "$top" 2>&1)"; then
    {
      printf '%s\n' "$out"
      echo
      echo "Bloqueado por el hook de paridad REST v1 ↔ GraphQL (.claude/scripts/parity-hook.sh $mode). Arréglalo; no desactives el hook."
    } >&2
    exit 2
  fi
}

case "$mode" in
  post-edit)
    file="$(field tool_input.file_path)"
    [[ -n "$file" ]] || file="$(field tool_input.notebook_path)"
    [[ -n "$file" ]] || exit 0
    [[ "$file" == /* ]] || file="$(field cwd)/$file"
    top="$(checkout_of "$(dirname "$file")")"
    [[ -n "$top" ]] || exit 0
    case "${file#"$top"/}" in
      backend/* | data/*) run_parity "$top" ;;
    esac
    ;;

  pre-bash)
    command="$(field tool_input.command)"
    cwd="$(field cwd)"
    # El directorio del git que hace commit o push: git -C <dir>, un `cd <dir> &&` delante o el cwd del hook.
    dir="$(node -e '
      const [cmd, cwd] = process.argv.slice(1);
      const path = require("node:path");
      const git = /(?:^|[;&|(]\s*|\s)git((?:\s+-(?:C|c)\s+(?:"[^"]*"|\x27[^\x27]*\x27|\S+)|\s+--?[\w-]+(?:=\S+)?)*)\s+(commit|push)\b/.exec(cmd);
      if (!git) process.exit(0);
      const unquote = (s) => s.replace(/^["\x27]|["\x27]$/g, "");
      const C = /\s-C\s+("[^"]*"|\x27[^\x27]*\x27|\S+)/.exec(git[1]);
      const cd = /^\s*cd\s+("[^"]*"|\x27[^\x27]*\x27|[^\s;&|]+)\s*&&/.exec(cmd);
      let dir = cwd || process.cwd();
      if (cd) dir = path.resolve(dir, unquote(cd[1]));
      if (C) dir = path.resolve(dir, unquote(C[1]));
      process.stdout.write(dir);
    ' "$command" "$cwd")"
    [[ -n "$dir" ]] || exit 0
    top="$(checkout_of "$dir")"
    [[ -n "$top" ]] || exit 0
    touches_api "$top" && run_parity "$top"
    ;;

  stop)
    top="$(checkout_of "$(field cwd)")"
    [[ -n "$top" ]] || exit 0
    touches_api "$top" && run_parity "$top"
    ;;

  *)
    echo "parity-hook.sh: modo desconocido: $mode" >&2
    exit 1
    ;;
esac
exit 0
