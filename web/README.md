# Web · interfaz del planificador

La interfaz del Lunar Landing Site Navigator, partida por vistas para que tres personas trabajen en paralelo sin pisarse. Sale del prototipo de [`../prototipo/`](../prototipo/), que se queda tal cual como referencia: mismo comportamiento y mismo aspecto, con el código en inglés y repartido en módulos. **Planificar, Avanzado y Replanificar sacan sus datos de la API de [`../data/`](../data/) si está arrancada, con las mismas reglas de [`../planner/`](../planner/): las tres dan el mismo veredicto.** Sin la API, las tres usan el motor simulado.

## Arrancar

```sh
node web/serve.mjs     # http://localhost:4542  (PORT=8080 node web/serve.mjs para cambiarlo)
```

Es un atajo del servidor del sitio ([`../serve.mjs`](../serve.mjs)) que abre directamente el planificador, en `/web/`. Con `npm start` en la raíz se entra por la portada ([`../home/`](../home/)): su misión «Simulador de misiones» lleva aquí, y el nombre del producto en la barra vuelve a la Luna.

Para que Replanificar use datos reales, arranca también la API de datos (`cd data && npm start`, puerto 3100). Al cargar, la web comprueba `/v1/health`: si la API no responde (por ejemplo, en GitHub Pages), Replanificar vuelve a los datos de ejemplo del motor del navegador y la etiqueta de la cabecera lo dice. Con `?data=fake` se fuerza el motor simulado y con `?api=http://…` se cambia la URL de la API.

El botón de la Luna de la barra superior cambia entre la cara oculta (modo oscuro) y la cara iluminada (modo claro) en las cuatro vistas. Por defecto es oscuro, sea cual sea el tema del sistema; si eliges el claro, se guarda en `localStorage` (`llsn.theme`). Al cambiar, la cara nueva barre la página desde el botón con un terminador suave (View Transitions; sin animación si el sistema pide menos movimiento). El fondo es la superficie de la Luna: el regolito cálido al Sol en claro y en sombra, azulado, en oscuro. El botón es una Luna pequeña cuya sombra se mueve como una fase.

Con `?debug=1` se activa el modo explicación. La primera vez que se abre cada vista arranca además un tutorial que recorre, en orden, por dónde hay que pasar; se guarda en `localStorage` (`llsn.tour.seen`) para no repetirlo y se puede repetir cuando haga falta con el botón «Tutorial» de la barra superior. El tutorial que se abre solo ofrece además «No mostrar más tutoriales»: apaga la apertura automática en todas las pantallas del sitio (`llsn.tour.disabled` en `localStorage`; para volver a activarla, borrar esa clave) y deja el botón «Tutorial» como estaba. No necesita instalar nada: HTML y JavaScript sin dependencias.

Bajo el titular de Replanificar, una línea dice además si esas ventanas llevan relieve: «con relieve LOLA» en todos los sitios, en algunos, o «Luna lisa (sin relieve)». La API puede estar viva y no tener el DEM, y en el polo eso lo cambia todo: en la cresta de Shackleton, de marzo a agosto de 2027, hay Sol el 55 % del tiempo con relieve y el 5 % con el horizonte liso.

## Idioma

Español e inglés (#283). Manda `?lang=en` (o `es`) en la dirección; si no, lo elegido con el conmutador ES / EN de la barra superior (`llsn.lang` en `localStorage`) y, la primera vez, el idioma del navegador (inglés si no es español). Cambiar de idioma recarga la página. Las reglas son las de [`../shared/i18n/`](../shared/README.md).

- **Textos**: `t('área.clave')` de `js/common/i18n.js` sobre los diccionarios de `js/i18n/` (uno por vista, con `es` y `en`). Los textos fijos de `index.html` siguen en español en el HTML y llevan `data-i18n`; su inglés está en `js/i18n/html.js` o en el diccionario de su vista. El modo explicación tiene su inglés en `js/common/explanations.en.js`. `test/i18n.test.js` falla si una clave no tiene inglés.
- **Cifras y fechas** (#343): los formateadores de `shared/format/` atados al idioma en `js/common/i18n.js`: `fmtNum`, `fmtDeg`, `fmtPct`, `fmtKm`, `fmtM`, `fmtCoords`, `fmtDays`, `fmtHours` («2 d», sin «0 h»), `fmtDate` («15 ene 2027»), `fmtDateTime` («15 ene 2027 · 00:00 UTC»), `fmtDayMonth` e `isoDay` (solo para URLs y campos). Coma decimal en español y punto en inglés, «−» en los negativos y miles agrupados también con cuatro cifras. Todas las fechas visibles, también la del historial, van en UTC. El CSV en inglés usa `,` como separador y punto decimal.
- **Motivos del planificador**: `../planner/` (y la API) los da en español y sin código; se traducen al pintarlos por plantilla (`reasonText` en `js/common/rules.js`). Un motivo nuevo que no encaje en ninguna plantilla sale en español.

### De dónde salen los datos: cinco términos

Los textos que dicen de dónde sale un dato usan solo estos cinco términos (#338), en `web/`, `viewpoint/`, `rolegame/` y `home/`:

| Término | En inglés | Qué nombra |
|---|---|---|
| Relieve LOLA | LOLA terrain (en el Mirador, *LOLA relief*) | El relieve medido por el altímetro LOLA |
| Luna lisa (sin relieve) | smooth Moon (no terrain) | La API de datos cuando el servidor no tiene el DEM |
| Relieve inventado | made-up terrain (en el Mirador, *made-up relief*) | Alturas inventadas para ilustrar: el relieve procedural, el `simulated` del pipeline y el del motor del navegador |
| Efemérides reales / aproximadas | real / approximate ephemerides | La posición del Sol y de la Tierra |
| Datos de ejemplo | example data | El modo sin API (el motor del navegador, `?data=fake`) |

«Simulado» no sale en la interfaz: se queda en el código (`fake`, `simulated-terrain`…). «Simulador de misiones» sí, porque es el nombre de la pantalla. Las fichas del modo explicación dicen en «De dónde sale hoy» (`demo`) qué pasa con la API y sin ella; las pocas que solo hablan del caso sin la API llevan además un campo `api` con la fuente real, que es el que se muestra mientras la API responde (`sourceToday` en `js/common/explanations.js`, con la fuente que conoce `app.js` aunque el servicio de misión aún no haya cargado). `test/data-origin-vocabulary.test.js` y `test/explain-card-source.test.js` lo comprueban.

## Tests

```sh
cd web && npm test     # también entran en `npm test` de la raíz
```

Prueban el adaptador de la API contra la API real, arrancada en un puerto efímero (necesitan `npm ci` en `backend/` y `data/`): las ventanas, el ranking, las alturas del panel y de la antena (`test/heights.test.js`) y los CSV (`test/csv.test.js`). `test/mission-history.test.js` prueba la lógica del historial de misiones. `test/profiles.test.js` prueba la nave propia: qué perfil corresponde a cada id, su línea de fuente y cuándo los requisitos tecleados dejan de ser los de una nave de ejemplo, qué requisitos deja al elegirla antes y después de buscar, la ida y vuelta del enlace con el visor 3D y del historial con la nave propia, y que `adopt()` no falla con ella, el nombre de la nave que da el historial y cuándo se anuncia el paso a «Nave propia». `test/plan-profiles.test.js` prueba el paso 1 de Planificar sobre un DOM falso: la tarjeta «Nave propia», elegirla, cambiar un requisito a mano (y su aviso al lector de pantalla) y abrir un plan desde su enlace; y el paso 2 con la coherencia de los requisitos (#252): que un bloqueo no deja avanzar ni buscar y dice qué datos chocan, «Continuar de todos modos» (su nombre accesible, el foco de vuelta al campo y el bloqueo que vuelve al cambiar un dato), C0 y C1 sin botón, «Bloquea:» y «Aviso:» en texto, `aria-invalid` y `aria-describedby`, el selector de clase de nave solo con «Nave propia», las reglas saltadas y la clase que restauran un enlace (también de ida y vuelta por el visor 3D) y el historial, y la nota bajo la fecha de un plan con reglas saltadas (que el servicio de misión conserva en el resultado) y su ausencia sin saltos. `test/horizon-label.test.js` prueba qué horizonte dicen Avanzado y la insignia de la cabecera: con la API sin el DEM LOLA, «liso (sin relieve LOLA en este punto)» y «Datos reales · sin relieve». `test/coherence.test.js` prueba la coherencia de los requisitos (#252): cada regla, con un caso que salta y otro que no; que las tres naves de ejemplo pasan sin bloqueos; qué bloqueos se pueden saltar y cuándo vuelven; que, con cualquier combinación de reglas saltadas, lo que sale hacia `/v1/best-landings`, `/v1/windows` y `/v1/light-map` está en los rangos de la API, y que el CSV, el enlace y el historial dicen qué reglas se saltaron y guardan la clase de nave; `test/battery.test.js` prueba la batería de la nave propia (#253): el caso de COMPASS (20 000 Wh, 0,9 y 46 W dan ~391 h), que la cuenta da lo mismo que `batteryFor` del motor, qué se deduce de Wh, kg y Wh/kg, que una carga de 0 W no da `Infinity` ni `NaN`, cada regla B1–B6 con un caso que salta y otro que no, cuáles se pueden saltar, el bloqueo de más de 720 h con la cuenta, el enlace y el historial con la batería y la ficha del modo explicación; `test/plan-profiles.test.js` prueba además la batería en el paso 2 (el modo solo con «Nave propia», las horas y la cuenta al cambiar cada dato, los bloqueos con y sin botón, lo que sale hacia la API y la vuelta de un enlace o del historial). `test/coherence-en.test.js`, que con `?lang=en` los mensajes, las fuentes, las clases, la nota de reglas saltadas y la columna del CSV salen en inglés. `test/deep-polar.test.js` prueba, contra la API real, la nota del polo profundo (#437): sale en la cresta de Shackleton y no en IM-2, tampoco con el motor simulado, y su texto en español y en inglés. `test/control-cases.test.js` prueba los casos de control (#102) con el motor real (la API) y con el simulado: desde Chang'e 4 (cara oculta) la Tierra se ve el 0 % de cada mes de 2027 y R2 («Tierra al aterrizar») falla siempre; en Apolo 15 la Tierra se ve ≥ 99 %, el Sol entre el 45 y el 55 % de un mes sinódico y los días duran 14,8 ± 0,5 días terrestres; y en el polo sur exacto con Luna lisa el centro del Sol no sube de 1,4–1,7° en 2027 (su borde de arriba sube unos 0,27° más). Si el motor simulado falla uno, es una limitación suya: se documenta y se abre su issue, no se ajusta el umbral. `test/relief-note.test.js` prueba la nota del relieve de los mapas y que solo `js/common/map.js` carga la imagen; `test/relief-image.test.js`, los estados de su cargador (`js/common/relief-image.js`). El resto de la interfaz no tiene tests todavía.

## Flujo

Planificar empieza vacío y va por pasos, uno cada vez: **1 Nave**, **2 Requisitos** (vienen de la nave y se pueden ajustar), **3 Dónde** y **4 Cuándo**. En **1 Nave**, junto a las tres naves de ejemplo, la cuarta tarjeta es «Nave propia» («Tú pones los requisitos», #251): al elegirla, el paso 2 se abre con los días, las horas sin Sol, el % de Tierra, el máximo sin Tierra y el tránsito vacíos (las alturas del panel y de la antena se quedan en 2 m), y no se pasa de él sin días, horas sin Sol y % de Tierra. Con un plan ya en pantalla, elegir «Nave propia» deja los requisitos que había (pasan a ser los del usuario), para que el resultado siga respondiendo a los requisitos que se ven. Pulsar «Nave propia» cuando ya está marcada (para seguir) tampoco borra lo escrito. Si se elige una nave de ejemplo y luego se cambia a mano uno de sus requisitos, la selección pasa a «Nave propia»; igual con un plan que vuelve de un enlace o del historial, o que se adopta en Avanzado, con una nave de ejemplo y requisitos que ya no son los suyos. La nave propia viaja como una de ejemplo (perfil `custom`): en el enlace con el visor 3D, que la devuelve con sus requisitos, en el historial, que la lista con el mismo nombre con el que la abre (una entrada guardada antes de #251 con una nave de ejemplo y requisitos cambiados a mano sale como «Nave propia»), y al pasar a Avanzado, cuyo resumen de la misión dice «Nave propia». Cuando un requisito cambiado a mano pasa la selección a «Nave propia», un aviso oculto a la vista (`aria-live`) se lo dice una vez al lector de pantalla. La barra de arriba marca el paso y deja volver a los ya hechos, con su resumen. Al marcar el último día de la ventana sale el plan. El formulario se pliega en una barra con las cuatro fichas de los pasos y su resumen («El mejor de la zona → Malapert», «… · aterriza 17 nov 12:00»). Cada ficha abre solo su paso, flotando bajo la barra, y el plan se recalcula detrás; Esc o un clic fuera lo cierran. «Cambiar fechas», junto a la fecha de aterrizaje del resultado, abre la ficha «Cuándo» igual que su ficha (en el móvil la barra de fichas se desplaza y esa puede quedar fuera de la pantalla): al marcar el último día de la nueva ventana, el plan se recalcula sin salir de la pantalla. Debajo, la respuesta en una línea y, como pieza central, «¿Cuándo aterrizar?»: una línea de tiempo con la ventana buscada más una misión. La fila «Aterrizar» pinta cada día con su veredicto (el mismo del calendario), «Sol» la altura del Sol sobre el relieve, «Tierra» las horas con la Tierra a la vista y «Misión» la barra de tu misión. Pulsar un día, arrastrar la barra o moverla con las flechas (hora a hora; con Mayús, día a día) cambia el aterrizaje; mientras se arrastra solo se mueve la barra, con el color del veredicto de ese aterrizaje, y el plan entero se recalcula al soltar o al pararse un instante. Debajo, una frase da el veredicto con su motivo y cuánto falta, desde el aterrizaje, para que se pongan el Sol y la Tierra. «Línea | Círculo», en su cabecera, cambia la línea de tiempo por el reloj lunar de antes (un calendario circular: se arrastra el arco de la misión y, al empujarlo contra el corte de arriba, giran las fechas; con las cifras al lado); el navegador recuerda la elección. Bajo la línea de tiempo, sus cifras, cada una del color de su fila (al pasar por una, la línea de tiempo resalta esa fila), y al lado el retraso que aguanta, con sus fichas +1/+3/+7/+14 d. A la derecha, las alternativas que valen, el cielo en 2D, en «Brújula» (visto desde arriba, el norte arriba, con el rumbo y el margen sobre el relieve de cada uno) o en 3D (su deslizador es la raya vertical de la línea de tiempo) y «Investigar en la vista avanzada →». En 1440×900 cabe sin scroll. Avanzado no tiene pestaña: se llega desde ese botón, y sin plan `#advanced` (y Replanificar) llevan a Planificar.

**Coherencia de los requisitos (#252).** Al rellenar el paso 2, cada campo dice si su valor no puede darse o es poco creíble ([`js/engine/coherence.js`](js/engine/coherence.js)), con la regla y su fuente, bajo el propio campo (`aria-live`, y cada campo apunta a sus mensajes con `aria-describedby`). Lo imposible bloquea: no se pasa del paso 2 ni se busca, y el mensaje dice qué datos chocan y con qué valores. Lo inverosímil solo avisa. Un bloqueo trae «Continuar de todos modos»: al pulsarlo deja de bloquear para esos valores y queda como «Regla saltada»; si cambia uno de los datos que cruza, vuelve. No se pueden saltar los valores sin sentido (C1: días, alturas o tránsito a cero o negativos, % fuera de 0–100) ni los límites de la API (C0, `API_LIMITS` en [`js/ports/visibility.js`](js/ports/visibility.js), con la ruta de la que sale cada uno): ya no se recorta nada en silencio, lo que se calcula es lo que se ve escrito. Con «Nave propia» aparece además la **clase de nave** (lander pequeño, lander mediano, tripulado o rover), que solo ajusta los rangos creíbles; las naves de ejemplo llevan la suya. Un plan calculado con reglas saltadas lo dice bajo la fecha («Calculado con N regla(s) de coherencia saltada(s)…»), en una última columna del CSV de comparación de sitios y en el enlace (`?skip=C4,C5`), que al volver a Planificar las deja saltadas; también el historial. Los textos de las reglas están en el diccionario (`plan.coherence.*` en [`js/i18n/plan.js`](js/i18n/plan.js)), en español y en inglés. Las reglas solo miran la entrada: no cambian ningún veredicto.

**Batería de la nave propia (#253).** Con «Nave propia», «Autonomía sin Sol» deja elegir entre teclear las horas («En horas») o describir la batería («Con la batería»): capacidad (Wh), carga de supervivencia (W) y profundidad de descarga (0–1), y, si se quiere, la energía específica del pack (Wh/kg), la masa de la batería y la masa seca de la nave. Con la batería, «Aguanta sin Sol» pasa a ser de solo lectura y enseña la cuenta (`horas = Wh × DoD / W`); con dos de Wh, kg y Wh/kg se deduce la tercera, y solo con Wh la masa sale de los 200 Wh/kg por defecto. Los valores por defecto (100 W, 0,9 y 200 Wh/kg) son los de `BATTERY_DEFAULTS` del motor, y la cuenta es la inversa de su `batteryFor` (`backend/src/night.ts`): [`js/engine/battery.js`](js/engine/battery.js), que `test/battery.test.js` compara con el motor. La masa es solo la del pack: sin electrónica, sin panel extra para recargar y sin márgenes. Las reglas B1–B6 de [`js/engine/coherence.js`](js/engine/coherence.js) miran la batería: B1, B4 y B5 se pueden saltar; B2 y B3 (profundidad de descarga fuera de 0–1, carga de 0 W o menos), no. La batería no viaja a la API: solo las horas, y si pasan de 720 h es el bloqueo sin salto de C0, con la cuenta a la vista. El enlace (`?bwh=…&bload=…&bdod=…`, más `bspec`, `bkg` y `dry` si se dan) y el historial guardan la batería, no solo sus horas.

**Orientación del panel solar (#254).** En el paso 2, «Orientación del panel solar» dice cómo va montado: seguidor de dos ejes (por defecto, lo que se calculaba antes), vertical giratorio u horizontal fijo, las tres que conoce el motor (`panel` de `/v1/rank`, `backend/src/panel.ts`: factor 1, cos(el) o max(0, sen(el)), con `el` la elevación del Sol). Las tres naves de ejemplo llevan paneles verticales en los costados, como los landers polares, y declaran «Vertical giratorio», la orientación más cercana del motor. Un panel vertical fijo, sin giro, no está modelado y no se ofrece. Bajo el resultado, «Energía del panel» da la `meanSunDiskFraction` de `/v1/rank` para el sitio, el aterrizaje, los días y las alturas del plan, con ese panel y, si no es el seguidor, también la del seguidor para comparar ([`js/engine/panel.js`](js/engine/panel.js), `loadEnergy` del adaptador y `energy()` del servicio de misión). **Solo informa**: el veredicto es el mismo con cualquier orientación y no hay una regla de energía mínima. La regla C13 de [`js/engine/coherence.js`](js/engine/coherence.js) avisa (nunca bloquea) de un panel horizontal en un sitio a más de 80° de latitud, con la cifra de su latitud: el Sol no sube de 90° − |latitud| + 1,54° y el panel recibe como mucho el seno de esa altura de lo que recibe uno que sigue al Sol (un 3,7 % en la Cresta de conexión de Shackleton, un 9,7 % en Malapert, un 19,8 % en IM-1); cambiar la orientación no repite la búsqueda: solo cambian la energía, el aviso, el enlace y el historial del aterrizaje en pantalla; con «El mejor de la zona» mira el sitio de la zona más lejos del polo. Con el motor simulado la energía no se calcula y el selector lo dice, como las alturas; con misiones de menos de 1 día tampoco (el mínimo de `/v1/rank`). El enlace (`?panel=horizontal`), el historial y el CSV de comparación de sitios llevan la orientación. `test/panel.test.js` prueba la regla, las naves de ejemplo, el enlace, el historial, el CSV y el motor simulado; `test/panel-energy.test.js`, contra la API real, que la energía es la de `/v1/rank` para el mismo sitio, fechas y panel, que con panel horizontal en la Cresta de conexión de Shackleton cae a unos pocos puntos porcentuales y que el veredicto no cambia.

## Punto propio

En «¿Dónde?», además de los sitios del catálogo y «El mejor de la zona», «Punto propio» pide una latitud (−90 a 90) y una longitud (−180 a 180), con coma o punto decimal y el sur y el oeste en negativo; cada campo mal escrito dice por qué debajo y «Siguiente» no avanza hasta que los dos valen (#101). El punto es un sitio más para el servicio de misión: se carga junto al catálogo (solo él, sobre el periodo ya cargado) y da veredicto, cifras, línea de tiempo, reloj y cielo con las mismas reglas; la búsqueda dice cuándo aterrizar allí («Mejor fecha en tu sitio») y enseña como alternativas los sitios de la zona.

- **Qué horizonte usa**: el resultado lo dice bajo la fecha. Con la API y el DEM LOLA en el servidor, su relieve LOLA; con la API sin relieve en ese punto, el de una Luna lisa (sin relieve) (`horizonModel: sphere`), avisado en ámbar porque cerca del polo el veredicto es optimista; sin la API, el relieve inventado de los datos de ejemplo.
- **Enlace**: viaja como `?site=custom&lat=…&lon=…` (`viewpoint/src/core/mission-link.js`). «Ver en 3D» se ofrece si el punto cae dentro de la región de relieve de un sitio del catálogo (a menos de 18 km); «Volver a Planificar» lo trae de vuelta con la misma búsqueda.
- **Avanzado**: entra en «Comparar escenarios», en el grupo «Puntos propios» del selector de cada escenario.
- **Replanificar**: no lo acepta. Su dominio (`planner/src/replan.js`) busca salidas entre los sitios del catálogo; con un punto propio como plan, la vista lo dice en vez de calcular.

## Historial de misiones

Cada plan que se calcula en Planificar se guarda solo en el historial (#246), y el botón «Historial» de la barra superior lo abre desde cualquier vista: la lista de misiones, de la más reciente a la más antigua, con su sitio, su aterrizaje, la nave, los requisitos, la ventana y el veredicto que tenía al guardarse. Pulsar una misión rellena Planificar con sus parámetros, busca de nuevo y deja como plan ese aterrizaje; cada una se puede quitar, y «Borrar historial» vacía la lista.

- **Qué se guarda**: los parámetros, no los resultados. La nave (perfil), los requisitos (días, horas sin Sol, Tierra mínima, cortes de Tierra, tránsito), las alturas del panel y de la antena, dónde (un sitio fijado o «El mejor de la zona»), la ventana de fechas y el aterrizaje elegido. Al abrirla todo se recalcula con los datos de ese momento: si la fuente es otra (API con relieve, sin relieve o motor simulado), el veredicto puede no ser el de entonces.
- **Qué es una misión**: una búsqueda. Mover el aterrizaje o elegir otra alternativa de la misma búsqueda actualiza su entrada; cambiar la nave, los requisitos, las alturas, el dónde o la ventana crea otra.
- **Dónde**: en `localStorage` (`llsn.missions`), es decir, en ese navegador y sin salir de él. Como mucho 20 misiones: al entrar una nueva sale la más antigua. En una ventana privada, o con el almacenamiento bloqueado, el historial dura lo que la visita.
- **Qué no entra**: los puntos propios, escritos en «¿Dónde?» o marcados en el mapa y los cambios hechos en Replanificar que no se llegan a ver en Planificar.

## Datos reales

Las tres vistas piden los datos por el mismo puerto de visibilidad ([ADR 0001](../docs/adr/0001-arquitectura-hexagonal.md)). Con la API de datos (versión 1.2 o posterior) y el DEM LOLA descargado, todo sale con relieve real:

```sh
cd backend && npm ci && node scripts/fetch-dem.ts   # una vez: dependencias y DEM LOLA (~200 MB de descarga)
cd ../data && npm ci && npm start                   # API en http://localhost:3100
```

| En la vista | De dónde sale |
|---|---|
| Orden de los sitios y mejor fecha de cada uno (Planificar y Avanzado) | `/v1/best-landings?terrain=1`: el servidor ejecuta `../planner/src/ranking.js`. Sin la API, el navegador ejecuta el mismo módulo sobre las ventanas del motor simulado |
| Veredictos de una fecha concreta, cifras, calendario y línea de tiempo | `application/mission-service.js`: ventanas de `/v1/windows?terrain=1` evaluadas con `../planner/src/rules.js` |
| Rango entre corchetes junto a las cifras del sitio («Sol 61 % [55–66 %]», en Planificar y Avanzado) | `application/mission-service.js` (`band`): `/v1/windows?horizonBandDeg=0.3` (API 1.18) da además las ventanas con el horizonte 0,3° más alto y más bajo, y la misma misión se evalúa sobre las tres. Con el motor simulado no hay rango |
| «Tierra con antena de la DSN» en las cifras de Avanzado (también de un punto abierto), con su ficha en el modo explicación | `application/mission-service.js` (`earthDsn`): `/v1/windows?dsn=1` (API 1.24, #103) da `earthDsn`, las ventanas con la Tierra visible y la Luna a 10° o más en Goldstone, Madrid o Canberra; la cifra es su parte de la misión. Solo informa: no cambia el veredicto. Con el motor simulado sale «—» |
| Nota «Al sur de 85°S el cálculo es menos fiable…» bajo las cifras del sitio (Planificar y Avanzado), con enlace a «Cómo sabemos que es correcto» | `application/mission-service.js` (`deepPolar`): el aviso `deep_polar_uncertainty` de `/v1/windows?terrain=1` (API 1.23, #437). Solo informa: no cambia el veredicto ni la puntuación. Con el motor simulado no sale |
| Replanificar | `application/replan-service.js`: las mismas ventanas, con `../planner/src/replan.js` |
| Cielo de 360° y misión hora a hora (solo para dibujar) | `/v1/track?terrain=1` y `/v1/horizon` |
| Cielo en 3D (botón 2D / 3D de «El cielo desde el sitio») | Los mismos datos que el 2D y, para el relieve, `/v1/horizon?relief=1` (API 1.19): las alturas LOLA hasta 30 km del sitio. Sin esas alturas (API anterior o servidor sin DEM), solo la silueta del horizonte |
| «Sol al aterrizar» (Planificar) y «Sol en la misión» (Avanzado): elevación del Sol y cuánto le saca al relieve | El mismo cielo hora a hora. Solo informa: avisa en rojo con el Sol a menos de 0,6° sobre el relieve (radio del Sol, 0,27°, más el error del horizonte LOLA, ~0,3°), con paneles verticales que giran la elevación en sí apenas cuenta. Detalle en `js/common/sun-elevation.js` |
| «Si aterrizas desviado» (Avanzado): el mismo aterrizaje en 8 puntos a 500 m, 1 km o 2 km del sitio | `application/mission-service.js` (`around`): `/v1/windows?terrain=1` de cada punto, con su propio horizonte LOLA calculado con el DEM del servidor, y las mismas reglas |
| Detalle de uno de esos puntos (cada punto es un botón; al pulsarlo se abre en el mismo panel que un sitio, con «Volver al sitio» y «Añadir a "Comparar escenarios"») y de cualquier punto del mapa «Polo sur» (fuera de «Comparar escenarios», pulsar un hueco del mapa lo abre igual, en la fecha que se está viendo; el tooltip da sus coordenadas) | `application/mission-service.js` (`point`): `/v1/windows?terrain=1&horizonBandDeg=0.3` del punto, con el margen ante retrasos; el cielo y la pendiente, de `/v1/track`, `/v1/horizon` y `/v1/sun-earth` en sus coordenadas. Con el motor simulado, su relieve simulado |
| «Comparar escenarios» (Avanzado): de 2 a 4 escenarios, cada uno con su sitio (o un punto propio marcado en el mapa) y su fecha de alunizaje | `application/mission-service.js` (`scenario` y `compareScenarios`): las ventanas ya cargadas si el sitio y la fecha están dentro o, si no, `/v1/windows?terrain=1` de ese punto y esas fechas; las mismas reglas, y el servicio dice cuál es el mejor de cada fila |
| Sombras del mapa de Avanzado (tiempo con Sol de cada punto durante la misión) | `/v1/light-map` (API 1.13): el polo cada 10 km y, al acercar, la zona del sitio cada 2,5 km. Unos segundos la primera vez |
| Pendiente de cada sitio de Avanzado (< 10° en 100 m, alunizaje tripulado de Artemis) | `/v1/sun-earth?slope=1&maxSlopeDeg=10` |
| Relieve sombreado de los mapas de Avanzado y Replanificar | `assets/south-pole-relief.png`, sombreado del DEM LOLA, cargado una sola vez por `js/common/map.js` (`reliefImage()`, con el cargador sin DOM de `js/common/relief-image.js`). Se regenera con `node backend/scripts/build-web-relief.ts`. Mientras carga, o si no carga, los mapas dibujan el relieve inventado del motor simulado, y la nota del mapa (Avanzado) y la leyenda (Replanificar) lo dicen: «relieve LOLA», «relieve LOLA · veredictos simulados» (con el motor simulado; si aún no se sabe de dónde vienen los veredictos, solo «relieve LOLA»), «cargando el relieve…» o «relieve inventado: …» (`js/common/relief-note.js`) |
| «Cómo sabemos que es correcto» (Fuentes de datos): errores medidos frente a JPL Horizons y a los productos de PGDA | `assets/validation-summary.json`, calculado a partir de los fixtures del repo. Se regenera con `cd data && npm run validation-summary -- --write`; la vista no lleva ninguna cifra escrita a mano y no lee `knownDiscrepancies` (la pestaña no remite al repositorio ni enseña la tabla de discrepancias; esas filas siguen en `VALIDATION.md`) |

### Altura del panel y de la antena

El formulario de la misión (en Planificar, y en el panel lateral) tiene dos campos: la altura del panel solar y la de la antena, en metros sobre el suelo. Por defecto, 2 m las dos, lo que la API usaba hasta ahora (`observerHeightM`). El Sol se mira desde el panel y la Tierra desde la antena, cada uno con su horizonte: la web manda `panelHeightM` y `antennaHeightM` (API 1.6) a `/v1/windows`, `/v1/track`, `/v1/best-landings` y `/v1/light-map`, y las tres vistas, Replanificar incluida, usan las mismas. En una cresta, unos metros cambian el resultado: en la cresta de Shackleton, con el panel a 20 m en vez de a 2 m, del 1 al 20 de abril de 2027 pasa de 119 h de Sol a 282 h.

Las alturas no son un umbral, son otros datos de visibilidad: se aplican al volver a buscar, y las ventanas se guardan por pareja de alturas (el rango que se pide a los servicios las lleva). Solo las usa la API con relieve. Con el motor simulado, o si el servidor no tiene el DEM, no cambian nada y la interfaz lo dice junto a los campos y en el resumen de la misión de Avanzado.

### Exportar a CSV

Avanzado descarga dos ficheros, con un botón junto a cada dato:

| Botón | Qué lleva |
|---|---|
| «Descargar CSV», en «La misión, hora a hora» | Una fila por hora del aterrizaje que se está viendo: azimut, elevación y relieve del Sol y de la Tierra (lo que dibuja la gráfica) y si se ven según las ventanas del veredicto |
| «Descargar la comparación (CSV)», sobre el top 3 | Una fila por sitio de la búsqueda, en su orden y en su mejor fecha: veredicto, motivo, puntuación, cifras, margen, pendiente y la misión con la que se calculó, con la orientación del panel (#254) |

El formato es el mismo en los dos (`js/common/csv.js`): cabeceras en español con su unidad, UTF-8 con BOM para que Excel respete las tildes, celdas separadas por `;` con coma decimal (lo que abre un Excel en español con doble clic; en otras herramientas, importar con separador `;` y decimal `,`), fechas en UTC ISO 8601 y `sí` / `no`. Cada fila dice las alturas y de dónde salen los datos (API con relieve, API sin relieve o motor simulado).

Un astro cuenta como visible con el disco entero sobre el relieve (`mode=full`, el de `planner/`). Las coordenadas de los sitios salen del catálogo del backend (ver «Sitios»), salvo las de los tres ilustrativos, que son aproximadas: con relieve real, en una cresta unos metros cambian el resultado.

## Sitios

Hay un solo catálogo: el de [`../backend/src/sites.ts`](../backend/src/sites.ts), con las coordenadas comprobadas y la fuente de cada una (validadas en [`../backend/VALIDATION.md`](../backend/VALIDATION.md)). La web lo lee de [`data/sites.json`](data/sites.json), un fichero estático para que la lista salga también sin la API (en GitHub Pages). Lo genera [`scripts/build-sites.mjs`](scripts/build-sites.mjs) importando `sites.ts`; después de tocar `sites.ts`, regenéralo y súbelo con el cambio:

```sh
node web/scripts/build-sites.mjs
```

`test/sites-json.test.js` falla si el JSON no está al día con `sites.ts`, o si un sitio del backend no tiene sus datos de la web.

Lo que solo usa la web está en [`js/engine/catalog.js`](js/engine/catalog.js) y se une por id: el nombre corto, la nota, el nombre en español cuando el del backend no lo está (Apolo) y el grupo de los selectores, que sale del `program` del backend (Polo sur · zonas de Artemis, CLPS y misiones comerciales, Apolo, Otros países). Dos sitios son **casos de control** (#102, `CONTROL_CASES` de `catalog.js`): Chang'e 4, en la cara oculta (la Tierra nunca se ve), y Apolo 15, en la cara visible lejos del polo (Tierra siempre, Sol la mitad del tiempo). Llevan `control` y en «¿Dónde?» dicen por qué están; «Cómo sabemos que es correcto» (Fuentes de datos) tiene la tabla «Casos de control», con el polo sur exacto, qué tiene que salir en cada uno y, para Chang'e 4, la fuente de sus coordenadas (LROC). `offMap` no se escribe a mano: un sitio a más de 190 km del polo sur (el radio del mapa polar) está fuera del mapa, de «El mejor de la zona» y del relieve inventado del motor simulado. Ahí también están los tres sitios ilustrativos que el backend no tiene (la ladera de la cresta, Malapert y de Gerlache), marcados con `approximate: true` y «Coordenadas aproximadas» en «¿Dónde?»: se quedan porque tienen relieve LOLA en `viewpoint/data/` y dan a la búsqueda de la zona y a Replanificar alternativas cercanas.

Los ids viejos siguen abriendo (`js/engine/site-ids.js`, en los enlaces `?site=` y en el historial): `connecting-ridge` es ahora `shackleton-rim`, con las coordenadas del backend (la cresta de conexión, ~300 m de las aproximadas de antes, que caían fuera de la cresta; #94), y `mouton` (aproximado) es `im2-objetivo`.

## Reparto

| Zona | Ficheros | Responsable |
|---|---|---|
| **Planificar** | `js/views/plan.js`, `styles/plan.css`, sección `view-plan` de `index.html` | REVISAR |
| **Avanzado** | `js/views/advanced.js`, `styles/advanced.css`, sección `view-advanced`, y el mapa (`js/common/map.js`) | REVISAR |
| **Replanificar** | `js/views/replan.js`, `styles/replan.css`, sección `view-replan` | Asier Alba |
| Común | `js/common/*` (excepto el mapa), `js/engine/*`, `js/app.js`, `styles/base.css`, `styles/tour.css`, `styles/sources.css`, `js/views/sources.js` | Los tres: se cambia en un PR que revisen todos |

Cada uno toca solo lo suyo. Si necesitas algo común (un campo nuevo en el estado, un cambio en la regla de viabilidad, un gráfico compartido), va en un PR aparte y pequeño.

## Estructura

| Fichero | Qué hace |
|---|---|
| `js/app.js` | Arranque: navegación por `#hash`, `render()`, cursor de tiempo de la misión y modo explicación |
| `js/common/state.js` | Estado compartido, misión del panel lateral y evaluación de todos los sitios |
| `js/common/custom-site.js` | Punto propio de Planificar (#101), sin DOM y con tests: lee y valida las coordenadas y crea su sitio (el mismo objeto para las mismas coordenadas) |
| `js/common/adopt.js` | Fija una opción como plan: desde Planificar o Avanzado es el plan original; desde Replanificar cambia solo el vigente |
| `js/common/mission-history.js` | Historial de misiones (#246), sin DOM y con tests: qué es una entrada, cuándo se actualiza y cuándo se añade, el tope y la lectura de `localStorage` |
| `js/common/history-panel.js` | «Historial» de la barra superior: pinta la lista en un diálogo modal y dice a Planificar qué misión abrir |
| `js/common/sidebar.js` | Panel lateral: misión y lista de sitios |
| `js/common/map.js` | Mapa del polo sur: relieve, capa de luz o Tierra, sitios y puntos propios |
| `js/common/charts.js` | Cielo de 360° y línea de altura sobre el relieve |
| `js/common/sky-view.js` | «El cielo desde el sitio» con su conmutador 2D / 3D (Planificar y Avanzado). El 2D es el de siempre y el de por defecto; si no hay WebGL, vuelve al 2D y lo dice. El icono ⤢ abre el visor 3D del Mirador en el mismo sitio e instante, a pie |
| `js/common/sky3d.js` | El cielo en 3D: el relieve alrededor del sitio con el Sol y la Tierra, con three.js (se descarga solo al pedir el 3D). El suelo es el del Mirador (#393): su material con el regolito ilustrativo (`createTerrainLook` de `viewpoint/src/terrain-material.js`) y su tono ACES a 0,85; el detalle va en el plano del suelo, así que la altura ×3 no lo estira, y solo añade lo que los anillos del relieve no resuelven (`cellPerKm` de `sky3d-geometry.js`). Solo dibuja y responde a sus controles; los botones los pone quien lo enseña |
| `js/common/viewer-link.js` | El enlace al visor 3D del Mirador para un sitio o un punto propio: «Ver en 3D» y el icono ⤢ del cielo, que lo abre en el instante del cursor y a pie (#130) |
| `js/common/sky3d-geometry.js` | La geometría del 3D, sin three.js ni DOM (con tests): la malla del relieve, recortada a la máscara del horizonte |
| `js/common/explain.js`, `explanations.js` | Modo explicación y sus textos |
| `js/common/tour.js` | Tutorial de la primera visita a cada vista: los pasos de cada una |
| `js/common/tour-memory.js` | Lo que el tutorial recuerda en `localStorage`: qué se ha visto y si se han apagado los tutoriales automáticos |
| `js/common/tour-engine.js` | El motor del tutorial (foco y bocadillo). Solo depende de `tour-memory.js`: lo usan también otras pantallas, como [`../home/`](../home/), junto con `styles/tour.css` |
| `js/common/util.js` | Formatos y acceso al DOM |
| `js/theme-init.js` | Pone el tema en `<html>` antes de pintar, para que no parpadee (script clásico en `<head>`) |
| `js/common/sky.js` | El cielo de estrellas del fondo (apagado: el fondo es la superficie de la Luna) |
| `js/common/csv.js` | Formato de los CSV que descarga la web y la descarga en sí |
| `js/common/sun-elevation.js` | Elevación del Sol para los paneles: umbral de Sol bajo sobre el relieve y media y mínimo de la misión (#69) |
| `js/engine/model.js` | Modelo **falso**: efemérides, relieve, horizonte, métricas y veredicto |
| `js/engine/search.js` | Puente a `../planner/src/ranking.js`: las prioridades y los motivos de un aterrizaje |
| `js/engine/catalog.js` | Sitios (los de `data/sites.json` más lo que solo usa la web, ver «Sitios»; sus textos en `js/i18n/common.js`), perfiles de misión y fuentes de datos |
| `js/engine/panel.js` | Orientación del panel solar (#254): las tres del motor, su nombre y su factor, y cuándo un panel no sirve en el polo. Puro, con tests |
| `js/engine/site-ids.js` | Ids viejos de sitios → el id de ahora, para enlaces e historial |
| `js/engine/coherence.js` | Coherencia de los requisitos de la nave (#252): las reglas C0–C13, sus umbrales con su fuente y qué bloqueos se pueden saltar. Puro, con tests |
| `js/ports/visibility.js` | Puerto: de dónde salen las ventanas de Sol y de Tierra de un sitio ([ADR 0001](../docs/adr/0001-arquitectura-hexagonal.md)), y las alturas del panel y de la antena con las que se piden |
| `js/adapters/visibility-api.js` | Adaptador sobre la API de datos: pide `/v1/windows` con relieve (`terrain=1`) por coordenadas, a través de `../planner/src/api.js`. Los rangos de más de 366 días los pide por tramos |
| `js/adapters/visibility-fake.js` | Adaptador sobre el motor simulado: lo muestrea cada 30 min y lo convierte en ventanas. Es la alternativa si la API no responde |
| `js/application/mission-service.js` | Servicio de Planificar y Avanzado: precarga las ventanas y responde con las reglas de `../planner/src/rules.js` (veredictos, búsqueda, calendario, línea de tiempo y los puntos alrededor de un sitio) |
| `js/application/csv-export.js` | Qué lleva cada CSV: la misión hora a hora y la comparación de sitios |
| `js/application/replan-service.js` | Servicio de Replanificar: precarga las ventanas y responde con el dominio (`../planner/src/replan.js`) |
| `js/views/advanced-scenarios.js` | El segundo modo de Avanzado, «Comparar escenarios». Es parte de esa vista: solo lo importa `advanced.js` |
| `js/views/*.js` | Una vista por fichero: `plan`, `advanced`, `replan` y `sources`. `replan` ya no usa `engine/`: pide al servicio |

Para evitar dependencias circulares, las vistas no se importan entre sí: piden un repintado con `actions.render()` de `state.js`, y `app.js` conecta esa acción. `app.js` es también la raíz de composición: elige el adaptador de visibilidad y se lo da al servicio de Replanificar.

## El cielo en 3D

El bloque «El cielo desde el sitio» de Planificar y del detalle de Avanzado tiene un conmutador **2D / 3D**. El 2D es el de por defecto. El 3D enseña lo mismo desde los ojos del observador: el relieve alrededor del sitio, y el Sol y la Tierra en el acimut y la elevación del instante del cursor de la misión.

- **Mismos datos que el 2D**: la serie hora a hora y la máscara del horizonte del servicio de misión (`sky`), más el relieve del puerto (`loadRelief`): con la API, las alturas LOLA de `/v1/horizon?relief=1`, tomadas sobre los mismos círculos máximos que recorre la máscara; sin la API, el relieve del motor simulado.
- **El relieve tapa lo mismo que el 2D**: la malla tiene un radio por grado de acimut, como la máscara. Cada vértice se recorta a la máscara de su acimut y, en el borde (30 km), una pared sube hasta ella: es el relieve más lejano, del que solo se conoce la silueta. Así, el perfil de la malla es la máscara, grado a grado (`test/sky3d-geometry.test.js`).
- **Altura ×3** por defecto, solo en el 3D (el 2D estira su eje vertical según el tamaño de la ventana, sin un factor fijo, y por eso dice «altura no a escala»): todas las elevaciones (relieve, Sol y Tierra) se multiplican por lo mismo, así que no cambia qué tapa a qué. En la vista ampliada, «Altura real» pasa a escala real y «Altura ×3» vuelve; la nota del bloque dice cuál está puesta.
- **Luz**: no hay sombras proyectadas. El Sol ilumina la escena según la parte de su disco que asoma sobre el relieve en el sitio; con el Sol tapado quedan el rebote de las laderas iluminadas (desde el lado contrario al Sol) y la luz tenue de la Tierra, para que el relieve que lo tapa no se pierda en el cielo negro (`test/sky3d-shade.test.js`). Los colores e intensidades de la luz y el color del suelo son los del Mirador y la cabina del juego (`shared/render/lighting.js`, #339), con la curva de tonos ACES; solo la exposición es propia. La luz llega desde la elevación real del Sol y de la Tierra, aunque la altura esté ×3: estirar el dibujo no ilumina más el suelo llano (`test/sky3d-light.test.js`).
- **Manejo en el bloque**: solo «Sol» y «Tierra» (miran hacia cada astro) y «Ampliar». Arrastrar o las flechas giran la vista, y `+` y `−` acercan, con el foco en el dibujo.
- **Vista ampliada** («Ampliar»): un diálogo modal casi a pantalla completa (completa en el móvil) con todos los controles: «Sol», «Tierra», girar (◀ ▶, arrastrar o las flechas), zoom (`+` `−`), «Altura ×3» / «Altura real» y el reproductor de la misión, que es el mismo cursor de la vista: moverlo allí lo mueve aquí. No se crea otra escena ni se piden datos otra vez: el dibujo del bloque (el mismo canvas y el mismo renderer) pasa al diálogo mientras está abierto y vuelve al cerrarlo. Se cierra con Esc, con «Cerrar» o pulsando fuera, y el foco vuelve a «Ampliar». Todo se alcanza con el teclado.
- **Sin WebGL** (o si no se puede descargar three.js, que viene de un CDN como en `viewpoint/`), vuelve al 2D con un aviso y «Ampliar» no aparece. Solo usa materiales estándar de three.js, sin shaders propios ni mapas de sombras.

## Qué sigue siendo falso

En el mapa lateral, y en todo si la API no está arrancada, lo mismo que en el prototipo: el relieve, las efemérides y las coordenadas son aproximados. Ver [`../prototipo/README.md`](../prototipo/README.md). El motor (`js/engine/`) es lo que se sustituirá por la API de [`../data/`](../data/) y el evaluador de [`../planner/`](../planner/).

Con la API, las tres vistas usan efemérides reales. El relieve solo se aplica si el servidor tiene el DEM LOLA en caché (`node backend/scripts/fetch-dem.ts`); si no, el horizonte es el de una Luna lisa (sin relieve) y, cerca del polo, los veredictos son optimistas.

## Design system

El aspecto está centralizado en un design system básico, sin build. Es zona común: se cambia en PR revisado por los tres.

| Fichero | Qué contiene |
|---|---|
| `styles/tokens.css` | Colores, tipografía, espacios, radios y capas. Si cambias un token semántico (`--color-*`, `--space-*`…), cambia toda la web, gráficos incluidos |
| `styles/components.css` | Componentes: botón, caja, campo, insignia, métrica, cifras, leyenda, reproductor, opción, lista, tabla, gráfico, puntos, vacío y pestañas |
| `js/common/ui.js` | Los mismos componentes como funciones que generan HTML (`UI.verdict(v)`, `UI.figures([...])`…) |
| `js/common/theme.js` | Lee los tokens para los canvas (`theme().sun`), traduce cada veredicto a su tono y lleva el botón de modo claro u oscuro |
| `design-system.html` | Catálogo con todo lo anterior: <http://localhost:4542/web/design-system.html> |

`base.css` importa `tokens.css`, así que cualquier página que enlace `base.css` recibe los tokens. Las cuatro vistas y el laboratorio `motion/` usan ya estos componentes. Guía de uso, recetas y equivalencias con los nombres antiguos: [`styles/README.md`](styles/README.md).
