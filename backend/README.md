# Backend · Lunar Landing Site Navigator

Motor de cálculo (Node.js, sin framework) del reto NASA Space Apps 2026 «Lunar Landing Site Navigator», sus casos de uso,
la infraestructura que comparten los servidores (pool de workers, caché, trabajos asíncronos) y las evals. **No tiene
servidor HTTP propio** desde #61: la API es la pública v1 y GraphQL de [`../data/`](../data/README.md).
Dado un sitio de la Luna (latitud/longitud selenográficas) y una fecha, calcula el azimut y la
elevación del **Sol** (energía solar) y de la **Tierra** (comunicación directa), si se ven y cuándo
salen o se ponen, y las ventanas en las que se ven ambos a la vez.

Única dependencia en runtime: [`astronomy-engine`](https://github.com/cosinekitty/astronomy)
(`geotiff` es devDependency: solo la usa el script que descarga el relieve).
Requiere Node 26.13 (`.nvmrc`; `package.json` exige `26.13.x` con `engine-strict`).

La API pública v1 ([`../data/`](../data/README.md)) importa `src/` directamente (sin copia) y resuelve sus dependencias
desde `backend/node_modules`. Si cambias `src/`, ejecuta también los tests de `data/`: el contrato v1 no debe cambiar sin
pedirlo.

## Ejecutar

```sh
npm ci               # dependencias exactas del package-lock.json
npm test             # tests unitarios, de precisión y de los casos de uso (node:test)
npm run typecheck    # tsc en modo strict (sin build: Node ejecuta los .ts quitando los tipos)
npm run fixture      # vuelve a descargar de JPL Horizons test/fixtures/horizons.json
```

## Modelo

- Posiciones geocéntricas del Sol (con aberración) y de la Luna con astronomy-engine, en el marco ecuatorial J2000.
- Orientación de la Luna con el modelo de rotación **IAU** de astronomy-engine (`RotationAxis`), que se
  aproxima al marco Mean Earth/Polar Axis. No usa las efemérides de libración de DE440 (marco ME de DE440).
- Luna **esférica** de radio 1737.4 km (como Horizons); `heightKm` sube el observador sobre esa esfera.
- Sin refracción (no hay atmósfera).
- Azimut desde el norte selenográfico hacia el este, en grados. Longitud este positiva.
- Criterios de visibilidad (`mode`):
  - `limb` (por defecto): se ve alguna parte del disco (limbo superior sobre el horizonte). Es el criterio de las
    tablas de orto y ocaso de Horizons.
  - `center`: el centro del disco está sobre el horizonte.
  - `full`: el disco entero está sobre el horizonte.
- `visibleFraction`: fracción del disco sobre el horizonte (0–1), aproximando el horizonte como una recta.
  Sirve como indicador de la potencia solar disponible durante el orto y el ocaso.
- **Qué supone la energía.** La métrica `energy` (búsqueda, evals; `meanSunDiskFraction` en `/v1/rank`) es la media, en
  cada paso, de `visibleFraction` del Sol. Por defecto supone un **panel que sigue al Sol** en dos ejes (incidencia normal):
  no tiene en cuenta el ángulo de incidencia. Tampoco modela el oscurecimiento del limbo, la variación de la distancia al Sol
  (±3,4 %), las sombras del propio módulo ni el polvo.
- En el polo el Sol va a 0–2° de elevación: un panel horizontal recibiría ~sen(el), es decir, casi nada (0–3,5 %). Lo
  realista allí son paneles **verticales que giran** para mirar al Sol, como los de los requisitos VSAT de la NASA
  (<https://ntrs.nasa.gov/api/citations/20230012849/downloads/GCD%20Annual%20Review%20VSAT%20September%202023%20Final.pdf>). La opción `panel` (ver «Panel solar») permite elegir la orientación.
- Ortos y ocasos: se muestrea el margen de visibilidad cada 15 min y cada cambio de signo se refina por
  bisección hasta 1 s.

### Validación

`test/horizons.test.ts` compara con JPL Horizons (DE441, `MEAN_ME`) cada 30 min del 2027-01-01 al
2027-03-01, desde Chandrayaan-3 y el borde de Shackleton:

| Serie | Error máx. de elevación | Separación angular máx. |
|---|---|---|
| Chandrayaan-3 / Sol | 0.0018° | 0.0033° |
| Chandrayaan-3 / Tierra | 0.0024° | 0.0026° |
| Shackleton / Sol | 0.0021° | 0.0033° |
| Shackleton / Tierra | 0.0025° | 0.0026° |

Los ortos y ocasos con el modo `center` quedan a menos de 1.2 min de los cruces por 0° de Horizons
(interpolados linealmente cada 30 min). El umbral del test es de 10 min.

La campaña completa (los sitios del catálogo, los tres modos y 2026–2030) está en
[`data/ACCURACY.md`](../data/ACCURACY.md). Si cambia el cálculo, hay que regenerarla en el mismo commit con
`cd data && npm run accuracy -- --write`: su diff dice si el cambio mejora o empeora la precisión.

### Limitaciones

- **Relieve solo donde hay DEM en la caché.** Con máscaras LOLA (ver «Relieve») el horizonte es el real; sin ellas
  es el de una esfera (0°) y los resultados polares son **optimistas** (hasta +34 pp de tiempo de Sol en el polo).
  Las búsquedas (`/v1/search`, `/v1/rank`) y los evals solo usan relieve si se pide (`terrain=1`).
- **Orientación IAU frente a DE440 ME.** El error resultante es de unas 0.003°, alrededor del 1 % del radio
  del Sol (0.27°). Cerca del polo el Sol sube o baja muy despacio (unas 0.005°/h), así que ese error
  angular puede suponer minutos de desfase en un orto o un ocaso.
- **Eventos muy rasantes.** Si un cuerpo sale y se pone dentro de un mismo paso de muestreo (15 min),
  ese par de eventos no se detecta. Solo pasa en roces casi tangentes al horizonte.
- Las ventanas de `/v1/windows` (y de `windows()` y `compare()`) se recortan al intervalo pedido: la primera puede
  empezar en `start` y la última acabar en `end` aunque el cuerpo ya estuviera visible antes o lo siga después.
- Los sitios con `verified: false` tienen coordenadas aproximadas.
- **Eclipses.** No se modelan los eclipses de Sol vistos desde la Luna (eclipses de Luna vistos desde la Tierra, [catálogo de NASA](https://eclipse.gsfc.nasa.gov/lunar.html)): las ventanas de Sol no descuentan esas horas.
  Durante uno la luz y la energía salen optimistas en toda la cara visible, unas horas como mucho.

## Casos de uso (`src/useCases.ts`)

Una sola fuente de verdad (#61): cada operación es una función que recibe parámetros ya validados y tipados (nombres
internos) y decide **ella** los valores por defecto, el relieve (DEM, máscara del catálogo o esfera, con su aviso), la
puntuación, las restricciones y los avisos de dominio. La API v1 y GraphQL de `data/` solo validan, traducen nombres y
formatean; las evals llaman a `evaluatePeriod`. Así la misma pregunta da lo mismo por cualquier camino
(`../data/test/single-source.test.ts` lo comprueba con y sin relieve, también en un sitio del catálogo sin DEM).

| Caso de uso | Ruta v1 | Qué decide además del cálculo |
|---|---|---|
| `sunEarth` | `/v1/sun-earth` | `lookaheadDays` (45), horizonte de cada astro, `earthMinElevationDeg`, pendiente del sitio |
| `visibilityWindows` | `/v1/windows` | paso de 15 min, noche y batería, aviso de noche truncada, banda de robustez del horizonte (`horizonBandDeg`), modo DSN (`dsn`: `earthDsn`) |
| `track` | `/v1/track` | paso de 1 h por defecto, elevación del horizonte en el azimut de cada astro |
| `horizonProfile` | `/v1/horizon` | siempre con relieve, sin rayo directo |
| `lightMapCells`, `lightMap` | `/v1/light-map` | malla del disco, máscaras rápidas |
| `rank` | `/v1/rank` | pesos `SCORE_WEIGHTS` (0,7 / 0,3), relieve preciso, batería por `maxBatteryKg`, veredicto de restricciones, sitios fuera por pendiente |
| `landingDates` | `/v1/landing-dates` | lo mismo que `rank` para cada fecha candidata |
| `search` | `/v1/search` | relieve rápido por defecto, refinado, separación mínima 4 × `spacingKm` |
| `evaluatePeriod` | (evals) | un punto en un periodo muestreado, con la pendiente y las restricciones de `constraints.ts` |

Avisos de dominio (`WarningSink`): `smooth_moon_polar`, `night_truncated`, `outside_validated_dates`,
`height_no_horizon_dip`, `low_observer_height`, `terrain_not_applied` y `deep_polar_uncertainty`; la v1 los pone en `warnings`.

`deep_polar_uncertainty` (#437): `visibilityWindows`, `rank`, `landingDates`, `search` y `lightMap` lo emiten cuando
algún punto con relieve aplicado está al sur de 85°S (`DEEP_POLAR.maxLatDeg`). Ahí la matriz de validación
([`VALIDATION.md`](../VALIDATION.md), filas frente a los productos de 60 m de PGDA) mide desviaciones de decenas de puntos
porcentuales (#85). Las cifras del mensaje (`DEEP_POLAR.measured`, filas de 2 m) salen de esa matriz: `test/deep-polar.test.ts`
las vuelve a leer de `VALIDATION.md` y falla si se separan. Solo informa: no cambia ninguna cifra, puntuación ni veredicto.

Los límites y valores por defecto de todas las operaciones están en `LIMITS` (`src/useCases.ts`); la v1 valida contra ellos.

## Noche y batería

Opcional en `/v1/search`, `/v1/rank`, `/v1/landing-dates` y `/v1/windows`. Sin estos parámetros las respuestas no cambian (`src/night.ts`).

| Parámetro | Qué hace | Por defecto |
|---|---|---|
| `nightMinSunFraction` (0–1) | Un instante es de noche si la fracción visible del disco solar es menor que este valor. Con 0 decide `mode` (con `limb` basta un filo del disco para que no sea de noche); 0,5 equivale a `center` y 1 a `full` | 0 |
| `fullNight=1` | Además de `longestNightH` (recortada al periodo), `longestNightFullH`: la noche más larga que toca el periodo, entera. Si el periodo empieza (acaba) a oscuras, la busca hacia atrás (delante) con el mismo paso hasta el ocaso (amanecer), como mucho 30 días | no |
| `battery=1` | `batteryKWh = survivalLoadW × horas / 1000` y `batteryKg = batteryKWh × 1000 / (batteryDoD × batteryWhPerKg)`, con la noche real si se pide y, si no, con `longestNightH` | no |
| `survivalLoadW` (0–10 000) | Carga de supervivencia durante la noche, en W (también activa la batería) | 100 |
| `batteryWhPerKg` (10–1000) | Energía específica a nivel de pack, en Wh/kg (también la activa) | 200 |
| `batteryDoD` (0,05–1) | Profundidad de descarga utilizable (también la activa) | 0,9 |

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
- **`batteryKg` es solo la masa del pack:** sin electrónica, sin el panel solar extra para recargarlo y sin márgenes.
  A nivel de sistema sale unas 2–3 veces más.
- Por qué la noche real: con una misión de 14 días, `longestNightH` se queda en lo que cae dentro. En (−65,31485°,
  −3,05572°) desde el 24 de enero de 2027 da 183 h, pero la noche dura 351 h (360 h con relieve LOLA a 2 m): la
  batería tiene que aguantar la noche entera.
- La respuesta repite los parámetros usados en `night` (`minSunFraction`, `fullNight`, `extensionLimitDays`) y `battery`.
- Si la noche real llega a los 30 días de búsqueda por algún lado (sombra casi permanente), es solo un mínimo: lo marcan
  `nightTruncated: true` en el resultado (búsqueda y cada fecha de `/v1/landing-dates`) y `night.fullNightTruncated` en
  `windows()`.

## Banda de robustez del horizonte

Las cifras de Sol y Tierra dependen de un horizonte con error: el DEM LOLA, su ray-march (rms 0,014° frente a una
referencia fina; hasta 0,66° en modo rápido sobre una cresta) y, sobre todo, la posición y la altura reales del módulo.
`visibilityWindows` (`/v1/windows`) acepta `horizonBandDeg` (0–5°, valor de referencia 0,3°; 0 o ausente, nada cambia) y
devuelve además `horizonBand`:

- **Qué se calcula.** Las mismas ventanas con el horizonte de **los dos astros** subido (`raised`) y bajado (`lowered`)
  `deg` grados en todos los azimuts, y `range`: el mínimo y el máximo de `totalHours`, `fractionOfTime` y
  `longestWindowHours` del Sol, la Tierra y ambos (y de la noche más larga, si se pide la noche) entre los tres
  horizontes. Se toma el mínimo y el máximo de los tres, no «subido = mínimo», para que la cifra nominal quede siempre
  dentro aunque un roce rasante se detecte en un horizonte y no en otro.
- **Cómo.** Es el mismo desplazamiento de máscara que ya usa `earthMinElevationDeg` (`raiseMask` en `src/useCases.ts`):
  se suma a cada valor de la máscara y al rayo directo del horizonte híbrido, y en la Tierra se suma a su elevación
  mínima. Sin máscara (esfera), el horizonte pasa de 0° a ±`deg`. No se recalcula ninguna máscara ni se toca
  `src/terrain/`: un error constante del horizonte equivale a mover el astro en elevación.
- **Coste.** Las efemérides (lo caro) se muestrean una sola vez y las comparten los tres horizontes (`windows()` acepta
  `sampled`). Un año de ventanas en (−89,76432°, −156,86311°) con el DEM: 0,27 s sin banda y 0,29 s con ella en caliente;
  en frío, los rayos directos de los dos horizontes desplazados añaden ~0,75 s a los 0,8 s de la petición sin banda.
- **Qué no es.** Un análisis de sensibilidad, no un intervalo de confianza: supone el mismo error en todos los azimuts
  (el caso peor para un horizonte que se equivoca en bloque, no un error aleatorio azimut a azimut) y no mueve el sitio
  (para eso, el anillo de puntos alrededor del sitio de la web).
- **Cifras reales** (`mode=full`, observador a 2 m, `horizonBandDeg=0.3`):

  | Sitio y periodo | Horizonte | Sol | Tierra |
  |---|---|---|---|
  | `shackleton-rim`, 2027 entero | máscara del catálogo | 82,0 % [77,0–88,3] | 47,1 % [45,8–48,3] |
  | `shackleton-rim`, 2027 entero | esfera | 46,9 % [40,0–52,3] | 40,6 % [39,1–42,0] |
  | (−89,76432°, −156,86311°), 2027 entero | DEM LOLA | 76,7 % [69,1–81,7] | 39,7 % [38,3–41,1] |
  | (−89,76432°, −156,86311°), 14 días desde el 24-01-2027 | DEM LOLA | 91,0 % [86,9–92,7] | 0 % [0–0] |
  | `im2-alunizaje`, 14 días desde el 24-01-2027 | máscara del catálogo | 28,5 % [27,5–29,6] | 45,9 % [42,2–49,8] |
  | `im1`, 14 días desde el 24-01-2027 | máscara del catálogo | 36,5 % [35,7–37,5] | 100 % [100–100] |

  En el polo, 0,3° son varios puntos de Sol; a 80°S, alrededor de uno. Sin relieve la banda es mucho más ancha en el polo
  (en esos 14 días del punto polar, de 0 % a 100 %): otra forma de ver que allí la esfera no sirve.

```sh
curl 'localhost:3100/v1/windows?site=shackleton-rim&start=2027-01-01&end=2028-01-01&mode=full&terrain=1&horizonBandDeg=0.3'
```

## Tierra visible con antena de la DSN

Que la Tierra se vea desde el sitio no garantiza que alguna estación tenga la Luna sobre su horizonte (#103).
`visibilityWindows` (`/v1/windows`) acepta `dsn` (`dsn=1` en la v1; ausente, nada cambia) y devuelve además
`windows.earthDsn` y `dsn` (`src/dsn.ts`):

- **Qué se calcula.** Para cada instante del muestreo de las ventanas (15 min, con los cruces refinados al segundo),
  si la Luna está por encima de 10° en al menos una de las tres estaciones de la DSN: Goldstone (DSS-14), Madrid (DSS-63)
  y Canberra (DSS-43). `earthDsn` es la intersección de esas horas con las de `earth` (la Tierra visible desde el sitio,
  con su máscara, la altura de la antena y `earthMinElevationDeg`).
- **Fuentes.** Coordenadas geodésicas de las antenas de 70 m: DSN Telecommunications Link Design Handbook (JPL 810-005),
  módulo 301, las mismas que usa JPL Horizons para sus observadores. Los **10° son un supuesto de partida**
  (`DSN_MIN_ELEVATION_ASSUMED`, `dsn.minElevationAssumed` en la API) hasta citar una fuente oficial.
- **Cómo.** Con `astronomy-engine`: la Luna geocéntrica (`GeoMoon`) menos la posición de la antena sobre el elipsoide
  WGS84 (`ObserverVector`), girada al horizonte local (`Rotation_EQJ_HOR`). Centro del disco, sin refracción.
- **Precisión.** Frente a JPL Horizons con el observador en cada antena (`test/fixtures/dsn-horizons.json`, 52 instantes
  de 2027 por estación, `npm run fixture:dsn`): error máximo de 0,001° en elevación (`test/dsn.test.ts` exige ≤ 0,1°).
- **Qué no es.** No mira la programación de la DSN ni si la estación está asignada a la misión: solo si podría apuntar.
  Un hueco o un pase más corto que un paso de muestreo se puede perder (como en `findEvents`). No entra en la banda del
  horizonte ni en la puntuación.
- **Coste.** Tres posiciones de la Luna por instante: un año de ventanas pasa de ~0,9 s a ~2,6 s la primera vez. Las
  horas de la DSN no dependen del sitio: `dsnWindows` guarda las de las últimas mallas de instantes y las peticiones
  siguientes del mismo intervalo (otros sitios) solo pagan la intersección.

## Panel solar (orientación para la energía)

Opcional en `/v1/search`, `/v1/rank` y `/v1/landing-dates` (`data/`) y en los evals (escenario `panel`). Solo cambia la
métrica `energy` (y con ella la puntuación): no cambia `sunFraction`, la noche, la Tierra ni la batería (`src/panel.ts`).
`/v1/windows`, `/v1/sun-earth` y `/v1/track` no dan energía y no lo usan.

En cada paso, `energía = visibleFraction × factor`, con `el` la elevación del **centro** del Sol en grados:

| `panel` | Qué es | Factor |
|---|---|---|
| `tracking` (por defecto) | Panel que sigue al Sol en dos ejes (incidencia normal). Es el comportamiento de siempre, idéntico bit a bit | 1 |
| `vertical-rotating` | Panel vertical que gira para mirar al acimut del Sol. Lo realista en el polo (requisitos VSAT de la NASA) | cos(el) |
| `horizontal` | Panel horizontal fijo | max(0, sen(el)) |

- **Es geometría pura** (coseno del ángulo de incidencia): sin eficiencia de célula ni temperatura, y sin el oscurecimiento
  del limbo, la variación de la distancia al Sol (±3,4 %), las sombras del propio módulo ni el polvo.
- Sin `panel` (o con `panel=tracking`) las respuestas no cambian y no llevan eco. Con otro valor, la búsqueda repite
  `panel` en la respuesta. Un valor desconocido da 400: «panel debe ser tracking, vertical-rotating u horizontal».
- Misión de 14 días desde el 24 de enero de 2027, paso de 1 h, con relieve LOLA (modo preciso, observador a 2 m):

  | Sitio | `tracking` | `vertical-rotating` | `horizontal` |
  |---|---|---|---|
  | `shackleton-rim` (cresta de conexión, Sol a 0,16–0,76°) | 1 | 0,9999 | 0,0099 |
  | `im1` (IM-1, 80,13°S) | 0,3745 | 0,3719 | 0,0417 |
  | (−65,31485°, −3,05572°) | 0,467 | 0,4495 | 0,1105 |

```sh
curl 'localhost:3100/v1/rank?sites=shackleton-rim,im1&start=2027-01-24&days=14&terrain=1&panel=vertical-rotating'
```


## Pendiente del terreno

Artemis III pide una pendiente **menor de 10° en una base de 100 m** (<https://ntrs.nasa.gov/api/citations/20250009323/downloads/ArtemisOverview2025IntSPAPPSChallenge.pdf>). La puntuación no la
mira, y las laderas puntúan bien porque bajan el horizonte: el ganador del benchmark v3, (−65,31485, −3,05572), está en una
ladera de 13,5° y el segundo, (−72,4792, −5,64746), en una de 27,4°.

`src/terrain/slope.ts` calcula la pendiente como la inclinación del plano ajustado por mínimos cuadrados a las alturas del
DEM LOLA en caché dentro de un círculo cuyo **diámetro es la base** (100 m por defecto), muestreadas por interpolación
bilineal cada medio píxel: la misma definición que el producto LDRM de PGDA (Barker et al. 2023). La rugosidad
(`roughnessM`) es la desviación típica de los residuos del plano. Cuesta unos microsegundos por punto (una máscara de
horizonte, milisegundos) y no necesita `terrain=1`.

- **Fuente, por orden (campo `source`):**
  1. `pgda-ldrm-100m`, `-400m` u `-800m`: el producto oficial `LDRM_80S_50MPP_ADJ_SLP_<base>M` de PGDA (50 m/px, de ~80°S
     al polo), tal cual, si la base pedida es 100, 400 u 800 m y está en la caché (`src/terrain/ldrm.ts`). Se lee píxel a
     píxel del disco (4 bytes por consulta), sin cargarlo en memoria. No tiene rugosidad: `roughnessM` sale del DEM solo
     si el DEM resuelve la base (ventanas de 20 m); si no, `null`.
  2. `dem-20m`: el plano ajustado a una ventana de 20 m, si la hay. Frente a LDRM 100 m, rms 0,68°; frente a LDRM
     400 m, 0,28° (240 puntos).
  3. `dem-160m` (hasta 80°S) o `dem-240m` (hasta 60°S): con menos de 3 píxeles el plano no tiene sentido, así que se usa
     la base mínima posible (~480 m con 160 m/px, ~690 m con 240 m/px), `slopeBaselineM` dice la usada y
     `underestimated` vale `true`. En bases largas sí vale: con 800 m, rms 0,16° frente a LDRM 800 m.
- **Certificación:** una pendiente solo se certifica si se ha medido en la base pedida. Con `underestimated: true` queda
  **sin certificar**: con `maxSlopeDeg`, `meetsMaxSlope` vale `null` (nunca `true`, aunque el número sea pequeño) y
  `meetsMaxSlopeReason` lo explica («sin certificar: la base real es de 477 m (se pidieron 100 m)»; si ya en esa base
  supera el máximo, lo añade). Motivo, medido frente a LDRM 100 m en 372 puntos del casquete: con la base de ~480 m del
  DEM de 160 m, 17 de los 178 puntos con 10° o más (9,6 %) salían por debajo de 10° y pasaban el filtro. Fuera de 80°S
  no hay LDRM ni DEM de 20 m: allí ninguna pendiente de 100 m queda certificada.
- **Filtros:** en el ranking y la búsqueda, `slopeUncertified=exclude` (por defecto) saca los sin certificar del `top`
  (cuentan en `excluded` y en `uncertifiedCount`); `keep` los deja, marcados con `meetsMaxSlope: null`. Los puntos sin
  pendiente (fuera del DEM) siguen fuera siempre. En las evals y en el barrido de fechas (`sweepLandingDates`), la restricción `maxSlopeDeg`
  sobre una pendiente sin certificar es siempre una violación: `slopeDeg=3.66 (<= 10) sin certificar: la base real es de 674 m…`.
- **Validación:** un plano sintético da su pendiente exacta (también inclinado en diagonal y lejos del polo, con la escala
  de la proyección corregida), y en el DEM real los puntos de referencia de la revisión del v3 (diferencias centradas
  sobre ±1 píxel de 240 m) dan 13,5°, 27,4° y 3,7° frente a 13,5°, 27,6° y 3,8° (`test/slope.test.ts`). Frente a los
  productos de PGDA, `npm run validate` (ver «Validación frente a fuentes oficiales»).
- **API:** `slope=1`, `slopeBaselineM` (1–5000 m) y `maxSlopeDeg` (0–90°); cualquiera de los tres la activa.
  - `/v1/search` y `/v1/rank`: `slope` en cada resultado y eco `slope` (`baselineM`, `maxSlopeDeg`, `uncertified`,
    `excluded`, `uncertifiedCount`, `note`). Con `maxSlopeDeg`, los puntos que la superan, sin DEM o sin certificar (salvo
    con `slopeUncertified=keep`) no entran en el `top` ni se refinan a su alrededor; siguen en `cells` con su `slope`. Con
    `sites=`, salen del ranking y se listan en `slope.excludedSites`.
  - `/v1/sun-earth`, `/v1/windows` y `/v1/landing-dates`: objeto `slope` con la pendiente del sitio (`meetsMaxSlope` con
    `maxSlopeDeg`: `null` sin pendiente o sin certificar). En el barrido del motor (`sweepLandingDates`) y en las evals,
    `maxSlopeDeg` es además una restricción: igual en todas las fechas.
  - La pendiente se calcula en las coordenadas del punto, no en las redondeadas a 4 decimales de la respuesta.
  - Sin estos parámetros las respuestas no cambian. Un valor fuera de rango da 400 («maxSlopeDeg debe ser un número entre 0 y 90»).
- **Evals:** restricción `maxSlopeDeg` y opción de escenario `slope: {"baselineM": 100}` (ver `evals/README.md`).

```sh
curl 'localhost:3100/v1/search?latMin=-66&latMax=-64&lonMin=-5&lonMax=-1&spacingKm=3&maxSlopeDeg=10'
curl 'localhost:3100/v1/sun-earth?lat=-65.31485&lon=-3.05572&slope=1'
```

## Fechas de alunizaje

`src/landingSweep.ts` barre las fechas candidatas de un sitio (la misión que empieza en cada fecha) con una sola muestra
de efemérides para todo el rango; cada fecha da exactamente lo mismo que `evaluateCell` de su misión. Se usa con el caso
de uso `landingDates` y la ruta `/v1/landing-dates` (parámetros y ejemplos en `../data/openapi.yaml`).

## Relieve (máscaras de horizonte LOLA)

El horizonte de cada punto se calcula con un ray-march sobre los DEM LOLA de PGDA/GSFC (Barker et al. 2023):
`LDEM_80S_20MPP_ADJ` (20 m/px con overviews, ±304 km alrededor del polo sur) y `LDEM_60S_240MPP_ADJ` (240 m/px, hasta 60°S).
No hay red en ejecución: el backend solo lee una caché local.

```sh
node scripts/fetch-dem.ts                     # una vez: 160 m del casquete 80S + 240 m hasta 60°S (~200 MB de descarga, ~300 MB en disco)
node scripts/fetch-dem.ts --catalog           # ventanas de 20 m (±16 km) de los sitios del catálogo dentro del 80S
node scripts/fetch-dem.ts --near -84.79,29.2  # ventana de 20 m alrededor de un punto
node scripts/fetch-dem.ts --list              # qué hay en la caché
node scripts/fetch-dem.ts --slope             # opcional: pendiente LDRM de PGDA (100/400/800 m) en las ventanas de 20 m y los sitios del 80S (~2 MB cada una)
node scripts/fetch-dem.ts --slope-cap         # opcional: LDRM 100 m de todo el casquete 80S (~620 MB de descarga y 591 MB en disco, ~10–25 min)
node scripts/build-masks.ts                   # precalcula terrain/masks/<id>.json (2 m) y <id>.h10.json (10 m)
node scripts/build-web-relief.ts              # sombreado del polo sur para el mapa de la web (web/assets/south-pole-relief.png)
```

- `terrain/cache/` (fuera de git): rejillas Float32 (`.f32` + `.json`) y la caché en disco de máscaras bajo demanda
  (`terrain/cache/masks/`, ver «Servidor» → «Caché de máscaras»). La descarga es secuencial, por rangos y con reintentos:
  PGDA responde 403 a peticiones en paralelo y no tiene CORS. `geotiff` es devDependency y solo la usa `fetch-dem.ts`.
- **DEM empaquetado** (`.ldp`, #129): `node scripts/pack-dem.ts --out <carpeta>` guarda cada rejilla comprimida sin
  pérdida (`src/terrain/demPack.ts`: predicción por vecinos sobre los bits, zstd; 285 → 172 MB) y
  `node scripts/pack-dem.ts --check` comprueba la caché contra `terrain/dem-sha256.json`. El motor lee un `.ldp` igual
  que un `.f32` (al primer uso, a los mismos bits): las respuestas no cambian. Sirve para un despliegue
  con límite de tamaño, donde los `.f32` no caben.
- `terrain/cache/ldrm/` (fuera de git, opcional): pendiente oficial LDRM de PGDA (`LDRM_80S_50MPP_ADJ_SLP_100M/400M/800M`,
  <https://pgda.gsfc.nasa.gov/products/90>). Son COG de 12160×12160 px de 50 m (teselas de 512 px, deflate, Float32, ~600 MB
  cada uno); sus overviews promedian la pendiente (no es la pendiente en una base mayor), así que solo se lee el nivel 0,
  por rangos: `--slope` y `--slope-near` bajan ventanas y `--slope-cap` el casquete entero, por franjas de teselas y con
  reanudación (`.f32.part` + `.progress.json`). `--baselines 100,400,800` elige las bases. Va en una subcarpeta para que
  `dem.ts` (también el de copias antiguas que compartan la caché) nunca la lea como alturas. Sin ella, todo funciona igual
  con el DEM.
- `terrain/masks/`: máscaras del catálogo. Se cargan al arrancar. Las funciones `snapshot`, `series`, `windows` y `compare` de
  `src/service.ts` las usan si no se les pasa `mask` (`site.horizon.type` pasa a `"mask"`); los casos de uso eligen siempre
  la máscara de forma explícita (sin relieve, la esfera).
  `LUNAR_OBSERVER_HEIGHT_M=10` carga las de 10 m. Los sitios fuera de la cobertura (Apollo, etc.) siguen con esfera.
- `/v1/search` acepta `terrain=1`, `observerHeightM` (0–100, por defecto 2) y `terrainResolution=fast|precise`
  (por defecto `fast` en malla y `precise` con `sites=`). Con relieve la malla admite 2500 puntos. Cada celda lleva
  `horizon: "mask" | "sphere"` (esfera = fuera de la cobertura del DEM) y `heightM`. Sin `terrain` la respuesta no cambia.
- **Panel y antena a distinta altura:** `/v1/*` (con `terrain=1`) acepta `panelHeightM` y `antennaHeightM`
  (0–100 m, por defecto `observerHeightM`), y los escenarios de evals, `terrain.panelHeightM` y `terrain.antennaHeightM`.
  La máscara a la altura del panel se usa para el Sol (`energy`, `sunFraction`, la noche y la batería); la de la antena,
  para la Tierra (`earthFraction`, `longestNoEarthH`); `bothFraction` y `longestBothH` cruzan las dos. En el motor:
  `resolveTerrain` las guarda (las dos) solo si alguna difiere de `observerHeightM`, `cellMasks` (search.ts) y
  `chooseMasks` (horizon.ts) dan una máscara por cuerpo, y `snapshot`, `series` y `windows` aceptan `earthMask`. Con
  las dos alturas iguales se calcula una sola máscara y todo es idéntico bit a bit a antes. Alturas realistas: cubierta
  del módulo a ~2–4 m (Nova-C, 4,3 m de altura total; SLIM, ~2,4 m) y mástiles VSAT de 5 m (umbral) a 10 m (objetivo)
  según los [requisitos de la NASA](https://ntrs.nasa.gov/api/citations/20230012849/downloads/GCD%20Annual%20Review%20VSAT%20September%202023%20Final.pdf).
  El catálogo tiene máscaras a 2 m y 10 m; otra altura se calcula bajo demanda con el DEM (~50 ms por máscara en modo
  preciso y ~7 ms en rápido, medido en el polo sur) y queda en la caché de memoria y de disco.
- API pública v1 (`data/`): no usa el catálogo por su cuenta. Elige la máscara de forma explícita con
  `chooseMasks(site, { terrain, panelHeightM, antennaHeightM })` (sin `terrain`, siempre esfera) y las pasa a
  `snapshot`/`series`/`windows` con las opciones `mask` (Sol) y `earthMask` (Tierra).
  Sin la opción `mask` esas funciones siguen usando `getMask(id)` (registrada o del catálogo), como hacía la API interna `/api/*` (retirada en #61).
- `terrainStatus()` (y `WorkerPool.terrainCounters()` sumado sobre los workers): versión del DEM en caché, máscaras del catálogo y contadores (calculadas, de disco, de memoria, ms por
  máscara; `rays`, `rayHits` y `rayMs` del horizonte híbrido).
- Sin caché ni máscaras todo funciona como antes (horizonte a 0°), con un aviso en la consola y en la `note` de la respuesta.
- `LUNAR_TERRAIN_DIR` cambia la carpeta `terrain/` (`none` la desactiva). Bajo `node --test` se desactiva sola: los tests
  usan DEM sintéticos y no dependen de la caché.
  `LUNAR_MASK_CACHE_DIR` cambia solo la carpeta de la caché de máscaras (`none` la desactiva).

### Validación frente a fuentes oficiales

`npm run validate` (desde `backend/` o la raíz) calcula la **matriz de validación**
([`../VALIDATION.md`](../VALIDATION.md)): cada fila es un endpoint (o una métrica) frente a una referencia oficial
(JPL Horizons; PGDA/LOLA: iluminación, visibilidad de la Tierra, cielo visible, PSR y pendiente LDRM; Gläser et al. 2018;
Leone et al. 2023; NSSDC/LROC; datos de misiones), con n, sesgo, MAE, RMS, máximo, % de puntos dentro de tolerancia y
estado. Lo que no tiene verdad oficial (rank, landing-dates, search) sale con sus comprobaciones de consistencia.

- **Por los casos de uso** (`src/useCases.ts`, los mismos de `/v1` y GraphQL), sin servidor ni HTTP. Solo bajan al
  motor la definición igualada de iluminación (solo el DEM de 240 m) y la pendiente frente a LDRM (`validation/measure.ts`).
- **Falla** (código de salida 1) si alguna fila queda fuera de sus límites (❌). Los problemas conocidos (#85, #86) son ⚠️
  con su valor actual como tope: si empeoran, fallan. `npm run validate -- --write` reescribe `VALIDATION.md`; regenerarlo
  en el commit que cambie el cálculo, y bajar el tope de una fila ⚠️ si el cambio la mejora (`validation/matrix.ts`).
- **Sin DEM** (`terrain/cache`, fuera de git) las filas de relieve salen como «no ejecutado: falta el DEM» y no fallan;
  las de efemérides, catálogo y misiones se calculan igual. Con el DEM tarda unos 2 min con 16 núcleos (hilos que
  comparten una copia del DEM; `LUNAR_VALIDATE_WORKERS` cambia cuántos): casi todo son 18,6 años hora a hora en 101
  puntos y dos alturas. No forma parte de `npm test` (la CI no tiene DEM).
- **Vista para personas: `npm run validate:view`** (desde `backend/` o la raíz; equivale a `npm run validate -- --view`).
  La misma medición, y además una página HTML autocontenida (sin red, se abre desde `file://`) en
  `validation/out/validation-view.html`, fuera de git: dice su ruta y la abre en el navegador (`-- --no-open` solo la
  escribe). Arriba, el resumen ✅/⚠️/❌/ℹ️/⏭️ por endpoint con filtros por estado, endpoint y texto, la versión del DEM, la
  fecha y el commit; cada fila se despliega con la dispersión de nuestro valor frente a la referencia (diagonal 1:1 y
  banda de tolerancia), el histograma de los errores por punto, los peores puntos (coordenadas, nuestro valor,
  referencia, d), un mapa estereográfico polar sur con el error por color para los puntos polares, y la fuente, la
  tolerancia, el tope y el issue de las ⚠️. Cada ejecución (también sin `--view`) guarda los puntos de cada fila en
  `validation/out/validation-points.json`; `npm run validate:view -- --cached` rehace la página con ellos sin volver a
  medir (para iterar sobre la página en segundos). `VALIDATION.md` no cambia: es la vista para la CI y los LLM, y
  `--write` sigue sin los puntos. El código de la página: `validation/view.ts`, `view-page.js` y `view-page.css`.
- **Fixtures** (`validation/fixtures/`, ~50 KB): puntos muestreados de los productos con su nombre, versión y URL, y las
  tablas transcritas (Gläser, Leone, coordenadas y hechos de misiones), nunca los productos completos.
  `npm run validate:fixtures` (`node validation/fetch-fixtures.ts [--cache <dir>] [--horizons]`) descarga los productos
  de iluminación de PGDA (~445 MB, una vez, a `terrain/cache/pgda-illumination/`, fuera de git) y vuelve a muestrear
  `pgda-points.json`; con `--horizons`, las elevaciones de JPL Horizons de los instantes Apollo. `illumination.json`,
  `psr.json` y `slope.json` son submuestras de la comparación del 2026-11 con PGDA (cada una lo dice en su `description`).

**Observador a 0 m frente a Gläser et al. 2018, tabla 1 (#86).** A ras de suelo el resultado depende de la posición con
una precisión de metros, y las coordenadas publicadas están redondeadas (latitud a 1e-4°, unos 3 m; longitud a 0,01°).
Medido el 2026-11-14 con el DEM real: en las coordenadas publicadas, con el modo preciso (unidad `glaser`); en la malla
de ±40 m cada 10 m alrededor de cada punto (81 puntos, desplazamientos en la proyección estereográfica polar), con el
caso de uso `rank` en solo máscara (`refineDeg: 0`, los 81 sitios en una sola llamada):

| Punto | Gläser (% con Sol · sombra) | En las coordenadas publicadas | Rango a ±10 m (9 puntos) | Mejor punto a ≤ 40 m |
|---|---|---|---|---|
| C1 | 81,3 % · 268 h | 51,9 % · 699 h | 41,0–73,2 % | 78,0 % · 337 h, a (20, 30) m |
| C2 | 80,6 % · 166 h | 61,1 % · 702 h | 41,7–72,0 % | 75,3 % · 247 h, a (−40, −10) m |
| S | 85,5 % · 221 h | 79,3 % · 284 h | 43,6–84,6 % | 84,6 % · 220 h, a (0, −10) m |

A 0 m, moverse 10 m cambia el % con Sol hasta 30 pp (decenas de puntos); a 2 m, C1, C2 y S1 coinciden con la tabla 2 en
el punto publicado y a ±10 m cambian menos de 1,5 pp. No es un fallo del ray-march: los puntos de Gläser son los máximos
de su mapa, y comparar a 0 m en la coordenada redondeada no mide el motor. Por eso la matriz tiene dos juegos de filas a
0 m: en la coordenada publicada (⚠️ #86, con su valor actual como tope) y con la definición igualada, el **mejor punto a
≤ 40 m** (unidad `glaserNear` de `validation/measure.ts`: los 81 puntos por el caso de uso `rank`, no por `/v1/rank`,
que admite 10 sitios; 2017–2037, paso de 1 h, solo máscara con `refineDeg: 0`), que baja la diferencia del % con Sol de
20,7 pp RMS a 3,6 pp (con solo máscara, el mejor punto da 78,0 / 75,3 / 84,6 % con Sol y 337 / 248 / 219 h de sombra en
C1, C2 y S). El rango a ±10 m de las filas en la coordenada publicada no se escribe a mano: sale de la medición (`vis10`
de `glaserNear`) en su estado. El motor y el aviso `low_observer_height` no cambian.

**El polo profundo frente a PGDA y Gläser 2018 a 2 m (#85).** `shackleton-rim` (−89,44027°, −137,12649°) da un 91,6 %
del tiempo con Sol a 2 m y en el punto, y `AVGVISIB_85S_060M` de PGDA, un 44,3 %. No miden lo mismo: los productos de
PGDA son con el «observador sobre el suelo» (0 m) y por píxel de 60 m (o de 240 m). Medido el 2026-11-14 con el DEM
real, 18,6 años desde 2010-01-01, paso de 1 h:

| Nuestro valor en `shackleton-rim` | % con Sol |
|---|---|
| A 2 m, en el punto | 91,6 % |
| A 0 m, en el punto | 62,7 % |
| A 0 m, media de la huella de 60 m (6 × 6 puntos cada 10 m dentro del píxel de PGDA que contiene el sitio; medición del 2026-11-15) | 53,1 % |
| PGDA de 60 m | 44,3 % |

Con la definición igualada la diferencia baja de 47 pp a 8,8 pp. La matriz la mide ahora en la fila «… media de la huella
de 60 m …» sobre el píxel de PGDA que contiene el sitio, no sobre un cuadrado centrado en el sitio (unidad `footprint`
de `validation/measure.ts`: el centro del píxel sale con la misma fórmula que `sample()` de `fetch-fixtures.ts`, 6 × 6
puntos a ±25 m cada 10 m dentro del píxel, sin puntos en aristas compartidas, por el caso de uso `rank`, solo máscara
con `refineDeg: 0`; el valor en el punto se evalúa aparte). Una primera medición, del 2026-11-14, sobre un cuadrado de
7 × 7 puntos centrado en el sitio dio 52,4 % (de 35,8 a 84,9 %, 8,07 pp sobre PGDA); la huella dentro del píxel da
8,77 pp y el tope de la fila es de 9,5 pp. El producto de 240 m (74,7 %) sale de un DEM de 240 m que suaviza la cresta; esa
definición ya está igualada en la fila «Definición igualada … solo el DEM de 240 m». Las filas de los 49 puntos al sur
de 85°S siguen ⚠️ #85 en el punto y a 2 m o 0 m: igualar la huella de cada uno costaría minutos por ejecución.

En S2 (−89,7815°, −155,30°) la noche más larga a 2 m es de 99,4 h frente a las 65 h de la tabla 2. La transcripción del
fixture coincide con el artículo (204,70°E: 82,1 % de iluminación media, 89,8 % con Sol, 65 h), y no es sensibilidad a
la posición: en una malla de ±40 m cada 10 m la noche más larga va de 95 a 182 h (nunca 65 h) y el máximo de % con Sol
está en el punto publicado (87,2 % frente a 89,8 %). C1, C2 y S1 sí coinciden en el punto (113 / 165 / 66 h frente a
112 / 165 / 66 h). La fila sigue ⚠️ #85 con tope de 35 h. El motor no cambia.

La web enseña estas cifras en «Cómo sabemos que es correcto» (vista de fuentes de datos). Salen de los fixtures, sin DEM:
`cd data && npm run validation-summary -- --write` las recalcula y las guarda en `web/assets/validation-summary.json`.
Las filas ⚠️ de `VALIDATION.md` salen también ahí, en «Dónde nos alejamos de la referencia»: tras `npm run validate --
--write`, regenera el resumen en el mismo commit (el test de `data/` falla si falta alguna).

## Servidor: workers, caché acotada, compresión y límites

El motor es síncrono: una búsqueda, un barrido o una máscara bloquean el hilo que los calcula. El servidor de la API
(`../data/src/server.ts`, puerto 3100) usa la capa HTTP de aquí (`src/httpServe.ts`) y un **pool de workers**
(`src/pool.ts`, `node:worker_threads`). Hasta #61 también la usaba la API interna `/api/*` de `backend/`, ya retirada:

- **La petición entera va al worker**, no solo las máscaras: el worker ejecuta el mismo código de la ruta
  (`../data/src/app.ts`), así que la respuesta es la misma byte a byte (salvo `timingMs`). Las máscaras y
  los rayos del horizonte híbrido se calculan dentro del motor (refinado de la búsqueda, ventanas), y mandar solo eso al
  worker obligaría a hacer asíncrono el motor. El hilo principal solo lee la URL, encola, comprime y escribe:
  `/v1/health` responde en ~1 ms aunque haya cálculos pesados en curso.
- **Un solo DEM en memoria.** Al arrancar, el pool lee las rejillas una vez, sin bloquear, en `SharedArrayBuffer`
  (`loadSharedGrids` en `src/terrain/dem.ts`) y todos los workers las comparten (~340 MB en total, no por worker).
- **Prioridad.** Se atienden antes las peticiones ligeras (un `sun-earth` sin relieve) que las pesadas
  (búsqueda, barrido, ranking, ventanas, series, todo lo que lleva relieve o pendiente). Las búsquedas asíncronas, al final.
- **Worker reservado para lo ligero (desde la API 1.13.0).** Con 2 workers o más, uno (`LUNAR_LIGHT_WORKERS`) solo
  atiende peticiones ligeras: una petición ligera no espera detrás de las pesadas. Medido con 4 workers y 10 rankings de
  10 puntos nuevos con relieve en curso: p95 de un `sun-earth` sin relieve, 930–950 ms antes y 55 ms ahora. El precio:
  lo pesado tiene un worker menos (esos 10 rankings, 4,4 s en lugar de 3,0 s).
- **Coalescencia.** Dos peticiones deterministas idénticas en curso a la vez se calculan una vez. Dos workers que
  necesitan la misma máscara nueva la calculan una vez (cerrojo en la caché de disco).
- **Caché de resultados (desde la API 1.13.0).** Las respuestas deterministas (todas las fechas explícitas) se guardan en
  una LRU acotada por el tamaño de sus cuerpos (`LUNAR_RESULT_CACHE_MB`, 64 MB; ninguna entrada de más de la cuarta
  parte), con la clave método + ruta + parámetros ordenados, y con ellas sus cuerpos ya comprimidos. Repetirlas o
  revalidarlas (304) no recalcula nada: `/v1/windows` de un año con relieve, 383 ms cada vez antes (también el 304) y
  0,6 ms (0,4 ms el 304) ahora. Se vacía al reiniciar (el DEM y el código no cambian con el servidor en marcha). Apagada
  bajo `node --test`, para que los tests sigan calculando.
- **Cola con tope y tiempo máximo.** Si hay `LUNAR_QUEUE_MAX` peticiones esperando y llega otra, 503 con `Retry-After`
  y un mensaje en español. Si una tarda más de `LUNAR_REQUEST_TIMEOUT_MS` (desde que llega, cola incluida): en cola, 503;
  ya calculando, se termina su worker (es la única forma de parar código síncrono), se arranca otro y responde 504.
  Desde la API 1.13.0 el pool sabe qué cerrojos de máscaras tiene cada worker (el worker se lo dice al tomarlos y
  soltarlos) y, al sustituir uno terminado, borra los que dejó, de forma asíncrona y solo si siguen siendo suyos. Antes,
  la siguiente petición de esa máscara bloqueaba un worker 30 s esperando al cerrojo; ahora el cerrojo desaparece en
  ~3 ms (`test/locks.test.ts`).
- Sin pool (`LUNAR_WORKERS=0`) todo va en el hilo principal como antes. Bajo `node --test` no hay pool salvo que un test lo
  pida (`createApp({ config: { workers: 2 } })`): los tests siguen siendo deterministas.

### HTTP

- **Compresión** `br` (calidad 5) o `gzip` según `Accept-Encoding` en respuestas de más de 1 KiB, en el pool de hilos de
  libuv (no bloquea). `Vary: Accept-Encoding`.
- **`ETag`** débil (SHA-1 del cuerpo sin comprimir, calculado en el worker) en cada 200 y **304** con `If-None-Match`.
- **`Cache-Control`**: `public, max-age=3600` (`LUNAR_CACHE_MAX_AGE_S`) solo si la respuesta es determinista: todas las
  fechas explícitas (`date` en `sun-earth`; `start` en `windows`, `track`, `rank`, `landing-dates` y `search`) o rutas
  sin fecha (`/v1/sites`, `/v1/regions`, `/v1/horizon`). Si depende de «ahora», `no-cache` (se revalida con el `ETag`); errores, `no-store`.
- **Cabeceras de seguridad**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Resource-Policy: cross-origin` y, en JSON, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
  `/docs` (HTML con Swagger UI de jsDelivr) no lleva CSP para que siga cargando. CORS no cambia y expone `ETag`,
  `Retry-After` y `server-timing`.
- **URL**: más de `LUNAR_MAX_URL_LENGTH` caracteres, 414.
- **Límite por cliente** (`src/rateLimit.ts`, API 1.21.0, #161): ver «Límite de peticiones por cliente».
- **Rutas especiales** (`Endpoint.special`): se atienden en el hilo principal con acceso al pool (trabajos de búsqueda y
  `/graphql` de `data/`). Su respuesta solo se cachea en público si lo dice (`cacheable: true`); una tarea
  del pool puede llevar cuerpo (`RouteTask.body`, el de un POST) y `Endpoint.preflight` añade cabeceras CORS al `OPTIONS` de
  una ruta (`/graphql` admite `POST`).

### Límite de peticiones por cliente

La API pública se llama desde el navegador, así que una clave no sirve para autenticar (se vería en el JS de la web).
Lo que se limita es el ritmo de cada cliente, con un **cubo de fichas** por dirección IP y clase de petición, en
memoria (`src/rateLimit.ts`, usado por `src/httpServe.ts` para la v1 y GraphQL):

- **Desactivado por defecto.** Sin `LUNAR_RATE_LIMIT=1` no se mira nada y las respuestas no cambian (ni las cabeceras).
- **Dos cupos por cliente**, con la misma clasificación que la prioridad del pool: **pesadas** (rutas con cálculo en el
  pool salvo `sun-earth` sin relieve ni pendiente; búsquedas y trabajos; consultas GraphQL con coste ≥
  `LUNAR_GRAPHQL_HEAVY_COST`) y **ligeras** (el resto: catálogo, `sun-earth`, rutas desconocidas, el estado de un trabajo,
  GraphQL barato o inválido). Cada cubo guarda hasta `LUNAR_RATE_*_BURST` fichas y recupera `LUNAR_RATE_*_PER_MIN` por
  minuto; cada petición que cuenta gasta una.
- **Solo cuenta lo que se calcula.** Una respuesta de la caché de resultados (y su 304) no gasta; un 304 de una respuesta
  que depende de «ahora» sí, porque hay que calcularla para saber su `ETag` (si no, `If-None-Match: *` daría cálculo
  gratis). `/v1/health`, `/docs`, `/openapi.yaml`, `/openapi.json`, `/graphql/schema.graphql`, el explorador GraphiQL y
  los `OPTIONS` no cuentan nunca.
- **Al pasarse**, 429 con `Retry-After` (segundos hasta la siguiente ficha) y el error de cada formato: en la v1
  `{"error":{"code":"rate_limited","message":"…"}}`; en GraphQL `{"errors":[{"message":"…","extensions":{"code":"rate_limited"}}]}`.
  Las respuestas que cuentan llevan `RateLimit-Limit` (tamaño del cubo), `RateLimit-Remaining`, `RateLimit-Reset`
  (segundos hasta llenarse) y `RateLimit-Policy` (`120;w=120;name="heavy"`), del borrador del IETF. CORS las expone y
  admite `X-Api-Key`.
- **Claves.** `LUNAR_API_KEYS` (separadas por comas) en la cabecera `X-Api-Key` saltan el límite, para scripts del equipo
  o la demo. Solo en las variables del servidor: nunca en el código ni en la web. Se guardan con su SHA-256.
- **Dirección del cliente.** Sin proxy, la de la conexión. Detrás de proxies, `LUNAR_TRUST_PROXY=<n>`: la entrada n-ésima
  de `X-Forwarded-For` empezando por la derecha, la que escribió el proxy de confianza más cercano. Un cliente solo puede
  añadir entradas a la izquierda de esa, así que no puede elegir su clave ni hacerse pasar por otro. Un proxy
  que añade al final la dirección que ve y deja delante lo que mande el cliente, como Cloudflare: `LUNAR_TRUST_PROXY=1`.
  Con otro proxy delante que añade además la suya, `2`. **Sin proxy no la actives**: un
  cliente elegiría su clave con la cabecera. IPv6 se agrupa por /64 (una máquina suele tener la /64 entera). Varios
  usuarios tras la misma NAT comparten cupo.
- **Memoria acotada y por instancia.** Como mucho `LUNAR_RATE_MAX_CLIENTS` clientes; al llegar, se olvida el visto hace
  más tiempo (olvidarlo equivale a que haya esperado: vuelve con los cubos llenos). Con N instancias que no comparten
  memoria, un cliente puede llegar a N veces el límite.
- **Valores por defecto** (con `LUNAR_RATE_LIMIT=1`): 300 ligeras y 60 pesadas por minuto, con cubos del doble (600 y
  120). Al abrir el planificador de `web/` se piden unas 20–25 pesadas (las ventanas de cada sitio, los mejores
  aterrizajes, el cielo, el horizonte y el mapa de luz), y cada cambio de alturas otras tantas; con las fechas explícitas
  muchas salen de la caché. Una persona no llega al límite; un script que encadena búsquedas o rankings, a las 120 pesadas
  seguidas, y después va a una por segundo.

### GraphQL y la caché de efemérides

La API GraphQL de `data/` (`/graphql`, ver [`../data/README.md`](../data/README.md)) usa este motor tal cual. Para que varios
campos y sitios de una consulta no repitan las efemérides, ejecuta la petición dentro de `withVectorCache`
(`src/ephemeris.ts`): mientras dura, `moonFixedVectors` guarda los vectores Sol/Tierra de cada instante (hasta 200 000) y
los reutiliza. Es una función pura del instante, así que el resultado es idéntico bit a bit (`test/vectorCache.test.ts`);
fuera de ese ámbito no cambia nada.

### Tabla de efemérides compartida

Las efemérides (`moonFixedVectors`, ~12 µs por instante en `astronomy-engine`) se repiten en ventanas, barridos de fechas,
rankings y `sun-earth`. `src/ephemerisTable.ts` (#417) las guarda en una **tabla exacta** que comparten todos los hilos del
servidor: un instante se calcula una vez en todo el servidor y después lo leen todos los workers y todas las peticiones.

- **Rejilla fija**: cada 15 min desde 2026-01-01T00:00Z hasta 2031-01-01T00:00Z, ambos incluidos (el rango validado,
  175 297 instantes). Fuera de la rejilla (instantes que no caen en un cuarto de hora exacto) o del rango, se calcula como
  siempre.
- **Exacta**: guarda los `Float64` calculados, así que una lectura da los mismos bits que calcular de nuevo
  (`test/ephemerisTable.test.ts`). No interpola.
- **Bajo demanda**: no se precalcula nada ni cuesta nada al arrancar; cada entrada la rellena el primer hilo que la
  necesita.
- **Memoria**: dos `SharedArrayBuffer`, uno con seis `Float64` por instante (Sol y Tierra, ~8,4 MB) y otro con un byte por
  instante que marca si está rellena (~0,2 MB). Una sola copia para todo el servidor.
- **Quién la crea**: con pool, el pool, que la pasa a cada worker junto al DEM compartido (también a los que sustituyen a
  uno terminado); sin pool (`LUNAR_WORKERS=0`), el servidor de `data/` adopta una propia en el hilo principal. Dentro de
  `withVectorCache` (GraphQL) se mira antes su memo y después la tabla.
- `LUNAR_EPHEMERIS_TABLE=0` la apaga. Bajo `node --test` está apagada salvo que un test la pida. El banco del motor la
  adopta con `npm run bench -- --ephemeris-table` (ver «Rendimiento»).

### Variables de entorno

| Variable | Qué hace | Por defecto |
|---|---|---|
| `LUNAR_WORKERS` | Workers del pool; `0`, sin pool (todo en el hilo principal) | núcleos − 1 (mínimo 1); 0 bajo `node --test` |
| `LUNAR_LIGHT_WORKERS` | Workers reservados para las peticiones ligeras (siempre queda al menos uno para lo pesado) | 1 con 2 workers o más; 0 con uno |
| `LUNAR_RESULT_CACHE_MB` | Caché de respuestas deterministas (MB de cuerpos sin comprimir; `0` la apaga) | 64; 0 bajo `node --test` |
| `LUNAR_EPHEMERIS_TABLE` | Tabla exacta de efemérides compartida por los workers (ver «Tabla de efemérides compartida»; `0` la apaga) | encendida; apagada bajo `node --test` |
| `LUNAR_QUEUE_MAX` | Peticiones que pueden esperar a un worker; una más, 503 | 32 |
| `LUNAR_REQUEST_TIMEOUT_MS` | Tiempo máximo de una petición en el pool, cola incluida (504, o 503 si no ha empezado) | 120000 |
| `LUNAR_RETRY_AFTER_S` | Valor de `Retry-After` en los 503 | 5 |
| `LUNAR_MAX_URL_LENGTH` | Longitud máxima de la URL (414) | 8192 |
| `LUNAR_CACHE_MAX_AGE_S` | `max-age` de las respuestas deterministas (0: siempre `no-cache`) | 3600 |
| `LUNAR_JOB_TIMEOUT_MS` | Tiempo máximo de una búsqueda asíncrona | 600000 |
| `LUNAR_JOBS_MAX`, `LUNAR_JOB_TTL_S` | Trabajos guardados en memoria y cuánto se guarda uno terminado | 100, 3600 |
| `LUNAR_JOBS_STATELESS` | `1`: trabajos sin estado, para varias instancias sin memoria compartida (ver «Búsqueda asíncrona») | sin definir (con estado) |
| `LUNAR_RATE_LIMIT` | `1`: límite de peticiones por cliente (ver «Límite de peticiones por cliente») | sin definir (apagado) |
| `LUNAR_RATE_LIGHT_PER_MIN`, `LUNAR_RATE_HEAVY_PER_MIN` | Peticiones ligeras y pesadas por minuto y cliente (`0`: esa clase sin límite) | 300, 60 |
| `LUNAR_RATE_LIGHT_BURST`, `LUNAR_RATE_HEAVY_BURST` | Peticiones seguidas que admite cada cubo | el doble del ritmo por minuto |
| `LUNAR_TRUST_PROXY` | Proxies de confianza que se añaden a `X-Forwarded-For` (la IP del cliente es la entrada n-ésima por la derecha; `0`: la de la conexión) | 0; `1` detrás de Cloudflare |
| `LUNAR_API_KEYS` | Claves (separadas por comas) que saltan el límite en `X-Api-Key` | ninguna |
| `LUNAR_RATE_MAX_CLIENTS` | Clientes recordados en memoria | 10000 |
| `LUNAR_TERRAIN_DIR` | Carpeta de relieve (`cache/` con el DEM, `masks/`); `none` la apaga | `backend/terrain` |
| `LUNAR_MASK_CACHE_DIR` | Carpeta de la caché de máscaras (`none`: sin disco) | `terrain/cache/masks` |
| `LUNAR_MASK_CACHE_MAX_MB` | Presupuesto en disco de la caché de máscaras (bloques ocupados) | 1024 |
| `LUNAR_MASK_DISK_HEIGHT_STEP_M` | Solo las alturas múltiplo de este paso van al disco (0: todas) | 0.5 |
| `LUNAR_MASK_CACHE_LEGACY` | `0` ignora la caché del formato antiguo | 1 |
| `LUNAR_MASK_MEMORY_MAX` | Máscaras en la LRU de memoria de cada hilo | 10000 |

El servidor de `data/` lee estas variables. `WorkerPool.terrainCounters()` suma los contadores de máscaras de todos los
workers, `WorkerPool.status()` da el estado del pool (workers, reservados para lo ligero, ocupados, en cola, rechazadas por
cola llena, timeouts, reinicios y cerrojos huérfanos borrados) y `ResultStore.status()` el de la caché de resultados
(entradas, bytes, aciertos, fallos, peticiones coalescidas y expulsadas), y `RateLimiter.status()` el del límite por cliente
(clientes recordados, admitidas, rechazadas, con clave y olvidados). Hasta #61 los publicaba `/api/terrain`.

### Caché de máscaras

- **Un fichero por máscara**: `masks/v2/<demVersion>/<modo>_h<altura>/<xx>/<latE5>_<lonE5>.bin` (el mismo registro binario
  de siempre: cabecera, `Int16` en centésimas de grado y cobertura). Una consulta lee ~1–1,5 KB, no el fichero entero (el
  formato antiguo se leía completo en memoria: 600 MB en una malla polar rápida). Se escribe en un temporal y se renombra
  (atómico: nadie ve media máscara aunque escriban varios workers o servidores a la vez). Un `.lock` al lado hace que
  quien llega segundo espere al fichero en vez de calcularla otra vez (30 s como mucho; un cerrojo de más de 60 s es de
  un hilo muerto y se borra). Desde la API 1.13.0 el cerrojo guarda su dueño (`<pid>:<hilo>`): el de un proceso que ya no
  existe se borra al momento, y el de un worker terminado por un 504 lo borra el pool al sustituirlo.
- **LRU con presupuesto en disco**: cada lectura toca el `mtime` del fichero; cuando un hilo ha escrito el 5 % del
  presupuesto, recorre la caché y borra los menos usados hasta el 90 % (como mucho un barrido cada 10 s entre todos).
  En memoria, una LRU de `LUNAR_MASK_MEMORY_MAX` máscaras por hilo.
- **Alturas y coordenadas.** Las coordenadas ya se redondean a 1e-5° y el cálculo se hace en el punto redondeado. La
  altura **no se cuantiza en el cálculo**: cuantizar a 0,5 m no cambiaría 2, 3, 5 ni 10 m, pero 2,3 m pasaría a calcularse
  a 2,5 m y cambiaría esa respuesta. Lo que se limita es qué alturas se guardan en disco: solo las múltiplo de 0,5 m
  (como mucho 201 carpetas de 0 a 100 m); las demás viven solo en memoria.
- Calculada o leída del disco, la máscara es el mismo objeto (mismos campos, orden y `source`): la respuesta no depende
  de qué worker la calculó ni de qué hay en la caché. Antes, una máscara leída del disco perdía los productos del DEM en
  su `source` (`LOLA (preciso, …)` en lugar de `LOLA LDEM_…@20m + … (preciso, …)`).
- **Formato antiguo** (`masks/<demVersion>_<modo>_h<altura>.bin`, anexado, hasta 1.9.0): se reaprovecha en solo lectura.
  La primera vez que un hilo lo necesita construye un índice ordenado compacto (16 bytes por máscara; ~0,5 s y 13 MB para
  el fichero de 600 MB) y luego lee cada máscara por separado. Nunca se escribe ni se borra, ni cuenta en el presupuesto:
  si sobra, se puede borrar a mano (con el servidor parado) o ignorar con `LUNAR_MASK_CACHE_LEGACY=0`.

### Búsqueda asíncrona (`POST /v1/search/jobs`)

`src/jobs.ts`: la búsqueda en malla con relieve tarda de segundos a decenas de segundos, así que también se puede pedir
como trabajo: los mismos parámetros de `/v1/search` en la URL de un `POST /v1/search/jobs` (`../data/`), que responde 202
con `Location`; `GET /v1/search/jobs/<id>` da el estado (`queued`, `running` con `progress`, `done` con `result` o
`error`). Se ejecuta en el pool, detrás de las peticiones síncronas; sin pool, en el hilo principal justo después de
responder. Los trabajos viven en la memoria del proceso: se pierden al reiniciar. Con la cola llena o `LUNAR_JOBS_MAX`
trabajos sin terminar, 503.

**Sin estado** (`LUNAR_JOBS_STATELESS=1`, API 1.20.0, #129): para un despliegue con varias instancias que no comparten
memoria, donde el `GET` puede llegar a otra instancia que la del `POST`. El `POST` solo valida y fija `start`;
no guarda nada. Su `statusUrl` (y `Location`) lleva los parámetros de la búsqueda, y el `GET` con ellos la calcula en esa
petición y responde el trabajo terminado. Como `start` está fijado, el resultado es el mismo en cualquier instancia y la
caché de resultados contesta los sondeos repetidos sin recalcular. Un cliente que use siempre `statusUrl` tal cual
funciona con los dos modos.

**Formato de máscara:** `{ lat, lon, heightM, observerHeightM, stepDeg, el: [...], source, demVersion, resolution, coverage }`,
con `el` en grados redondeados a 0,01° (azimut 0 = norte, sentido horario) y `coverage` = fracción de muestras con dato.
`demVersion` identifica qué productos y ventanas había en la caché.

**Método** (`src/terrain/horizonMask.ts`): mallas anidadas, interpolación bilineal, curvatura exacta, paso de 0,5 px que
crece con la distancia. `computeHorizon` traza un rayo por azimut de la rejilla con `horizonRay`, que también sirve para
trazar uno en cualquier azimut exacto.

| Modo | DEM | Radio | Azimuts | Tiempo medido por máscara |
|---|---|---|---|---|
| `precise` | 20 m ≤ 10 km (si hay ventana) + 160/240 m | 300 km | 720 | 45–60 ms con 20 m; 10–30 ms sin 20 m |
| `fast` | solo 160/240 m | 150 km | 360 | 4–10 ms |

`fast` frente a `precise`: rms ≤ 0,01° donde no hay ventana de 20 m; 0,04–0,13° en terreno alto con 20 m (IM-1, IM-2);
0,66° (máx. 1,7°) en una cresta afilada como el borde de Shackleton. La segunda petición de un mismo punto sale de la caché.

**Horizonte híbrido** (`refinedMask` en `src/horizon.ts`, `horizonAt` en `src/visibility.ts`). La máscara de 720 azimuts
(360 en `fast`), redondeada a 0,01°, se usa siempre y se interpola linealmente. Cuando el margen de un astro al horizonte
es menor que X (por defecto 0,1° en `precise`), la elevación del horizonte se recalcula con un **rayo directo** en el
azimut exacto del astro, con las mismas capas, curvatura, paso y crecimiento que la máscara, y con ella se deciden la
visibilidad y la fracción visible del disco. Detalles:

- **Dónde.** `margin` y `visibleFraction` (y `horizonAt`, que comparten `evaluateCell`, el barrido de fechas, la noche,
  `snapshot`, `series`, `windows` y `compare`) usan el rayo cuando la elevación interpolada está a menos de X del borde
  que decide: el limbo que marca `mode` (con `earthMinEl` en la Tierra) y, para la fracción, el limbo superior o el borde
  de `nightMinSunFraction`. Lejos del horizonte no se traza nada.
- **Solo con el DEM detrás.** Lo aplica `refinedMask` a las máscaras de `maskFor` y a las del catálogo cuando la versión
  del DEM en caché es la suya. Las registradas a mano, las del catálogo sin DEM y las de cualquier máscara sin DEM dan el
  mismo objeto y resultados idénticos.
- **Caché.** Rayos por máscara (sitio, altura, modo) y azimut redondeado a 1e-4° (≈ 2 mm a 1 km): el rayo se traza en el
  azimut redondeado, así que el resultado no depende del orden de las consultas.
- **Opciones.** `terrain.refine: false` o `terrain.refineDeg` (0–2°; 0 lo apaga) en los escenarios de evals;
  `horizonRefine=0|1` y `horizonRefineDeg` en `/v1/*`. En `fast` está apagado por
  defecto (`refine: true` lo enciende con 0,1°): allí manda el error de la marcha (160/240 m, paso que crece un 1 %·d), que
  un rayo con la misma marcha no corrige. `resolveTerrain` guarda `refineDeg` solo si difiere del valor por defecto de su
  modo: los escenarios existentes conservan su `scenarioHash` y el `codeHash` distingue las ejecuciones de antes y después.
- **Precisión medida** (2027, paso de 1 h, 8760 instantes, observador a 2 m, Sol en `limb` y Tierra en `center` con 2°;
  «verdad» = rayo fino en el azimut exacto con paso de 0,25 px y crecimiento del 0,1 %·d): en modo preciso todos los
  cambios de decisión entre la máscara interpolada y el rayo ocurrían con el margen por debajo de 0,04°; con X = 0,1°
  desaparecen todos. Lo que queda frente a la verdad es el error de la marcha, igual en máscara y rayo.

| Sitio | Noche más larga (h): máscara / híbrido / verdad | Energía | Horas con Tierra: máscara / híbrido / verdad | Decisiones del Sol distintas de la verdad: máscara / híbrido | Rayos | Tiempo añadido |
|---|---|---|---|---|---|---|
| `shackleton-rim` | 111 / 111 / 111 | 0,8725 / 0,8725 / 0,8718 | 3730 / 3731 / 3731 | 2 / 1 | 339 | 63 ms |
| IM-1 (−80,13, 1,44) | 453 / 453 / 453 | 0,3775 / 0,3775 / 0,3774 | 8760 / 8760 / 8760 | 3 / 1 | 42 | 8 ms |
| Isla (−89,76432, −156,86311) | 128 / **124** / 124 | 0,8115 / 0,8115 / 0,8113 | 3030 / 3030 / 3030 | 7 / 3 | 371 | 67 ms |
| (−65,23576, −9,16979) | 373 / 373 / 373 | 0,4740 / 0,4740 / 0,4740 | 8760 / 8760 / 8760 | 0 / 0 | 24 | 2 ms |

  La energía cambia menos de 1e-4. Cada rayo cuesta ~0,06 ms en modo preciso (~0,015 ms en rápido); un año en el peor sitio,
  ~370 rayos (~23 ms, frente a ~50 ms de calcular la máscara); al repetir, salen de la caché.
- **Modo rápido cerca del polo: solo para cribar.** Frente a la misma verdad fina, en `shackleton-rim` el modo `fast`
  cambia la visibilidad del Sol en 406 horas de 2027 y la noche más larga pasa de 111 h a 274 h (en la isla
  (−89,47298, −137,34113), de 115 h a 137 h). Por eso `/v1/search`, `/v1/rank`, `/v1/landing-dates` y los informes de evals añaden
  un aviso cuando se usa `fast` al sur de −85° o donde hay ventana de 20 m: hay que confirmar los finalistas en `precise`.

**Precisión** (método preciso, antes de integrarlo): frente a los mapas de iluminación media de Mazarico et al. (2011,
`AVGVISIB_85S_060M_201608` y `_EARTH`, <http://imbrium.mit.edu/EXTRAS/ILLUMINATION/>), con 18,6 años de nuestras efemérides:
% de tiempo con Sol, sesgo +1,6…+2,2 pp y RMSE 2,9–6,4 pp; con Tierra, sesgo +1,0…+1,9 pp y RMSE 3,1–7,6 pp
(sin relieve: RMSE 25–37 pp). Error de la máscara frente a una referencia fina: rms 0,014°.

**Limitaciones del relieve:**
- Fuera de 80°S solo hay 240 m: en terreno suave el error es pequeño (Δ puntuación < 1 en IM-1/IM-2/v1), pero en crestas
  afiladas una rejilla de 240 m puede fallar varios grados.
- En crestas la altura del observador manda: en el borde de Shackleton pasar de 2 m a 10 m cambia el horizonte ~1,2° de media.
- La caché de 20 m solo cubre las ventanas descargadas; el resto del 80S usa 160 m.
- `visibleFraction` trata el horizonte como una recta. La máscara se interpola linealmente entre azimuts, salvo cerca del
  horizonte, donde el horizonte híbrido usa el rayo directo.
- No se modelan la sombra del propio módulo, la inclinación de los paneles (más allá de las tres orientaciones de `panel`) ni
  el multitrayecto de radio.

## Rendimiento

`scripts/bench-engine.ts` mide el motor llamándolo directamente (sin servidor ni pool), con la caché de máscaras en disco
apagada y con inicio el 2027-01-10T00:00Z. Cada fila imprime la media de sus repeticiones en milisegundos; los tiempos solo
se imprimen, ningún test los comprueba.

```sh
npm run bench                          # todas las filas
npm run bench -- --json banco.json     # además, { node, demVersion, rows: [{ name, ms }] } en banco.json
npm run bench -- --ephemeris-table     # con la tabla de efemérides adoptada (filas sin relieve, en su segunda ejecución)
npm run bench -- --identity 200        # identidad bit a bit del ray-march con el DEM real (sale con 1 si algo difiere)
LUNAR_TERRAIN_DIR=/ruta/terrain npm run bench   # otra carpeta de relieve ('none' = sin DEM)
```

Sin DEM en la caché (`node scripts/fetch-dem.ts`) las filas de relieve salen como «no ejecutado: falta el DEM», `--identity`
dice que falta, y el script termina con código 0.

**Referencia bit a bit del ray-march.** `test/reference/horizonMarchReference.ts` es una copia congelada de `horizonRay`,
`computeHorizon` y `bilinear` tal como estaban antes de optimizarlos (épica #413); no se optimiza ni se edita.
`test/marchIdentity.test.ts` compara con ella el ray-march de `src/` sobre relieve sintético con crestas (capa fina y gruesa,
muestras fuera de la rejilla y huecos `NaN`; alturas de 0, 2, 2,3 y 100 m; modos preciso y rápido): `Object.is` en cada
elevación de la máscara, las mismas muestras y fallos, y 200 rayos directos por caso a acimuts arbitrarios. `--identity <N>`
hace lo mismo con el DEM real en `N` puntos con semilla fija (dos tercios al azar al sur de 60°S, uno dentro de las
ventanas de 20 m; alturas de 0 a 100 m) y 40 rayos directos por punto y modo.

Tiempos de partida de la épica (#413), medidos el 2026-11-14 con Node 26.13, 16 núcleos y el DEM real:

| Fila | Tiempo |
|---|---|
| Efemérides, un año a 1 h (8760 instantes) | 104 ms |
| Máscara precisa, `shackleton-rim` / (−80,13, 1,44) | 170 / 129 ms |
| Máscara rápida, `shackleton-rim` / (−80,13, 1,44) | 16 / 18 ms |
| Ventanas de un año a 15 min, relieve preciso, primera llamada / repetida | 761 / 393 ms |
| Ventanas de 30 d a 15 min, sin relieve | 34 ms |
| `sun-earth` de un instante, sin relieve | 47 ms |
| Búsqueda polo sur, 15 km, 30 d, 1 h, sin relieve | 100 ms |
| La misma búsqueda con relieve rápido, en frío / con las máscaras en memoria | 10,8 s / 122 ms |
| Ranking de 10 sitios, 30 d, 1 h, relieve preciso | 443 ms |
| Barrido de fechas de un año cada 6 h, misión de 14 d, sin relieve / con relieve preciso | 111 / 325 ms |

Con el ray-march más rápido (B1.2, #415: los datos de cada capa leídos una vez por sitio y una tabla de coseno y seno por
paso, con los mismos bits), medido el mismo día y en la misma máquina, antes → después:

| Fila | Antes | Después |
|---|---|---|
| Máscara precisa, `shackleton-rim` / (−80,13, 1,44) | 153 / 141 ms | 49 / 57 ms |
| Máscara rápida, `shackleton-rim` / (−80,13, 1,44) | 18 / 18 ms | 6,8 / 8,0 ms |
| Un rayo directo, preciso / rápido | 0,18 / 0,042 ms | 0,06 / 0,013–0,016 ms |
| Ventanas de un año a 15 min, relieve preciso, primera llamada | 823 ms | 557 ms |
| Búsqueda polo sur con relieve rápido, en frío | 13,1 s | 4,6 s |
| Ranking de 10 sitios, 30 d, 1 h, relieve preciso | 466 ms | 166 ms |
| Barrido de fechas de un año, relieve preciso | 359 ms | 188 ms |

Las filas sin relieve o con las máscaras ya en memoria no cambian. `npm run bench -- --identity 1000`: 0 puntos diferentes;
`node scripts/build-masks.ts` regenera las máscaras del catálogo sin cambiar ningún fichero.

## Estructura

```
src/ephemeris.ts   vectores Luna→Sol y Luna→Tierra en el marco lunar; az/el topocéntricos
src/horizon.ts     máscaras de horizonte: registradas, del catálogo (terrain/masks) y bajo demanda (maskFor)
src/terrain/dem.ts          rejillas DEM en caché, proyección estereográfica polar, elección por cobertura
src/terrain/horizonMask.ts ray-march del horizonte (máscara y rayo directo en un azimut exacto) y formato de máscara
src/visibility.ts  criterios de visibilidad, búsqueda de eventos y operaciones con ventanas
src/dsn.ts         elevación de la Luna desde las estaciones de la DSN y horas con alguna por encima de 10°
src/night.ts       umbral de Sol para la noche, noche real (extendida fuera del periodo) y batería
src/panel.ts       orientación del panel solar: factor de la energía (tracking, vertical-rotating, horizontal)
src/constraints.ts restricciones duras sobre las métricas (escenarios de evals y barrido de fechas)
src/landingSweep.ts barrido de fechas de alunizaje de un sitio: serie, mejores y peores, ventanas buenas y estadísticas
src/service.ts     snapshot, series, windows y compare (JSON puro)
src/useCases.ts    casos de uso (una función por operación): valores por defecto, relieve, puntuación, restricciones y avisos
src/params.ts      parseo y validación de parámetros (los usa la v1)
src/jobs.ts        trabajos asíncronos de búsqueda (POST /v1/search/jobs)
src/httpServe.ts   capa HTTP del servidor de data/: pool o en línea, ETag/304, Cache-Control, compresión, seguridad y límites
src/pool.ts        pool de worker threads: cola con tope y prioridades, timeout, DEM compartido
src/poolWorker.ts  worker del pool: importa las rutas de su servidor y ejecuta peticiones
src/terrain/ldrm.ts        pendiente oficial de PGDA (LDRM) en terrain/cache/ldrm/, leída píxel a píxel
src/terrain/maskCache.ts   caché en disco de máscaras: un fichero por máscara, escritura atómica, cerrojos, LRU y formato antiguo
scripts/fetch-horizons-fixture.ts   descarga la referencia de JPL Horizons
scripts/fetch-dsn-fixture.ts        descarga de JPL Horizons la Luna vista desde las antenas de la DSN (test/dsn.test.ts)
scripts/fetch-dem.ts               descarga única de los DEM LOLA (y, opcional, la pendiente LDRM) a terrain/cache/
scripts/build-masks.ts             precalcula las máscaras del catálogo en terrain/masks/
scripts/build-web-relief.ts        dibuja el relieve del polo sur que usa el mapa de la web
scripts/bench-engine.ts            banco de rendimiento del motor e identidad del ray-march con el DEM real (ver «Rendimiento»)
test/              unitarios, precisión frente a Horizons y casos de uso (la banda del horizonte, en horizonBand.test.ts)
test/reference/    referencia congelada del ray-march (no se edita) y su comparación con src/
validation/        matriz de validación frente a fuentes oficiales (npm run validate → ../VALIDATION.md), con sus fixtures
                   y su vista HTML (npm run validate:view → validation/out/, fuera de git)
```
