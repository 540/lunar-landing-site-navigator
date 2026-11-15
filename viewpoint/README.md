# viewpoint/ · Mirador del Polo Sur

Pantalla 3D del polo sur de la misión 02 de la portada. Tiene dos puertas (glosario y decisiones en [`docs/arquitectura-tour.md`](../docs/arquitectura-tour.md); qué construir, en el [desglose](../docs/desglose-tour-lunar.md)):

- **Exploración** (`/viewpoint/`): el relieve LOLA de la región con el Sol y la Tierra reales, la línea de tiempo y el panel «Luz y Tierra en la bandera» (E1, #121).
- **Visor de misión** (`/viewpoint/?site=…&t0=…&days=…`): lo abre «Ver en 3D» del simulador y reproduce la misión con el estado del veredicto. El icono ⤢ del cielo de Planificar y Avanzado lo abre con `&at=<ISO>` (el instante del cursor, dentro de la misión) y `&view=foot` (a pie, junto al lander; «Subir al dron» vuelve a la vista de siempre).

```
index.html     la pantalla (se publica tal cual en /viewpoint/)
src/           código: main.js (elige la puerta), mission.js (visor), scene.js, lost.js (aviso de 3D no disponible), region.js, texts.js y texts.en.js;
               «Luz y Tierra en la bandera» (E1): sky-panel.js (el panel) y sky-labels.js (etiquetas del Sol y la Tierra, también del visor);
               terrain-material.js (aspecto de regolito del suelo: grano y cráteres ilustrativos, #393);
               a pie (E3): foot-view.js (cámara y controles, la monta scene.js), foot-ui.js (botón, brújula, joystick),
               suit-body.js (tu traje), watch-ui.js (reloj) y gesture-ui.js (tus gestos con la cámara)
src/core/      funciones puras (SceneFrame, serie, relieve, línea de tiempo, enlace con el simulador;
               sky-state.js y horizon-ring.js de E1, que comparten el panel y el reloj; a pie: foot-camera.js, walk.js con la física lunar, compass.js, el rig del traje y el seguimiento de gestos)
src/styles/    estilos de la pantalla
data/          regiones generadas por pipeline/ (relief.mjs, ephemeris.mjs, horizon-mask.mjs)
tests/         tests (node --test)
```

Si el 3D falla (no se puede crear el contexto WebGL o se pierde), en las dos puertas sale el aviso `#glost` en vez de una pantalla negra: «La vista 3D no está disponible en este equipo o se ha detenido.», enlaces a la portada y al simulador de misiones y un botón «Recargar». Es el mismo aviso que el de la portada, con su lógica en `shared/render/lost-notice.js`; `src/lost.js` le pone los textos y se lo pasa a `createScene`. Si el contexto se recupera, el aviso se va y la escena se vuelve a pintar. Las estrellas salen de `shared/render/stars.js`, como las del cielo 3D del simulador, de la cabina del juego y del lander, y bajan por debajo del horizonte hasta pasar el borde del anillo lejano visto desde lo más alto del dron (`src/core/star-floor.js`, #340): así no queda una franja negra entre el cielo y el relieve. Solo dentro de una sesión de realidad virtual (#396) las sustituye el catálogo Yale BSC5 (`src/star-field.js`, `assets/stars-bsc5.bin`), que no se descarga hasta entrar en VR.

La PS VR de PS4 (WebHID, `src/psvr.js`) es experimental: su botón solo existe con `?psvr=1` en la dirección.

`web/` importa de aquí `src/core/mission-link.js` (enlace «Ver en 3D» de ida y vuelta) y `src/core/direction.js` (cielo 3D).

## Luz y Tierra en la bandera (E1, #121)

Responde a las dos preguntas del reto para el punto de la bandera: ¿hay luz? y ¿se ve la Tierra?, ahora y en los 60 días de la línea de tiempo. Todo sale de `data/<región>/series-2027.json` (`visibleFraction`, que el motor ya calculó con la máscara LOLA) y de `data/<región>/mask.json` (la máscara del catálogo, que copia `pipeline/horizon-mask.mjs`). El cliente no recalcula la visibilidad ni importa nada de `backend/`.

- **Anillo del horizonte** (E1.1, E1.2; `src/core/horizon-ring.js`): el horizonte de 360° visto desde arriba, con el norte arriba y el este a la derecha (azimut de la API). Cuanto más cerca del centro, más alto: la escala es `asinh`, así que alrededor de 0° cada grado ocupa mucho y el Sol de la Cresta, que apenas sale de ±2°, se lee. El perfil son los 720 azimuts de la máscara, sin remuestrear. Encima, el Sol y la Tierra en el instante elegido, su recorrido en los 60 días (apagado donde el relieve los tapa; el de la Tierra muestra la libración) y la cuña de lo que enseña la cámara.
- **Estados y cuenta atrás** (E1.1, E1.2, E1.4; `src/core/sky-state.js`): «Sol a la vista» (`visibleFraction` ≥ 0,99), «a medias» (> 0) o «tapado» (0); «Tierra a la vista» (> 0) o «tapada». La cuenta atrás es la próxima puesta (o salida) dentro del periodo, con media hora de error como mucho; si no la hay, lo dice. Las etiquetas «Sol» y «Tierra» de la escena (`src/sky-labels.js`, compartido con el visor de misión) llevan el estado y la cuenta atrás. El estado se anuncia por la región `aria-live` de la línea de tiempo.
- **Barras del periodo** (E1.3, `periodMetrics`): las métricas de `RankResult.metrics` de la API (`meanSunDiskFraction`, `sunTimeFraction`, `earthTimeFraction`, `sunAndEarthTimeFraction`, `longestNightHours`, `longestEarthOutageHours`) con las reglas del motor: una muestra por hora con los dos extremos, visible si `visibleFraction` > 0. Se ven «Luz solar», «Tierra a la vista» y las dos rachas más largas. Se recalculan al cambiar la fecha de inicio (menos de 1 ms).
- **Paridad** (`tests/sky.test.js`): estados en instantes de 2027, perfil de 720 azimuts, métricas frente al caso de uso de ventanas del motor con relieve (`visibilityWindows` y `evaluatePeriod` de `backend/src/useCases.ts`, como `/v1/windows?terrain=1`) y próxima puesta frente a `nextSet`. Solo los tests importan el motor; necesitan `npm ci --prefix backend`, no el DEM.
- **Sin datos**: una región sin serie no enseña anillo ni barras y lo dice; con serie y sin máscara, enseña los estados y las barras y dice que no hay anillo.
- **Diseño**: el panel se pliega con su cabecera (abierto en pantallas anchas, plegado en el móvil, y recuerda la elección); plegado, dos puntos dicen el estado del Sol y la Tierra. En el móvil, con el panel abierto, la columna de botones de la derecha (bajar a pie, zoom) se aparta hasta plegarlo (pellizcar sigue acercando), y a pie el panel no sale: lo dice el reloj de muñeca (R, ⌚), que usa las mismas funciones puras (`core/watch.js` sobre `core/sky-state.js` y `core/horizon-ring.js`) y la misma `mask.json` (`loadMask` de `src/region.js`).
- **En la escena**: la exploración coloca la Tierra también desde el dron (`setExploreEarth` de `scene.js`, solo el globo: la luz de relleno es del visor de misión), y el Sol y la Tierra se ven apagados cuando la serie dice que el relieve los tapa. Las etiquetas se colocan con `labelPlacement` (`src/core/sky-labels.js`): sobre su disco si caben y, si no, enteras en el borde con una flecha, sin pisar la barra superior, el título ni la columna de botones de la derecha; si se juntan, la segunda baja. En el móvil llevan solo el nombre (la cuenta atrás se queda en el panel). La cuña del anillo sale de `heading()` de `scene.js`, la dirección de la cámara, así que sigue también la vista a pie.


## Mover la bandera (E2.2, #486)

- **Arrastrar** (solo desde el dron): `pointerdown` sobre la bandera (rayo a su malla, con un cilindro invisible más grueso para acertar), `pointermove` con rayo al terreno y la bandera sigue al puntero; los controles de cámara se apagan mientras dura. `scene.js` mueve con ella la bandera, el astronauta y los dos cohetes (el del dron y el de a pie); «Restablecer» sigue devolviendo solo la cámara.
- **Límite:** no sale del cuadrado de la rejilla de máscaras (`meta.maskGrid.extentKm`); fuera, se queda en el borde (`clampToGrid`, `src/core/flag-drag.js`).
- **Cifras:** mientras se arrastra (como mucho una vez por fotograma), con la máscara del punto de la rejilla más cercano; al soltar y con las flechas, con la máscara interpolada del punto (`maskAt`). `seriesOverMask` recalcula `visibleFraction` del Sol y la Tierra con `discFraction` sobre el `az` y el `el` de la serie y los radios aparentes medios (Sol 0,267°, Tierra 0,95°; la serie no trae el radio), y el panel (`setSource` de `sky-panel.js`) redibuja perfil, recorridos, estados, cuenta atrás y barras con `periodMetrics`, `fractionAt` y `nextChange` tal cual.
- **Latitud y longitud** (`fromScene`), debajo de las barras, en grados y con la longitud este positiva.
- **Teclado:** el botón «Mover la bandera» junto a la lectura; con el foco en él, las flechas mueven la bandera 100 m (un paso de la rejilla) y la región `aria-live` (`flag-status`) anuncia las cifras nuevas; Escape o Tab devuelven las flechas a la cámara.
- **Sin rejilla** (región sin `maskGrid`, o mientras se descarga): no se arrastra y una nota corta lo dice.

## Opciones (E8.2, #498)

El botón «Opciones» de la barra superior (o la tecla O) abre un cajón no modal, `<dialog>` abierto con `show()`, con cuatro grupos: **idioma** (el conmutador ES / EN de `shared/i18n/page.js`, montado dentro), **región** (el selector y «Ver región», solo en la exploración), **calidad gráfica** (automática, alta, media y baja) y **capas** (panel de luz y Tierra, rótulos del cielo y detalle del suelo). Esc lo cierra y devuelve el foco al botón; el cajón no cuenta como modal en `modalOpen`: sus controles ya son de formulario (`isFormTarget`) y, al volver al lienzo, la cámara y los atajos siguen respondiendo. Tras «Ver región» y la recarga, el cajón se abre y el foco vuelve al selector.

- `src/core/options.js` (puro): estado guardado en `localStorage` (`llsn.viewpoint.options`) con valores por defecto si falta o está corrupto, `forcedLevel` y la regla de la tecla O. `src/core/options-drawer.js`: abrir, cerrar, foco y teclas. `src/options-ui.js`: textos y controles.
- **Calidad:** un nivel forzado entra a `resolveQuality` como `stored` (`scene.js`), así que `?q=` de la dirección sigue mandando y «automática» es el comportamiento de siempre. Cambiarla recarga la vista.
- **Capas:** el panel y los rótulos se apagan con una clase en `<body>` (`layer-off-panel`, `layer-off-labels`) y el detalle del suelo con `view.ground.setMicro`, igual que el botón «Textura fina», que sigue la casilla.
- En el visor de misión el cajón no tiene el grupo de región ni la capa del panel.

## Visita guiada (E6.1, #493)

Botón «Empezar la visita» en la exploración (no en el visor de misión), junto al del tutorial; el tutorial y la visita no se abren a la vez. Cada capítulo pregunta, deja apostar («Enséñamelo sin apostar» también vale), lo demuestra en la escena y vuelve la bandera al sitio de la región al cambiar de capítulo. Cada capítulo empieza desde el sitio; al salir, la bandera y la fecha vuelven a donde las tenía el visitante. Con la visita abierta, el arrastre de la bandera, «Mejor punto cercano» y la fecha de inicio quedan desactivados (con su motivo) y vuelven al salir.

- **Capítulos como datos** (`src/visit-chapters.js`): id, región, fecha UTC de inicio (dentro de `series-2027.json`), vista, `minDifference` (el cambio mínimo de luz que el capítulo sabe calificar; si ningún punto cercano llega, lo dice y no califica), opciones con su umbral `from` (la correcta es la de mayor umbral que alcanza la diferencia medida entre el sitio y el punto elegido) y acción. Los textos (título, pregunta y revelación en los tres niveles, opciones) están en `visit.chapters[id]` de `src/texts.js` y `src/texts.en.js`. Añadir un capítulo es añadir una entrada y sus textos; el motor no cambia. El botón solo sale en las regiones con algún capítulo.
- **Motor puro** (`src/core/visit.js`): estado (capítulo, fase «pregunta», «apostado» o «revelado», nivel, origen de la bandera) y transiciones (`bet`, `reveal`, `previous`, `next`, `setLevel`, `exit`); `flagTarget` dice dónde debe estar la bandera (en el destino solo mientras está revelado, si no en el origen).
- **Tarjeta** (`src/visit-ui.js`): pregunta, opciones, acierto o fallo dicho con texto, revelación, puntos, «Anterior», «Siguiente», «Plegar» y «Salir». Escape desde la tarjeta la pliega y, plegada, sale; al salir el foco vuelve al botón. Los cambios se anuncian en la región `aria-live` `visit-status`. Con «reducir movimiento» la bandera salta (`place` de `src/flag-ui.js`). El nivel (principiante, intermedio o experto) cambia el texto, no la mecánica, y se recuerda en `localStorage` (`viewpoint-visit-level`).
- **«Mueve la bandera»** (`shackleton-rim`, 15 ene 2027, 60 días): `pickContrastPoint` (`src/core/visit-point.js`) elige, de la rejilla de máscaras, el punto a menos de 500 m de la bandera con mayor diferencia de tiempo con Sol; las cifras de la revelación son `periodMetrics` sobre la serie con la máscara de cada punto, las mismas que las barras. Sin rejilla (no existe o aún no ha cargado) el capítulo lo dice y no se puede revelar.
- **«Sombras de kilómetros»** (E6.2, vista a pie): el instante es el de mayor elevación del Sol entre las muestras con el Sol a la vista (`pickShadowInstant`, `src/core/visit-figures.js`; el más temprano si hay empate); la longitud es `L = h / tan(elevación)` con h = 1 km (`shadowLengthKm`). La visita lleva la línea de tiempo a ese instante, baja a pie junto a la bandera y mira al azimut del Sol + 180°. El nivel experto enseña la fórmula con el ejemplo de 1,5° (≈ 38,2 km).
- **«Llamar a casa»** (E6.2, vista a pie): las cifras son `periodMetrics` del periodo (`earthTimeFraction`, `longestEarthOutageHours`). Baja a pie, mira a la Tierra en el primer instante en que se ve y deja correr el tiempo a la velocidad más alta hasta que el relieve la tapa (o dos días si no la tapa); la mirada la sigue (`timeChanged`). Con «reducir movimiento» salta al final.
- **«Tú decides»** (E6.2, cierre sin calificar, `options: []`): el visitante mueve la bandera (arrastre o teclado; `setLocked(motivo, { move: true })` de `src/flag-ui.js`) y pulsa «Comprobar»; se compara `scoreAt` de su punto con `findBestPoint` (`compareWithBest`), con `improvement` y el botón «Llevar la bandera al mejor punto». Al revelar se bloquea el arrastre.
- Cada capítulo dice qué mide con `measure` (`'sun-difference'` por defecto, `'shadow-km'`, `'earth-time'`) y `rightOption` se usa igual sobre ese valor; `minDifference` solo aplica a `'sun-difference'`. Al cambiar de capítulo o salir se restauran la vista (si la visita bajó a pie, sube), la fecha, la reproducción del tiempo y la bandera.
- Fuera de alcance: los capítulos de Athena y del ecuador, la serie de 2025 y el modo clase.

## Vuelo entre el dron y el suelo (E7.1, #496)

«Bajar a pie» y «Subir al dron» ya no cortan: la cámara vuela en arco (1,5 s) entre la pose del dron y los ojos junto a la bandera, y al revés (`src/core/flight.js`, puro: `flightPose`, `flightMode`, `flightScale`, `createFlightLock`). El arco no baja del suelo más 1 m (`groundAt`); el plano cercano cambia en progresión geométrica, la bandera se encoge en progresión geométrica y el astronauta, los cohetes y el anillo cambian a mitad de camino. Durante el vuelo no hay controles de cámara ni de andar y una segunda petición se ignora. Con «reducir movimiento» o calidad baja, fundido a negro corto (0,4 s) en lugar de vuelo. En realidad virtual y PS VR no hay vuelo, y el visor de misión que abre a pie (`&view=foot`) entra de golpe. El foco y `#foot-status` siguen al terminar.

## Accesibilidad básica (E8.3, #499)

Comprobado (`tests/a11y.test.js`):

- **Nombre accesible** en todo `button`, `a`, `input` y `select` de `index.html` (texto visible, `aria-label`, `label` o texto que pinta el script, comprobado sobre el propio elemento; ningún nombre fijo en español queda en `index.html` sin que un script lo repinte y el inglés lo distinga).
- **Foco visible**: una sola regla global `:focus-visible` (anillo claro con halo oscuro, legible sobre la escena negra y sobre el cristal); no hay variantes por control.
- **Contraste AA**: 4,5:1 en el texto del HUD, el panel y la línea de tiempo (también con el cristal sobre el relieve más claro) y 3:1 en los bordes de Sol, Tierra y veredicto y en el borde de los controles (`--control-line`, opaco; el `--line` tenue queda para divisores y contenedores).
- **Área de toque** de al menos 44 × 44 px con `pointer: coarse`.
- **«Reducir movimiento»** en un solo sitio, `src/core/motion.js` (`prefersReducedMotion`): lo consultan la cámara, la bandera, el saludo, el paso a pie y el cambio de región; ningún otro fichero de `src/` usa `matchMedia` para eso.
- **375 px**: sin desplazamiento horizontal; la barra superior, el cajón, la visita y el progreso de región se ajustan al ancho.
- **Teclado**: Tab recorre los controles en el orden del documento; los ocultos llevan `hidden`. Los atajos están en la ayuda de la esquina (cámara: flechas, C; a pie: WASD, Mayús, Espacio, R, F, V, Esc) y no se añade ninguno nuevo para no pisarlos.

Fuera: lectores de pantalla reales en dispositivo, realidad virtual, el planificador y el juego.

## Cualquier sitio y fecha, con la API en directo (E10.2, #508)

La exploración no se queda en las regiones ni en 2027. Si el periodo (`?start=` y 60 días) cabe en `series-2027.json`, se usa lo precalculado y no se llama a la API. Si no cabe (por ejemplo `?region=shackleton-rim&start=2028-03-01`), la pantalla pide a la API pública el cielo del sitio de la región (`/v1/track` y `/v1/horizon`, con el adaptador de `web/js/`, `?api=` para cambiar de servidor), lo convierte en la forma de la serie (`core/live-series.js`) y el anillo, los estados, las barras y la línea de tiempo no cambian. Mientras llega lo dice; si falla o tarda más de 30 s, se queda en 2027 con un aviso, y el motivo sale por el `code` del error, no por su `message`.

`?lat=-88.5&lon=20` (nombres de la API, este positivo) abre un punto sin región: sin terreno 3D, con el cielo y el panel. El anillo usa el horizonte que dé la API.

Toda cifra que no sale de lo precalculado lleva su aviso, con el vocabulario común: «API en directo · relieve LOLA» o «API en directo · Luna lisa (sin relieve) · cifras optimistas». Un cambio de fecha que no cabe en el año precalculado recarga la página con `?start=` y `?day=`, como el cambio de región. Con `?data=fake` no se llama a la API.

## Idioma

Español por defecto e inglés («South Pole Lookout») con `?lang=en`, el conmutador ES / EN de la barra superior o un navegador en otro idioma (`shared/i18n/`). Los textos están en `src/texts.js` (español) y `src/texts.en.js` (inglés, mismas claves; lo que falte sale en español); `useLang()` fija el diccionario en uso (`UI`) al arrancar. Fechas y cifras con el formato de cada idioma. Los nombres de región salen de `meta.name.en` de `data/`; los de sitio y el título del veredicto del visor de misión, del diccionario inglés por id y código, y el motivo del veredicto (que el planificador da en español) se traduce por sus plantillas con `reasonToEnglish`. `tests/texts.test.js` comprueba que el inglés tiene todas las claves con la misma forma.

## Tests

`npm test --prefix viewpoint` (también cuelga de `npm test` en la raíz). Algunos tests generan regiones con `pipeline/relief.mjs` y DEM sintéticos: no hace falta el DEM real.
