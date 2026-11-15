#!/usr/bin/env bash
# Paridad REST v1 ↔ GraphQL (#71): lo que ofrecen (rutas, parámetros y campos de respuesta de data/openapi.yaml frente a
# data/src/graphql/schema.graphql, con las excepciones de data/src/graphql/operations.ts) y lo que responden (cada
# operación con todos sus parámetros da lo mismo por /v1 y por GraphQL). Tarda unos segundos.
#
#   .claude/scripts/api-parity.sh [checkout]     (por defecto, el del directorio actual)
#
# Lo ejecutan `npm run parity`, `npm test` y los hooks de Claude Code (.claude/settings.json, parity-hook.sh).
set -euo pipefail

root="${1:-$(git rev-parse --show-toplevel)}"
cd "$root"

tests=(data/test/api-parity.test.ts data/test/single-source.test.ts)
for t in "${tests[@]}"; do
  if [[ ! -f "$t" ]]; then
    echo "Paridad REST v1 ↔ GraphQL: falta $t en $root." >&2
    exit 1
  fi
done
for d in backend data; do
  if [[ ! -d "$d/node_modules" ]]; then
    echo "Paridad REST v1 ↔ GraphQL: faltan las dependencias de $d/ en $root (npm ci --prefix backend && npm ci --prefix data)." >&2
    exit 1
  fi
done

# Sin LUNAR_WORKERS: los tests de data/ corren en el hilo principal. Sin NODE_TEST_CONTEXT: si lo llama otro
# `node --test` (tests/parity-hook.test.mjs), este no debe portarse como un proceso hijo de aquel.
if out=$(env -u LUNAR_WORKERS -u NODE_TEST_CONTEXT node --test --test-reporter=spec "${tests[@]}" 2>&1); then
  exit 0
fi

{
  echo "La API REST v1 y GraphQL divergen en $root (o sus tests de paridad no pasan)."
  echo "Cada ruta, parámetro y campo de respuesta de la v1 debe tener su equivalente en GraphQL y dar lo mismo:"
  echo "data/src/graphql/operations.ts (OPERATIONS, y las excepciones con motivo en V1_ONLY y GRAPHQL_ONLY),"
  echo "data/src/graphql/schema.graphql y data/test/single-source.test.ts (PARITY_REQUESTS). Ver data/README.md, «De la v1 a GraphQL»."
  echo
  echo "Qué falla:"
  # Los mensajes de las aserciones (en castellano) y los tests que fallan, sin las trazas.
  printf '%s\n' "$out" | awk '/failing tests:/ { on = 1; next } on' \
    | grep -vE '^\s+at |^\s*(\+|-) *(\[|\]|actual|expected)|^\s*(generatedMessage|code|actual|expected|operator|diff):|^\s*\}$|^\s*$' \
    | head -n 80
  # Un fallo al cargar (un error de sintaxis en el esquema o en el código): su mensaje.
  printf '%s\n' "$out" | grep -E '^[A-Za-z]*Error( \[[A-Z_]+\])?: ' | sort -u | head -n 10
} >&2
exit 1
