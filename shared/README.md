# Código común de las pantallas

Módulos que importan varias pantallas por rutas relativas (`../shared/…`). No es una pantalla: no tiene `index.html`. `serve.mjs` la sirve en `/shared/` y `pages.yml` la copia al sitio.

| Fichero | Qué hace |
|---|---|
| `hands/` | Control con las manos: la cámara del dispositivo sigue una mano que apunta, pulsa y arrastra. `gesture.js` (reglas del gesto, puro), `camera.js` (cámara y MediaPipe), `pointer.js` (puntero, vista previa y clics) y `hands.css`. Lo usan la portada y el Mirador; ver «Control con las manos» |
| `format/` | Números, duraciones y fechas para el usuario (#329, #343), los mismos en todas las pantallas. Cada función recibe el idioma (`es` o `en`). `number.js`: `num(lang, x, max = 1, min = 0)` (coma decimal en castellano y punto en inglés, sin ceros de relleno, «−» (U+2212) en los negativos y miles agrupados también con cuatro cifras: `1234` → «1.234»), `deg` («1,3°»), `pct` («12 %», en inglés «12%»), `km`, `m`, `coords` («89,45° S, 12,3° O»; en inglés «W») y `fmtNum(x, max = 1, lang)`, que sin idioma toma el de la página (`<html lang>`; sin DOM, `es`). `time.js`, siempre en UTC: `days` («2 d»), `hours` (duración en horas enteras sin «0 h»: «5 h», «2 d», «2 d 3 h»), `dayMonth` («15 ene»), `date` («15 ene 2027»), `time` («00:00 UTC»), `dateTime` («15 ene 2027 · 00:00 UTC», la fecha visible única), `dayMonthTime` («15 ene · 00:00 UTC») e `isoDay` («2027-01-15», solo para URLs, ficheros y la API). Los meses salen de `MONTHS`, no de `Intl`, para que septiembre sea «sep» en todas partes. No vale para CSV, URLs, la API, `datetime-local` ni logs, que siguen con punto. Tests en `tests/format.test.mjs`, que además comprueba que ninguna pantalla formatea números o fechas por su cuenta (`toLocaleString`, `Intl.NumberFormat`, `Intl.DateTimeFormat`) ni vuelve a definir los formateadores retirados |
| `i18n/` | Idioma de las pantallas (J10.1, #242; E8, #283). `lang.js` es puro: `LANGS` (`es`, `en`), `STORAGE_KEY` (`llsn.lang`), `pickLang({ query, saved, languages })` (manda `?lang=` de la dirección, luego lo guardado, luego el navegador: `es` si su primer idioma empieza por `es`, `en` en otro caso; sin nada, `es`), `translator(dicts, lang)` (da `t(clave, …)` sobre un par `{ es, en }`: si falta en inglés, el español; si falta en los dos, la clave), `missingKeys`, `withLang(href, lang)` y `formatNumber` / `formatDate` con `Intl` (coma decimal en español, punto en inglés). `page.js` lo aplica en el navegador: `initLang()` (y `<html lang>`), `applyTexts(t)` (rellena `data-i18n`, `data-i18n-html` y `data-i18n-<atributo>`; el HTML guarda el texto en español), `mountLangToggle(host, …)` (el conmutador ES / EN; por defecto recarga la página en el otro idioma) y `carryLang(lang)` (añade `?lang=` a los enlaces relativos al seguirlos, para que la siguiente pantalla abra en el mismo idioma aunque `localStorage` esté bloqueado). Lo usan todas las pantallas |
| `version/badge.js` | Distintivo con la versión del sitio (`vX.Y.Z`) en la esquina inferior izquierda de cada pantalla. Lee `/version.json`, que escribe el build de Pages antes de cada deploy y que `serve.mjs` responde en local; sin él pinta solo el aviso de uso de IA («Hecho con ayuda de IA · Claude Code», #96), que acompaña siempre a la versión. Ver [`tools/version/README.md`](../tools/version/README.md) |
| `render/moon-globe.js` | El globo lunar (G1.2, #140): `createMoonGlobe(renderer, options)` da la esfera y el casquete polar con el material de la Luna, el sombreador del polo (`POLE_DISP`), el material de profundidad de las sombras y la carga de las texturas de `render/tex/` (CGI Moon Kit de NASA SVS: color de 2k y 4k y alturas), con una imagen de reserva si fallan. La textura de 4k la pide quien lo usa, según su nivel de calidad. Necesita three.js por la importmap de la página. Lo usan la portada y la Luna 3D del juego (J8.1) |
| `render/lost-notice.js` | Aviso de 3D no disponible (#144, compartido en G1.2b, #286): `createLostNotice({ notice, loading, roots, fallbackFocus })` lo muestra y lo oculta (el resto de la página, inerte; el foco, dentro y de vuelta), `watchContextLoss(canvas, { notice, deferWhile, onRestore })` lo enseña al perder el contexto WebGL y lo quita al recuperarlo, y `createRendererOrNotice(make, notice)` lo enseña si no se puede crear el renderer. No crea DOM: recibe los elementos. Lo usan la portada (`#glost`) y el Mirador (`viewpoint/src/lost.js`); tests en `tests/lost-notice.test.mjs` |
| `render/stars.js` | El campo de estrellas común de las escenas 3D (G1.2b, #286; #340): el Mirador y la cabina del juego (con `starPoints` de `sky-meshes.js`), el cielo 3D del planificador y el lander. Unas 300 estrellas por estereorradián (`STAR_DENSITY`, `starCount(below)`), brillo `0,25 + r⁴ · 0,75` (`starBrightness`, `starColors`) y semilla 5: siempre las mismas. `starPositions(count, radius, { below })` da las posiciones; `starField(radius, { below, share })`, posiciones y colores (`share`: el recorte de «bajo» en la cabina). `below` es la parte del cielo bajo el horizonte que también lleva estrellas: `belowFor(grados)` la saca de lo más bajo que puede verse cada escena, más 2° de margen (en el Mirador, el borde del anillo lejano desde lo más alto del dron, `viewpoint/src/core/star-floor.js`; en el cielo 3D, lo más bajo de la máscara con ×3, `lowestShownDeg`). La portada, el globo del juego y el fondo 2D tienen las suyas. Cada escena monta su `THREE.Points`. Tests en `tests/stars.test.mjs` |
| `render/sky-bodies.js` | Tamaño aparente del Sol y de la Tierra vistos desde la Luna (#336) y a qué tamaño los dibuja cada vista (#342): `SUN_DIAMETER_DEG` (0,53°), `EARTH_DIAMETER_DEG` (1,9°), `radiusAt(distance, diameterDeg)` (el radio que tiene a esa distancia un cuerpo de ese diámetro aparente) y `sunSpriteWidth(distance, diameterDeg)` (el ancho del *sprite* del Sol para que su núcleo, `SUN_CORE_STOP`, mida ese diámetro). Los aumentos se aplican a los dos astros por igual, así que la Tierra sigue 3,6 veces más ancha: `PLANNER_SKY_MAGNIFY` (×1,5, cielo 3D del planificador, sin el estirado del relieve) y `LANDER_MAGNIFY` (×2, lander). En los gráficos 2D (cielo, Brújula y mapa de Avanzado) Sol y Tierra son marcadores del mismo radio, `BODY_MARKER_RADIUS_PX`, con la nota «Sol y Tierra no a escala». Donde los dos marcadores se solapan (`markersOverlap`, centros a menos de dos radios), la Tierra, que va encima, se pinta como aro sin relleno para que el Sol se siga viendo. En el Mirador y la cabina del juego, a tamaño real, el disco del Sol es un *sprite* propio (`sunDiscTexture` de `sky-meshes.js`) de 0,53°, y su resplandor (`sunTexture`, `SUN_GLOW_SHARE`) se queda como estaba. Lo usan el Mirador y la cabina, el planificador (`web/js/common/sky3d.js`, `charts.js`, `sky-polar.js`, `views/advanced.js`) y el lander (`lander/src/site.js`). Tests en `tests/sky-bodies.test.mjs` |
| `render/lighting.js` | Luz y color del regolito comunes (#339): `REGOLITH` (`#ADAAA3`, albedo de referencia; cada vista puede ajustar su material partiendo de él), `SUN` (`0xfff4e6` a 30), `AMBIENT` (`0xbfc8d6` a 0,05), `BOUNCE` (`0xd8d2c8` a 0,8, desde 35° sobre el horizonte en el lado opuesto al Sol), `EARTH` (`0x9fb8e8` a 0,3) y `TONE_MAPPING` (ACES). Lo usan el Mirador, la cabina del juego y el cielo 3D del planificador, que solo eligen su exposición; la portada solo toma los colores que ya coincidían (Sol y ambiente) y conserva sus intensidades por su banco de render. Las lámparas (casco, faros del rover) no son luz del entorno y siguen en cada vista. Tests en `tests/lighting.test.mjs` |
| `render/three-version.js` | La versión de three.js de todo el sitio (`THREE_VERSION`, `THREE_URL`). `tests/moon-globe.test.mjs` comprueba que todas las importmap usan esa |
| `render/quality.js` | Niveles de calidad del render 3D (`alto`, `medio` y `bajo`), las señales del equipo, el nivel con que arranca, el pixel ratio de cada nivel, los parámetros de calidad de la URL (#142, épica #138), la calibración que mide el equipo y el nivel guardado (#143) y el modo de render, continuo o a demanda, con `settledEased`, que dice si los valores suavizados ya han llegado a su destino (#144), y el ajuste del pixel ratio en marcha (#166). Lo usan la portada, el Mirador (`viewpoint/src/scene.js`), el cielo 3D del planificador (`web/js/common/sky3d.js`, #145) y el mapa del juego de rol (`rolegame/src/map-quality.js`, J4.3, #215) |

Los módulos son puros (sin DOM, sin three.js y sin `window`): todo les llega por argumentos. `render/lighting.js` solo da números. Las excepciones son `render/moon-globe.js`, que construye la escena con three.js y se prueba por su texto, `version/badge.js`, que pinta en la página, y `hands/`, que maneja la cámara y la página; sus reglas, en `hands/gesture.js`, sí son puras. Sus tests están en `tests/` de la raíz (`tests/quality.test.mjs`) y entran en `npm test`. `package.json` solo declara la carpeta como ES modules (`"type": "module"`), para que Node no avise al importarlos en los tests.

## Niveles de calidad

| Clave | `bajo` | `medio` | `alto` |
|---|---|---|---|
| `pr` (pixel ratio máximo) | 1,25 | 1,5 | 2 |
| `shadow` (lado del mapa de sombras) | 2048 | 3072 | 4096 |
| `cap` (rejilla del casquete polar) | 230 | 320 | 460 |
| `tex` (textura de color) | `2k` | `4k` | `4k` |
| `aniso` (tope de anisotropía) | 8 | 4 | 16 |
| `fs` (muestras del promedio polar) | 8 | 16 | 16 |
| `rs` (sombras de los cohetes) | no | sí | sí |

En todos los niveles el pixel ratio, además, no pinta más de 3840 × 2160 píxeles (`MAX_PIXELS`): `pixelRatio` aplica `sqrt(MAX_PIXELS / (ancho × alto))`. Antes solo valía en `alto` y en una pantalla 5K `medio` pintaba más que `alto` (#325).

- **Señales** (`readSignals(gl, nav)`): render por software (el nombre de `WEBGL_debug_renderer_info` o, sin la extensión, el de `gl.RENDERER`; un nombre desconocido no cuenta), `maxTextureSize`, `saveData`, `deviceMemory` y `hardwareConcurrency`, a partir del contexto WebGL y de `navigator`. Una señal que el navegador no da queda `undefined`.
- **Nivel de partida** (`initialLevel`): `bajo` si el render es por software, `maxTextureSize` es menor que 4096, el navegador pide ahorrar datos, o el equipo tiene 4 GB de memoria o menos o 4 núcleos o menos; si no, `alto`. Una señal que el navegador no da no cuenta. `initialLevel` solo da la señal de partida: el nivel lo decide la calibración.
- **Nivel en uso** (`resolveQuality`): primero `?q=alto|medio|bajo` de la URL (`source: "url"`); después el nivel guardado en una visita anterior (`source: "stored"`); si no hay ninguno, el de partida de la calibración, `calibrationStart` (`source: "auto"`): `bajo` en un equipo modesto y `medio` en el resto. Los parámetros del banco (`pr`, `shadow`, `cap`, `tex`, `aniso`, `fs` y `rs`) cambian valores sueltos del nivel; ver [`home/README.md`](../home/README.md), «Calidad del render». Valen igual en `/viewpoint/` (pixel ratio y lado del mapa de sombras) y en el cielo 3D de `/web/` (solo el pixel ratio). `q`, `pr` y `shadow` pasan de Planificar al Mirador con «Ver en 3D» y vuelven con «Volver».

## Calibración (#143)

Con `source: "auto"`, la portada mide el equipo antes de quitar la pantalla de carga y se queda en el nivel que aguanta con fluidez. Las funciones son puras; la medición (frames con sincronización de GPU) la hace `home/index.html`.

**Umbrales** (`THRESHOLDS`, en ms por frame; medidos en una RTX 3060 para la épica #138, se validan en dispositivos en G1.8, #146):

| Clave | Valor | Significado |
|---|---|---|
| `upMs` | 5 | Mediana igual o menor: se puede subir un nivel |
| `altoDownMs` | 8 | Mediana mayor en `alto`: baja a `medio` |
| `medioDownMs` | 11 | Mediana mayor en `medio`: baja a `bajo` |
| `tooSlowMs` | 33 | Mediana mayor en `bajo`: el equipo no puede con el render continuo (`tooSlow`) |

- `frameStats(samplesMs)` → `{ p50, p95 }` (percentiles de rango más cercano).
- `calibrationStep(level, stats)` → `{ level, tooSlow }`: adónde apunta una medición. Solo cuenta la mediana: el percentil 95 se disparaba con el ruido del arranque en equipos sobrados, y los tirones posteriores los cubre el ajuste del pixel ratio (#166, #325).
- `bestBatch(a, b)` → de dos tandas (`{ p50, p95 }`) del mismo nivel, la de menor mediana; si una es `null` o no tiene `p50`, la otra; con ninguna, `null`. La portada mide dos tandas por nivel y usa la mejor: lo que el equipo ha hecho una vez, puede hacerlo, y un pico de carga no debe bajar el nivel (#325).
- `measuredStats({ warm, batches, cut })` → las estadísticas (`{ p50, p95 }`) de la medición de un nivel a partir de sus tiempos: `warm`, los frames de calentamiento; `batches`, las tandas medidas; `cut`, si el tope de tiempo la cortó (entonces la última tanda es la cortada). Vale la mejor tanda completa (`bestBatch`); la cortada solo cuenta si no acabó ninguna, para que unos pocos frames no pesen más que una tanda entera; sin ninguna, los frames de calentamiento; sin nada medido, `p50` y `p95` `null`. La portada solo recoge los tiempos (#325).
- `calibrationStart(signals)` → `bajo` si `initialLevel` es `bajo`; si no, `medio`.
- `nextCalibration(history, start)` → el nivel siguiente que medir, o `null` si ya está decidido. Como mucho **dos** mediciones: la segunda solo si la primera apunta a otro nivel.
- `calibrationResult(history)` → `{ level, tooSlow }`, el nivel decidido. Si la segunda medición contradice a la primera (se subió y el nivel nuevo pide bajar, o al revés), se queda el más bajo de los dos medidos; nunca se elige un nivel que no se haya medido. Así no hay ida y vuelta.
- `calibrationOutcome(history, { cut, current })` → `{ level, tooSlow, store }`, lo que hace la portada al acabar. Sin corte, el nivel de `calibrationResult` y se guarda. Si el tope de 1,5 s cortó la calibración, vale el nivel en uso (`current`) en esta carga, y solo se guarda si la medición cortada era de ese nivel y ya apunta a él (como en un render por software, lento en `bajo`). Si la medición cortada era de ese nivel y pide bajar, baja y se guarda: bajar es la dirección segura y unos pocos frames por encima del umbral ya lo muestran. Si pedía subir o no era del nivel en uso, la visita siguiente vuelve a medir.

## Nivel guardado

`STORAGE_KEY = "llsn.quality"`. `encodeStored({ level, renderer, at, tooSlow })` da la cadena que se guarda en `localStorage` (`tooSlow` es opcional y solo se guarda si es `true`); `decodeStored(raw, { renderer, now })` devuelve el nivel, o `null` si la cadena no es válida, si se guardó con otro renderer de WebGL o si es más antiguo de lo que permite su nivel: 7 días para `alto` (`STORED_MAX_AGE_MS`) y 1 día para `medio` o `bajo` (`STORED_LOW_MAX_AGE_MS`), así una calibración pesimista se corrige en la visita del día siguiente (#325). Con `null`, la portada vuelve a calibrar. `decodeStoredTooSlow(raw, { renderer, now })` da `true` solo si el registro es válido con esas mismas reglas y lleva `tooSlow: true` (#144).

## Modo de render (#144)

- `renderMode({ softwareRenderer, tooSlow, reducedMotion })` → `"onDemand"` si alguno es `true`; si no, `"continuous"`.
- `shouldRender({ mode, now, awakeUntil, animating })` → en `continuous`, siempre `true`; en `onDemand`, `true` mientras algo se anima o si `now < awakeUntil`.
- `WAKE_MS = 1200`: cuánto se sigue pintando en `onDemand` tras la última actividad.

Cómo lo usa la portada: [`home/README.md`](../home/README.md), «Imagen fija y aviso de 3D no disponible».

## Ajuste del pixel ratio (#166)

Con el render continuo, la portada baja el pixel ratio un escalón cuando los frames van justos y lo sube cuando van sobrados, sin cambiar de nivel. Todo es puro: el estado entra y sale.

`GOVERNOR`:

| Clave | Valor | Significado |
|---|---|---|
| `steps` | `[1, 1.25, 1.5, 2]` | Escalones de pixel ratio |
| `windowFrames` | 60 | Frames por ventana |
| `slowMs` | 20 | Un frame es lento si su intervalo supera esto |
| `slowShare` | 0,75 | Una ventana es lenta si esta parte de sus frames es lenta |
| `fastMs` | 18 | Un frame es holgado si su intervalo no llega a esto |
| `fastShare` | 0,95 | Una ventana es holgada si esta parte de sus frames es holgada |
| `slowWindowsToDrop` | 2 | Ventanas lentas seguidas para bajar |
| `fastMsToRaise` | 5000 | Tiempo holgado seguido para subir |
| `cooldownMs` | 3000 | Sin cambios tras un cambio |
| `relapseMs` | 10000 | Si tras subir hay una ventana lenta en este plazo, se veta el escalón |
| `vetoMs` | 30000 | Duración del primer veto; el segundo es definitivo |
| `minGain` | 0,1 | Mejora mínima de la mediana (10 %) para dar por buena una bajada |

- `governorSteps(maxRatio)` → los escalones de `steps` que no pasan de `maxRatio`, más `maxRatio`, ordenados; el escalón fijo justo por debajo de `maxRatio` se descarta si ahorra muy pocos píxeles (`(s / maxRatio)² > 1 − minGain`), porque bajar a él no mejoraría lo bastante y congelaría el ajuste; por debajo de 1, solo `maxRatio`.
- `governorInit(maxRatio)` → estado inicial, en el escalón más alto. `governorRatio(state)` → su pixel ratio.
- `governorStep(state, { samples, tainted }, now)` → `{ state, ratio }` (`ratio`: el pixel ratio nuevo, o `null` si no cambia). Reglas:
  1. Una ventana `tainted` no cuenta y pone a cero las rachas lenta y holgada.
  2. Durante `cooldownMs` tras un cambio, las ventanas no cuentan y no hay cambios.
  3. `slowWindowsToDrop` ventanas lentas seguidas bajan un escalón, si lo hay.
  4. Tras bajar, la primera ventana válida se compara con la mediana de la que hizo bajar: si no mejora al menos `minGain`, vuelve al escalón anterior y el estado queda congelado (`frozen`): ya no cambia más.
  5. `fastMsToRaise` de ventanas holgadas seguidas (una que no lo es corta la racha) suben un escalón, si lo hay y no está vetado.
  6. Una ventana lenta dentro de `relapseMs` tras subir baja de inmediato y veta el escalón de arriba: `vetoMs` la primera vez, para siempre la segunda.

Cómo lo usa la portada: [`home/README.md`](../home/README.md), «Ajuste de resolución en marcha».

## Control con las manos

`createHandPointer()` (`hands/pointer.js`) añade a una pantalla el control con las manos. La pantalla pone el botón que lo enciende, enlaza `hands/hands.css` y dice qué hacer al arrastrar y al hacer zoom (`canDrag`, `onDrag`, `onZoom`); el resto es común:

| Gesto | Qué hace |
|---|---|
| Señalar la pantalla con el índice (los demás dedos doblados) | Enseña el puntero, en la yema del índice. El control sobre el que está se resalta |
| Apuntando, doblar el pulgar contra la mano | Pulsa lo apuntado: cualquier enlace, botón o control, o el lienzo 3D. Un deslizador va al valor apuntado; una lista pasa a su siguiente opción (un script no puede abrirla) |
| Pinza (yemas del pulgar y el índice juntas) y mover la mano | Arrastra la escena (`onDrag`) |
| Una pinza en cada mano, separarlas o juntarlas | Zoom (`onZoom`): separar acerca |
| Saludo militar, como el astronauta del Mirador: la mano plana y de lado junto a la cabeza, un momento | `onSalute` (en el Mirador, estrellas y parches de 540 que salen del astronauta) |

- **Vista previa**: en una esquina, en espejo, con el usuario recortado sobre un fondo espacial dibujado (estrellas), no la habitación. Una pantalla la recoloca con `--hands-top` y `--hands-right` o con sus reglas sobre `.handcam`.
- **Entre pantallas**: encendido, se recuerda en `sessionStorage` (`llsn.hands`) y la siguiente pantalla del sitio que lo tenga lo vuelve a encender sola. Una pantalla que solo lo tiene en una de sus vistas (la portada, en «Explorar la Luna») lo crea con `resume: false`, llama a `resume()` al entrar en esa vista y a `pause()` al salir, que lo apaga sin olvidar que estaba encendido.
- **Privacidad y red**: el vídeo no sale del navegador. El seguimiento de manos y el recorte del fondo son MediaPipe (Google): la librería se descarga de jsDelivr y los modelos de `storage.googleapis.com`, solo al encenderlo. Necesita `https` o `localhost`.
- **Umbrales** (`createHandTracker` e `isSalute` en `hands/gesture.js`): pinza, dedos estirados o doblados, pulgar y saludo, todos en tamaños de mano. Para ajustar el saludo con manos reales, `?manos=diagnostico` en la dirección enseña en la vista previa sus medidas en directo y cuáles fallan. Tests en `tests/hands.test.mjs`. REVISAR: están puestos sin probar con manos reales.

