# API pública v1 · Lunar Landing Site Navigator

Cara pública, mínima y estable del proyecto para el reto NASA Space Apps 2026 «Lunar Landing Site Navigator».
Dado un sitio de la Luna y una fecha, dice **dónde están el Sol y la Tierra**, si se ven y cuándo salen o se
ponen, tratando ambos como **discos** y no como puntos.

El motor de cálculo (efemérides con astronomy-engine, visibilidad de discos, ortos y ocasos, ventanas, ranking y relieve
LOLA) es el del backend: `src/v1.ts` lo importa de [`../backend/src/`](../backend/README.md), **sin copia**, y lo expone
con un contrato pequeño, nombres claros y errores uniformes. Por eso las dependencias del motor (astronomy-engine) se
resuelven desde `backend/node_modules` y hace falta `npm ci` **también en `backend/`** (no hay workspaces de npm por
ahora; es una decisión pendiente del plan de TypeScript).

- Especificación: [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1), servida también en `/openapi.yaml` y `/openapi.json`.
- Documentación interactiva: `GET /docs` (Swagger UI 5.17.14 desde jsDelivr; necesita conexión para cargar el CDN).
- **GraphQL** (desde 1.11.0): `/graphql` sobre el mismo motor, con el explorador GraphiQL en el navegador y el esquema en
  `/graphql/schema.graphql` (ver «GraphQL»).

## Arrancar

Requiere Node 26.13 (ver `engines` en `package.json`).

```sh
(cd ../backend && npm ci)   # el motor de cálculo y sus dependencias
npm ci
npm start          # http://localhost:3100  (PORT=8080 npm start para cambiarlo)
npm test           # node:test: API contra openapi.yaml (servidor en puerto efímero) y precisión frente a JPL Horizons
npm run accuracy   # informe de precisión completo (~30 s); con `-- --write` lo guarda en ACCURACY.md
npm run validate --prefix ../backend   # matriz de validación frente a fuentes oficiales (../VALIDATION.md; necesita el DEM)
npm run validation-summary   # resumen de errores que enseña la web (Horizons, PGDA y las filas ⚠️ de VALIDATION.md); con `-- --write` lo guarda en ../web/assets/validation-summary.json y con `-- --check` falla si está desfasado
npm run typecheck  # tsc en modo strict (también comprueba el motor de ../backend/src que importa)
```

Sin `backend/node_modules` falla al arrancar con `Cannot find package 'astronomy-engine'`.

El puerto por defecto es 3100.

Desde 1.10.0 las peticiones pesadas se calculan en un pool de workers y las respuestas van comprimidas (`br`/`gzip`), con
`ETag` (304 con `If-None-Match`) y `Cache-Control` público solo si todas las fechas son explícitas. Con la cola llena,
503 con `Retry-After`; un cálculo demasiado largo, 504; una URL de más de 8 KiB, 414. Los límites se configuran con las
variables `LUNAR_*` descritas en [`../backend/README.md`](../backend/README.md) («Servidor»), que comparten los dos servidores.

Desde 1.21.0 el servidor puede limitar el ritmo de cada cliente (desactivado por defecto; para un despliegue público,
`LUNAR_RATE_LIMIT=1` y, detrás de un proxy como Cloudflare, `LUNAR_TRUST_PROXY=1`): un cupo de peticiones ligeras y otro de
pesadas por IP; al gastarlo, 429 con `Retry-After` y código `rate_limited`, también en GraphQL. Lo que sale de la caché
no gasta, y una clave de `LUNAR_API_KEYS` en `X-Api-Key` salta el límite. Detalle en
[`../backend/README.md`](../backend/README.md), «Límite de peticiones por cliente».

```sh
curl -i 'localhost:3100/v1/rank?sites=all&start=2027-01-01'   # con el cupo pesado gastado:
# HTTP/1.1 429 Too Many Requests
# retry-after: 1
# ratelimit-limit: 120
# ratelimit-remaining: 0
# ratelimit-reset: 120
# ratelimit-policy: 120;w=120;name="heavy"
# {"error":{"code":"rate_limited","message":"Has superado el límite de peticiones pesadas (60 por minuto, hasta 120 seguidas). Vuelve a intentarlo dentro de 1 s."}}
```

## Rutas

Todas son `GET`, devuelven JSON y llevan CORS abierto. El sitio se indica con `site=<id>` (ver `/v1/sites`)
**o** con `lat` + `lon` (y opcionalmente `heightKm`). `mode` es `limb` (por defecto), `center` o `full`.
`/v1/sun-earth`, `/v1/windows`, `/v1/track`, `/v1/rank` y `/v1/landing-dates` aceptan además `terrain=1`,
`observerHeightM` y, desde 1.6.0, `panelHeightM` y `antennaHeightM` (ver «Relieve»); `/v1/horizon` siempre usa relieve.
`/v1/windows`, `/v1/rank` y `/v1/landing-dates` aceptan los parámetros de noche y batería (ver «Noche y batería»).
Desde 1.9.0 un parámetro desconocido o que no aplica no da error: se ignora y la respuesta lo dice en `warnings` (ver
«Entrada estricta y avisos»). Desde 1.16.0, `/v1/rank`, `/v1/landing-dates` y `/v1/search` aceptan `earthMode` (criterio de
la Tierra distinto del del Sol) y un peso por cada variable de la puntuación (`weightSunAndEarthTimeFraction`,
`weightShortNights`, `weightSunTimeFraction`, `weightShortEarthOutages`, `weightLongestSunAndEarth`), y `/v1/rank` y
`/v1/search` el paso de muestreo `step` (15 min–6 h, 1 h por defecto).

Todas las rutas (y GraphQL, que las llama) usan los casos de uso del motor (`backend/src/useCases.ts`): los valores por
defecto, el relieve, la puntuación, las restricciones y los avisos se deciden ahí, una vez, y las evals usan los mismos.
`test/horizon-band.test.ts   banda de robustez del horizonte (1.18.0): horizonBandDeg en /v1/windows
test/dsn.test.ts            modo DSN (1.24.0): dsn=1 en /v1/windows añade earthDsn
test/single-source.test.ts` comprueba que la misma pregunta da lo mismo por `/v1`, por GraphQL y por el caso de uso.

| Ruta | Para qué |
|---|---|
| `/v1/health` | Estado y versión del contrato |
| `/v1/sites` | Catálogo de sitios (Apollo, CLPS, Chandrayaan-3, SLIM, Chang'e, cresta de conexión de Shackleton) |
| `/v1/regions` | Regiones predefinidas de `/v1/search`, con sus límites. Desde 1.16.0 |
| `/v1/sun-earth` | Sol y Tierra en un instante: azimut, elevación, radio angular, visible, fracción visible, próximo orto/ocaso |
| `/v1/windows` | Ventanas de visibilidad de Sol, Tierra y ambos en un intervalo (máx. 366 días); con `events=1` (1.16.0), también los ortos y ocasos; con `horizonBandDeg` (1.18.0), la banda de robustez del horizonte; con `dsn=1` (1.24.0), la Tierra visible con antena de la DSN disponible (`earthDsn`) |
| `/v1/track` | Azimut y elevación del Sol y de la Tierra paso a paso (máx. 400 días, paso desde 1 min y 3000 instantes; hasta 1.15.0, 60 días y 5 min), con la elevación del horizonte en su azimut y, desde 1.22.0, el radio aparente del disco (`angularRadiusDeg`). Desde 1.2.0 |
| `/v1/horizon` | Perfil del horizonte con relieve LOLA: elevación en cada azimut y altura del terreno. Desde 1.2.0; con `relief=1` (1.19.0), también las alturas del terreno alrededor del sitio, para dibujarlo en 3D |
| `/v1/rank` | Ranking de sitios por energía y comunicación en un periodo (1–120 días) |
| `/v1/best-landings` | Mejores aterrizajes de una ventana con los requisitos de la misión (días, batería, % de Tierra) y una prioridad: para cada sitio, su mejor fecha con veredicto, motivos, puntuación y margen ante retrasos, y los sitios ordenados. Las mismas reglas y el mismo código que la interfaz (`planner/src/ranking.js`). Desde 1.15.0 |
| `/v1/light-map` | Mapa de luz con relieve: parte de un periodo con el Sol y con la Tierra en cada punto de una malla alrededor de un centro (por defecto, el polo sur), para pintar las sombras de una misión. Como mucho 2000 puntos. Desde 1.14.0 |
| `/v1/landing-dates` | ¿Cuándo alunizar? Para un sitio, la misión de N días que empieza en cada fecha candidata: serie, mejores y peores fechas, ventanas buenas y estadísticas. Desde 1.5.0 |
| `/v1/search` | Mejores puntos de una región: malla con refinamiento, la puntuación de `/v1/rank`. Desde 1.13.0; desde 1.16.0, pendiente (`maxSlopeDeg` filtra) y `cells=1` con todos los puntos evaluados |
| `POST /v1/search/jobs`, `/v1/search/jobs/{id}` | La misma búsqueda en segundo plano: 202 con `Location`, estado, progreso y resultado. Desde 1.13.0 |

```sh
curl localhost:3100/v1/health
# {"status":"ok","apiVersion":"1.24.0","uptimeSeconds":42,
#  "terrain":{"dem":true,"demVersion":"lola-c33d4bb7a8cf","slopeProducts":true,"slopeProductBaselinesM":[100,400,800],
#             "catalogMaskSiteIds":["im1","im2-objetivo","im2-alunizaje","chandrayaan3","shackleton-rim"]}}

curl localhost:3100/v1/sites
# {"count":15,"sites":[{"id":"apollo11","name":"Apollo 11","latDeg":0.67408,"lonDeg":23.47297,…},…]}

curl 'localhost:3100/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z'
# {"site":{…},"date":"2027-01-15T00:00:00.000Z","mode":"limb","lookaheadDays":45,
#  "sun":{"azimuthDeg":229.7233,"elevationDeg":0.3834,"angularRadiusDeg":0.271,"visible":true,"visibleFraction":1,
#         "nextRise":"2027-02-27T10:27:24.873Z","nextSet":"2027-02-12T08:05:43.213Z","hoursToNextSet":680.095,…},
#  "earth":{"elevationDeg":4.8044,"visible":true,"nextSet":"2027-01-23T21:40:33.252Z",…},
#  "sunAndEarthVisible":true,
#  "warnings":[{"code":"smooth_moon_polar","message":"Sin relieve (terrain=1): horizonte de Luna lisa a 0° a más de 80° de latitud. …"}]}

curl 'localhost:3100/v1/sun-earth?lat=-89.5&lon=0&date=2027-01-15&mode=center'

curl 'localhost:3100/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z&terrain=1'
# {"site":{…,"horizonModel":"mask"},…,
#  "sun":{"elevationDeg":0.3834,"horizonElevationDeg":-1.5155,"visible":true,"nextSet":null,…},
#  "terrain":{"observerHeightM":2,"applied":true,"source":"catalog","demVersion":"lola-c33d4bb7a8cf","note":"…"}}

curl 'localhost:3100/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-03-01&mode=center'
# {"site":{…},"start":"2027-01-01T00:00:00.000Z","end":"2027-03-01T00:00:00.000Z","mode":"center",
#  "sun":{"summary":{"count":1,"totalHours":970.609,"fractionOfTime":0.6855,"longestWindowHours":970.609},
#         "windows":[{"start":"2027-01-01T00:00:00.000Z","end":"2027-02-10T10:36:33.311Z","durationHours":970.609,
#                     "startsBeforeRange":true,"endsAfterRange":false}]},
#  "earth":{…},"sunAndEarth":{"summary":{"count":2,"totalHours":366.182,…},"windows":[…]}}

curl 'localhost:3100/v1/windows?lat=-65.31485&lon=-3.05572&start=2027-01-24&end=2027-02-07&fullNight=1&battery=1'
# {…,"night":{"minSunFraction":0,"sampleStepMinutes":15,"longestNightHours":182.75,"longestNightFullHours":351.25,
#            "extensionLimitDays":30},
#  "battery":{"survivalLoadW":100,"whPerKg":200,"depthOfDischarge":0.9,"nightMetric":"longestNightFullHours",
#             "nightHours":351.25,"batteryKWh":35.125,"batteryKg":195.14,"note":"Solo la masa del pack de baterías: …"}}

curl 'localhost:3100/v1/rank?sites=all&start=2027-01-01&days=30'
curl 'localhost:3100/v1/rank?sites=apollo11,shackleton-rim,-84.79:29.2&start=2027-01-01&days=30'
# {"start":…,"days":30,"scoreWeights":{"meanSunDiskFraction":0.7,"earthTimeFraction":0.3,…},
#  "results":[{"rank":1,"siteId":"shackleton-rim","score":78.04,"metrics":{"meanSunDiskFraction":0.924,…}},…]}

curl 'localhost:3100/v1/rank?sites=shackleton-rim,im1,apollo11&start=2027-01-01&days=14&weightMeanSunDiskFraction=1&weightEarthTimeFraction=1&minEarthTimeFraction=0.9&maxLongestNightHours=100'
# {…,"scoreWeights":{"meanSunDiskFraction":0.5,"earthTimeFraction":0.5,…},
#  "constraints":{"minEarthTimeFraction":0.9,"maxLongestNightHours":100},
#  "results":[{"rank":1,"siteId":"shackleton-rim",…,"meetsConstraints":false,"violatedConstraints":["minEarthTimeFraction"],…},…]}

curl 'localhost:3100/v1/rank?sites=im1,apollo11&start=2027-01-24&days=14&fullNight=1&battery=1'
# {…,"results":[{"rank":1,"siteId":"im1",…,"metrics":{…,"longestNightHours":188,"longestNightFullHours":346,
#                "batteryKWh":34.6,"batteryKg":192.22}},…],
#  "night":{"minSunFraction":0,"fullNight":true,"extensionLimitDays":30},
#  "battery":{"survivalLoadW":100,"whPerKg":200,"depthOfDischarge":0.9,"nightMetric":"longestNightFullHours","note":"…"}}

curl 'localhost:3100/v1/landing-dates?lat=-65.31485&lon=-3.05572&start=2027-01-01&end=2027-12-31&top=5'
# {"site":{…},"start":"2027-01-01T00:00:00.000Z","end":"2027-12-31T00:00:00.000Z","dateStepHours":24,"missionDays":14,…,
#  "goodCriterion":{"constraints":false,"minScore":90,"relativeToBest":0.9},
#  "stats":{"dateCount":365,"score":{"min":30,"mean":64.69,"max":100},"meanSunDiskFraction":{"min":0,"mean":0.4956,"max":1},…},
#  "best":[{"rank":1,"date":"2027-01-16T00:00:00.000Z","score":100,…},…],"worst":[…],
#  "goodWindows":[{"start":"2027-01-14T00:00:00.000Z","end":"2027-01-18T00:00:00.000Z","durationDays":4,"dateCount":5,
#                  "bestDate":"2027-01-16T00:00:00.000Z","bestScore":100},…],"dates":[…],"note":"…"}

curl 'localhost:3100/v1/search?region=polo-sur&spacingKm=20&refineLevels=1&top=2&start=2027-01-01&days=10'
# {"region":{"preset":"polo-sur",…},"levels":[{"level":0,"spacingKm":20,"evaluated":286},…],"evaluated":336,
#  "results":[{"rank":1,"latDeg":-89.3333,"lonDeg":26.6833,"score":73.61,"refineLevel":1,"metrics":{…}},…],"note":"…"}
curl -X POST 'localhost:3100/v1/search/jobs?region=polo-sur&spacingKm=5&start=2027-01-01&days=30&terrain=1'
# 202 {"id":"…","status":"queued","request":"/v1/search?…","statusUrl":"/v1/search/jobs/…"}
curl 'localhost:3100/v1/search/jobs/<id>'
# {"id":"…","status":"running","progress":{…,"fraction":0.2},…} y, al acabar, {"status":"done",…,"result":{…}}

curl 'localhost:3100/v1/sun-earth?site=atlantis'
# 404 {"error":{"code":"not_found","message":"Sitio desconocido: atlantis"}}
curl 'localhost:3100/v1/sun-earth?lat=100&lon=0'
# 400 {"error":{"code":"invalid_parameter","message":"lat debe estar entre -90 y 90"}}
```

Los parámetros completos (tipos, rangos y valores por defecto) y los esquemas de respuesta están en `openapi.yaml`.

## Conceptos mínimos

- **Azimut** (`azimuthDeg`): dirección en el horizonte, de 0 a 360°, medida desde el norte selenográfico hacia el este.
- **Elevación** (`elevationDeg`): altura del **centro** del disco sobre el horizonte; negativa si está por debajo.
- **Horizonte liso** (por defecto): la Luna es una esfera sin relieve (radio 1737.4 km) y el horizonte está a 0° en
  todas direcciones (`horizonModel: "sphere"`, `horizonElevationDeg: 0`).
- **Horizonte con relieve** (`terrain=1`): elevación del horizonte real según el azimut, de los DEM LOLA
  (`horizonModel: "mask"`, `horizonElevationDeg` ≠ 0).
- **Discos y `mode`**: el Sol mide ~0.27° de radio y la Tierra ~0.95°. Cuándo cuenta como «visible»:
  - `limb`: asoma alguna parte del disco (por defecto; lo que importa para un panel o una antena, y el criterio
    de las tablas de orto y ocaso de JPL Horizons);
  - `center`: el centro está sobre el horizonte;
  - `full`: se ve el disco entero.
- **`visibleFraction`**: fracción del disco sobre el horizonte (0–1). En el orto o el ocaso del Sol es un proxy
  de la potencia solar disponible.
- **Energía (`meanSunDiskFraction` en `/v1/rank`)**: media de `visibleFraction` del Sol en cada paso. Supone un panel que
  **sigue al Sol** (incidencia normal, sin ángulo de incidencia) y no modela el oscurecimiento del limbo, la variación de la
  distancia al Sol (±3,4 %), las sombras del propio módulo ni el polvo. Ver «Panel solar».
- **Coordenadas**: latitud norte positiva, longitud **este** positiva (se aceptan 0–360 y se normalizan a −180..180).
- **Fechas**: ISO 8601 en **UTC** (`AAAA-MM-DD` u `AAAA-MM-DDThh:mm[:ss[.sss]]`, con zona opcional `Z` o `±hh:mm`).
  Sin zona horaria se interpretan como UTC; un `+02:00` en la URL va como `%2B02:00`. Años de 1900 a 2100.
- **Unidades**: en el nombre del campo (`Deg`, `Km`, `Hours`, `Minutes`, `Seconds`) o fracciones 0–1.

## Relieve (opcional, desde 1.1.0)

En los polos el relieve manda en la iluminación y en la visibilidad de la Tierra. Con `terrain=1` (o `true`):

- `/v1/sun-earth` y `/v1/windows` usan la máscara de horizonte precalculada del catálogo
  (`backend/terrain/masks/`, sitios polares, observador a 2 m o 10 m) o, para coordenadas libres u otras alturas, la
  calculan con el DEM LOLA en caché (`backend/terrain/cache/`, modo preciso).
- `/v1/rank` calcula la máscara de cada sitio con el DEM en caché (modo preciso; con el mismo DEM coincide con la del
  catálogo). Cada resultado lleva `horizonModel`. Desde 1.13.0, sin DEM en el servidor, `/v1/rank` y `/v1/landing-dates`
  usan la máscara del catálogo como las demás rutas (antes caían en Luna lisa sin avisar: `shackleton-rim` en abril de
  2027 daba 0 de tiempo con Sol frente a 0,735 en `/v1/windows`), también para un punto pedido por coordenadas que
  coincide con un sitio del catálogo. Se incluye en v1 porque el ranking de sitios polares es justo donde el
  relieve cambia más el resultado (sin él, hasta +34 pp de tiempo con Sol).
- `observerHeightM` (0–100 m, por defecto 2): altura del panel o la antena sobre el terreno. Sin `terrain=1` se ignora.
  Desde 1.12.0, una altura por debajo de 1 m (observador, panel o antena) lleva el aviso `low_observer_height` en
  `warnings`: el horizonte lo decide el píxel del DEM en el que está el observador y las noches polares se alargan mucho
  (en la cresta de conexión de Shackleton, C1, la noche más larga en 18,6 años es de 2108 h a 0 m frente a 114 h a 2 m).
  Se calcula igual; solo avisa.
- `panelHeightM` y `antennaHeightM` (0–100 m, desde 1.6.0): altura del panel y de la antena por separado. Por defecto,
  las dos valen `observerHeightM`. La máscara del panel decide todo lo del Sol (`sun`, `meanSunDiskFraction`,
  `sunTimeFraction`, la noche y la batería); la de la antena, todo lo de la Tierra (`earth`, `earthTimeFraction`,
  `longestEarthOutageHours`). `sunAndEarth` cruza las dos. Si alguna difiere de `observerHeightM`, el objeto `terrain`
  lleva las dos; si no, la respuesta es idéntica byte a byte a la de 1.5.0. Cada altura usa la máscara del catálogo si
  existe (2 m y 10 m) o la calcula con el DEM (unos 140 ms la primera vez en modo preciso; luego sale de la caché).
  `/v1/horizon` devuelve un solo perfil: para el de la antena, pide `observerHeightM` con su altura.
- La respuesta lleva un objeto `terrain` (`observerHeightM`, `applied`, `source`: `catalog` | `dem` | `null`,
  `demVersion`, `note`). Si no hay máscara (servidor sin DEM o punto fuera de cobertura, que es solo el polo sur hasta
  unos 60°S) **no falla**: usa el horizonte esférico, `applied: false`, y lo explica en `note`. Desde 1.13.0 lo avisa
  además con `terrain_not_applied` en `warnings` (en `/v1/rank` y `/v1/search`, si algún sitio o punto se queda sin
  máscara). Desde 1.23.0, si algún punto con relieve aplicado está al sur de 85°S, la respuesta de `/v1/windows`,
  `/v1/rank`, `/v1/landing-dates`, `/v1/search`, `/v1/light-map` o `/v1/best-landings` lleva el aviso
  `deep_polar_uncertainty`: ahí la fracción de tiempo con Sol o con Tierra puede desviarse de los mapas de PGDA en decenas
  de puntos porcentuales (en la cresta de Shackleton, 76 % de tiempo con Sol frente al 44 % del producto de 60 m y el
  74,7 % del de 240 m; ver [`VALIDATION.md`](../VALIDATION.md) y #85). Solo informa: las cifras no cambian. `/v1/health` dice qué datos de relieve tiene el servidor (`terrain`: DEM, productos LDRM de pendiente y sitios
  con máscara precalculada).
- **Sin `terrain` nada cambia**: las respuestas son idénticas byte a byte a las de 1.0.0, también en los sitios polares
  con máscara de catálogo (el motor recibe explícitamente «sin máscara»). Lo comprueba `test/terrain.test.ts` con el
  relieve encendido.

**Cómo se calcula el horizonte (desde 1.8.0, horizonte híbrido).** La máscara (720 azimuts, 0,5° de paso, redondeada a
0,01°) se usa siempre y se interpola entre azimuts. Cuando el margen del Sol o de la Tierra al horizonte es menor que
`horizonRefineDeg` (0,1° por defecto), la elevación del horizonte se recalcula con un **rayo directo** sobre el DEM en el
azimut exacto del astro, con la misma marcha que la máscara, y con ella se deciden si se ve y qué fracción del disco asoma.
Solo actúa sobre máscaras con el DEM detrás: con una del catálogo en un servidor sin DEM no hace nada. Entonces el objeto
`terrain` lleva `horizonRefineDeg` y su `note` lo dice; si no se aplica, la respuesta es la de 1.7.0.

- `horizonRefine=0` lo apaga (solo máscara) y `horizonRefineDeg` (0–2°) cambia el umbral. Solo con `terrain=1`.
- **Precisión medida** (2027, paso de 1 h, observador a 2 m; «verdad» = rayo fino en el azimut exacto): con la máscara
  sola, todos los cambios de decisión frente al rayo ocurrían con el margen por debajo de 0,04°; con 0,1° desaparecen.
  La noche más larga de la isla (−89,76432, −156,86311) pasa de 128 h a 124 h, el valor de la verdad; en
  `shackleton-rim`, IM-1 y (−65,23576, −9,16979) no cambia, las horas con Tierra cambian como mucho 1 y la energía,
  menos de 1e-4. Detalle en «Relieve» de [`backend/README.md`](../backend/README.md).
- **Coste:** ~0,18 ms por rayo y como mucho ~400 rayos por sitio y año a paso de 1 h. Un `/v1/landing-dates` de un año con
  relieve pasa de ~0,10 s a ~0,17 s la primera vez en un sitio polar y vuelve a ~0,10 s al repetirlo (caché de rayos).
- `/v1/track` devuelve en `horizonElevationDeg` la máscara interpolada; su `visibleFraction` ya usa el rayo cerca del horizonte.

**Alturas realistas.** La cubierta de un módulo queda a unos 2–4 m del suelo (Nova-C mide 4,3 m de alto en total; SLIM,
unos 2,4 m). Para las antenas, los requisitos de la NASA para mástiles VSAT piden 5 m como umbral y 10 m como objetivo
([GCD Annual Review, VSAT, 2023](https://ntrs.nasa.gov/api/citations/20230012849/downloads/GCD%20Annual%20Review%20VSAT%20September%202023%20Final.pdf)).
Un caso típico es `panelHeightM=2` (o 3–4) y `antennaHeightM=10`.

```bash
curl 'http://localhost:3100/v1/rank?sites=-89.76432:-156.86311&start=2027-04-22&days=29.5&terrain=1&panelHeightM=10&antennaHeightM=2'
```

Las máscaras del catálogo están en git. El DEM (unos 400 MB en disco) no: se descarga una vez con `node scripts/fetch-dem.ts` en
`backend/` y las máscaras del catálogo se regeneran con `node scripts/build-masks.ts` (ver «Relieve» en
[`backend/README.md`](../backend/README.md)). Sin DEM, `terrain=1` funciona para los sitios del catálogo con máscara
y responde con esfera en el resto.

## Noche y batería (opcional, desde 1.3.0)

`/v1/windows` y `/v1/rank` aceptan estos parámetros. **Sin ellos nada cambia** (lo comprueba `test/night.test.ts`).

| Parámetro | Qué hace | Por defecto |
|---|---|---|
| `nightMinSunFraction` (0–1) | Umbral de Sol: un instante es de noche si la fracción visible del disco solar es menor que él. Con 0 decide `mode` (con `limb` basta un filo del disco para que no sea de noche); 0,5 equivale a `center` y 1 a `full`. No cambia las ventanas | 0 |
| `fullNight=1` | Noche real: `longestNightFullHours`, la noche más larga que toca el periodo medida entera. Si el periodo empieza (o acaba) a oscuras, se busca hacia atrás (o hacia delante) hasta el ocaso (o el amanecer), como mucho 30 días por cada lado. `longestNightHours` no cambia | no |
| `battery=1` | Batería para pasar la noche (la real con `fullNight=1`; si no, `longestNightHours`). `battery=0` la apaga aunque vayan los tres parámetros siguientes (desde 1.9.0) | no |
| `survivalLoadW` (0–10 000) | Carga de supervivencia, en W. Activa la batería | 100 |
| `batteryWhPerKg` (10–1000) | Energía específica a nivel de pack, en Wh/kg. Activa la batería | 200 |
| `batteryDoD` (0,05–1) | Profundidad de descarga utilizable. Activa la batería | 0,9 |

- `batteryKWh = survivalLoadW × horas / 1000` y `batteryKg = batteryKWh × 1000 / (batteryDoD × batteryWhPerKg)`.
- Valores por defecto de la batería, cada uno con su fuente (comprobadas el 2026-11-14):
  - **100 W** de carga de supervivencia: Cataldo, Zacny y Schmitz, «Radioisotope Power Systems to Enable Extended Lunar
    Science and In-Situ Resource Utilization Missions» (NASA GRC, NETS 2018, <https://ntrs.nasa.gov/citations/20180004489>),
    apartado IV: «A lunar equatorial mission requiring 100 We throughout the lunar day and night». En la fuente es la
    carga continua, de día y de noche, de una misión ecuatorial; aquí se usa como aproximación de la carga de
    supervivencia nocturna. Como referencia, VIPER: Bluethmann, «VIPER Rover Overview and Mobility and Hardware» (NASA
    JSC, LSIC 2024, <https://ntrs.nasa.gov/citations/20240013903>), transparencia 2, «VIPER Rover Overview»: «Battery
    capacity (start of life @ 0C): 5,420 W-hr» y «50 hours survival in low power mode». No sale de COMPASS, que trabaja
    con ~40 W de operación nocturna más ~6 W de pérdidas: se queda en 100 W para no cambiar `batteryKg` en la v1.
  - **200 Wh/kg** a nivel de pack y **0,9** de profundidad de descarga: equipo COMPASS de NASA GRC (Oleson, Colozza y
    Uguccini), «Overnight Power & Thermal Solutions for Lunar Landers» (CLPS Survive the Night Technology Workshop, 2022,
    <https://ntrs.nasa.gov/citations/20220018215>),
    transparencia 15, «Battery Design»: «Specific energy of ~200 Whr/kg» (pack de ~20 kWh con celdas comerciales 18650) y
    «Use 90% DoD to reduce battery mass (only expect 125 charge/discharge cycles…)». Los 200 Wh/kg son el extremo
    optimista: la batería de ion-litio calificada para vuelo de Cataldo 2018 (46,8 kWh, ~432 kg) ronda los 108 Wh/kg.
- **`batteryKg` es solo la masa del pack:** sin electrónica, sin el panel solar extra para recargarlo y sin márgenes. A
  nivel de sistema sale unas 2–3 veces más. La respuesta lo repite en `battery.note`.
- `/v1/windows` devuelve `night` (con `sampleStepMinutes`: 15 min de resolución) y, con la batería, `battery` con las
  cifras. `/v1/rank` añade a cada resultado `longestNightFullHours`, `batteryKWh` y `batteryKg` (los que se pidan) y repite
  los parámetros usados en `night` y `battery`. La puntuación de `/v1/rank` no cambia: en v1 la noche pesa 0.
- **Noche cortada (desde 1.9.0):** si la noche real llega a los 30 días de búsqueda por algún lado (sombra casi
  permanente), `longestNightFullHours` y la batería son **solo un mínimo**. Lo marca `nightTruncated: true` (en `night` de
  `/v1/windows` y en las métricas de `/v1/rank` y `/v1/landing-dates`), la nota de la batería lo dice y la respuesta lleva
  el aviso `night_truncated`. Ejemplo: en (−89,66, 129,2) con relieve, 14 días de enero de 2027 dan 1776 h y 987 kg de pack.
- Errores con `400 invalid_parameter` y mensaje en castellano (p. ej. «batteryDoD debe ser un número entre 0.05 y 1»).

## Banda de robustez del horizonte (opcional, desde 1.18.0)

`/v1/windows` acepta `horizonBandDeg` (0–5°; el valor de referencia es 0,3°). Sin él, o con 0, la respuesta no cambia. Con
un valor mayor que 0 añade `horizonBand`, sin tocar el resto de la respuesta:

| Campo | Qué es |
|---|---|
| `deg` | El desplazamiento usado |
| `raised` | `sun`, `earth` y `sunAndEarth` (resumen y ventanas) con el horizonte de los dos astros **subido** `deg` grados: menos visibilidad |
| `lowered` | Lo mismo con el horizonte **bajado** `deg` grados: más visibilidad |
| `range` | Para `sun`, `earth` y `sunAndEarth`, `{ min, max }` de `totalHours`, `fractionOfTime` y `longestWindowHours` entre el horizonte nominal y los dos desplazados; si la respuesta lleva `night`, también `longestNightHours` (y `longestNightFullHours` con `fullNight=1`) |
| `note` | Qué es la banda, en texto |

- El desplazamiento es el mismo en todos los azimuts, se suma a `earthMinElevationDeg`, se aplica también al rayo directo
  del horizonte híbrido y, sin relieve, al horizonte esférico.
- Es un análisis de sensibilidad («cuánto cambian las cifras si el horizonte se equivoca en 0,3°»), no un intervalo de
  confianza. La batería (`battery`) no se recalcula: usa la noche nominal.
- Ejemplo real (`shackleton-rim`, 2027 entero, `mode=full`, máscara del catálogo a 2 m): Sol 82,0 % [77,0–88,3 %], Tierra
  47,1 % [45,8–48,3 %]. Más cifras, el método y el coste, en [`../backend/README.md`](../backend/README.md) («Banda de
  robustez del horizonte»).
- La web la pide siempre (`web/js/adapters/visibility-api.js`) y pinta el rango junto a las cifras del sitio. GraphQL
  todavía no la expone.

```sh
curl 'localhost:3100/v1/windows?site=shackleton-rim&start=2027-01-01&end=2028-01-01&mode=full&terrain=1&horizonBandDeg=0.3'
```

## Tierra visible con antena de la DSN (opcional, desde 1.24.0)

Que la Tierra se vea desde el sitio no garantiza que alguna estación de la Deep Space Network tenga la Luna sobre su
horizonte (PGDA avisa de que su visibilidad de la Tierra es optimista para estudios de enlace que solo usan la DSN,
<https://pgda.gsfc.nasa.gov/products/69>). `/v1/windows` acepta `dsn=1`; sin él, o con `dsn=0`, la respuesta no cambia.
Con él añade, sin tocar el resto:

| Campo | Qué es |
|---|---|
| `earthDsn` | Resumen y ventanas (como `earth`) de las horas con la Tierra visible desde el sitio **y** la Luna por encima de `dsn.minElevationDeg` en al menos una de las tres estaciones. Siempre dentro de `earth` |
| `dsn.minElevationDeg` | Elevación mínima de la Luna sobre el horizonte de la estación: 10° |
| `dsn.minElevationAssumed` | `true`: los 10° son un supuesto de partida hasta tener fuente oficial |
| `dsn.stations` | Goldstone (DSS-14), Madrid (DSS-63) y Canberra (DSS-43): las antenas de 70 m, con sus coordenadas geodésicas |
| `dsn.note` | Qué es, en texto |

- Coordenadas de las antenas: DSN Telecommunications Link Design Handbook (JPL 810-005), módulo 301; son las mismas que
  usa JPL Horizons para sus observadores DSS-14, DSS-63 y DSS-43.
- La elevación de la Luna es la del centro del disco, sin refracción, con `astronomy-engine`
  (`backend/src/dsn.ts`). Frente a JPL Horizons con el observador en cada antena (52 instantes de 2027 por estación,
  `backend/test/fixtures/dsn-horizons.json`), el error máximo es de 0,001° en elevación.
- Solo dice si alguna estación **podría** apuntar a la Luna, no si está asignada a la misión. La banda del horizonte
  (`horizonBand`) no lo recalcula.
- Ejemplo: en Apolo 11 la Tierra se ve el 100 % del tiempo; con la DSN, ~98 % (en enero de 2027 hay unos 20–40 min al día
  en que ninguna estación tiene la Luna por encima de 10°). En el polo sur la Tierra roza el horizonte y la diferencia
  depende del relieve.
- Coste: en un año de ventanas, ~1,7 s más la primera vez; las horas de la DSN no dependen del sitio y las peticiones
  siguientes del mismo intervalo (otros sitios) las reutilizan.

```sh
curl 'localhost:3100/v1/windows?site=apollo11&start=2027-01-01&end=2027-02-01&dsn=1'
```

## Panel solar (opcional, desde 1.4.0)

En el polo el Sol va a 0–2° de elevación: un panel horizontal recibiría ~sen(el), casi nada (0–3,5 %). Lo realista allí
son paneles **verticales que giran** para mirar al Sol, como los de los requisitos VSAT de la NASA
(<https://ntrs.nasa.gov/api/citations/20230012849/downloads/GCD%20Annual%20Review%20VSAT%20September%202023%20Final.pdf>).

`/v1/rank` (y, desde 1.5.0, `/v1/landing-dates`) acepta `panel`, que solo cambia `meanSunDiskFraction` (y la puntuación). En cada paso, energía = fracción visible
del disco × factor, con `el` la elevación del centro del Sol:

| `panel` | Qué es | Factor |
|---|---|---|
| `tracking` (por defecto) | Panel que sigue al Sol en dos ejes (incidencia normal). La respuesta no cambia | 1 |
| `vertical-rotating` | Panel vertical que gira hacia el acimut del Sol | cos(el) |
| `horizontal` | Panel horizontal fijo | max(0, sen(el)) |

- Es **geometría pura**: sin eficiencia de célula ni temperatura. No cambia `sunTimeFraction`, la noche, la Tierra ni la batería.
- Con un valor distinto de `tracking`, la respuesta añade `panel` (`orientation`, `factor` y `note`). Sin él, o con
  `panel=tracking`, es idéntica byte a byte (lo comprueba `test/panel.test.ts`).
- `/v1/sun-earth`, `/v1/windows` y `/v1/track` no dan métricas de energía: ignoran `panel`.
- Ejemplo, 14 días desde el 24 de enero de 2027 sin relieve: en la cresta de Shackleton la energía es 0,9939 con
  `tracking` y con `vertical-rotating`, y 0,0098 con `horizontal`.

```sh
curl 'localhost:3100/v1/rank?sites=shackleton-rim,im1&start=2027-01-24&days=14&panel=horizontal'
```

## Pendiente del terreno (opcional, desde 1.7.0)

Artemis III pide una pendiente **menor de 10° en una base de 100 m** (<https://ntrs.nasa.gov/api/citations/20250009323/downloads/ArtemisOverview2025IntSPAPPSChallenge.pdf>). La puntuación no la
mira, y las laderas puntúan bien porque bajan el horizonte: el ganador del benchmark v3 está en una de 13,5°.

| Parámetro | Rutas | Qué hace |
|---|---|---|
| `slope=1` | `/v1/sun-earth`, `/v1/windows`, `/v1/landing-dates`, `/v1/rank` | Añade la pendiente (objeto `slope`; en `/v1/rank`, en cada resultado) |
| `slopeBaselineM` | las mismas | Base en metros (diámetro del círculo; 1–5000, por defecto 100). También la activa |
| `maxSlopeDeg` | las mismas | Grados (0–90). En `/v1/rank` saca del ranking los sitios que la superan, quedan fuera del DEM o (desde 1.12.0) tienen la pendiente sin certificar (`slope.excludedSiteIds` y, desde 1.9.0, `slope.excluded` con `{siteId, reason, slopeDeg}`); en las demás, solo añade `meetsMaxSlope` (`null` desde 1.9.0 si no hay pendiente y desde 1.12.0 si está sin certificar) |
| `slopeUncertified` | `/v1/rank` (desde 1.12.0) | `exclude` (por defecto) o `keep`: qué hace `maxSlopeDeg` con las pendientes sin certificar. Sin `maxSlopeDeg` se ignora, con aviso |

- Cálculo: plano ajustado por mínimos cuadrados a las alturas del terreno dentro del círculo, la definición del producto
  LDRM de PGDA; `roughnessM` es la desviación típica de los residuos. Depende solo del lugar: no hace falta `terrain=1`.
- **Fuente (`source`, desde 1.12.0):** `pgda-ldrm-100m`, `-400m` u `-800m` (producto oficial de PGDA, 50 m/px, de ~80°S
  al polo) si la base es 100, 400 u 800 m y el servidor lo tiene en caché; si no, el DEM LOLA: `dem-20m` (algunas ventanas
  cerca del polo), `dem-160m` (hasta 80°S) o `dem-240m` (hasta 60°S).
- **Aviso de resolución:** si la base pedida es menor que 3 píxeles del DEM, se usa la mínima (`slopeBaselineM` de la
  respuesta, ~480 o ~690 m), `underestimated` vale `true` y la pendiente en 100 m puede ser mayor. Fuera del DEM, los
  campos numéricos y `source` son `null`.
- **Sin certificar (desde 1.12.0):** con `underestimated: true` la pendiente no cuenta como apta: `meetsMaxSlope` vale
  `null` (nunca `true`) y `meetsMaxSlopeReason` dice por qué. En `/v1/rank`, por defecto esos sitios salen del ranking con
  el motivo `slopeUncertified`; con `slopeUncertified=keep` se quedan, marcados. Antes de 1.12.0 contaban como aptos si el
  número era pequeño: frente a LDRM 100 m, el 9,6 % de los puntos del casquete con 10° o más pasaban el filtro. Fuera del
  casquete de 80°S no hay LDRM ni DEM de 20 m, así que ninguna pendiente de 100 m queda certificada allí.
- Sin estos parámetros la respuesta es idéntica byte a byte (lo comprueba `test/slope.test.ts`).

```sh
curl 'localhost:3100/v1/rank?sites=-65.31485:-3.05572,-60.75:-7.2881&start=2027-01-10&days=14&maxSlopeDeg=10'
curl 'localhost:3100/v1/rank?sites=-65.31485:-3.05572,-60.75:-7.2881&start=2027-01-10&days=14&maxSlopeDeg=10&slopeUncertified=keep'
curl 'localhost:3100/v1/sun-earth?lat=-65.31485&lon=-3.05572&slope=1'
```

## Fechas de alunizaje (desde 1.5.0)

La variable que más decide la energía de una misión es la **fecha de alunizaje respecto al amanecer local**: alunizar al
amanecer da unos 14 días de Sol y al anochecer, una misión casi a oscuras. En el polo influyen además la estación y la
libración de la Tierra. `/v1/landing-dates` barre las fechas candidatas de un sitio (`start` a `end`, como mucho 400 días,
cada `dateStep` de 1 h a 30 d) y puntúa la misión de `days` días (1–60) que empieza en cada una, muestreada cada hora, con las
mismas métricas y la misma puntuación que `/v1/rank`: cada fecha da lo mismo que `/v1/rank` con `start` = esa fecha (lo
comprueba `test/landing-dates.test.ts`).

- **La energía (`meanSunDiskFraction`) supone un panel que sigue al Sol**, salvo que se pase `panel`.
- Pesos: `weightMeanSunDiskFraction` y `weightEarthTimeFraction` (por defecto 0,7 y 0,3; se normalizan). Desde 1.9.0
  también en `/v1/rank`.
- Restricciones opcionales, con los nombres públicos de las métricas: `minMeanSunDiskFraction`, `minSunTimeFraction`,
  `minEarthTimeFraction`, `minSunAndEarthTimeFraction` (las cuatro de 0 a 1), `maxLongestNightHours`,
  `maxLongestEarthOutageHours`, `minLongestSunAndEarthHours` y `maxBatteryKg` (que activa la batería con sus valores por
  defecto). Desde 1.9.0, cada fecha que no las cumple dice cuáles incumple en `violatedConstraints`, y `/v1/rank` acepta
  las mismas (cada resultado lleva `meetsConstraints` y `violatedConstraints`; el orden no cambia).
- `earthMinElevationDeg` (desde 1.9.0, también en `/v1/rank`, `/v1/sun-earth` y `/v1/windows`): elevación mínima de la
  Tierra para contar como visible (por ejemplo, la de la antena). 0 por defecto.
- Una fecha es **buena** si cumple las restricciones y llega a `minScore`; sin ninguna de las dos, si llega al 90 % de la
  mejor puntuación. `goodWindows` son los tramos seguidos de fechas buenas, con su mejor fecha.
- Cada fecha dice además si se ve el Sol al alunizar (`sunVisibleAtLanding`) y cuántas horas faltan para el siguiente
  ocaso o amanecer dentro de la misión (`hoursToSunChange`, null si no cambia).
- Un año con paso de 1 día tarda ~0,15 s: el Sol y la Tierra se muestrean una sola vez y cada fecha es una ventana deslizante.
- `dates=0` (desde 1.10.0) omite la serie completa `dates` y deja `stats`, `best`, `worst` y `goodWindows`: el barrido
  más grande (400 días cada hora) pasa de ~3 MB a unos pocos KB.

## Entrada estricta y avisos (desde 1.9.0)

- **Parámetros que no aplican → `warnings`, no error.** v1 solo admite cambios aditivos, así que un parámetro que un
  cliente ya manda por error sigue funcionando; la respuesta añade al final `warnings: [{code, parameter, message}]`:
  `unknown_parameter` (`terain=1`, con sugerencia: «¿Querías decir terrain?»), `unused_parameter` (existe en otra ruta:
  `end` en `/v1/rank`, `panel` en `/v1/windows`, `mode` en `/v1/track`), `ignored_parameter` (alturas u `horizonRefine` sin `terrain=1`,
  `lat`/`lon`/`heightKm` con `site`, datos de batería con `battery=0`), `duplicate_parameter` y `duplicate_site`. También
  avisa de los límites de las cifras: `smooth_moon_polar` (Luna lisa a más de 80° sin máscara, en `/v1/sun-earth` y
  `/v1/windows`), `night_truncated`, `outside_validated_dates` (fuera de 2026–2030), `height_no_horizon_dip` y, con relieve,
  `low_observer_height`, `terrain_not_applied` y `deep_polar_uncertainty` (punto al sur de 85°S, desde 1.23.0).
  Solo aparece si hay algo que avisar.
- **Valores mal formados → 400.** Fechas ISO 8601 estrictas que deben existir (`2027-02-30` ya no es el 2 de marzo, y
  `2027` a secas no vale), años de 1900 a 2100, números decimales estrictos (`lat=%20`, `lon=0x10` o `Infinity` no valen),
  `top` entero, restricciones de fracción de 0 a 1, `sites` con un `lat:lon` mal formado. Se valida todo antes de calcular,
  también los parámetros que luego se ignoran.
- **`heightKm` no baja el horizonte.** Eleva al observador sobre la esfera solo para la geometría (paralaje < 0,01°). Se
  supone que el terreno de alrededor está a la misma cota (una meseta, no una torre): aplicar la depresión geométrica de
  una esfera lisa, acos(R / (R + h)), casi 2° con 1 km, sería falso en casi todos los sitios. Para un panel o una antena
  elevados, `terrain=1` con `panelHeightM` y `antennaHeightM`. La respuesta lo avisa.
- `/v1/sites` dice en `terrainMaskHeightsM` a qué alturas tiene máscara precalculada cada sitio (2 y 10 m en los polares).

```sh
curl 'localhost:3100/v1/sun-earth?site=apollo11&date=2027-01-15&terain=1'
# {…,"warnings":[{"code":"unknown_parameter","parameter":"terain","message":"Parámetro desconocido: terain; se ignora. ¿Querías decir terrain?"}]}
curl 'localhost:3100/v1/sun-earth?site=apollo11&date=2027-02-30'
# 400 {"error":{"code":"invalid_parameter","message":"date no es una fecha real: 2027-02-30"}}
```

## GraphQL (desde 1.11.0)

`/graphql` es otra puerta al mismo motor: cada cliente pide **exactamente los campos que necesita en una sola
consulta**. No cambia ninguna ruta v1. Cada campo que calcula llama por dentro a la ruta v1 equivalente (`src/v1.ts`),
así que los valores, el redondeo, las notas y los avisos son **los mismos** (`test/graphql*.test.ts` lo comprueban campo a
campo, con y sin relieve).

- `POST /graphql` con `{"query", "variables", "operationName"}` y `Content-Type: application/json`.
- `GET /graphql?query=…&variables=…&operationName=…` para consultas cortas o persistidas. Se pueden cachear: llevan `ETag`
  (304 con `If-None-Match`) y, si todas las fechas son explícitas y no hay errores, `Cache-Control: public, max-age=3600`.
- **Consultas persistidas** (protocolo APQ de Apollo): `extensions={"persistedQuery":{"version":1,"sha256Hash":"…"}}` en vez
  de `query`. Si el servidor no la conoce, responde `PERSISTED_QUERY_NOT_FOUND` y el cliente la reenvía con su texto
  (queda registrada; `LUNAR_GRAPHQL_PERSISTED_MAX`). Los ejemplos del explorador están registrados desde el arranque.
- **Explorador**: abre `/graphql` en el navegador (GraphiQL 3.9.0 y React 18.3.1 desde unpkg, versiones exactas con SRI).
  Trae ejemplos: la ficha de un sitio, comparar sitios y fechas, el barrido de fechas solo con resumen, la ficha corta de
  varios sitios y el análisis completo (`src/graphql/examples.ts`).
- **Esquema**: [`src/graphql/schema.graphql`](src/graphql/schema.graphql), servido en `/graphql/schema.graphql`.
  Introspección permitida.
- Mismo servidor y misma capa HTTP que la v1: pool de workers (prioridad ligera o pesada según el coste), tiempo máximo,
  cola con `Retry-After`, compresión, CORS abierto (el preflight de `/graphql` admite `POST`).
- Mismo límite por cliente que la v1 (desde 1.21.0, si el servidor lo activa): una consulta gasta cupo ligero o pesado
  según su coste (el mismo umbral que la prioridad del pool), salvo que su resultado salga de la caché; el explorador y
  el esquema no gastan. Al pasarse, 429 con `Retry-After` y
  `{"errors":[{"message":"Has superado el límite…","extensions":{"code":"rate_limited"}}]}`.

### De la v1 a GraphQL

Desde 1.17.0 GraphQL ofrece **todo** lo que da la v1, y no puede dejar de hacerlo: una sola tabla,
[`src/graphql/operations.ts`](src/graphql/operations.ts) (`OPERATIONS`), dice qué campo de GraphQL responde a cada ruta y de
qué argumento sale cada parámetro. Los resolvers construyen con ella sus llamadas a la v1 (y traducen con ella los
nombres de los errores y avisos), y dos tests la vigilan:

- `test/api-parity.test.ts` la compara con `openapi.yaml` y con `schema.graphql` en los dos sentidos: una ruta, un
  parámetro o un campo de respuesta de la v1 sin equivalente en GraphQL (o un argumento o un campo de GraphQL sin
  equivalente en la v1) hace fallar los tests, con un mensaje que dice qué falta y dónde añadirlo.
- `test/single-source.test.ts` traduce con la tabla unas peticiones v1 que, entre todas, usan **todos** los parámetros de
  cada ruta, y comprueba que la consulta GraphQL equivalente da el mismo cuerpo, campo a campo y con los mismos avisos.
  Un parámetro nuevo sin petición que lo use también hace fallar los tests.

Así que añadir algo a la v1 es: la ruta o el parámetro en `src/v1.ts` y `openapi.yaml`, su entrada en `OPERATIONS` y el
argumento o el campo en `schema.graphql`. Las únicas excepciones están en la misma tabla, cada una con su motivo
(`V1_ONLY` y `GRAPHQL_ONLY`).

Rutas:

| v1 | GraphQL |
|---|---|
| `/v1/health` | `health` (no se cachea); la versión sola, `apiVersion` |
| `/v1/sites` | `sites(ids, withTerrainMask)`: la lista (sin `count`) |
| `/v1/regions` | `regions`: la lista (sin `count`) |
| `site=<id>` o `lat`, `lon`, `heightKm` | `site(id)` o `site(lat, lon, heightKm)`, y dentro el campo de la ruta |
| `/v1/sun-earth` | `Site.sunEarth(at, mode, terrain, slope, earthMinElevationDeg)` |
| `/v1/windows` | `Site.windows(from, to, mode, terrain, night, battery, slope, earthMinElevationDeg, events, horizonBandDeg, dsn)` |
| `/v1/track` | `Site.track(from, to, stepMinutes, terrain)` |
| `/v1/horizon` | `Site.horizon(heightM)` |
| `/v1/light-map` | `lightMap(site, lat, lon, heightKm, radiusKm, spacingKm, from, days, mode, observerHeightM, panelHeightM, antennaHeightM)`: los puntos en columnas (`points { latDeg … withTerrain }`) |
| `/v1/best-landings` | `bestLandings(sites, from, to, missionDays, batteryHours, minEarthPct, maxEarthGapHours, priority, mode, terrain)` |
| `/v1/rank` | `rank(sites, from, days, mode, earthMode, stepMinutes, scoring, constraints, terrain, night, battery, panel, slope, earthMinElevationDeg)` |
| `/v1/landing-dates` | `Site.landingDates(from, to, dateStepHours, missionDays, mode, earthMode, scoring, constraints, terrain, night, battery, panel, slope, minScore, top, earthMinElevationDeg)` |
| `/v1/search` | `search(region, latMin, latMax, lonMin, lonMax, spacingKm, refineLevels, refineTop, top, minSeparationKm, from, days, mode, earthMode, stepMinutes, cells, scoring, terrain, night, battery, panel, slope, earthMinElevationDeg)` |
| `POST /v1/search/jobs`, `GET /v1/search/jobs/{id}` | No están: son trabajos asíncronos de HTTP; `search` da el mismo resultado dentro de la petición |
| (no existe) | `compare(sites, landingDates)`: varios sitios × varias fechas (`LandingDatesInput` = los argumentos de `Site.landingDates`) |
| (no existe) | `Site.slope(baselineM, maxSlopeDeg)`: el objeto `slope` de `/v1/sun-earth` con `slope=1`, solo |

Parámetros (cuando el nombre cambia; los demás se llaman igual):

| v1 | GraphQL |
|---|---|
| `start`, `end`, `date` | `from`, `to`, `at` |
| `step` (`/v1/track`; `/v1/rank` y `/v1/search`) | `stepMinutes` (minutos) |
| `dateStep`, `days` (`/v1/landing-dates`) | `dateStepHours` (horas), `missionDays` |
| `days` (`/v1/best-landings`) | `missionDays` |
| `observerHeightM` (`/v1/horizon`) | `heightM` |
| `terrain=1`, `observerHeightM`, `panelHeightM`, `antennaHeightM`, `horizonRefine`, `horizonRefineDeg` | `terrain: { enabled, observerHeightM, panelHeightM, antennaHeightM, refine, refineDeg }` (en `/v1/light-map` las alturas van sueltas, como en la v1) |
| `terrainResolution` (`/v1/search`) | `terrain.resolution` |
| `weightMeanSunDiskFraction`, `weightEarthTimeFraction`, `weightSunAndEarthTimeFraction`, `weightShortNights`, `weightSunTimeFraction`, `weightShortEarthOutages`, `weightLongestSunAndEarth` | `scoring: { meanSunDiskFraction, earthTimeFraction, sunAndEarthTimeFraction, shortNights, sunTimeFraction, shortEarthOutages, longestSunAndEarth }` |
| `min…`/`max…` (restricciones) | `constraints: { … }` (mismos nombres) |
| `nightMinSunFraction`, `fullNight` | `night: { minSunFraction, fullNight }` |
| `battery`, `survivalLoadW`, `batteryWhPerKg`, `batteryDoD` | `battery: { enabled, survivalLoadW, whPerKg, depthOfDischarge }` |
| `slope=1`, `slopeBaselineM`, `maxSlopeDeg`, `slopeUncertified` | `slope: { baselineM, maxSlopeDeg, uncertified }` (`SlopeInput` en `rank` y `search`; `SiteSlopeInput`, sin `uncertified`, en `sunEarth`, `windows` y `landingDates`) |
| `events=1`, `cells=1` | `events: true`, `cells: true` |
| `dates=0` (`/v1/landing-dates`) | No hace falta: no pidas `dates` |
| `panel=vertical-rotating`, `verdict: "not-viable"` | `vertical_rotating`, `not_viable` (enums `PanelOrientation` y `Verdict`; GraphQL no admite guiones) |
| `region=polo-sur` | `region: "polo-sur"` (un id de `regions`) |
| `sites=a,b` | `sites: ["a", "b"]` |

Los campos de salida se llaman como en la v1, con las unidades en el nombre. Un campo que la v1 omite vale `null`, y
`warnings` es siempre una lista (vacía si no hay nada que avisar), con los nombres de los argumentos de GraphQL
(`terrain.panelHeightM`, `night.fullNight`…) y los mismos códigos (enum `WarningCode`; desde 1.23.0, también
`deep_polar_uncertainty`). Solo en GraphQL: `TerrainInput.resolution: fast` fuera de `search`
(relieve rápido, sin horizonte híbrido por defecto), `compare`, `Site.slope` y los filtros de `sites`.

### Ejemplo: ficha corta (planificador `web/`)

Pocos campos de cinco sitios en una petición: lo que hoy son diez llamadas a la v1.

```graphql
{
  sites(ids: ["shackleton-rim", "im1", "apollo11", "chandrayaan3", "im2-alunizaje"]) {
    id name
    slope { slopeDeg }
    sunEarth(at: "2027-01-15T00:00:00Z") { sun { elevationDeg visible } earth { elevationDeg visible } }
    landingDates(from: "2027-01-01", to: "2027-12-31", top: 3) { best { date score } }
  }
}
```

```jsonc
{"data":{"sites":[
  {"id":"shackleton-rim","name":"Cresta de conexión de Shackleton","slope":{"slopeDeg":1.3},
   "sunEarth":{"sun":{"elevationDeg":0.3834,"visible":true},"earth":{"elevationDeg":4.8044,"visible":true}},
   "landingDates":{"best":[{"date":"2027-09-12T00:00:00.000Z","score":99.38},…]}},
  {"id":"im1","name":"IM-1 Odysseus","slope":{"slopeDeg":12.51},…},…]},
 "extensions":{"cost":{"estimated":401.2,"limit":10000,"depth":4,"siteDates":1825},
               "computed":{"routeCalls":15,"memoHits":0,"ephemerisSamples":12493,"ephemerisReused":53034}}}
```

### Ejemplo: análisis completo (dashboard)

Ranking con relieve, restricciones, batería y pendiente, y para el sitio elegido el horizonte, la trayectoria, las
ventanas con la noche real y el barrido con toda su serie: una consulta (`EXAMPLES[4]` en `src/graphql/examples.ts`).

```graphql
{
  rank(sites: ["shackleton-rim", "im2-alunizaje", "im1", "chandrayaan3"], from: "2027-01-24T00:00:00Z", days: 14,
       terrain: { panelHeightM: 10, antennaHeightM: 2 }, night: { fullNight: true }, battery: {},
       constraints: { minEarthTimeFraction: 0.5, maxBatteryKg: 500 }, slope: { baselineM: 100, maxSlopeDeg: 15 }) {
    results { rank siteId score meetsConstraints violatedConstraints metrics { meanSunDiskFraction earthTimeFraction longestNightFullHours batteryKg } }
    terrain { applied note }
  }
  site(id: "shackleton-rim") {
    horizon(heightM: 10) { azimuthStepDeg elevationDeg }
    track(from: "2027-01-24T00:00:00Z", to: "2027-01-26T00:00:00Z", stepMinutes: 60, terrain: {}) { times sun { elevationDeg horizonElevationDeg } }
    windows(from: "2027-01-24T00:00:00Z", to: "2027-02-07T00:00:00Z", terrain: {}, night: { fullNight: true }, battery: {}) {
      night { longestNightHours longestNightFullHours nightTruncated } battery { batteryKg note }
    }
    landingDates(from: "2027-01-01", to: "2027-03-31", terrain: {}, constraints: { maxLongestNightHours: 120 }) {
      stats { score { min mean max } meetsConstraintsFraction }
      dates { date score meetsConstraints violatedConstraints }
    }
  }
}
```

```jsonc
{"data":{
  "rank":{"results":[
    {"rank":1,"siteId":"shackleton-rim","score":74.01,"meetsConstraints":false,"violatedConstraints":["minEarthTimeFraction"],
     "metrics":{"meanSunDiskFraction":1,"earthTimeFraction":0.1335,"longestNightFullHours":0,"batteryKg":0}},
    {"rank":2,"siteId":"im1","score":56.47,"meetsConstraints":true,"violatedConstraints":null,
     "metrics":{"meanSunDiskFraction":0.3781,"earthTimeFraction":1,"longestNightFullHours":418,"batteryKg":232.22}},…],
    "terrain":{"applied":true,"note":"Relieve LOLA calculado con el DEM en caché en 4 de 4 sitios; …"}},
  "site":{"horizon":{"azimuthStepDeg":0.5,"elevationDeg":[-3.73,-3.73,…]},"track":{…},"windows":{…},"landingDates":{…}}}}
```

### Comparar sitios y fechas (`compare`)

El mismo barrido de fechas para hasta 10 sitios (ids o `lat:lon`): `sites` (el barrido de cada uno y el sitio con todos
sus campos), `matrix` (una fila por fecha con la puntuación de cada sitio y el mejor) y `ranking` (sitios por su mejor
fecha). Las efemérides de cada instante se calculan una vez para todos los sitios.

```graphql
{
  compare(sites: ["shackleton-rim", "im1", "chandrayaan3"],
          landingDates: { from: "2027-01-01", to: "2027-02-28", dateStepHours: 48, missionDays: 14 }) {
    ranking { rank siteId bestDate bestScore meanScore }
    matrix { date bestSiteId cells { siteId score } }
  }
}
```

### Rendimiento

Todo se calcula por petición y una sola vez:

- **Memo por petición**: dos campos (o un alias, o `compare` y `Site.landingDates`) que piden lo mismo usan el mismo
  cálculo (`extensions.computed.memoHits`).
- **Efemérides compartidas**: la petición entera corre dentro de `withVectorCache` (`../backend/src/ephemeris.ts`): los
  vectores Sol/Tierra de cada instante, la parte cara, se calculan una vez para todos los campos y sitios
  (`ephemerisSamples` calculadas frente a `ephemerisReused`). El resultado es idéntico bit a bit.
- Las máscaras y los rayos del horizonte híbrido ya se guardan por hilo en el motor.
- Una consulta es una tarea del pool, con prioridad ligera (coste < `LUNAR_GRAPHQL_HEAVY_COST`) o pesada.

Medido en local (4 workers, DEM real, mediana de 7, cachés calientes): la ficha corta de cinco sitios de arriba tarda
**167 ms** con una consulta GraphQL frente a **757 ms** con las 10 llamadas equivalentes a la v1 una tras otra
(`/v1/sun-earth?…&slope=1` y `/v1/landing-dates?…&top=3&dates=0` por sitio) y **245 ms** con las 10 en paralelo (que
ocupan los 4 workers). Respuesta: 1,9 KB frente a 29,6 KB. Con relieve, 171 ms frente a 758 y 259 ms.

### Límites

Cada consulta se analiza antes de calcular nada (en el hilo principal): si pasa un límite, 400 con un mensaje que dice
cuánto pide y cuál es el máximo, y no ocupa ningún worker.

| Variable | Qué limita | Por defecto |
|---|---|---|
| `LUNAR_GRAPHQL_MAX_COST` | Coste estimado de la consulta (puntos; un punto ≈ 1 ms de cálculo en un núcleo) | 10000 |
| `LUNAR_GRAPHQL_MAX_DEPTH` | Niveles de campos anidados (la introspección no cuenta) | 12 |
| `LUNAR_GRAPHQL_MAX_SITE_DATES` | Sitios × fechas de alunizaje de todos los barridos de la consulta | 10000 |
| `LUNAR_GRAPHQL_MAX_TOKENS` | Tamaño de la consulta en elementos | 5000 |
| `LUNAR_GRAPHQL_MAX_BODY_BYTES` | Cuerpo de un POST (413) | 65536 |
| `LUNAR_GRAPHQL_HEAVY_COST` | Desde este coste la consulta va a la cola de lo pesado | 100 |
| `LUNAR_GRAPHQL_PERSISTED_MAX` | Consultas persistidas guardadas (LRU; las de ejemplo no cuentan) | 500 |
| `LUNAR_GRAPHQL_INTROSPECTION` | `0` desactiva la introspección | 1 |

Además rigen los límites de cada campo (los de la v1: 400 días de barrido, 366 de ventanas, 3000 puntos de trayectoria,
10 sitios por `rank` o `compare`) y los del servidor (`LUNAR_REQUEST_TIMEOUT_MS`, `LUNAR_QUEUE_MAX`…).

Coste de cada campo (`src/graphql/limits.ts`, `COSTS`), recalibrado en 1.13.0 con medidas reales (DEM real, un worker,
en frío y repetido). Un campo de datos cuesta 0; `slope`, 2; `sunEarth`, 50 (busca el próximo orto y ocaso en 45 días).
Las efemérides (0,011 por muestra: horaria en barridos, rankings y trayectorias, cada 15 min en ventanas; la noche real
añade 60 días) se cobran **una vez por consulta y periodo**, como las calcula el servidor, no una vez por sitio; cada sitio
añade lo suyo (0,0004 por muestra y el deslizamiento del barrido). Con relieve, cada máscara según su estado
(`maskState` en `../backend/src/horizon.ts`, mirando la caché de disco antes de calcular): **110 en frío** (modo preciso;
12 en rápido), 1 si ya está en la caché de disco o es la del catálogo, 0 sin máscara; y los rayos del horizonte híbrido
(0,01 por muestra en ventanas, 0,002 en barridos y rankings, 20 en `sunEarth`). Las listas que crean sitios (`sites`,
`compare.sites`) suman lo de cada sitio. `bestLandings` cuesta, por sitio, las ventanas cada 15 min de la ventana de
aterrizaje más la misión y 16 días, y 0,02 por aterrizaje probado (cada 12 h); `lightMap`, 12 por punto con el DEM (su
máscara rápida en frío) y casi nada sin él: un mapa de 2000 puntos con relieve pasa del límite por defecto (en la v1 se
puede pedir).

| Consulta (DEM real) | Medido | Estimado 1.12.0 | Estimado 1.13.0 |
|---|---|---|---|
| `sunEarth` de un sitio | 53 ms | 11 | 51 |
| `windows` de un año | 385 ms | 422 | 401 |
| `landingDates` de un año | 104 ms | 114 | 109 |
| `sites { landingDates(un año) }` (15 sitios) | 157 ms | 1701 | 222 |
| … con relieve, en frío / repetida | 820 / 158 ms | 3709 (rechazada) | 754 / ~200 |
| `horizon` de un punto nuevo, en frío | 102 ms | 11 | 112 |
| `rank` de 10 puntos nuevos con relieve, 30 días, en frío | 969 ms | 351 | 1131 |
| `windows` de un año con relieve (catálogo), en frío / repetida | 712 / 390 ms | 867 | 752 |
| `bestLandings` de 10 sitios, 120 días, misión de 30 (1.16.0) | 210 ms | — | 313 |
| … con relieve (5 del catálogo y 5 puntos nuevos), en frío | 735 ms | — | 1154 |
| `lightMap` de 709 puntos (60 km cada 4 km), 10 días, en frío | 7,7–10,1 s | — | 8580 |

En 1.17.0, `search`, medida igual (máscaras siempre en frío) y con su estimación:

| Consulta (DEM real) | Medido | Estimado 1.17.0 |
|---|---|---|
| `search` de `polo-sur` por defecto, sin relieve | 94 ms | 101 |
| `search` de `polo-sur` cada 10 km, 60 días, paso de 30 min | 650 ms | 700 |
| `search` de `polo-sur` cada 20 km con relieve (rápido) | 3,1–7,2 s | 6607 |

Cada punto de la búsqueda cuesta 0,00017 por muestra (su bucle es más ligero que el del ranking) más su máscara con
relieve (12 en rápido, 110 en preciso), contando la malla inicial (estimada por el área) y el refinamiento (25 puntos
alrededor de cada uno de los `refineTop` mejores en cada nivel). `health` cuesta 0 y no se cachea; `regions`, 0.

El límite por defecto pasa de 3000 a **10 000** (≈ 10 s de un núcleo, la duodécima parte del tiempo máximo de una
petición) y el umbral de lo pesado, de 50 a **100** (un `sunEarth` sigue siendo ligero). Con la caché de resultados del
servidor (1.13.0), una consulta determinista repetida (sin fechas por defecto, sin errores) no recalcula, y varias
consultas idénticas a la vez se calculan una sola: 8 iguales simultáneas tardaban 243–300 ms frente a 103–149 ms de una
sola; ahora 85–109 ms.

### Errores

En el formato de GraphQL (`errors[]`), en español y con un código estable en `extensions.code` (los mensajes pueden
cambiar). Un error de un campo no tumba la consulta: ese campo vale `null` y el resto llega (200).

| Código | Cuándo | HTTP |
|---|---|---|
| `syntax_error`, `validation_failed`, `invalid_variables` | Consulta mal escrita, campo o argumento inexistente, variables que no encajan | 400 |
| `query_too_deep`, `query_too_complex`, `too_many_site_dates`, `query_too_large` | Límites de arriba | 400 |
| `bad_request`, `payload_too_large`, `unsupported_media_type`, `method_not_allowed` | Petición HTTP mal formada | 400, 413, 415, 405 |
| `PERSISTED_QUERY_NOT_FOUND`, `persisted_query_hash_mismatch` | Consultas persistidas (el primero, con el nombre del protocolo APQ) | 400 |
| `invalid_parameter`, `not_found` | Los de la v1, en el campo (por ejemplo, `from no es una fecha real: 2027-02-30`) | 200 |
| `overloaded`, `timeout`, `internal_error` | Cola llena (`Retry-After`), cálculo demasiado largo, fallo interno | 503, 504, 500 |

### Dónde está montado

En este servidor (`data/`, puerto 3100), el único de la API: `backend/` no tiene servidor propio desde #61. GraphQL se
apoya en la v1 (sus nombres, su validación y sus valores) y la v1 en los casos de uso del motor
(`backend/src/useCases.ts`). Una búsqueda en malla o un mapa de luz grandes pueden pasar del coste máximo de una
consulta GraphQL: entonces, la v1 (`POST /v1/search/jobs` para las búsquedas, que corren en segundo plano).

## Limitaciones

- **Sin `terrain=1` no hay relieve**: los resultados polares son **optimistas**.
- **Relieve solo en el polo sur** (DEM LOLA hasta unos 60°S). Fuera de 80°S solo hay 240 m/px, que en crestas afiladas
  puede fallar varios grados. No se modelan la sombra del propio módulo, la inclinación de los paneles (salvo las
  tres orientaciones de `panel`) ni el multitrayecto de radio. Con `terrain=1`, `heightKm` sigue elevando al observador sobre la esfera para la geometría.
- **`heightKm` no baja el horizonte** (ver «Entrada estricta y avisos»).
- **Precisión**: ≤ 0.006° en dirección frente a JPL Horizons en 2026–2030 (peor punto medido: 0.0047°;
  media cuadrática: 0.0020°). `npm test` lo comprueba en 20 030 puntos y falla si se supera. Fuera de esos años
  el error crece despacio (0.0062° en 2043).
- **Ortos y ocasos**: el error en tiempo es el de dirección dividido por lo deprisa que el astro cruza el
  horizonte, así que depende del sitio. Frente a Horizons, en los tres modos y en 2026–2030:

  | Sitios del catálogo | Sol | Tierra |
  |---|---|---|
  | Hasta 70° de latitud (11 sitios) | < 1 min (mediana ~10 s) | no sale ni se pone |
  | IM-1 e IM-2 (80–85° S) | < 3 min | < 5 min en IM-2 |
  | Junto a Shackleton (89.45° S) | hasta 70 min (mediana 11 min) | < 5 min |

  Ningún orto ni ocaso falta ni sobra respecto a Horizons en esos 5 años. El detalle por sitio está en
  [`ACCURACY.md`](ACCURACY.md); `npm test` comprueba un tramo de cada tipo de sitio y `npm run accuracy`, todo.
- **Validación frente a fuentes oficiales**: [`../VALIDATION.md`](../VALIDATION.md) mide cada endpoint frente a JPL
  Horizons, los productos de PGDA/LOLA (iluminación, visibilidad de la Tierra, cielo visible, PSR, pendiente LDRM),
  Gläser et al. 2018, Leone et al. 2023, NSSDC/LROC y misiones reales, con su tolerancia y su estado; los problemas
  conocidos (#85: iluminación con relieve en el polo profundo; #86: observador a 0 m) salen marcados con su tope.
- **Roces en los polos**: cuando un disco pasa a menos de ~0.005° del horizonte sin cruzarlo (o cruzándolo por
  muy poco), puede aparecer o faltar una ventana entera de varias horas. Medido en un punto de control a
  89.5° N: dos ventanas de 14 y 19 h que Horizons no tiene, en 5 años. En el catálogo no ocurre en 2026–2030.
- Ortos y ocasos se buscan con muestreo de 15 min: un roce que sale y se pone dentro del mismo paso no se detecta.
- **Eclipses**: no se modelan los eclipses de Sol vistos desde la Luna (eclipses de Luna vistos desde la Tierra, [catálogo de NASA](https://eclipse.gsfc.nasa.gov/lunar.html)): las ventanas de Sol no descuentan esas horas.
- `nextRise`/`nextSet` se buscan hasta 45 días; si no ocurren, valen `null`.
- Las ventanas se recortan al intervalo pedido (`startsBeforeRange` / `endsAfterRange` lo indican).
- Los sitios con `coordinatesVerified: false` tienen coordenadas aproximadas.

## Versionado

Todo cuelga de `/v1` y `info.version` en `openapi.yaml` sigue semver. Dentro de v1 solo se añaden campos o
parámetros **opcionales**; quitar o renombrar campos, cambiar unidades o cambiar los pesos **por defecto** del ranking
implica `/v2`. Los mensajes de error (`error.message`) y de aviso (`warnings[].message`) pueden cambiar; los códigos
(`error.code`, `warnings[].code`) no.

Las correcciones de errores sí pueden cambiar respuestas dentro de v1, documentadas en «Cambios» de `openapi.yaml`. En
1.9.0: entradas mal formadas que antes se aceptaban (o daban un 500) son un 400, `meetsMaxSlope` vale `null` y no `false`
sin pendiente, y sin parámetros nuevos solo cambian la `note` de `/v1/rank` (supone un panel que sigue al Sol), el aviso
de Luna lisa en `warnings` de los sitios polares de `/v1/sun-earth` y `/v1/windows` y `terrainMaskHeightsM` en
`/v1/sites`. `test/contract.ts` deshace esos cambios para seguir comprobando los hashes de 1.4.0, y
`test/fixtures/v1-contract-1.9.0.json` guarda los cuerpos completos de 1.9.0 (con `/v1/landing-dates`) para ver el diff. En
1.10.0 ningún cuerpo cambia sin el parámetro nuevo (`dates`): los tests siguen comparando con ese fichero (salvo
`apiVersion` de `/v1/health`), también comprimidos y desde el pool de workers.

En 1.12.0, una corrección: una pendiente subestimada ya no cuenta como apta con `maxSlopeDeg` (`meetsMaxSlope` `null` y,
en `/v1/rank`, fuera con `slopeUncertified`); sin parámetros de pendiente nada cambia.

En 1.19.0 ningún cuerpo cambia sin `relief=1` o `reliefRadiusKm` en `/v1/horizon` (salvo `apiVersion`): con ellos, la
respuesta añade `relief`, las alturas del terreno alrededor del sitio para dibujarlo en 3D.

En 1.24.0 ningún cuerpo cambia sin el parámetro nuevo (`dsn` en `/v1/windows`, salvo `apiVersion`): con `dsn=1`, la
respuesta añade `earthDsn` y `dsn` (ver «Tierra visible con antena de la DSN»).

En 1.23.0 ningún cuerpo cambia sin `terrain=1` (salvo `apiVersion`): con relieve, un punto al sur de 85°S añade el aviso
`deep_polar_uncertainty` a `warnings` (#437). Ninguna cifra cambia.

En 1.22.1 solo cambia el texto de `battery.note` (#255): atribuye los 100 W a Cataldo, Zacny y Schmitz (NETS 2018) y
200 Wh/kg y 0,9 a COMPASS, en lugar de los tres a COMPASS. `test/contract.ts` repone el texto anterior para seguir
comparando con los cuerpos guardados.

En 1.22.0 `/v1/track` añade a cada astro `angularRadiusDeg`, el radio aparente del disco (#192): con él, el margen del
borde inferior (`elevationDeg − horizonElevationDeg − angularRadiusDeg`) es el del criterio `full` de `/v1/windows`. Ningún
otro valor cambia; `test/contract.ts` quita el campo para seguir comparando con los cuerpos guardados.

En 1.18.0 ningún cuerpo cambia sin el parámetro nuevo (`horizonBandDeg` en `/v1/windows`, salvo `apiVersion`): con él, la
respuesta añade `horizonBand` (ver «Banda de robustez del horizonte»).

En 1.16.0 ningún cuerpo cambia sin los parámetros nuevos (salvo `apiVersion`): las rutas pasan a ser una capa fina sobre
los casos de uso del motor y desaparece la API interna `/api/*` de `backend/`.

En 1.13.0, sin `terrain=1` nada cambia salvo el objeto nuevo `terrain` de `/v1/health`. Con `terrain=1` en un servidor sin
DEM, `/v1/rank` y `/v1/landing-dates` usan la máscara del catálogo (una corrección) y, si algún horizonte sigue siendo el de
la Luna lisa, la respuesta lleva el aviso `terrain_not_applied`. `test/contract.ts` (`asOf1_12`) quita ambas cosas para
seguir comparando con los cuerpos de 1.9.0.

El esquema GraphQL sigue la misma regla: dentro de 1.x solo se añaden campos, argumentos opcionales o valores de enum; un
campo que deje de tener sentido se marca `@deprecated` antes de quitarlo en una versión mayor. Los `extensions.code` son
estables.

Los datos del catálogo sí pueden corregirse dentro de v1. En 1.3.0, `shackleton-rim` pasó de «Borde de Shackleton»
(−89.45, −137) a «Cresta de conexión de Shackleton» (−89.44027, −137.12649): el punto C1 de Gläser et al. 2018
(<https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf>) refinado con el DEM LOLA. El id no cambia,
pero sí los valores de las respuestas de ese sitio (también sin `terrain`).

## Estructura

```
openapi.yaml       especificación OpenAPI 3.1 (fuente de verdad del contrato)
src/v1.ts          rutas /v1: valida parámetros, llama al caso de uso (../backend/src/useCases.ts) y da forma pública a la respuesta
src/request.ts     parámetros de cada ruta y avisos (`warnings`) de lo que se ignora
src/notes.ts       textos fijos que los tests necesitan sin cargar el motor
src/app.ts         petición → respuesta: errores uniformes (405 con Allow), warnings, /openapi.yaml, /openapi.json y /docs; lo importan los workers
src/server.ts      node:http con la capa común de ../backend/src/httpServe.ts: pool de workers, CORS, compresión, ETag, límites
src/docs.html      Swagger UI (versión fijada) apuntando a /openapi.yaml
src/graphql/       API GraphQL (1.11.0): schema.graphql (esquema), operations.ts (qué campo y argumento de GraphQL corresponde a
                   cada ruta y parámetro de la v1, 1.17.0), resolvers.ts (cada campo llama a su ruta v1, memo por petición),
                   limits.ts (límites y coste), executor.ts (preparación y ejecución), http.ts (GET/POST, persistidas, explorador),
                   messages.ts (errores de graphql-js en español), examples.ts (ejemplos) y graphiql.html (explorador)
test/api.test.ts   200/400/404 por ruta, conformidad con el esquema y ejemplos de la spec = respuestas reales
test/terrain.test.ts  relieve: sin terrain, respuesta de 1.0.0 aunque haya máscaras; con terrain=1, catálogo, DEM sintético y esfera
test/night.test.ts    noche y batería: sin parámetros, respuesta idéntica; noche real, umbral, aritmética de la batería y errores
test/landing-dates.test.ts  barrido de fechas (1.5.0) y contrato: las demás rutas, byte a byte como en 1.4.0 (fixtures/v1-contract-1.4.0.json)
test/heights.test.ts  panel y antena a distinta altura (1.6.0): cada cuerpo con su máscara, respuesta idéntica sin ellas, errores
test/slope.test.ts    pendiente (1.7.0): sin parámetros, respuestas byte a byte como en 1.4.0 aun con DEM; cerro sintético, filtro de /v1/rank y DEM real si está
test/strict.test.ts   entrada estricta, warnings, pesos y restricciones en /v1/rank, noche cortada, detalles (1.9.0) y contrato 1.9.0
test/http.test.ts     HTTP de 1.10.0: compresión (mismos bytes que el contrato 1.9.0), ETag/304, Cache-Control, seguridad, dates=0, 414 y 503
test/single-source.test.ts  una sola fuente de verdad (1.16.0): /v1, GraphQL y el caso de uso (como las evals) dan lo mismo, con y sin relieve;
                   y (1.17.0) cada operación con todos sus parámetros da el mismo cuerpo por /v1 y por GraphQL
test/api-parity.test.ts  paridad de lo que ofrecen (1.17.0): rutas, parámetros y campos de respuesta de openapi.yaml frente a schema.graphql
test/pool.test.ts     pool de workers: mismos bytes que sin pool, máscaras calculadas una vez, worker reservado, trabajos y timeout
test/graphql.test.ts  GraphQL sin relieve: mismos valores que la v1 campo a campo, HTTP (GET, POST, APQ, caché, CORS, explorador), errores, límites y pool
test/graphql-terrain.test.ts  GraphQL con relieve (máscaras del catálogo y DEM sintético): mismos valores que la v1 con terrain=1
test/graphql-helpers.ts  selección de todos los campos de un tipo y comparación GraphQL ↔ v1
test/contract.ts      rutas del contrato 1.9.0 y lo que cambió respecto a 1.4.0 sin parámetros nuevos
test/schema.ts     validador mínimo de JSON Schema (el subconjunto que usa la spec)
test/precision.test.ts   dirección del Sol y la Tierra frente a JPL Horizons, sin servidor y sin red
test/events.test.ts      ortos, ocasos y horas visibles frente a JPL Horizons, sin servidor y sin red
test/accuracy.ts         medida del error frente a Horizons; la comparten los dos tests y el informe
test/accuracy-report.ts  informe de precisión completo (`npm run accuracy`)
test/validation-summary.ts  resumen de validación para la web (`npm run validation-summary`); su test comprueba que el guardado está al día
test/fixtures/     referencias de Horizons versionadas (horizons.json y horizons-events.json) y los scripts
                   que las regeneran (fetch-horizons*.ts); contratos v1 (hashes de 1.4.0 y cuerpos de 1.9.0, que
                   regenera write-contract.ts)
ACCURACY.md        informe de precisión generado; se regenera en el commit que cambie el cálculo
```

Dependencias (versiones exactas):
- [`yaml`](https://www.npmjs.com/package/yaml) 2.9.1: sirve `/openapi.json` a partir del YAML y lee la spec en los tests;
- [`graphql`](https://www.npmjs.com/package/graphql) 17.0.2 (graphql-js, la implementación de referencia): esquema, validación
  y ejecución de `/graphql`. Funciona sin build (es JavaScript) y sin servidor aparte: lo sirve la misma capa HTTP;
- del motor, desde `backend/node_modules`: [`astronomy-engine`](https://www.npmjs.com/package/astronomy-engine) 2.1.19
  (efemérides), fijada en `backend/package-lock.json`.

Ninguna tiene dependencias transitivas. El explorador carga GraphiQL 3.9.0 y React 18.3.1 de unpkg en el navegador (no
son dependencias del servidor). El validador de esquemas es propio (~50 líneas) y
falla ante cualquier palabra clave de JSON Schema que no soporte, para que ningún esquema quede sin comprobar.
