# CLAUDE.md · Lunar Landing Site Navigator (código)

Código de la herramienta del equipo de 540 para NASA Space Apps 2026, reto Lunar Landing Site Navigator. Qué construir y por qué está en el repo de discovery, `540/lunar-landing-site-navigator-discovery`: cada iniciativa tiene su PRD en `iniciativas/<slug>/prd.md`, con las historias de usuario y sus criterios de aceptación en la sección 8. Si está clonado al lado, léelo para entender una historia; no lo edites desde aquí.

## Reglas

- Cada cambio responde a una historia o a un issue; la referencia va en el commit o en el PR.
- Commits en español y descriptivos. Todo el contenido en español con tildes, ñ, ¿ y ¡.
- Código (identificadores, ficheros, carpetas, ids y clases de HTML y CSS, comentarios) en inglés. Textos que ve el usuario y documentación, en español. Excepción: el README raíz, `README.md`, está en inglés (para el jurado de Space Apps) y su versión en español es `README.es.md`; un cambio en uno va también al otro, en la misma PR.
- `prototipo/` es solo referencia: no se edita. La interfaz se trabaja en `web/`, repartida por vistas (ver `web/README.md`).
- La portada es `home/` y enlaza con cada pantalla por rutas relativas (`../web/`). Una pantalla nueva es una carpeta nueva en la raíz, añadida a `MOUNTS` en `serve.mjs`, a `cp -R` en `.github/workflows/pages.yml`, a `SITE_PATHS` en `tools/version/lib.mjs` y al `href` de su misión en `home/index.html`. Por dentro sigue la forma de `planner/`: `index.html`, código en `src/`, tests en `tests/` y su `package.json` con `npm test` (enganchado al `npm test` de la raíz).
- Pantallas: `viewpoint/` es el **Mirador del Polo Sur** (exploración 3D y visor de misión; glosario en `docs/arquitectura-tour.md`) y `rolegame/` el **juego de rol** «Varados en el polo» (`docs/arquitectura-juego.md`).

- Sin modelos ni servicios de entidades chinas (DeepSeek, Qwen, GLM/Zhipu, Kimi, MiniMax…): lo prohíben los términos de NASA Space Apps. Vale para agentes, evals y dependencias.

## Comandos

| Carpeta | Arrancar | Test |
|---|---|---|
| raíz | `npm start` (todo el sitio en el puerto 4540: `/home/`, `/web/`, `/viewpoint/`, `/rolegame/`, `/prototipo/`) | `npm test` (el typecheck de `backend/` y `data/`, la paridad REST v1 ↔ GraphQL (`npm run parity`) y los tests de `backend/` con los dorados, `data/`, `planner/`, `pipeline/`, `web/`, `viewpoint/` y `rolegame/`; antes `npm ci --prefix backend && npm ci --prefix data`) |
| `home/` | con el sitio: `npm start` | sin tests todavía (REVISAR) |
| `web/` | `node web/serve.mjs` (puerto 4542, abre el planificador) | `cd web && npm test` (el adaptador de la API de datos, contra la API real; el resto, sin tests todavía) |
| `backend/` | sin servidor propio: motor (casos de uso en `src/useCases.ts`), infraestructura (pool, caché, trabajos) y evals (`cd backend && npm ci && npm run eval -- …`); la API es la de `data/` | `cd backend && npm run typecheck && npm test && node evals/golden.ts check` |
| `data/` | `cd backend && npm ci`, luego `cd data && npm ci && npm start` (puerto 3100). Importa el motor de `backend/src/`, sin copia | `cd data && npm run typecheck && npm test` |
| `planner/` | `cd planner && npm run evaluate -- --site … --date …` | `cd planner && npm test` |
| `viewpoint/` | con el sitio: `npm start` → `/viewpoint/` | `npm test --prefix viewpoint` |
| `rolegame/` | con el sitio: `npm start` → `/rolegame/` | `npm test --prefix rolegame` |

La release ejecuta estos tests antes de publicar.

Notas de `backend/` y `data/`:

- Stack: Node 26.13 (`backend/.nvmrc`), ES modules, sin framework y **sin build**: TypeScript (`.ts`) que Node ejecuta tal cual quitando los tipos (*type stripping*). Solo sintaxis borrable: nada de `enum`, `namespace` ni propiedades en el constructor; `import type` para lo que solo es tipo; `declare` en los campos de clase solo tipados; los imports relativos acaban en `.ts`. `tsc` (strict, `npm run typecheck`, `tsconfig.base.json` en la raíz) solo comprueba tipos. Tests con `node:test`.
- Relieve (DEM LOLA) opcional: `cd backend && node scripts/fetch-dem.ts` (descarga única, ~400 MB en `backend/terrain/cache/`, fuera de git) y `node scripts/build-masks.ts` (máscaras del catálogo en `backend/terrain/masks/`, en git). Los tests no lo necesitan: bajo `node --test` el relieve se apaga solo y los tests de relieve usan máscaras o DEM sintéticos.
- Una sola fuente de verdad: cada operación es un caso de uso de `backend/src/useCases.ts`, que decide valores por defecto, relieve, puntuación, restricciones y avisos. `/v1` y GraphQL solo validan, traducen y formatean, y las evals llaman a los mismos casos de uso. No hay API interna (`/api/*` se retiró en #61).
- Contrato v1: sin `terrain=1` las respuestas de `/v1/*` no deben cambiar. Si tocas `backend/src/`, pasa también los tests de `data/` (y los de `planner/`, que consume la API). Los cambios de v1 solo pueden añadir campos o parámetros opcionales (si no, `/v2`) y suben `info.version` en `data/openapi.yaml`.
- Paridad REST v1 ↔ GraphQL (#71): **un cambio en la v1 no pasa los tests si GraphQL no lo ofrece igual.** Toda ruta, parámetro y campo de respuesta de `/v1` tiene su equivalente en GraphQL y da lo mismo. Al añadir algo a la v1: la ruta o el parámetro en `data/src/v1.ts` y `data/openapi.yaml`, su entrada en `OPERATIONS` (`data/src/graphql/operations.ts`, de donde los resolvers sacan sus llamadas a la v1), el argumento o el campo en `data/src/graphql/schema.graphql` y una petición que lo use en `PARITY_REQUESTS` (`data/test/single-source.test.ts`). Las excepciones van en `V1_ONLY` o `GRAPHQL_ONLY`, siempre con su motivo. Tabla de equivalencias en `data/README.md`, «De la v1 a GraphQL».

## Guardarraíl de paridad (no lo desactives)

`.claude/scripts/api-parity.sh [checkout]` (`npm run parity`, también dentro de `npm test`) ejecuta `data/test/api-parity.test.ts` (lo que ofrecen: rutas, parámetros y campos de `openapi.yaml` frente al esquema GraphQL) y `data/test/single-source.test.ts` (lo que responden: cada operación por `/v1` y por GraphQL), en unos segundos, y si fallan dice en castellano qué diverge. Los hooks de Claude Code de `.claude/settings.json` (vía `.claude/scripts/parity-hook.sh`) lo ejecutan en el checkout afectado, también en worktrees fuera del proyecto, y bloquean con exit 2:

- al editar (Edit, Write, MultiEdit, NotebookEdit) un fichero de `backend/` o `data/`;
- antes de un `git commit` o `git push` (también con `git -C …` o tras `cd … &&`) si el checkout cambia `backend/` o `data/` frente a `origin/main`: así cubre también lo editado con sed o heredocs;
- al terminar (Stop y SubagentStop) si el checkout de `cwd` tiene cambios en `backend/` o `data/` sin commit o sin subir.

Fuera de `backend/` y `data/` no hacen nada. `core.hooksPath=/dev/null` solo apaga los hooks de git, no estos. No se desactivan ni se saltan: si bloquean, se arregla la divergencia. `tests/parity-hook.test.mjs` prueba su lógica.

## Versión del sitio

Semántica y automática: el paso «Version» de `pages.yml` la decide antes de cada deploy con `tools/version/next.mjs` (etiqueta `vX.Y.Z`, sin commits en `main`) y `shared/version/badge.js` la pinta abajo a la izquierda en cada pantalla. Sube la menor si un commit referencia un issue con la etiqueta `enhancement`; la mayor, con `[major]` en el título del commit o una línea `BREAKING CHANGE`; si no, el parche; y no sube si nada de lo publicado cambia. Una pantalla nueva carga el distintivo en su `index.html` y entra en `SITE_PATHS` (`tools/version/lib.mjs`). Detalle en `tools/version/README.md`.

## Release

`release/release.sh` prepara la release y, con `--publicar`, la publica. Con `git config core.hooksPath .githooks` se publica sola tras cada commit en `main` que cambia el producto (en una sola máquina, la que tenga sesión de `claude`). Detalle en `release/README.md`.
