# Evals: búsqueda iterativa de la mejor posición de alunizaje

Arnés **reproducible** para encontrar dónde aterrizar según el Sol (energía) y la Tierra (comunicación directa),
tratando ambos como **discos**. Cada ejecución queda guardada para comparar cambios: pesos, restricciones,
fechas o mejoras del modelo, como activar el relieve LOLA (ver «Relieve»).

Se ejecuta desde `backend/`, tras `npm ci`. El relieve es opcional: sin la caché de DEM los escenarios con `terrain`
usan horizonte a 0° y lo avisan.

## Ciclo de trabajo
1. **Define un escenario** en `scenarios/*.json` (qué misión quieres).
2. **Ejecuta**: `npm run eval -- evals/scenarios/polo-sur-verano-2027.json`.
3. **Lee** `runs/<id>/report.md`: mejor posición, convergencia, top de zonas distintas, sitios de referencia y avisos.
4. **Cambia algo** sin tocar el fichero: `--set clave=valor` y `--label nombre`.
5. **Compara**: `npm run eval:compare` muestra todas las ejecuciones y el Δ de puntuación y de km respecto a la anterior del mismo escenario.

```sh
npm run eval -- evals/scenarios/polo-sur-verano-2027.json
npm run eval -- evals/scenarios/polo-sur-verano-2027.json --set region.latMax=-70 --label region-ampliada
npm run eval -- evals/scenarios/polo-sur-verano-2027.json --set aggregate=mean --set constraints.minEnergy=0.4 --label media
npm run eval:compare
```

## Qué se evalúa
Para cada candidato (lat, lon) y **cada fecha de alunizaje** del escenario, se simula la misión (`missionDays`, cada `stepMinutes`):

| Métrica | Significado |
|---|---|
| `energy` | fracción media del **disco solar** sobre el horizonte (0..1), con un panel que sigue al Sol (ver «Panel solar») |
| `sunFraction` | % del tiempo con algo de Sol |
| `earthFraction` | % del tiempo con algo de Tierra (comunicación directa) |
| `bothFraction` | % del tiempo con Sol y Tierra a la vez |
| `longestNightH` | noche más larga (h), que marca baterías y supervivencia térmica |
| `longestNoEarthH` | apagón de comunicaciones más largo (h) |
| `longestBothH` | ventana más larga con Sol y Tierra (h) |
| `longestNightFullH` | solo con `fullNight`: la noche más larga que toca la misión, entera (ver «Noche y batería») |
| `batteryKWh`, `batteryKg` | solo con `battery`: energía y masa del pack para pasar esa noche |

Las fechas se **agregan** de una de dos formas:
- `worst` (por defecto): el peor caso. Un sitio solo es bueno si aguanta todos los retrasos previstos.
- `mean`: la media de las fechas.

Después:
- **Restricciones duras** (`constraints`): `minEnergy`, `minSunFraction`, `minEarthFraction`, `minBothFraction`, `maxLongestNightH`, `maxLongestNoEarthH`, `minLongestBothH`, `maxBatteryKg` (activa `battery` con sus valores por defecto si el escenario no la trae) y `maxSlopeDeg` (pendiente del terreno; activa `slope` con la base de 100 m si el escenario no la trae). Un candidato que no las cumple siempre queda por detrás de uno que sí.
- **Puntuación 0–100** (`weights`, normalizados): energía, comunicación, ambas y noches cortas. Es la misma función que usa la API (`scoreMetrics`); cada fecha se evalúa con el caso de uso `evaluatePeriod` de `src/useCases.ts`, el mismo cálculo que `/v1/rank` y `/v1/search`.

## Pesos por variable
La puntuación es una suma ponderada de **variables**, cada una normalizada a 0..1 (1 = mejor). `npm run eval:rescore -- --vars` muestra la lista.

| Variable | Qué premia | Peso por defecto |
|---|---|---|
| `energy` | fracción media del disco solar visible | 0,35 |
| `comm` | % del tiempo con la Tierra visible | 0,25 |
| `both` | % del tiempo con Sol y Tierra a la vez | 0,30 |
| `night` | noches cortas: 1 − noche más larga / periodo | 0,10 |
| `sun` | % del tiempo con algo de Sol | 0 |
| `commGap` | apagones de comunicación cortos: 1 − apagón más largo / periodo | 0 |
| `bothStreak` | ventana continua de Sol y Tierra más larga / periodo | 0 |

- Se fijan en el escenario (`"weights": {…}`), con `--set weights.commGap=0.3` o en `/v1/rank`, `/v1/search` y `/v1/landing-dates` (`weightSunTimeFraction`, `weightShortEarthOutages`, `weightLongestSunAndEarth`, además de `weightMeanSunDiskFraction`, `weightEarthTimeFraction`, `weightSunAndEarthTimeFraction` y `weightShortNights`).
- Los pesos se normalizan para que sumen 1, y un nombre desconocido da error.
- Cada candidato trae su **desglose** (`breakdown`): cuántos puntos de 100 aporta cada variable.

**Re-puntuar sin recalcular.** Las métricas no dependen de los pesos, así que se pueden probar otros sobre la base de datos en segundos:
```sh
npm run eval:rescore -- --scenario reto-polo-sur --w comm=0.3,commGap=0.3,energy=0.2,bothStreak=0.2
npm run eval:rescore -- --run 80 --w energy=1 --top 5
```
Muestra el nuevo top, el puesto que tenía cada punto con los pesos originales y cuántos km se mueve el ganador. Las restricciones no cambian, porque dependen de las métricas y no de los pesos.

## Noche y batería
Tres opciones del escenario, desactivadas por defecto. **Sin ellas nada cambia**: mismos resultados y mismo `scenarioHash`
(solo entran en el escenario resuelto, y por tanto en el hash, cuando están activadas).

```json
"nightMinSunFraction": 0.2,
"fullNight": true,
"battery": { "survivalLoadW": 100, "whPerKg": 200, "depthOfDischarge": 0.9 },
"constraints": { "maxBatteryKg": 150 }
```

- `nightMinSunFraction` (0–1): una muestra cuenta como noche si la fracción visible del disco solar es menor que este valor.
  Con 0 (por defecto) decide `mode`: con `limb` basta un filo del disco para que no sea de noche. 0,5 equivale a `center`
  y 1 a `full`. Solo cambia la noche (`longestNightH` y lo que depende de ella), no `sunFraction` ni `energy`.
- `fullNight`: añade `longestNightFullH`. `longestNightH` se recorta a la misión: en (−65,31485°, −3,05572°), con 14 días
  desde el 24 de enero de 2027, da 183 h, pero la noche entera dura 351 h (360 h con relieve LOLA a 2 m). Si la misión
  empieza (acaba) a oscuras, la búsqueda sigue hacia atrás (delante) con el mismo paso hasta el ocaso (amanecer), como
  mucho 30 días por cada lado. `longestNightH` no cambia.
- `battery` (`true` para los valores por defecto, o un objeto con los campos que cambien): `batteryKWh = survivalLoadW ×
  horas / 1000` y `batteryKg = batteryKWh × 1000 / (depthOfDischarge × whPerKg)`, con la noche real si `fullNight` está
  activada y, si no, con `longestNightH`. Valores por defecto: 100 W (Cataldo, Zacny y Schmitz, NETS 2018), 200 Wh/kg
  a nivel de pack y profundidad de descarga 0,9 (estudio COMPASS de NASA GRC, 2022); fuentes y pasajes en
  [`backend/README.md`](../README.md) y en `BATTERY_DEFAULTS` (`src/night.ts`).
  **Es solo la masa del pack:** sin electrónica, sin el panel extra para recargarlo y sin márgenes; a nivel de sistema
  sale unas 2–3 veces más.
- Agregado `worst`: la noche real y la batería toman el máximo, como `longestNightH`. Ninguna es variable de puntuación:
  se usan como métricas y como restricción (`maxBatteryKg`).
- Desde la línea de órdenes: `--set fullNight=true --set battery=true --set constraints.maxBatteryKg=150`.
- La base de datos guarda las métricas de siempre; las nuevas están en `summary.json` y en el informe.

## Panel solar
`energy` supone por defecto un panel que **sigue al Sol** (incidencia normal): no tiene en cuenta el ángulo de incidencia, ni
el oscurecimiento del limbo, la variación de la distancia al Sol (±3,4 %), las sombras del propio módulo o el polvo. En el
polo, con el Sol a 0–2°, un panel horizontal recibiría ~sen(el); lo realista son paneles verticales que giran (requisitos
VSAT de la NASA, <https://ntrs.nasa.gov/api/citations/20230012849/downloads/GCD%20Annual%20Review%20VSAT%20September%202023%20Final.pdf>).

```json
"panel": "vertical-rotating"
```

- `tracking` (por defecto, factor 1), `vertical-rotating` (vertical que gira hacia el Sol, factor cos(el)) u `horizontal`
  (fijo, factor max(0, sen(el))), con `el` la elevación del centro del Sol. En cada paso, energía = `visibleFraction` × factor.
  Geometría pura: sin eficiencia de célula ni temperatura.
- Solo cambia `energy` (y la puntuación y `minEnergy`), no `sunFraction`, la noche, la Tierra ni la batería.
- Solo entra en el escenario resuelto (y en `scenarioHash`) si no es `tracking`: los escenarios de siempre no cambian.
- Desde la línea de órdenes: `--set panel=horizontal`.

## Pendiente del terreno
Artemis III pide una pendiente **menor de 10° en 100 m** (<https://ntrs.nasa.gov/api/citations/20250009323/downloads/ArtemisOverview2025IntSPAPPSChallenge.pdf>). La puntuación no la mira y las laderas
suelen puntuar bien (bajan el horizonte): el ganador del v3, (−65,31485, −3,05572), está en una de ~13,5°. Con

```json
"constraints": { "maxSlopeDeg": 10 },
"slope": { "baselineM": 100 }
```

cada candidato lleva la métrica `slopeDeg` (y `slope` con la base usada, la resolución del DEM y la rugosidad) y los que
superan el límite no cumplen. `slope` solo hace falta para cambiar la base o para tener la métrica sin restricción.

- Cálculo (`src/terrain/slope.ts`): el producto LDRM de PGDA si está en caché para esa base (100, 400 u 800 m; ver
  `backend/README.md`) o el plano ajustado por mínimos cuadrados a las alturas del DEM LOLA en caché dentro de un círculo
  cuyo diámetro es la base (`slope.source` dice cuál). Unos microsegundos por punto: no necesita `terrain` ni máscaras.
- **Resolución:** el DEM tiene 20 m solo en algunas ventanas polares, 160 m hasta 80°S y 240 m hasta 60°S. Si la base es
  menor que 3 píxeles se usa la mínima (~480 m o ~690 m) y la pendiente queda **subestimada** (`slope.underestimated`).
  Un punto fuera del DEM no tiene `slopeDeg` y no cumple `maxSlopeDeg`.
- **Sin certificar:** una pendiente subestimada nunca cumple `maxSlopeDeg`, sea cual sea su valor: la violación lo dice
  (`slopeDeg=3.66 (<= 10) sin certificar: la base real es de 674 m (se pidieron 100 m)`). Fuera del casquete de 80°S (sin
  LDRM ni DEM de 20 m) ningún candidato cumple `maxSlopeDeg` con base de 100 m; para cribar allí, una base que el DEM
  resuelva (`slope.baselineM` ≥ ~700 m) sí se certifica, aunque no es el requisito de Artemis III.
- La versión de los datos de pendiente (DEM y, si hay, LDRM) entra en `scenarioHash`.
- Con `robustness`, la pendiente también se exige en cada vecino.
- Solo entra en el escenario resuelto (y en `scenarioHash`, con la versión del DEM) si se usa: los escenarios de siempre no cambian.
- Desde la línea de órdenes: `--set constraints.maxSlopeDeg=10 --set slope.baselineM=100`.

## Robustez espacial
El alunizaje tiene un error de posición, y en el polo unos cientos de metros cambian la visibilidad de la Tierra: el borde de la franja con Tierra a la vista es un "acantilado". Con
```json
"robustness": { "radiusKm": 1, "directions": 8, "rings": 2 }
```
cada candidato se evalúa en su centro y en sus vecinos (anillos a r/rings … r km en N direcciones):
- **la puntuación es la PEOR** de todos;
- **solo cumple** si cumplen el centro y todos los vecinos.

El informe y la base guardan la puntuación nominal (`nominal_score`), la caída (`robust_spread`) y los vecinos que fallan. Está desactivada por defecto. Cuesta ~(1 + directions × rings) veces más, aunque la caché comparte vecinos entre candidatos.

## Relieve
Por defecto el horizonte es el de una Luna lisa. Con
```json
"terrain": { "enabled": true, "observerHeightM": 2, "resolution": "fast" }
```
**cada** punto evaluado (candidatos de la malla, puntos de `points`, sitios de referencia y vecinos de robustez) usa su
máscara de horizonte LOLA, calculada bajo demanda desde la caché de DEM y guardada en `terrain/cache/masks/`.
Antes hay que descargar el DEM una vez: `node scripts/fetch-dem.ts` (ver «Relieve» en `backend/README.md`).

- `resolution`: `fast` (160/240 m, 360 azimuts, 6–15 ms por máscara) para mallas; `precise` (20 m cerca si hay ventana,
  720 azimuts, 30–140 ms) para confirmar finalistas en modo puntos.
- **El modo rápido cerca del polo es solo de cribado.** Frente a una referencia fina, en `shackleton-rim` cambia la
  visibilidad del Sol en 406 horas de 2027 y la noche más larga pasa de 111 h a 274 h. El informe lo avisa cuando la
  ejecución es `fast` y hay candidatos al sur de −85° o con ventana de 20 m.
- `refine` y `refineDeg`: horizonte híbrido (ver «Relieve» en `backend/README.md`). Encendido por defecto en `precise`
  (rayo directo en el azimut exacto cuando el margen al horizonte es menor que 0,1°) y apagado en `fast`.
  `"refine": false` (o `"refineDeg": 0`) usa solo la máscara; otro `refineDeg` cambia el umbral. Solo entran en el
  escenario resuelto (y en `scenarioHash`) si difieren del valor por defecto del modo.
- `observerHeightM`: altura del panel o la antena sobre el terreno (por defecto 2 m). En crestas cambia mucho el resultado.
- `panelHeightM` y `antennaHeightM`: altura del panel (máscara para el Sol: energía, Sol, noche, batería) y de la antena
  (máscara para la Tierra), por separado. Valen `observerHeightM` por defecto y solo entran en el escenario resuelto (y en
  `scenarioHash`) si alguna difiere de él. Alturas realistas: cubierta a ~2–4 m y mástil VSAT de 5–10 m.
- El escenario resuelto guarda `terrain.demVersion` (qué DEM había en la caché), así que entra en `scenarioHash` y en la
  huella. La base guarda `runs.terrain_json`. Cada candidato lleva `horizon` (`mask`, o `sphere` si queda fuera de la cobertura)
  y `heightM`.
- **Sin `terrain` nada cambia:** mismos resultados bit a bit y mismo `scenarioHash` (los tests dorados lo comprueban).
- Si se activa sin DEM en la caché, la ejecución no falla: usa horizonte a 0° y lo avisa.
- Con relieve el campo cambia en 1–2 km (de 60 a 20 puntos): usa mallas de 2–4 km, no de 30.
- Desde la línea de órdenes: `--set terrain.enabled=true --set terrain.resolution='"precise"'`.

**Tiempos medidos** (un núcleo, caché de máscaras vacía; con la caché de disco llena, las máscaras ya calculadas no cuestan):

| Ejecución | Candidatos | Máscaras | Tiempo |
|---|---|---|---|
| v3 nominal (malla de 3 km, modo rápido) | 9 672 | ~9 700 | 94 s |
| v3 con `robustness` a 1 km (8 vecinos) | 9 725 | ~87 000 | 768 s |
| v3-puntos (12 puntos × 9, modo preciso) | 12 | 108 | 9 s |

La puntuación nominal con relieve engaña: el mejor nominal del v3 (66,69) cae a 27,84 con robustez a 1 km, porque es un
pico aislado. Usa `robustness` (o el juez de la competición) para decidir.

`scenarios/reto-polo-sur-v3.json` es el benchmark v2 con relieve (observador a 2 m, malla de 3 km).
`scenarios/reto-polo-sur-v3-puntos.json` reevalúa en modo preciso y con robustez a 1 km los puntos de interés.

## Optimizador
1. **Malla gruesa** sobre la región, con puntos espaciados en km (`search.spacingKm`).
2. **Refina** alrededor de los `keepTop` mejores con la mitad de separación.
3. **Para** cuando se cumple cualquiera de estas condiciones:
   - se llega a `maxIterations`;
   - la malla baja de `minSpacingKm`;
   - la mejora es menor que `stopDelta` durante `patience` iteraciones.

Es determinista: el mismo escenario con el mismo código da el mismo resultado.

## Salida (`runs/<fecha>_<escenario>[_<etiqueta>]/`)
| Fichero | Contenido |
|---|---|
| `scenario.json` | El escenario resuelto |
| `iterations.jsonl` | Una línea por iteración |
| `summary.json` | Mejor posición, top, baselines, avisos y versión del código |
| `report.md` | El informe legible |

`runs/` está en `.gitignore`.

## Base de datos y métricas
Cada ejecución se guarda también en **`evals/evals.db`** (SQLite, con `node:sqlite` de Node, sin dependencias). Usa `--no-db` para no guardar y `--db <fichero>` para otra base.

| Tabla | Contenido |
|---|---|
| `runs` | Una fila por ejecución: escenario, etiqueta, versión del código, parámetros y mejor resultado |
| `iterations` | Convergencia del optimizador |
| `candidates` | **Todos** los puntos evaluados, con métricas agregadas y si cumplen |
| `candidate_dates` | Métricas de cada candidato en cada fecha de alunizaje |
| `violations` | Restricción incumplida por cada candidato |
| `baselines`, `warnings` | Sitios de referencia y avisos |

Métricas (vistas SQL), con `npm run eval:metrics [-- --scenario <nombre>] [-- --json]`:

| Vista | Pregunta que responde |
|---|---|
| `v_run_summary` | ¿Qué salió? ¿Cuántos candidatos cumplen? ¿Cuánto mejora frente al mejor sitio conocido? ¿Cuántos candidatos por segundo? |
| `v_convergence` | ¿Sirve el refinamiento? (ganancia sobre la malla gruesa e iteración en que aparece el mejor) |
| `v_best_robustness` | ¿Es el mejor sitio sensible a retrasos? (spread de energía y de Tierra entre fechas) |
| `v_binding_constraints` | ¿Qué requisito limita la elección? |
| `v_run_deltas` | ¿Cuánto cambia el resultado entre ejecuciones del mismo escenario? (puntos y km) |
| `v_score_distribution` | ¿Hay un óptimo claro o una meseta? (percentiles y nº de puntos a <1 pt del mejor) |

Consultas libres: `sqlite3 evals/evals.db "SELECT * FROM v_run_summary"`.

## Determinismo
El resultado depende solo del escenario y del entorno; no hay aleatoriedad, red ni IA en el bucle. Para garantizarlo:

- **Entorno fijado:**
  - `.nvmrc` fija la versión de Node (26.13.0) y `package.json` exige `26.13.x` (`engine-strict` en `.npmrc`);
  - instala con `npm ci` para respetar el `package-lock.json` (astronomy-engine 2.1.19);
  - si se ejecuta con otro Node, el informe lo avisa.
- **Huella de cada ejecución:** `summary.json`, `report.md` y la tabla `runs` guardan:
  - el hash del escenario resuelto;
  - el hash del código de cálculo (`src/*.ts` + `src/terrain/*.ts` + `evals/lib.ts`), versión 2: con los tipos de TypeScript borrados y sin espacios, así que cambiar solo tipos no lo cambia (`node evals/fingerprint.ts [carpeta]` lo imprime);
  - el hash de `package-lock.json`;
  - la versión de Node y la de astronomy-engine;
  - el `resultHash`: el hash de **todos** los candidatos con sus métricas.

  La vista `v_determinism` comprueba que la misma huella da un único resultado.
- **Test dorado** (`test/golden.test.ts`):
  - `npm test` compara dos escenarios fijos con la referencia guardada en `test/fixtures/golden/`;
  - si un cambio de resultado es intencionado (por ejemplo, al añadir el relieve), regenera con `npm run eval:golden:update` y revisa el diff;
  - `npm run eval:golden` comprueba sin escribir.

Límite conocido: el estándar de JavaScript no obliga a que `Math.sin`/`cos` den el mismo último bit en todas las plataformas. Las métricas se redondean a 3–4 decimales, así que una diferencia así solo afectaría a casos exactamente en un umbral. Si alguna vez pasa, el test dorado lo detecta.

## Competición de agentes (Claude y opencode)
Varios **exploradores** buscan en paralelo la mejor posición de un benchmark. Pueden ser `claude -p` con cualquier modelo u `opencode run` con el proveedor que tengas configurado. Después, un **juez determinista, sin IA**, decide.

```sh
npm run eval:competition -- --benchmark reto-polo-sur-v2 \
  --agents claude:haiku:grid,claude:sonnet:data,opencode:<proveedor>/<modelo>:hillclimb \
  [--max-runs 15] [--max-candidates 20000] [--timeout-min 20] [--budget-usd 2] [--robust-km 1] [--finalists 3] [--dry-run]
npm run eval:competition -- --benchmark reto-polo-sur-v2 --judge hv2-   # juzgar ejecuciones que ya existen
```

- **Modelos de origen chino excluidos** (DeepSeek, Qwen, GLM/Zhipu, Kimi, MiniMax…). Los términos de NASA Space Apps 2026 prohíben colaborar o coordinarse con entidades chinas en relación con la participación, así que el orquestador **rechaza** esos modelos (`BLOCKED_MODEL` en `competition.ts`). Con opencode, usad un proveedor y un modelo no chinos.
- **Reglas comunes:** están en `evals/AGENT.md`, que es el mismo texto para Claude y para opencode. Las estrategias (`grid`, `sectors`, `hillclimb`, `latitudes`, `data`, `robust`) están en `evals/strategies.ts`.
- **Cada agente** recibe un prefijo de etiquetas propio y una carpeta de trabajo en `evals/competitions/<id>/aN/`, con su prompt y sus logs.
- **Lanzamiento:**
  - Claude se lanza sin servidores MCP, con herramientas limitadas (`node evals/run.ts`, `sqlite3`, lectura y escritura) y un tope de gasto en dólares.
  - opencode se lanza con `--auto`.
  - Todos tienen tope de tiempo.
- **Qué hace el juez:**
  1. Audita en la base cada ejecución: parámetros fijos intactos, sin `robustness` propia, candidatos y número de ejecuciones dentro del presupuesto.
  2. Comprueba que el **código no cambió** durante la competición (hash del código de cálculo).
  3. Toma los mejores candidatos de cada agente (los «finalistas»).
  4. Los **reevalúa con robustez espacial**.
  5. Clasifica por puntuación robusta.
- **Resultados:** se guardan en las tablas `competitions` y `competition_agents` (con tiempo, coste y tokens si la herramienta los da) y en `evals/competitions/<id>/report.md`.

## Avisos automáticos
- **Mejor punto en el borde de la región:** amplíala.
- **Ningún candidato cumple:** relaja las restricciones o cambia la región o las fechas.
- **Mejor punto a menos de 1° del polo:** las coordenadas deben ser precisas al metro.

## Limitaciones
- **Relieve opcional y limitado por el DEM.** Sin `terrain` el horizonte es el de una Luna lisa y en los polos los resultados son optimistas. Con `terrain`, fuera de 80°S solo hay 240 m y las ventanas de 20 m hay que descargarlas por zona.
- **Resolución temporal:** las métricas tienen la resolución de `stepMinutes`.
- **Comunicación:** "Tierra visible" no comprueba la disponibilidad de las antenas DSN (≈ 0,5–2 % de diferencia; ver el análisis de errores).
