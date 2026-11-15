# Versión del sitio

Versionado semántico (`MAYOR.MENOR.PARCHE`) del sitio publicado en GitHub Pages. No hay que hacer nada a mano: el workflow [`pages.yml`](../../.github/workflows/pages.yml) decide la versión antes de cada deploy, la deja en una etiqueta de git `vX.Y.Z` y las pantallas la muestran en la esquina inferior izquierda.

## Cómo funciona

1. En cada push a `main`, el paso «Version» de `pages.yml` ejecuta `node tools/version/next.mjs --out _site/version.json`.
2. El script busca la etiqueta `vX.Y.Z` más alta del historial y mira los commits posteriores que tocan lo que se publica (`home/`, `web/`, `viewpoint/`, `prototipo/`, `rolegame/`, `lander/`, `shared/` y `planner/src`).
3. Con esos commits decide cuánto sube (tabla de abajo), escribe `version.json` en el sitio y sube la etiqueta nueva. Después se despliega.
4. Cada pantalla carga [`shared/version/badge.js`](../../shared/version/badge.js), que lee `version.json` y pinta `vX.Y.Z` abajo a la izquierda, seguido del aviso de uso de IA («Hecho con ayuda de IA · Claude Code», #96), que sale aunque no haya `version.json`.

La versión vive solo en las etiquetas: el workflow no hace commits en `main`.

## Cuánto sube

| Sube | Cuándo |
|---|---|
| **Mayor** (`1.0.0`) | Un commit lleva `[major]` en el título o una línea que empieza por `BREAKING CHANGE` en el mensaje, o un prefijo convencional con `!` (`feat!: …`) |
| **Menor** (`0.3.0`) | Un commit referencia un issue (`#123`) con la etiqueta `enhancement`, o lleva `[minor]` en el título, o empieza por `feat:` |
| **Parche** (`0.2.4`) | Cualquier otro cambio del sitio: arreglos, issues con otra etiqueta o commits sin issue |
| **No sube** | Ningún commit desde la última etiqueta toca el sitio (solo documentación, CI, `backend/`, `data/`…), o el commit desplegado ya tiene etiqueta. Se publica con la versión anterior |

Gana el nivel más alto de todos los commits desde la última etiqueta. Lo normal es no escribir ninguna marca: basta con que el commit lleve su `#issue`, como pide `CLAUDE.md`, y que el issue tenga su etiqueta (`enhancement` o `bug`).

Un commit `release: vX.Y.Z` de [`release/`](../../release/README.md) fija su propia versión: el deploy la muestra y no crea etiqueta, porque la pone la release.

## En local

`npm start` responde `/version.json` con la última etiqueta y el sufijo `-dev` (por ejemplo `v0.4.2-dev`). Para ver qué versión saldría del commit actual:

```sh
node tools/version/next.mjs                                    # sin etiquetas de issues: solo los mensajes
GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=540/lunar-landing-site-navigator node tools/version/next.mjs
```

No crea etiquetas: eso solo lo hace el workflow.

## Ficheros

| Fichero | Qué hace |
|---|---|
| `lib.mjs` | Las reglas, puras: leer y comparar versiones, el nivel de cada commit y la versión que toca |
| `next.mjs` | Lee git y las etiquetas de los issues en GitHub, escribe `version.json` y las salidas del workflow |
| [`shared/version/badge.js`](../../shared/version/badge.js) | El distintivo de las pantallas |
| [`tests/version.test.mjs`](../../tests/version.test.mjs) | Tests de las reglas, de la lectura de git y del cableado. Entran en `npm test` |

Una pantalla nueva añade `<script type="module" src="../shared/version/badge.js"></script>` a su `index.html` y su carpeta a `SITE_PATHS` de `lib.mjs`.
