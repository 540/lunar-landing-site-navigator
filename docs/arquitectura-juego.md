# Juego «Varados en el polo» · decisiones de arquitectura en este repo

Fecha: 2026-11-14. El [desglose del juego](desglose-juego-rol.md) se escribió pensando en el stack del desglose del tour (Vite, `src/game`, `/juego` como página de Vite, base común del Mirador por construir). Este documento recoge **en qué nos apartamos y por qué**. Donde choque con el desglose, manda este documento; el resto del desglose (épicas, reparto del cálculo, motor de reglas y resolutor) sigue valiendo.

Sigue las mismas decisiones que el tour ([`arquitectura-tour.md`](arquitectura-tour.md)); aquí solo va lo propio del juego.

## Decisiones

| Tema | El desglose dice | En este repo | Por qué |
|---|---|---|---|
| Pantalla | Página `/juego` de Vite, carpeta `src/game` | Carpeta estática **`rolegame/`** sin compilación (antes `juego/`, #126), enlazada desde la misión 03 de la portada (zona `rol`). Dentro, como `planner/`: `index.html`, `src/` (código, `src/engine/` y `src/styles/`), `tests/`, `data/` (lo que genera el pipeline) y `package.json` | Una pantalla = una carpeta, servida por `serve.mjs` y publicada tal cual por Pages (sin `tests/` ni `package.json`) |
| Orden frente al tour | Decisión abierta (sección 10.2) | **En paralelo.** La base común (repo, despliegue, `serve.mjs`, `npm test`) ya existe; el tour E0 monta `pipeline/` (#9) y el juego lo reutiliza | Ninguno de los dos espera al otro más allá de esas dos piezas |
| Motor de reglas | Módulo puro compartido entre navegador y resolutor | Módulos ES puros en **`rolegame/src/engine/`**, sin DOM ni `fetch`. Reciben estado, acción y tablas ya cargadas | Sin compilación, el mismo fichero lo importan el navegador, los tests de `npm test` y el resolutor de `pipeline/` en Node |
| Pipeline del escenario | Pipeline del Mirador, salida extra | **`pipeline/`** (el del tour), con un script propio del juego. Relieve procedural portado de `makeWorld` mientras no haya LOLA | Un solo pipeline y un solo lenguaje |
| Efemérides | Volcado compartido con el Mirador | El script del escenario llama a **`series()` del motor de `backend/src/`**, como `pipeline/ephemeris.mjs` | Paridad con la API por construcción |
| Datos generados | Almacenamiento versionado | **Se suben al repo** en `rolegame/data/<escenario>/` | Pesan unos pocos MB y Pages los publica sin tocar nada |
| Formatos | `.bin` y `.png` orientativos | Los de la sección 4.4 del desglose, con la disposición escrita en `scenario.json` (ver abajo). PNG con `zlib` de Node, sin dependencias nuevas | Que el cliente no tenga que adivinar nada |
| Three.js | 0.160 (unificado) | **0.160 desde CDN**, solo cuando llegue la Luna 3D (J8). J0 es canvas 2D | Lo mismo que `home/` y `viewpoint/` |
| Tests | CI con Vitest y Playwright | `node --test` en `rolegame/tests/` (`npm test --prefix rolegame`), colgado de **`npm test`** en la raíz | Es lo que ejecutan el workflow de Pages y la release |
| Prototipo | Artifact «Varados en el polo» | Copia congelada en [`juego-rol/`](juego-rol/), con su tabla de qué portar | Para portar con líneas concretas |

## Convenciones del juego

- **Rejilla:** 48 × 48 celdas de 250 m (12 × 12 km), como el prototipo. Índice de celda `i = y * 48 + x`.
- **Orientación del mapa:** norte local hacia `−y` (arriba) y este hacia `+x` (derecha). Un azimut `az` (convención de la API: desde el norte, hacia el este) apunta a `dx = sin(az)`, `dy = −cos(az)`, como en `makeWorld`.
- **Tiempo de juego:** horas desde la fecha UTC de inicio del escenario (`startUtc`). Las tablas tienen una fila por hora; entre horas, el motor interpola linealmente la fracción de Sol.
- **Determinismo:** mismas tablas, misma semilla y mismas acciones dan siempre el mismo estado. Nada de `Math.random` ni `Date.now` dentro de `engine/`.
- **Equilibrar es cambiar datos** (`levels.json`, `scenario.json`), no código.
- Textos que ve el jugador, en español y en un diccionario (`rolegame/src/texts.js`). Lo inventado se dice: «Relieve inventado» en el escenario procedural, con el vocabulario del origen de los datos de `web/README.md` (#338).

## Ficheros del escenario (J0)

En `rolegame/data/<escenario>/`. `scenario.json` describe la disposición de cada binario, para que el cliente y el resolutor lean lo mismo:

| Fichero | Contenido | Disposición |
|---|---|---|
| `scenario.json` | Id, nombre, sitio del catálogo de las efemérides, rejilla (`n`, `cellM`), `start`, `pad`, `startUtc`, `hours`, semilla del relieve, versión, fuentes y `facts` (cifras para los textos de experto y las lecciones, J9.4: ver `pipeline/README.md`) | JSON |
| `cells.bin` | Altura por celda en metros | `Float32Array` de `n × n`, little-endian. Las pendientes hacia las 8 vecinas llegan con J1 |
| `sun.bin` | Fracción del disco solar visible, 0 a 255 (= 0 a 1) | `Uint8Array` de `hours × n × n`, por horas: `sun[h * n * n + i]` |
| `earth.bin` | Tierra visible (1) o no (0). El motor lo lee con `seesEarth(celda, hora)` (J3.1), sin interpolar | Bits de `hours × n × n`, mismo orden, bit menos significativo primero |
| `masks.bin` | Máscara del horizonte de cada celda, en centésimas de grado (J3.4) | `Int16Array` de `n × n × 72`, little-endian: `masks[i * 72 + k]` para el azimut `k × 5°` desde el norte hacia el este |
| `series.json` | Azimut y elevación del Sol y de la Tierra hora a hora desde `startUtc`, sin relieve (J3.4, J4.1) | El formato de `viewpoint/data/<región>/series-2027.json` con `count = hours + 720`; el anillo usa las `hours` primeras |
| `solver.json` | Lo que dice el resolutor de cada nivel (J9.1): si se puede ganar, si es trivial, los márgenes de batería y de tiempo de la mejor victoria y su jugada | JSON por nivel (`beg`, `mid`, `exp`): `winnable`, `trivial`, `batteryMargin`, `timeMarginH`, `actions`, `route` |
| `map.png` | Sombreado del relieve, en gris. Solo se ve sin WebGL (o con render por software) | PNG de 512 × 512 |
| `map-normals.png` | Normales del relieve de detalle (J4.1): cráteres pequeños y ruido del prototipo, solo visuales | PNG RGB de 1024 × 1024, `(n + 1) / 2 × 255`; `x` al este, `y` al sur (hacia abajo en la imagen), `z` arriba |
| `map-albedo.png` | Albedo del relieve de detalle (J4.1) | PNG gris de 1024 × 1024, 0 a 255 = 0 a 1 |
| `map-ao.png` | Oclusión ambiental del relieve de detalle (J4.1) | PNG gris de 1024 × 1024, 0 a 255 = 0,55 a 1,12 |
| `map-horizon.png` | Horizonte por píxel del mapa (J4.2): 256 × 256 puntos y 48 direcciones, con el relieve y el trazado de las máscaras de `makeWorld` | Atlas PNG gris de 8 × 6 teselas de 256 × 256; tesela `d` (azimut `d × 7,5°`) en la columna `d % 8`, fila `⌊d / 8⌋`; grados = −2 + valor × 0,05 |
| `map-horizon-low.png` | El mismo horizonte en calidad baja (J4.3): 128 × 128 puntos y 24 direcciones | Atlas PNG gris de 6 × 4 teselas de 128 × 128, misma codificación |

`levels.json` va en `rolegame/data/` (lo comparten todos los escenarios mientras no haya motivo para lo contrario).

Además de las cifras del prototipo, cada nivel lleva `slopeCost` (J1.1), `hints` (J6.5: `false` en experto, sin pistas) y, en los niveles con `event`, las cifras del evento (J6.4): `eventFrom` y `eventSpan` (el evento cae en `[eventFrom, eventFrom + eventSpan)` h), `spikeE` (puntos que quita el pico de consumo) y `antennaH` (horas que transmitir cuesta el doble). El evento lo sortea `newGame(scenario, level, tables, { seed })` con la semilla que elige la pantalla (`?seed=` la fija) o lo fuerza `{ event: { at, type } }` (tests y resolutor).

El mapa (J4.1) se pinta en dos canvas apilados: `#map-gl` (WebGL directo, sin three.js, `rolegame/src/map-gl.js`) combina normales, albedo, oclusión, la dirección del Sol de `series.json` y la fracción de Sol de cada celda (`sun.bin` a esa hora); encima, `#map` (2D, transparente) lleva la ruta, la plataforma, el rover y las capas, y recibe toques, teclado y foco. Sin WebGL, con render por software, si la portada midió que el equipo va lento, si el jugador eligió «Modo ligero» o si se pierde el contexto, `#map` vuelve a pintar `map.png` con el velo de sombras (modo ligero, J10.4: `chooseMapMode` en `rolegame/src/map-mode.js` y el dibujo en `rolegame/src/map-2d.js`; lo orquesta `rolegame/src/map-backdrop.js`). Descarga: la carpeta del escenario ≤ 5 MB y los ficheros del primer dibujo ≤ 3 MB. Las sombras del mapa (J4.2) salen del horizonte por píxel en la GPU (`pixelSun` de `rolegame/src/map-light.js`, la fórmula de `sunFrac`); hasta que llega, el Sol de cada celda (`sun.bin`). Solo se descarga el horizonte del nivel de calidad (J4.3, `rolegame/src/map-quality.js`, con `shared/render/quality.js`): `alto` y `medio`, el completo con penumbra; `bajo`, el reducido sin penumbra. Bajo el mapa, una leyenda HTML (J4.4) y, en el mapa, la escala de 2 km y el rumbo del Sol.

La Luna 3D (J8, #233) va en el recuadro «Dónde estás» (`#moon`), encima del panel desde 900 px y en una pestaña «Luna 3D» por debajo (J8.2, `rolegame/src/view-tabs.js`). Es la única parte que usa three.js (0.160, por la importmap de `rolegame/index.html`; la versión está en `shared/render/three-version.js`): `rolegame/src/moon-panel.js` pide `moon3d.js` con `import()` dinámico tras el primer dibujo del mapa, solo en modo completo y, en el móvil, solo al abrir la pestaña. En modo ligero, sin WebGL o con el contexto perdido, el recuadro y las pestañas se ocultan y three.js no se descarga. La escena usa el globo compartido (`createMoonGlobe`, `shared/render/moon-globe.js`, #140), la Tierra de `shared/render/earth.js` y el Sol y la Tierra de `series.json` (`rolegame/src/moon-sky.js`, puro, con `sampleAt` del Mirador). Solo se pinta cuando cambia el reloj, al girar o acercar y para el pulso del anillo (nada con movimiento reducido, con el recuadro fuera de la vista o con la pestaña del navegador oculta).

## Escenario de J0 y región

- **Relieve:** el procedural del prototipo (`makeWorld` con semilla 11), con su salida `(24, 31)` y su plataforma `(34, 11)`.
- **Efemérides:** las de `shackleton-rim` en 2027, las mismas que el tour. El relieve procedural está pensado para un Sol rasante de en torno a 1°, que es lo que hay en Shackleton.
- **Fecha de inicio:** la elige el script del escenario dentro de 2027: el primer instante en que el Sol, sin relieve, se mantiene por encima de 0,5° durante toda la misión (14 días) y la Tierra asoma en algún momento. Si no hay ninguno, el script falla y lo dice (no se baja el umbral a escondidas). Se guarda en `scenario.json`; se revisa con el resolutor en J9.1.
- **Escenarios como datos (J9.2):** cada escenario es una entrada de `pipeline/game-scenarios.json` (`id`, `name` en `es` y `en`, `siteId`, `source` `procedural` o `lola`, `start`, `pad` y la regla de la fecha: `startRule` o una `startUtc` fija). `node pipeline/game-scenario.mjs --scenario <id>` genera uno; sin argumento, `procedural-shackleton` con los mismos bytes de siempre. La pantalla abre el `default` de `rolegame/data/scenarios.json` (desde #313, `lola-mouton`) y `?scenario=<id>` abre otro de su lista. Un escenario puede cambiar campos de los niveles (`levels` en su entrada y en su `scenario.json`): Mons Mouton acorta el día límite a 8, 7 y 6 días.
- **Fuente LOLA (J9.2):** 48 × 48 celdas de 250 m centradas en el sitio, en el marco de escena de su centro (`createSceneFrame`, norte hacia `−y`). Altura del DEM en el centro de cada celda (sin curvatura), máscara de `buildMask` (observador a 2 m, preciso) girada a los ejes del centro con `toCenterAxes` y remuestreada a 72 azimuts, y `map.png` sombreado desde el DEM en cada píxel. `sun.bin` y `earth.bin` salen con las mismas fórmulas que el procedural. `scenario.json` añade `source` (`type: 'lola'`, `products`, `demVersion`, `citation`) y `center`; la etiqueta de la pantalla pasa a «Relieve real · <región>».
- **Región real (J9): pendiente.** La portada sitúa la misión 03 en **Mons Mouton**, donde aterrizó Athena (IM-2), que es la historia que cuenta el juego; el catálogo ya la tiene (`im2-alunizaje`, `im2-objetivo`). El desglose propone Shackleton para compartir datos con el tour. A Mons Mouton (84,8° S) el Sol sube hasta unos 6° y hay noche lunar, lo que obliga a revisar duración y niveles. REVISAR con producto antes de J9.

## Cabina del rover (J12)

La cabina (`rolegame/src/cabin/`) es otra vista de la misma partida: el motor no cambia y el resolutor sigue valiendo.

- **Cuándo:** solo con el mapa completo (WebGL) y en un escenario LOLA cuyo sitio tiene región en el Mirador (`cabinRegion`); en el procedural, en modo ligero o sin WebGL no hay interruptor y no se descarga nada 3D. three.js y el relieve llegan con `import()` al abrir la cabina.
- **Relieve:** el del Mirador (`viewpoint/data/<sitio>/`, leído con `loadRegion(id, null, '../viewpoint/data/')`), en el mismo marco que la rejilla del juego (`cellToScene`). El suelo es el del Mirador a pie (#403): los mismos niveles LOLA y el mismo material (`createTerrainLook` de `viewpoint/src/terrain-material.js`, con el regolito ilustrativo de `surface-detail.js` y su regla por calidad), sin parche ni pedruscos propios. Encima la cabina solo añade lo del juego: la luz del mapa (`sun.bin`) por píxel, la sombra del propio rover (`ownShadowGlsl` de `moments.js`) y la capa «Tierra visible»; no cambia el juego. La curvatura de la Luna solo se dibuja (el borde de la región se esconde tras el horizonte).
- **Conducir:** W A S D o las flechas (mando táctil en móvil). El rover se mueve de forma continua y, al cruzar a una celda vecina, `game.cabinStep(celda)` aplica `move(state, [celda])`: batería, tiempo, eventos y final, como en el tablero. Parado, el tiempo no corre. Una celda más empinada que `maxSlope` lo frena con una sacudida.
- **HUD:** el del mapa (J13.2) sigue encima; el mapa se encoge a minimapa en una esquina (tocarlo planea una ruta) y hay una barra de acciones con las teclas de J10.3 (en la cabina, S es marcha atrás).
