# Mirador del Polo Sur · prototipo de referencia

Copia congelada del artifact «Mirador del Polo Sur» (versión `1794607176-7d34`), el prototipo 3D del tour lunar. **Solo es referencia: no se edita ni se publica.** La pantalla de verdad se construye en `viewpoint/` siguiendo el [desglose](../desglose-tour-lunar.md).

- Original: https://claude.ai/artifact/K1C3tMgR48zNbKqCyQ1gi9
- Un único HTML con three.js 0.160 desde CDN. **Datos simulados**: relieve procedural y efemérides de juguete (`sunAt`, `earthAt`).
- Las texturas (`tex/`) no se han copiado. La página usa texturas de ruido en su lugar, así que se ve peor pero funciona. Las de la Luna están en `../../shared/render/tex/`.

## Qué portar para el relieve (E0.5)

Unidades del prototipo: `x` y `z` en km respecto al centro de la región, con `-z` hacia el azimut 0° (`dirAzEl`) y alturas en km. En la escena se multiplican por `U = 10`.

| Qué | Dónde (línea de `index.html`) | Para qué |
|---|---|---|
| `rng(seed)` | 375 | Generador pseudoaleatorio con semilla: el relieve sale siempre igual |
| `REGIONS` (+ cráteres pequeños generados) | 376-390 | Montes (`t:"m"`) y cráteres (`t:"c"`) de cada región, con su semilla y los puntos `pts` |
| `feat(f, x, z)` | 391-396 | Altura de un monte o un cráter en un punto |
| `Hr(reg, x, z)` | 397-399 | Altura total: ondulación de fondo + cuenco + montes + cráteres |
| `buildGrid` | 616-621 | Malla de 40 × 40 km a partir de `Hr` (lo que hay que sustituir por leer `terrain-lod0.bin`) |
| `radialGen`, `footY` | 623-638 | Malla radial con curvatura lunar (más adelante: E3 y E5) |
| `computeMask`, `maskAt` | 403-407 | Máscara de horizonte en un punto (más adelante: pipeline de E1) |

Lo que **no** se porta: `sunAt`, `earthAt` y `stats` (líneas 401-408) son efemérides falsas; en `viewpoint/` las sustituye la serie generada con el motor de `backend/src/`.
