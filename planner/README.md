# Evaluador de viabilidad

Dice si un aterrizaje es viable: dado un sitio, una fecha de aterrizaje y los requisitos de la misión, devuelve
**viable**, **marginal** o **no viable**, y **por qué**. Trabaja sobre la API de datos v1
([`../data/openapi.yaml`](../data/openapi.yaml), 1.12.0), con el relieve LOLA cerca del polo sur.

```sh
npm test                                                     # no necesita una API arrancada (ver «Tests»)
npm run evaluate -- --site apollo11 --date 2027-01-13T12:00  # necesita la API: npm start en ../data
```

Sin dependencias propias. Node 26.13, como el resto del repo (el test de integración importa TypeScript de
`../data` y `../backend`).

## Qué significa «viable»

Un aterrizaje en la fecha T0 es **viable** si cumple **todas** las reglas activas durante la misión
`[T0, T0 + duración]`. Es **marginal** si las cumple todas pero alguna con menos de un 10 % de margen, y
**no viable** si falla una. El resultado dice siempre qué regla aprieta más.

Son condiciones necesarias, no una nota ponderada. Una media esconde lo que importa: un sitio con mucho sol y
una sombra más larga que la batería no es «un 75 % viable», la misión muere. Por eso no se usa la puntuación de
`/v1/rank` como veredicto.

| Regla | Se cumple si… | Por qué |
|---|---|---|
| R1 · Sol al aterrizar | el Sol se ve en T0 | Energía y navegación óptica en el descenso |
| R2 · Tierra al aterrizar | la Tierra se ve en T0 | Telemetría en directo del aterrizaje |
| R3 · Luz para arrancar | sol seguido tras T0 ≥ umbral (h) | Desplegarse y cargar baterías antes de la primera sombra |
| R4 · Sobrevivir a la sombra | sombra seguida más larga ≤ umbral (h) | La batería aguanta un tiempo limitado sin sol |
| R5 · Energía total | parte de la misión con sol ≥ umbral | Balance energético |
| R6 · Sin quedarse incomunicado | hueco más largo sin Tierra ≤ umbral (h) | Cuánto se aguanta sin contacto directo |
| R7 · Tiempo operativo | parte de la misión con sol y Tierra ≥ umbral | Se opera con energía y enlace a la vez |
| R8 · Tierra suficiente | parte de la misión con la Tierra a la vista ≥ umbral | Comunicación directa suficiente; es el «% de Tierra» que pide la interfaz (`web/`) |
| R9 · Pendiente segura | pendiente en 100 m ≤ umbral (°), **certificada** por la API | Volcar o no al posarse. El alunizaje tripulado de Artemis pide menos de 10° en 100 m |

Cada regla se puede desactivar (una misión con satélite repetidor no necesita R2, R6, R7 ni R8) y sus umbrales
vienen del **perfil de misión** (`src/profiles.js`). Los tres perfiles incluidos llevan umbrales supuestos, sin
validar con fuentes de CLPS. Una regla que el perfil no nombra queda apagada y se informa sin umbral: por eso los
perfiles incluidos no llevan R8 ni R9. R9 se enciende desde la terminal con `--max-slope <grados>`.

Además:

- **Sin datos** no es «no viable»: si el periodo consultado no cubre toda la misión, el veredicto es `no-data`.
- **Sin certificar** tampoco es «cumple»: una regla activa que no se puede comprobar (hoy solo R9, ver «Pendiente»)
  sale con `passes: null`, el veredicto no pasa de **marginal** y es provisional.
- **Provisional** (`provisional: true`): calculado con Luna lisa o con alguna regla sin certificar. El resultado
  dice siempre con qué horizonte se calculó (`horizon`: `{ model: 'mask', panelHeightM, antennaHeightM }` o
  `{ model: 'sphere' }`).
- **Tolerancia de fecha** (`toleranceDays`): se evalúan también las fechas dentro de ±N días y manda la peor.
  «Viable» pasa a significar «viable aunque la fecha se mueva».
- **Mejores aterrizajes**: `bestLandings` (`src/ranking.js`) prueba un aterrizaje cada 12 h en una ventana de fechas,
  juzga cada uno con las reglas (R1, R2, R4 y R8, el perfil de la interfaz: `missionProfile`), lo puntúa según una
  prioridad (energía, comunicación, aterrizar antes o aguantar retrasos) y devuelve el mejor de cada sitio con su
  veredicto, motivos, margen ante retrasos y siguiente ventana, y los sitios ordenados. Lo usan la API pública
  (`/v1/best-landings`, en `../data/`) y la interfaz (`web/`), así que el servidor y el navegador ordenan igual.
  `ranking.d.ts` da sus tipos a quien lo importa desde TypeScript.
- **Replanificar**: `nextViable` da la primera fecha que cumple a partir de un retraso. `replanOptions`
  (`src/replan.js`) compara, tras un retraso o un cambio de nave, el plan con tres salidas: **A** (mismo sitio,
  otra fecha), **B** (otro sitio de la región, misma fecha) y **C** (otro sitio y otra fecha, la de menor retraso
  total). Cada una lleva su veredicto, su margen ante otro retraso, su distancia al sitio original y el retraso
  total respecto al plan original. Si nada es viable, da la menos mala y una sugerencia. Es el dominio de la
  vista Replanificar de `web/` (ver `../docs/adr/0001-arquitectura-hexagonal.md`).
- **Ventanas de aterrizaje**: `evaluateRange` evalúa una fecha candidata cada 6 h y `landingWindows` las agrupa.

## De dónde sale cada dato

Todo sale de **una llamada a `/v1/windows`** por sitio (dos si el perfil pide un `mode` distinto para el Sol y
para la Tierra), y a partir de ahí se evalúan todas las fechas en local:

| Dato | De `/v1/windows` |
|---|---|
| R1, R2 | T0 cae dentro de una ventana de `sun` / `earth` |
| R3 | fin de esa ventana de `sun` menos T0 |
| R4, R6 | hueco más largo entre ventanas de `sun` / `earth`, recortado a la misión |
| R5 | horas de `sun` dentro de la misión, sobre su duración |
| R7 | horas con los dos a la vez; se calculan cruzando `sun` y `earth`, no con `sunAndEarth` |
| R8 | horas de `earth` dentro de la misión, sobre su duración |
| R9 | `slope` de la misma llamada, con `slope=1&maxSlopeDeg=<umbral>`: `meetsMaxSlope`, `underestimated` |

El cruce propio permite combinar dos `mode`; con el mismo `mode` coincide con el `sunAndEarth` de la API (hay
un test que lo comprueba contra respuestas reales). Los avisos de la API (`warnings`, desde 1.9.0) pasan al
resultado con el código `api:<código>` y la terminal los muestra; `smooth_moon_polar` y `terrain_not_applied`
(desde la API 1.13.0) no se repiten, porque ya lo dice el aviso `no-terrain` del evaluador. Al sur de 85°S, con
relieve, llega así `api:deep_polar_uncertainty` (API 1.23.0): las cifras son menos fiables, pero el veredicto no cambia.

## Relieve

Desde la 1.1.0 la API calcula con relieve si se le pide (`terrain=1`): horizonte de los DEM LOLA (máscara del
catálogo o calculada con el DEM, y desde 1.8.0 un rayo directo cuando el Sol o la Tierra rozan el horizonte). El
DEM solo cubre el **polo sur, hasta unos 60°S**. Sin `terrain=1` la API sigue con la Luna lisa, como en la 1.0.0.

**En la terminal el relieve va activado por defecto en los sitios al sur de 60°S** y apagado en el resto:

- Cerca del polo el relieve manda: en la cresta de Shackleton el 15 de enero de 2027 cambia el veredicto de «no
  viable» (Luna lisa: 9 días de sombra) a «marginal» (con relieve, la cresta ve el Sol toda la misión). Sin él,
  los veredictos polares son optimistas o, en un cráter, falsos.
- Pedirlo no cuesta casi nada ni puede fallar: con máscara del catálogo es inmediato, en coordenadas libres la API
  la calcula con el DEM (~140 ms la primera vez) y, si no tiene DEM, responde con la esfera y lo explica.
- Al norte de 60°S no hay DEM: pedirlo solo añadiría un aviso de que no se aplicó.

Con `--site`, la latitud sale de `/v1/sites` (una llamada ligera más). Desde código, `loadWindows` no decide: pide
relieve solo con `terrain: true`.

Opciones: `--terrain` lo pide en cualquier sitio, `--no-terrain` lo quita, y `--panel-height <m>` y
`--antenna-height <m>` dan las alturas del panel (decide el Sol: R1, R3, R4 y R5) y de la antena (la Tierra: R2,
R6 y R8); R7 cruza las dos. Por defecto, 2 m las dos; el catálogo trae máscaras a 2 y 10 m, y otras alturas se
calculan con el DEM. Las alturas implican `--terrain`. Un caso típico: panel a 2 m y antena en un mástil de 10 m.

La salida dice siempre con qué se calculó: «Calculado con relieve LOLA (panel a 2 m, antena a 10 m)» o «Calculado
con Luna lisa, sin relieve: veredicto provisional». Si se pidió relieve y la API no lo aplicó (sin DEM o fuera de
cobertura), el aviso `no-terrain` lo dice con la nota de la API.

## Pendiente (R9)

Con `--max-slope <grados>` el planner pide a la API la pendiente del lugar (`slope=1&maxSlopeDeg=…`, desde 1.7.0;
plano ajustado al DEM en una base de 100 m) y R9 usa `meetsMaxSlope`:

| La API da | R9 |
|---|---|
| `meetsMaxSlope: true` y `underestimated: false` | Cumple, con su margen |
| `meetsMaxSlope: false` | Falla |
| `meetsMaxSlope: null` y `underestimated: true` (DEM grueso; desde la API 1.12.0) | **Sin certificar** |
| `meetsMaxSlope: true` y `underestimated: true` (API anterior a 1.12.0) | **Sin certificar** |
| `meetsMaxSlope: null` (fuera del DEM o servidor sin DEM) | **Sin certificar** |

`underestimated: true` significa que el DEM es grueso (160 o 240 m/px fuera de las ventanas de 20 m) y la API ha
medido en ~480–690 m en vez de 100 m. Una comparación con los productos de PGDA mostró que así se cuela ~1 de cada 10
zonas de más de 10°: por eso es «sin certificar» y nunca «apta». Desde la API 1.12.0 es la propia API la que lo dice
(`meetsMaxSlope: null` y `meetsMaxSlopeReason`), y la pendiente sale certificada del producto oficial LDRM de PGDA
(`source: pgda-ldrm-100m`) donde el servidor lo tiene, en el casquete de 80°S. Una regla sin certificar no tumba el
aterrizaje, pero deja el veredicto en «marginal» y provisional, con un aviso.

## Lo que hoy no entra en el veredicto

- **Fuera del polo sur, relieve.** No hay DEM al norte de 60°S ni en el polo norte: Luna lisa y veredicto
  provisional. Lejos de los polos el efecto suele ser pequeño.
- **Noche entera.** R4 mide la sombra más larga **dentro de la misión**, recortada a `[T0, T0 + duración]`, con las
  ventanas de `/v1/windows`; la misión siempre cabe en el periodo pedido (si no, `no-data`). No usa la noche real
  de la API (`fullNight=1`), así que su límite de 30 días (`nightTruncated`, `night_truncated`) no le afecta. Si
  una regla llegara a usarla, con `nightTruncated: true` no podría dar un veredicto firme.
- **Fechas de `/v1/landing-dates`.** El planner compara fechas (`--scan`, `--delay`, tolerancia) evaluando sus
  propias reglas en local sobre una sola llamada a `/v1/windows`, cada 6 h. `/v1/landing-dates` puntúa con la nota
  ponderada de `/v1/rank`, que aquí no se usa como veredicto (ver «Qué significa viable»), así que no se usa, ni
  siquiera con `dates=0`.
- **Margen de elevación para la antena.** Los perfiles usan `mode: full` para la Tierra (disco entero, el centro a
  ~0,95° o más). La API ya admite `earthMinElevationDeg` (desde 1.9.0) en `/v1/windows`, pero el planner aún no lo
  pide.
- **Cuánta energía.** R5 cuenta tiempo con el Sol visible según `mode`, no la fracción de disco ni el ángulo
  de los paneles (`panel` solo existe en `/v1/rank` y `/v1/landing-dates`).

## Usarlo

Desde la terminal (opciones en la cabecera de `src/cli.js`):

```sh
npm run evaluate -- --sites                                             # catálogo de sitios
npm run evaluate -- --site apollo11 --date 2027-01-13T12:00             # un aterrizaje
npm run evaluate -- --site apollo11 --date 2027-01-13 --scan 90         # ventanas de los 90 días siguientes
npm run evaluate -- --site apollo11 --date 2027-01-13T12:00 --delay 10  # replanificar con 10 días de retraso
npm run evaluate -- --lat -84.79 --lon 29.2 --date 2027-03-01 --profile short --tolerance 1
npm run evaluate -- --site apollo11 --date 2027-01-13T12:00 --json      # salida para programas
npm run evaluate -- --site shackleton-rim --date 2027-01-15             # polar: con relieve por defecto
npm run evaluate -- --site shackleton-rim --date 2027-01-15 --no-terrain               # Luna lisa, provisional
npm run evaluate -- --site shackleton-rim --date 2027-01-15 --antenna-height 10 --max-slope 10
```

Desde código:

```js
import { loadWindows } from './src/api.js';
import { PROFILES } from './src/profiles.js';
import { evaluate } from './src/rules.js';

const profile = PROFILES['clps-lunar-day'];
const w = await loadWindows({ site: 'shackleton-rim', start: '2027-01-01', end: '2027-03-01', sunMode: profile.sunMode, earthMode: profile.earthMode,
  terrain: true, panelHeightM: 2, antennaHeightM: 10, maxSlopeDeg: 10 });
const r = evaluate(w, { ...profile, rules: { ...profile.rules, R9: { active: true, threshold: 10 } } }, Date.parse('2027-01-15T00:00:00Z'));
// r.verdict: 'viable' | 'marginal' | 'not-viable' | 'no-data'
// r.limiting: la regla que más aprieta · r.rules: todas, con valor, umbral, margen y motivo (passes: null = sin certificar)
// r.metrics: sombra más larga, horas de sol tras aterrizar… · r.warnings: avisos (sin relieve, sin certificar, de la API)
// r.horizon: con qué horizonte se calculó · r.provisional: true con Luna lisa o con una regla sin certificar
```

Las fechas sin zona horaria son UTC, como en la API.

## Estructura

```
src/rules.js       reglas, veredicto, tolerancia, ventanas de aterrizaje y replanificación (funciones puras)
src/replan.js      opciones de replanificación tras un retraso: A, B, C, margen, distancia y sugerencia (puras)
src/ranking.js     mejores aterrizajes de una ventana: veredicto, puntuación por prioridad, margen y orden (puras)
src/intervals.js   operaciones con intervalos de tiempo: recortar, cruzar, huecos
src/profiles.js    perfiles de misión
src/api.js         cliente de la API de datos
src/cli.js         evaluación desde la terminal
test/              tests con casos hechos a mano, contra respuestas reales grabadas en test/fixtures y de integración
```

## Tests

- `test/rules.test.js`, `replan.test.js` e `intervals.test.js`: casos hechos a mano y respuestas reales grabadas en
  `test/fixtures` (Luna lisa, del 1 de enero al 1 de julio de 2027). No necesitan nada más.
- `test/integration.test.js`: arranca en memoria la app de `../data` (`createApp()`, puerto efímero, sin red
  externa) con las máscaras del catálogo y **sin DEM**, y ejecuta el planner contra ella: `loadWindows` y
  `evaluate` con y sin relieve, alturas, pendiente sin certificar, avisos de la API y la terminal (`src/cli.js`)
  de punta a punta. Comprueba también que las fixtures siguen siendo lo que responde la API. Así, un cambio de la
  v1 que rompa al planner rompe el `npm test` de la raíz y la CI. Necesita `npm ci --prefix backend && npm ci
  --prefix data` (como el `npm test` de la raíz); sin eso se salta con un aviso, salvo en la CI (`CI=true`).

### Fixtures

Si el test de integración dice que una fixture ya no es lo que responde la API, se regraban con la API arrancada
(`npm start` en `../data`; sin `terrain=1` la respuesta no depende del DEM):

```sh
for f in apollo11:full im1:full shackleton-rim:full shackleton-rim:center; do
  curl -sf "localhost:3100/v1/windows?site=${f%%:*}&start=2027-01-01&end=2027-07-01&mode=${f##*:}" \
    | python3 -m json.tool > test/fixtures/windows-${f%%:*}-${f##*:}.json
done
```
