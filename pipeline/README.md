# pipeline/

Datos precalculados que consumen las pantallas del tour. El resultado **se sube al repo**: no se genera al arrancar.

## `ephemeris.mjs`

Genera `viewpoint/data/shackleton-rim/series-2027.json`: la serie horaria (2027-01-01T00:00Z a 2027-12-31T23:00Z, 8760 muestras) del azimut y la elevación del Sol y de la Tierra vistos desde la cresta de conexión de Shackleton (`shackleton-rim`). Usa `series()` del mismo motor que la API v1 (`backend/src/`, compartido con `data/`), con la máscara de horizonte LOLA del catálogo y el observador a 2 m (fijo, no depende de `LUNAR_OBSERVER_HEIGHT_M`). Coincide con `/v1/sun-earth?…&terrain=1`. Sin `terrain` la API usa un horizonte esférico, y entonces solo coinciden `az` y `el`, no `visibleFraction`. La cabecera lleva `observerHeightM`, y `source` recoge el modelo de horizonte y el `demVersion` que usó `series()`.

- Azimut desde el norte selenográfico local hacia el este, en grados; elevación del centro del disco. Cuatro decimales.
- En lugar de la lista de fechas se guardan `start` y `stepMinutes` (la muestra `i` es `start + i · stepMinutes`), para que pese menos de 400 KB.
- `visibleFraction` (fracción visible del disco, 0 a 1) se guarda para el Sol y la Tierra: con la máscara de relieve puede ser 0 con `el > 0` (el terreno tapa el cuerpo), y quien consuma el fichero no debe fiarse solo de `el > 0`.

```sh
npm ci --prefix backend      # una vez: astronomy-engine
npm run pipeline:ephemeris   # regenera el fichero (determinista: mismo contenido siempre)
npm run test --prefix pipeline
```

## `mask-grid.mjs` (E2.0)

Genera la **rejilla de máscaras** de horizonte alrededor de un sitio, para saber la luz y la Tierra en cualquier punto de la zona y no solo en la bandera (la usarán E2.2 y E2.5). Escribe `viewpoint/data/<id>/masks.bin` y añade el bloque `maskGrid` a su `meta.json`.

- **Rejilla:** 4 × 4 km centrada en el sitio, un punto cada 100 m (41 × 41 = 1.681 puntos). Cada punto de la escena `(x, z)` pasa a lat/lon con `fromScene` (`viewpoint/src/core/scene-frame.js`) y su máscara sale de `buildMask(lat, lon, { observerHeightM: 2, resolution: 'precise' })` (`backend/src/terrain/horizonMask.ts`).
- **Ejes de la región:** la máscara se guarda ya con el azimut respecto al norte local del **centro** (el de `series-2027.json`) y la elevación sobre la vertical del centro. Cerca del polo el norte local gira unos 3,4° por km y la vertical se inclina unos 0,03° por km, así que cada dirección del horizonte se gira (`toCenterAxes`) y se remuestrea a los azimuts de la región; no se copia. El cliente compara directamente con el azimut y la elevación de la serie, sin correcciones.
- **Orden de ejecución:** `relief.mjs` reescribe `meta.json` entero y borra el bloque `maskGrid`. Tras regenerar el relieve o la serie, vuelve a ejecutar `mask-grid.mjs`. Un test falla si hay `masks.bin` sin `maskGrid` (o al revés), para que no pase en silencio. `masks.bin` tiene su propio presupuesto (2,5 MB por región) y los tests de peso del relieve no lo cuentan.
- **Formato de `masks.bin`:** `int16` little-endian, centésimas de grado, `azimuths` valores por punto (azimut `k · 360 / azimuths` desde el norte, hacia el este). Los puntos van por filas de norte a sur y de oeste a este (como el relieve): el punto `(col, fila)` empieza en `(fila · cols + col) · azimuths` valores. Elevación en grados = valor / 100.
- **Bloque `maskGrid` de `meta.json`:** `file`, `extentKm` (4), `stepKm` (0,1), `cols`, `rows`, `azimuths`, `encoding` (`int16-le`), `observerHeightM` (2) y `demVersion`.
- **Misma versión del DEM que la serie:** si la `demVersion` del DEM local no coincide con la de `series-2027.json`, el script falla y lo dice. Hace falta el DEM descargado (`cd backend && node scripts/fetch-dem.ts`); unos 4 min por región.
- Determinista: mismos bytes con el mismo DEM.
- **Decisión 360 o 720 azimuts:** por defecto **360** (`--azimuths 720` los dobla). La decide un test (`pipeline/test/mask-grid.test.js`, «360 or 720 azimuths»): construye la rejilla con 360 y con 720 sobre un relieve sintético de crestas muy afiladas (celdas de 20 m, crestas de σ 30 m) y comprueba que `AZIMUTHS` es el más pequeño que cumple la paridad del 98 %. Resultado: con 360 la paridad peor es del 98,9 %, así que 360 (~1,2 MB por región, la mitad). Cuando existan los `masks.bin` reales, el mismo test los mide con el DEM real y falla si `maskGrid.azimuths` no es el más pequeño que cumple; si con el DEM real 360 no llegara al 98 %, se sube `AZIMUTHS` a 720 (~2,4 MB, bajo el límite de 2,5 MB).
- **Núcleo en el cliente** (`viewpoint/src/core/mask-grid.js`): `decodeMaskGrid(meta, buffer)`, `maskAt(grid, x, z)` (bilineal entre las cuatro máscaras vecinas) y `discFraction(mask, az, el, radiusDeg)` (fracción visible de un disco; portada de `visibleFraction` y `fractionOver` de `backend/src/visibility.ts`). `masks.bin` se descarga en segundo plano después de la primera escena (`loadMaskGrid` en `viewpoint/src/region.js`).

```sh
cd backend && node scripts/fetch-dem.ts && cd ..       # una vez
node pipeline/mask-grid.mjs --site shackleton-rim
node pipeline/mask-grid.mjs --site im2-objetivo
```

## `horizon-mask.mjs` (E1.1)

Copia la máscara de horizonte del catálogo de cada región (`backend/terrain/masks/<id>.json`) a `viewpoint/data/<id>/mask.json`, para el anillo del horizonte de la exploración. Es una copia, no un remuestreo: los mismos 720 azimuts (`stepDeg` 0,5) con los que el motor calculó el `visibleFraction` de `series-2027.json`, con su `source` y su `demVersion`. Pesa unos 4 KB por región. Sin `--site` escribe las regiones con serie (`shackleton-rim` e `im2-objetivo`). Un test falla si `mask.json` no está al día o si su `demVersion` no es el de la serie.

```sh
npm run pipeline:horizon-mask
```

## Otras regiones (`--site <id>`)

`ephemeris.mjs` y `relief.mjs` aceptan `--site <id>` (por defecto `shackleton-rim`) y escriben en `viewpoint/data/<id>/`. Añadir una región es ejecutar estos comandos y añadir su id a `REGION_IDS` en `viewpoint/src/core/regions.js`. Hace falta que el sitio esté en el catálogo y tenga máscara en `backend/terrain/masks/`, y el relieve solo sale con `--source lola` (el procedural es solo de Shackleton). El tour abre una región con `viewpoint/?region=<id>`; sin parámetro o con un id desconocido abre Shackleton.

Mons Mouton (`im2-objetivo`, IM-2 Athena, −84,7754°, 29,128°). Fuera del polo la región no cabe en una sola ventana de 20 m (las esquinas están a 28 km), así que además de la ventana hace falta la base de 160 m:

```sh
cd backend && node scripts/fetch-dem.ts                                             # base de 160 m (y 240 m)
cd backend && node scripts/fetch-dem.ts --near -84.7754,29.128 --half-km 22         # ventana de 20 m
node pipeline/relief.mjs --site im2-objetivo --source lola
node pipeline/ephemeris.mjs --site im2-objetivo
```

## `relief.mjs`

Genera el relieve alrededor de un sitio en `viewpoint/data/<id>/`, con el formato definitivo del desglose (sección 3.4). La fuente se elige con `--source lola|procedural|simulated` (por defecto `procedural`, que no necesita DEM). Sin `--site` es la cresta de conexión de Shackleton (`shackleton-rim`), la única con relieve procedural. LOLA y simulado sirven también para cualquier sitio polar de la web (`--site <id>`), con la región centrada en sus coordenadas. Los ficheros de `viewpoint/data/` que están subidos son los **LOLA**.

- `meta.json`: id, nombre, centro (lat/lon del catálogo), extensión (40 × 40 km), rejilla (257 × 257, paso de 156,25 m), codificación de las alturas (`uint16-le`, `offset` y `scale` en km), fuente y los parámetros de `SceneFrame` (`viewpoint/src/core/scene-frame.js`).
- `terrain-lod0.bin`: alturas en 16 bits, little-endian, por filas de norte a sur y de oeste a este. Altura en km = `offset` + valor · `scale`.
- `terrain-far.bin` (solo con `--source lola`, E9.2): el anillo del horizonte lejano, una rejilla gruesa de **300 × 300 km** centrada en el centro de la región (`meta.center`), 257 × 257 (paso de ~1,17 km), con la misma codificación y la misma fórmula de curvatura (a 150 km la Luna «cae» unos 6,5 km). Sus alturas salen de las capas de 160/240 m (`layersFor(…, 'fast')`). `meta.json` lo describe en `far: { file, extentKm, grid, heights }`; sin `far` (los ficheros procedurales) el cliente solo dibuja la zona fina. Pesa unos 132 KB. Lo tienen todas las regiones LOLA (#430): `shackleton-rim`, `im2-objetivo`, `ridge-slope`, `malapert`, `gerlache` y `mouton`. Sin él, el relieve acababa en el cuadrado de 40 km y, a ras de suelo, se veía cielo por debajo del borde. Cada región descarga solo el suyo; con los seis, `viewpoint/data/` pesa unos 4,6 MB.
- Determinista: mismos bytes en cada ejecución con la misma entrada. Cada fichero de alturas pesa unos 133 KB.

### Rejillas de detalle alrededor del sitio (#97)

Con LOLA, además, se escriben dos rejillas más finas centradas en el sitio, para que el visor 3D (`viewpoint/`) tenga relieve de decenas de metros donde mira la cámara sin subir el peso de toda la zona:

| Fichero | Lado | Rejilla | Paso | Codificación | Peso |
|---|---|---|---|---|---|
| `terrain-lod0.bin` | 40 km | 257 × 257 | 156,25 m | `uint16-le` | 132 KB |
| `terrain-lod1.bin` | 20 km | 257 × 257 | 78,1 m | `delta16-gzip` | 71 a 77 KB |
| `terrain-lod2.bin` | 10 km | 513 × 513 | 19,5 m (la resolución de `LDEM_80S_20MPP_ADJ`) | `delta16-gzip` | 232 a 277 KB |

- `meta.json` las lista en `detail`, de gruesa a fina: `extentKm`, `grid`, `heights` (con su `offset` y su `scale`) y los `products` del DEM que ha usado cada una. El campo es opcional y solo añade: quien no lo conozca sigue dibujando la zona con `terrain-lod0.bin`, que no cambia.
- **`delta16-gzip`:** las mismas alturas de 16 bits por filas, pero cada valor se guarda como su diferencia con la predicción `izquierda + arriba − arriba-izquierda` (módulo 2^16), primero los bytes bajos de todos los nodos y luego los altos, y todo comprimido con gzip. Pesa la mitad que en plano. El cliente lo descomprime con `DecompressionStream` y lo deshace con `unpackDelta16` (`viewpoint/src/core/relief.js`); si el navegador no puede, dibuja la zona con `terrain-lod0.bin`.
- Cada rejilla ocupa un número entero de celdas de la anterior, con el borde sobre sus líneas (`DETAIL_LEVELS` en `relief.mjs`). Así el cliente las cose sin grietas: `buildLevels` funde cada una con la anterior en una banda del borde y le da allí la misma normal.
- **Cuándo se escriben:** solo con LOLA, y solo si todos los nodos de la rejilla salen de un DEM de resolución no mayor que dos pasos de la rejilla (`DETAIL_MAX_DEM_STEPS`). Sin ventana de 20 m (solo el DEM de 160 m) no se escribe ninguna: no habría nada más fino que enseñar. Los relieves procedural y simulado son lisos y tampoco las llevan. El script borra las que quedaran de una ejecución anterior.
- Las tienen `shackleton-rim`, `im2-objetivo`, `ridge-slope`, `malapert` y `gerlache`. `mouton` no: su zona sale solo del DEM de 160 m (#80) y se dibuja con su rejilla de 156 m. Añadirlas no cambia `terrain-lod0.bin`, `terrain-far.bin` ni el `demVersion` de ninguna zona.
- Cada zona gana entre 0,31 y 0,36 MB. `viewpoint/data/` entera pasa de 1,58 MB a 3,22 MB; cada misión descarga solo su zona.

### Fuente LOLA

- Cada nodo `(x, z)` pasa a lat/lon con `fromScene` y su altura sale del DEM con el motor de `backend/src/terrain/dem.ts`: interpolación bilineal en la rejilla más fina de `layersFor(lat, lon, 'precise')` que cubra el punto.
- **Curvatura:** la escena es el marco tangente en el centro, así que `y = (R + h) · cos θ − R`, con `R = 1737,4 km`, `h` la altura del DEM en km y `θ` el ángulo central entre el nodo y el centro. En la esquina (28,3 km) la Luna «cae» unos 230 m. El centro queda a la altura real del DEM (unos 1958 m en la bandera), no a 0.
- `meta.json` lleva `source: { type: 'lola', products, demVersion, citation }`. `products` son las rejillas que se han usado de verdad.
- Si ningún DEM cubre un nodo, el script falla en vez de inventar la altura.

DEM (una vez, fuera de git, ~400 MB en `backend/terrain/cache/`; PGDA limita las peticiones, tarda varios minutos):

```sh
npm ci --prefix backend
cd backend && node scripts/fetch-dem.ts                                                    # base de 160 m y 240 m
cd backend && node scripts/fetch-dem.ts --near -89.44027,-137.12649 --half-km 22          # ventana de 20 m que cubre los 40 km
# Si la caché ya tiene otra ventana de 20 m sobre el sitio (p. ej. la de ±16 km de --catalog), el comando anterior no descarga nada
# y los nodos lejanos de terrain-lod0.bin salen del producto de 160 m: cambian unos metros. Para regenerar los mismos bytes,
# usa una caché aparte: --dir <carpeta> en fetch-dem.ts y --dem-dir <carpeta> en relief.mjs.
npm run pipeline:relief:lola                          # regenera los ficheros con LOLA
node pipeline/relief.mjs --source lola --dem-dir <carpeta>   # usa otra caché de DEM (por defecto backend/terrain)
node pipeline/relief.mjs --far-only --site <id>       # solo el anillo lejano de esa región (sin --site, shackleton-rim): añade `far` a meta.json y no toca terrain-lod0.bin (basta el DEM de 160/240 m)
npm run pipeline:relief                               # procedural, sin DEM (escribe en la misma carpeta: no lo subas)
npm run test --prefix pipeline
```

Cliente (`viewpoint/src/core/far-relief.js`, `viewpoint/src/scene.js`): una segunda malla con el anillo, con el hueco de la zona fina, mismo material y sin proyectar sombras (las del relieve lejano son E5.2). En una franja de 2 km dentro del borde de la zona fina, su altura se mezcla linealmente hacia la del anillo (en el borde es la del anillo), así que no hay escalón en la junta.

### Fuente simulada (V2.1, #76)

Genera la región de cualquier sitio polar del catálogo de la web (`web/js/engine/catalog.js`) en `viewpoint/data/<id>/`, con el relieve inventado del motor simulado: el mismo terreno con el que decide el veredicto cuando la web va con datos simulados (GitHub Pages).

- Cada nodo `(x, z)` pasa a lat/lon con `fromScene`, luego al mapa polar del modelo con `toMap`, y su altura es `elevation(x, y)` de `web/js/engine/model.js` (importada, no copiada). Se aplica la misma curvatura que con LOLA.
- `meta.json` lleva `source: { type: 'simulated', origin, note }`; la nota dice que el relieve es inventado.
- Sin `--site`, `--source lola` y `--source procedural` dan los mismos bytes que antes para `shackleton-rim`.
- Límite: la región mide 40 km y el horizonte del veredicto con datos de ejemplo mira hasta unos 220 km. Las montañas lejanas tapan en el veredicto y no se ven en 3D (#45).

```sh
node pipeline/relief.mjs --source simulated --site malapert   # ridge-slope, malapert, gerlache o mouton
```

Sirve para los sitios que no tengan DEM LOLA. Las regiones subidas son todas LOLA: la simulada de 40 km es una loma o un cuenco liso, sin detalle (las campanas de `elevation()` miden decenas de km).

### Regiones subidas

| Sitio de la web | Carpeta | Fuente |
|---|---|---|
| `connecting-ridge` | `shackleton-rim` | LOLA (catálogo del backend) |
| `ridge-slope`, `malapert`, `gerlache`, `mouton` | la misma id | LOLA, centrada en las coordenadas (aproximadas) de `web/js/engine/catalog.js` |

Para regenerar las cuatro (con el DEM base y las ventanas de 20 m de cada sitio; Mons Mouton, a −84,6°, queda fuera de las ventanas de 20 m y sale del DEM de 160 m):

```sh
cd backend && node scripts/fetch-dem.ts && for p in -89.463,-151.2 -86.0,0.0 -87.97,-87.1; do node scripts/fetch-dem.ts --near $p --half-km 22; done
for s in ridge-slope malapert gerlache mouton; do node pipeline/relief.mjs --source lola --site $s; done
```

Qué ventana de 20 m hay en la caché decide los bytes (una ventana de más sobre `mouton` cambiaría su `terrain-lod0.bin`). Las zonas subidas salen cada una de una caché con el DEM base y solo sus ventanas (`--dir` en `fetch-dem.ts`, `--dem-dir` en `relief.mjs`): `shackleton-rim` con la suya; `im2-objetivo` con la suya; `ridge-slope`, `malapert`, `gerlache` y `mouton` con las tres del comando de arriba. El `demVersion` de cada `meta.json` es el de su caché.

Con datos de ejemplo el veredicto usa el relieve de `model.js` y la escena el de LOLA: el visor lo avisa (#82, opción b).

El cliente muestra «Relieve LOLA» o «Relieve inventado» (procedural o `simulated`) según `meta.source.type`, con el vocabulario de #338. En el visor de una misión, si el relieve y el veredicto tienen fuentes distintas (veredicto con datos de ejemplo sobre relieve LOLA, o veredicto con datos reales sobre relieve inventado), la etiqueta lo avisa. La parte procedural está portada del prototipo (`docs/mirador-polo-sur/index.html`: `rng`, `REGIONS.shackleton`, cráteres pequeños, `feat` y `Hr`), en km y con el centro en (0, 0).

## `game-scenario.mjs`

Genera el escenario del juego «Varados en el polo» en `rolegame/data/procedural-shackleton/` (`scenario.json`, `cells.bin`, `sun.bin`, `earth.bin`, `masks.bin`, `series.json`, `map.png`, `solver.json`, las texturas de detalle `map-normals.png`, `map-albedo.png` y `map-ao.png`, y los horizontes por píxel `map-horizon.png` y `map-horizon-low.png`) y `rolegame/data/levels.json`. La disposición de cada fichero está en [`docs/arquitectura-juego.md`](../docs/arquitectura-juego.md#ficheros-del-escenario-j0) y se repite en `scenario.json` (`files`).

- Relieve procedural, máscaras de 72 azimuts, `sunFrac` y `earthVis` portados del prototipo (`docs/juego-rol/index.html`). **No** se portan `sunAt` ni `earthAt`: el azimut y la elevación salen, hora a hora, de `series()` del motor de `backend/src/` para `shackleton-rim`.
- Fecha de inicio: el primer instante horario de 2027 en que el Sol, sin relieve, está por encima de 0,5° durante las 336 h y la Tierra asoma en alguna. Si no hay ninguno, el script falla. Queda escrita en `scenario.json` (`startUtc` y `sources`).
- Determinista: mismos bytes en cada ejecución. La carpeta pesa unos 2,8 MB (las texturas de J4.1, más de la mitad).
- Antes de escribir nada pasa el resolutor (`game-solver.mjs`): si algún nivel no se puede ganar o es trivial, falla y dice cuál.

```sh
npm ci --prefix backend      # una vez: astronomy-engine
npm run pipeline:game-scenario
```

### Escenarios LOLA (J9.2)

Cada escenario es una entrada de `pipeline/game-scenarios.json`. Con `source: "lola"` el relieve sale del DEM LOLA de `backend/terrain/cache/`: 48 × 48 celdas de 250 m (12 × 12 km) centradas en el sitio, altura del DEM en el centro de cada celda, máscara del horizonte con `buildMask` (observador a 2 m, preciso) girada a los ejes del centro con `toCenterAxes` (como `mask-grid.mjs`) y `map.png` sombreado desde el DEM píxel a píxel (unos 23 m por píxel). Si ningún DEM cubre una celda o un píxel, el script falla y dice cuál.

```sh
cd backend && node scripts/fetch-dem.ts && node scripts/fetch-dem.ts --near <lat>,<lon> --half-km 22   # una vez
node pipeline/game-scenario.mjs --scenario lola-shackleton   # unos 6 min: 2.304 máscaras precisas
node pipeline/game-scenario.mjs --scenario lola-mouton      # Mons Mouton (#313), ventana de 20 m del DEM: fetch-dem.ts --near -84.7754,29.128
```

`scenario.json` lleva `source` (`type: 'lola'`, `products`, `demVersion`, `citation`) y `center`. La `demVersion` es la de la caché de quien lo genera: es un hash del conjunto de ventanas descargadas, así que no tiene por qué coincidir con la de la región del Mirador. Lo que se comprueba es el relieve: el test compara `cells.bin` con `terrain-lod0.bin` de `viewpoint/data/<siteId>/` (diferencia media por debajo de 30 m).

## `game-solver.mjs`

Resolutor de los niveles del juego (J9.1). Juega cada nivel de `levels.json` con el **mismo motor** que el navegador (`rolegame/src/engine/`, importado tal cual: no copia ninguna regla) y escribe `solver.json` en la carpeta del escenario.

- **Búsqueda:** programación dinámica sobre `(celda, media hora, paquetes enviados)`. Desde cada nodo prueba esperar 0,5 h (`wait`), transmitir (`transmit`) y un paso a cada vecina que la pendiente permite (`move`), y en cada nodo guarda solo el estado con más batería. Es una cota inferior: una victoria encontrada es real (es el estado del propio motor); si no encuentra ninguna, el nivel se da por no ganable.
- **Trivial:** un nivel es trivial si, al empezar y sin esperar, ir directo de la salida a ASCENSO por `pathTo` y transmitir allí los paquetes (ninguno si `need` es 0) gana.
- **Márgenes** de la mejor victoria (la de más batería; a igualdad, la que antes acaba): `batteryMargin` = batería al ganar − `minBat` (puntos de %) y `timeMarginH` = `deadline` − hora al ganar. La mejor victoria por batería suele esperar a cargar al 100 %, así que el margen de tiempo es el de esa jugada, no el de la más rápida.
- **`solver.json`:** por nivel, `winnable`, `trivial`, `batteryMargin`, `timeMarginH`, `actions` (`move` con `path`, `wait` con `hours` y `transmit`; las esperas y los pasos seguidos, fundidos) y `route`. Determinista. Lo leerá J7 para la ruta de referencia del final.
- Sin eventos (llegan con J6.4).
- **Tiempo:** los tres niveles de `procedural-shackleton` se resuelven en unos 35 s en un portátil (Apple Silicon, Node 24).

`npm run pipeline:game-solver` resuelve el escenario ya escrito y regenera solo `solver.json` (para probar cambios de `levels.json` sin regenerar las tablas); con `--scenario <id>`, otro escenario. Al terminar imprime la tabla:

```text
Nivel  Ganable  Trivial  Margen de batería  Margen de tiempo
beg    sí       no       85 %               17,7 h
```

## `game-candidates.mjs`

Propone la fecha, la salida y la plataforma de una partida (J9.3) con el resolutor de J9.1. No escribe nada en el repo: **elige producto**, y elegir es cambiar datos.

```sh
node pipeline/game-candidates.mjs --scenario procedural-shackleton [--json candidatos.json]   # o npm run pipeline:game-candidates
```

Lee el relieve del escenario ya escrito (`cells.bin` y `masks.bin` de `rolegame/data/<id>/`) y las reglas de `candidates` en su entrada de `pipeline/game-scenarios.json` (si falta un campo, el valor de `CANDIDATE_DEFAULTS`; todos REVISAR con producto):

| Campo | Qué filtra |
|---|---|
| `dateStepH` | Fechas: cada inicio horario del año de `startRule.search` que cumple la regla de `pickStart` (Sol por encima de `sunMinEl` sin relieve toda la misión y la Tierra asomando en alguna hora), cada `dateStepH` horas |
| `earthRise` | La Tierra empieza a verse desde alguna celda del mapa dentro de esa franja de la misión (fracciones; por defecto, del 25 % al 75 %). Van primero las fechas en que asoma más cerca de la mitad |
| `edge` | Ni la salida ni la plataforma están a menos de `edge` celdas del borde del mapa, donde el horizonte está cortado |
| `padKm` | Distancia en línea recta de la salida a la plataforma (por defecto, de 4 a 7 km) |
| `batteryMargin`, `timeMargin` | Por nivel, `[mínimo, máximo]` del margen de la mejor victoria del resolutor. La mejor jugada espera a cargar, así que su margen de batería sale casi siempre al máximo (`100 − minBat`): solo sirve para «por los pelos». Si un nivel es demasiado fácil se ve en el margen de tiempo, que tiene máximo |
| `dates`, `starts`, `pads` | Cuántas fechas, salidas y plataformas por salida llegan al resolutor (cada combinación tarda unos 20 s) |

Salidas: celdas en sombra en la hora 0 («aquí casi no llega el Sol»), de la más oscura a la menos (media de la fracción de Sol en las primeras 24 h). Plataformas: ni siempre al Sol ni siempre en sombra, alcanzables con la pendiente máxima de cada nivel y con ningún nivel trivial (filtro barato, antes del resolutor), repartidas por distancia. Orden: por el menor margen de batería de los tres niveles (más alto, mejor), luego por el menor margen de tiempo (más alto, mejor), y luego fecha, salida y plataforma (determinista). Imprime los tres mejores; si ninguno pasa, dice qué filtro descartó más combinaciones y cuál relajar (no lo relaja solo).

**Para aplicar un candidato:** copia su `startUtc`, `start` y `pad` en la entrada del escenario en `game-scenarios.json` y regenera con `game-scenario.mjs --scenario <id>`.

**Niveles por escenario (#313):** una entrada puede cambiar campos de los niveles con `levels` (por ejemplo, `"levels": { "exp": { "deadline": 144 } }`). `scenarioLevels(cfg)` los mezcla sobre `LEVELS`, y falla si el nivel o el campo no existen; el resolutor y la búsqueda de candidatos juegan esa mezcla, y `scenario.json` guarda los campos cambiados en `levels` para que el juego haga la misma mezcla sobre `levels.json` (`levelsFor` de `rolegame/src/scenario-source.js`). Mons Mouton acorta el día límite (8, 7 y 6 días): con los niveles comunes sobraba tiempo en los tres.

## Cifras del escenario (`facts`, J9.4)

`game-scenario.mjs` calcula con `scenarioFacts` y guarda en `scenario.json` las cifras que dicen los textos de experto y las lecciones del final, para que el cliente no escriba ninguna a mano: `earthFirstDay` y `earthLastDay` (días en que la Tierra se ve desde alguna celda, de `earth.bin`), `sunMaxElDeg` (altura máxima del Sol sin relieve), `sunAzPer48hDeg` (cuánto avanza su acimut en 48 h, de media), `earthElRangeDeg` (altura mínima y máxima de la Tierra), `padKm` (la de `padDistanceKm` del cliente) y `startMaskNorthDeg` (horizonte más alto de la salida entre los 315° y los 45°).


## `ground.mjs`: suelo de 5 m a pie (E3, #181)

Añade a `meta.detail` un nivel de 2,5 km a 4,88 m alrededor del sitio, sacado de los DEM LOLA de 5 m/px de PGDA (producto 78, Barker et al. 2021), solo donde uno cubre el cuadrado entero. Detalle en `docs/arquitectura-tour.md`, «Suelo real a pie».

```
cd pipeline && npm i --no-save geotiff@2.1.3 && node ground.mjs [región…]
```
