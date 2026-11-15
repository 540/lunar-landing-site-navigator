# Home · portada lunar

La entrada al Lunar Landing Site Navigator: la Luna en 3D, vista desde el polo sur, con cuatro misiones en la cara visible. Al elegir una, la cámara baja con su nave hasta la zona de aterrizaje y enseña la ficha de destino. Con «Adelante», la nave frena y se posa en la zona; después la cámara hace zoom y se abre la pantalla de la misión.

## Arrancar

```sh
npm start     # desde la raíz: http://localhost:4540
```

Con `#simulador`, `#tour`, `#rol` o `#aterrizaje` en la URL baja directamente a esa misión; con `#explorar`, abre «Explorar la Luna», y con `#explorar-<zona>` (por ejemplo `#explorar-apollo-11`), además la tarjeta de esa zona; `#explorar-por-que` abre la ficha «¿Por qué el polo sur?» (hielo, agua, aire, combustible y luz), que es el primer botón de la lista. Carga three.js desde CDN y las fuentes de Google Fonts: necesita conexión.

## Idioma

Español por defecto e inglés con `?lang=en`, con el conmutador ES / EN de la cabecera (y el de «Explorar la Luna», donde la cabecera no se ve) o con un navegador en otro idioma (`shared/i18n/`). Cambiar de idioma recarga la página. El español sigue en `index.html` (marcado, `ZONES` y `EXPLORE`); el inglés está en [`i18n.js`](i18n.js): `HOME_TEXTS` (los textos del script y las claves `data-i18n` del marcado), y `ZONES_EN` y `EXPLORE_EN`, que se superponen a `ZONES` y `EXPLORE` por id. Un texto nuevo necesita su clave en los dos idiomas, y una misión o una zona nueva, su entrada en inglés: `tests/home-i18n.test.mjs` lo comprueba. El aviso `#glost` y `#loading` se traducen desde el script, sin `data-i18n`, porque `tests/quality.test.mjs` fija su marcado.

## Misiones

| Misión | Zona | «Adelante» abre |
|---|---|---|
| Simulador de misiones | Borde de Shackleton | El planificador, [`../web/`](../web/) |
| Mirador del Polo Sur | Macizo de Malapert (una de sus regiones con relieve LOLA) | Exploración 3D con relieve LOLA y visor de misión |
| Juego de rol | Mons Mouton | El juego de rol, [`../rolegame/`](../rolegame/) |
| Aterrizaje a bordo | Borde de Cabeus B | El simulador de aterrizaje, [`../lander/`](../lander/) |

Cada misión tiene la nave que usa dentro, para que su forma ya diga de qué va. Las misiones 01 a 03 esperan sobre su zona, cada una en su estela, y bajan por el mismo camino: la 01 (simulador) es un módulo robótico de carga (`makeRobotLander`) con lo que comprueba el simulador a la vista, un panel solar de pie (en el polo el Sol va rasante), una antena parabólica apuntando bajo, hacia la Tierra, y patas anchas para la pendiente; la 02 (Mirador) es un dron saltador (`makeHopper`) con cuatro propulsores en brazos (sin aire no hay hélices), una cámara bajo el morro y patas cortas, porque el Mirador enseña el polo desde el dron; y la 03 (juego de rol) sigue siendo un cohete tripulado (`makeRocket`), porque es la misión en la que hay que volver a despegar. Las tres comparten materiales con el satélite 540 (`craftKit`). Cada una llega por su lado de la Luna (01 por la izquierda, 02 por la derecha y 03 por abajo) para que no se amontonen en el centro: `app` es la dirección de llegada y `hold`, en qué punto de su camino espera. En pantallas estrechas las naves quedan más juntas que el ancho de sus etiquetas, así que la 01 y la 02 tienen ahí su propia trayectoria (`narrow`, se aplica en `aim()` al cambiar de ancho), separadas también en vertical. Una etiqueta que no cabe en su lado pasa al otro, porque pegada al borde taparía su nave. De cada nave sale una línea discontinua tenue de su color hasta su zona (el tramo de estela que le queda por recorrer), siempre visible en el menú, para que cada marca diga de qué misión es. La 04 es un módulo de aterrizaje tripulado, para que se lea como «aterrizaje»: un módulo de aterrizaje tripulado (`makeLander`: etapa de descenso octogonal con aislante dorado, cabina plateada con dos ventanas triangulares, cuatro patas desplegadas con platos y sondas de contacto, propulsores RCS y una llama corta de motor de descenso), con los materiales del satélite 540 y su mapa de entorno. No está en el grupo: cuelga en el cielo libre encima de su zona (en móvil, arriba a la izquierda, con la etiqueta a su izquierda), derecho en pantalla, con un leve balanceo y una línea de descenso discontinua hasta el suelo. Al elegirla baja en curva hasta quedar sobre la zona, ya de pie sobre la vertical del sitio; con «Adelante» desciende en vertical y se posa. Su sitio en el cielo se recalcula en `computeMenu` (búscalo por `LANDER`). En móvil, su etiqueta va a su izquierda y el módulo se aparta del borde lo justo para que quepa; en móviles bajos (375 × 667 o menos) baja lo justo para que ni el módulo ni su etiqueta queden debajo de los botones de la cabecera, que en móvil (≤ 400 px) caben en una sola fila con ES/EN (en ≤ 340 px, «Tutorial» queda solo con su icono); y, si el dock fuera a tapar la etiqueta del cohete morado, el cohete sube lo justo. Las cuentas están en [`src/menu-layout.mjs`](src/menu-layout.mjs) y se prueban en `tests/home-menu-layout.test.mjs`.

Para enlazar una misión con su pantalla, añade `href` a su entrada de `ZONES` en `index.html` (ruta relativa, como `"../web/"`). Sin `href`, se queda en la pantalla de marcador de posición.

## Explorar la Luna

Se entra desde el cohete morado que espera quieto a la izquierda de la Luna (en móvil, abajo a la izquierda), con su etiqueta «Explorar la Luna», unida al cohete por la misma línea fina que une cada misión con su etiqueta (aquí vertical; al pasar el ratón, la línea pasa por detrás del chip de la altitud). También desde su tarjeta, la última de la lista de misiones de la izquierda (en lila; solo en escritorio y mientras las cinco tarjetas caben entre la cabecera y el panel inferior). Al tocar el cohete, despega hacia la cámara, pasa por delante y desaparece; al volver a las misiones aparece de la nada por el borde derecho, cruza por delante de la cámara y vuelve a su sitio (con «reducir movimiento» solo desaparece y reaparece). También se entra alejando la cámara con la rueda o pellizcando el panel táctil, y con el teclado desde el botón «Explorar la Luna» de la cabecera (`#exploreBtn`), oculto a la vista hasta que recibe el foco; al enfocarlo, el cohete morado se ilumina como con el ratón. Cualquier entrada saca la cámara del polo sur y enseña la Luna entera, con zonas que enseñan por qué no se aterriza en cualquier sitio: la cresta de Shackleton y el cráter Cabeus (polo sur), Von Kármán (cara oculta), el mar de la Tranquilidad (Apolo 11), Hadley-Apeninos (Apolo 15), el mar de las Crisis (Blue Ghost 1) y el polo norte. Las zonas son rombos lilas con su nombre, nunca cohetes, para no confundirlas con las misiones. Al elegir una (en el globo o en la lista de abajo, que es la que se recorre con el teclado), el globo gira hasta ella y se abre una tarjeta para público no técnico: un dato curioso, si se puede aterrizar y por qué, y tres indicadores (luz, Tierra y terreno), con las cifras exactas plegadas en «Ver las cifras». La tarjeta se cierra con «Cerrar», con Escape o tocando fuera; Escape otra vez, o «Volver a las misiones», vuelve al menú.

Los textos (dato curioso, porqué, terreno y enlaces) están escritos a mano en `EXPLORE`, en `index.html`. Las coordenadas y las cifras de luz, Tierra y pendiente salen del motor y están en [`data/zones.json`](data/zones.json), que genera [`scripts/build-zones.ts`](scripts/build-zones.ts) con los casos de uso de `backend/src/useCases.ts` (`visibilityWindows`, como `/v1/windows`; `track`, como `/v1/track`, para la altura de la Tierra; y la pendiente del sitio), para todo 2027 y con un observador a 2 m. Es un fichero estático: la portada no necesita la API y funciona igual en GitHub Pages. Para regenerarlo:

```sh
npm ci --prefix backend
(cd backend && node scripts/fetch-dem.ts)   # opcional: relieve LOLA del polo sur (fuera de git)
node home/scripts/build-zones.ts
```

Sin el DEM, Cabeus se calcula con la Luna lisa y sale con Sol la mitad del tiempo, que es falso; por eso el script se para si una zona al sur de 60°S se queda sin relieve (`--allow-smooth` lo permite). El JSON publicado se generó con el DEM de 80°S en caché (`demVersion`) y cada zona dice en `horizon` si usó relieve (máscara del catálogo o DEM) o la Luna lisa. Las zonas lejos de los polos no tienen relieve ni pendiente: el DEM solo cubre el polo sur. Una zona nueva necesita su entrada en `ZONES` de `scripts/build-zones.ts` (coordenadas publicadas y, si está en el catálogo de `backend/src/sites.ts`, su `siteId`) y sus textos en `EXPLORE`. La lógica pura del script (niveles de luz y Tierra, redondeos) se prueba en `tests/home-zones.test.mjs`.


El globo se gira arrastrando y se acerca o aleja con la rueda del ratón o las teclas `+` y `−` (hasta 4 veces más cerca de la superficie); al abrir la tarjeta de una zona o salir, vuelve a verse entero.

### Mover con las manos

El botón «Mover con las manos», solo en «Explorar la Luna» (#259), enciende el control con las manos de `shared/hands/` (gestos, cámara y privacidad en [`shared/README.md`](../shared/README.md)): se apunta con el índice y se pulsa doblando el pulgar sobre cualquier botón, rombo o enlace, la pinza gira el globo y una pinza en cada mano hace zoom. El menú de misiones no tiene control con las manos: al volver a él se apaga (cámara, vista previa y puntero) y, si estaba encendido, se enciende solo al entrar otra vez en «Explorar la Luna».

## Calidad del render (niveles y parámetros de la URL)

La portada dibuja con uno de tres niveles de calidad, `alto`, `medio` o `bajo`, definidos en [`shared/render/quality.js`](../shared/README.md) (#142). Sin parámetros, la primera vez **mide el equipo** (#143): con la escena lista y antes de quitar la pantalla de carga, pinta 15 frames de calentamiento y mide dos tandas de 30, y vale la de menor mediana (un pico de carga no baja el nivel); cada frame espera a la GPU (lee 1 px con `gl.readPixels` tras el render). Empieza en `bajo` si el equipo es modesto (render por software, `maxTextureSize` menor que 4096, ahorro de datos, 4 GB de memoria o menos, o 4 núcleos o menos) y en `medio` si no; según la medición sube o baja un nivel (`applyLevel` lo aplica sin recargar: pixel ratio, mapa de sombras, casquete polar, textura de color, anisotropía, muestras del promedio polar y sombras de los cohetes) y, si hace falta, mide una segunda vez. Como mucho dos mediciones y 1,5 s: si se pasa, se corta y vale el nivel en uso en esta carga. Las reglas están en [`shared/README.md`](../shared/README.md), «Calibración».

El nivel decidido se guarda en `localStorage` (si el tope cortó la calibración, solo cuando lo medido confirma el nivel en uso o pide bajar, y entonces baja; si no, la visita siguiente vuelve a medir) (`llsn.quality`, con el nombre de la GPU y la fecha), y en las visitas siguientes arranca directamente en él, sin medir, mientras no cambie la GPU: 7 días si es `alto` y 1 día si es `medio` o `bajo`, para que una calibración pesimista se corrija al día siguiente. Solo se calibra con la escena entera: si a los 7 s aún faltan la textura de color de 2k o la de relieve, la Luna se muestra en el nivel de partida, sin medir ni guardar, y la visita siguiente mide. En modo privado, sin `localStorage`, calibra en cada visita. Con `?q=…` ni se calibra ni se guarda. El pixel ratio se recalcula al cambiar el tamaño de la ventana: en ningún nivel pinta más de 3840 × 2160 píxeles, así que en pantallas de más de 8,3 megapíxeles el tope de píxeles baja el pixel ratio y la Luna se ve algo menos nítida que en una pantalla más pequeña. El antialias está activado en todos los niveles. No hay selector en la interfaz.

`?q=alto`, `?q=medio` o `?q=bajo` fuerza el nivel. Para el banco de medición ([`tools/render-bench/`](../tools/render-bench/README.md)), `index.html` lee además de la URL valores sueltos que sustituyen a los del nivel (búscalos por `Quality`). Un valor no numérico o ≤ 0 se ignora. `shadow`, `cap` y `fs` se redondean al entero más cercano, y si queda por debajo de 1 también se ignora.

| Parámetro | En `alto` | Qué cambia |
|---|---|---|
| `q` | según el equipo | Nivel: `alto`, `medio` o `bajo` (otro valor se ignora). Sin calibración y sin guardar nada |
| `pr` | `2` | Tope del pixel ratio |
| `shadow` | `4096` | Lado del mapa de sombras del Sol |
| `cap` | `460` | Rejilla del casquete polar |
| `tex` | `4k` | `2k` o `4k`. Con `2k` no se pide la textura de color de 4k |
| `aniso` | `16` | Tope de anisotropía (nunca pasa del máximo del equipo) |
| `fs` | `16` | Muestras del promedio polar del sombreador de la Luna |
| `rs` | `1` | Con `0`, las naves de las misiones no proyectan sombra; con otro valor, sí |
| `bench` | ausente | Expone `window.__bench` (tiempos de cada frame, pérdidas de contexto, capturas; en `quality`, `{ level, source, values, calibration, tooSlow, renderMode }`: el nivel en uso, de dónde sale (`url`, `stored` o `auto`), sus valores, las mediciones de la calibración (`[{ level, p50, p95 }]`), si ni `bajo` aguanta el render continuo, el modo de render (`continuous` u `onDemand`) y, con la Luna en pantalla, `governor`: `{ ratio, frozen, changes }` del ajuste de resolución en marcha; `loseContext()`, que fuerza la pérdida del contexto WebGL, y `lostNotice()`, si se ve el aviso de 3D no disponible; en `tex`, la textura de color en uso: `2k` si la de 4k no cargó, `fallback` si la de 2k no cargó; `explore()`, que abre «Explorar la Luna», y `probe(t?)`, que devuelve la posición en pantalla de la sonda y su fase en la órbita y, con `t`, la fija; `lander()`, el centro en pantalla del módulo de la misión 04 y su medio ancho en píxeles) y no lanza el tutorial |

Los valores de `medio` y `bajo` están en [`shared/README.md`](../shared/README.md). Por ejemplo, `/home/?q=bajo&shadow=4096`. Las estrellas salen de una semilla fija, para que dos capturas se puedan comparar.

## Ajuste de resolución en marcha (#166)

Con el render `continuous` y la Luna ya en pantalla (fuera de la calibración), la portada vigila el intervalo real entre frames pintados. Cada 60 frames pasa la ventana a `governorStep` de [`shared/render/quality.js`](../shared/README.md), «Ajuste del pixel ratio»: si los frames van justos, el pixel ratio baja un escalón (2 → 1,5 → 1,25 → 1); si van sobrados un rato, sube. Solo cambia la nitidez, nunca el nivel (sombras, casquete, textura), y no baja de 1.

- Una ventana no cuenta si en ella hubo un cambio de tamaño, una vuelta a la pestaña, la carga de una textura, una transición de cámara, un cambio de modo o los 2 primeros segundos tras aparecer la Luna.
- Tras cada cambio hay 3 s sin otro; si una bajada no mejora el tiempo de frame, vuelve arriba y ya no cambia más en esa visita (el límite no son los píxeles: pantalla a 30 Hz, ahorro de energía, CPU). Así no hay parpadeos ni idas y venidas.
- El pixel ratio aplicado es el menor entre el del nivel y el escalón del ajuste; `resize()` respeta ese tope. Si cambia la densidad de la pantalla sin cambiar el tamaño de la ventana (otra pantalla, zoom), un oyente de `matchMedia("(resolution: …dppx)")` lo recalcula.
- No se guarda nada: cada visita empieza en el escalón más alto.

## Imagen fija y aviso de 3D no disponible (#144)

La portada pinta la Luna en uno de dos modos (`renderMode` de [`shared/render/quality.js`](../shared/README.md)):

- **`continuous`**: un frame en cada `requestAnimationFrame`, como siempre.
- **`onDemand`**: imagen fija. Solo se pinta mientras se mueve la cámara y hasta 1,2 s (`WAKE_MS`) después de la última actividad: puntero, rueda, teclado, cambio de tamaño, volver a la pestaña, una textura que acaba de cargar, una animación de cámara o que aparezca la Luna. Sin balanceo ni parallax en reposo, nada que se mueva con el tiempo (vaivén de los cohetes, parpadeo de la llama y de las balizas, estela, deriva y destellos del satélite), y las transiciones de cámara llegan al final en un frame. Se usa con render por software, cuando la calibración dice que ni `bajo` aguanta el render continuo (`tooSlow`, que se guarda con el nivel y vale en las visitas siguientes) y con `prefers-reduced-motion`.

Mientras el banco mide con `__bench.sync`, la portada pinta todos los frames también en `onDemand`, para que los tiempos sigan siendo comparables.

Si el 3D falla (no se puede crear el contexto WebGL o se pierde, `webglcontextlost`), en lugar de una pantalla negra o un «Cargando…» eterno sale el aviso `#glost`: «La vista 3D no está disponible en este equipo o se ha detenido.», un botón «Recargar» y enlaces a las cuatro pantallas, los mismos que los de las misiones (`tests/site-wiring.test.mjs` lo comprueba). El aviso es un diálogo de alerta modal (`role="alertdialog"`, `aria-modal`): mientras se ve, el resto de la página queda inerte y el foco está en su primer enlace; si el contexto se recupera (`webglcontextrestored`), se va y el foco vuelve adonde estaba. Su lógica está en `shared/render/lost-notice.js`, compartida con el Mirador, y se prueba con un DOM mínimo en `tests/lost-notice.test.mjs`. La pantalla de carga es una región `role="status"` con `aria-live="polite"`.

## Tutorial

La primera vez que se entra, un tutorial recorre la portada: las cuatro misiones, el resumen, el botón de luz, el cohete morado de «Explorar la Luna» y el satélite. Se repite con el botón «Tutorial» de la cabecera. Los pasos se generan desde `ZONES`, así que una misión nueva sale sola. Qué se ha visto se guarda en `localStorage` (`llsn.tour.seen`), compartido con el resto de pantallas.

## Sonda cartográfica

Una sonda como la LRO (Lunar Reconnaissance Orbiter) de la NASA da vueltas a la Luna en una órbita polar baja. Es decorativa: no abre nada y no tiene clic ni cursor de mano; la entrada a «Explorar la Luna» es el cohete morado. Está ahí porque de la LRO salen los datos de la escena: la textura de color es un mosaico de la cámara LROC WAC y el relieve, del altímetro láser LOLA, los dos a través del CGI Moon Kit de NASA SVS (ver «De dónde sale»), y LOLA es también el DEM del polo sur con el que el motor calcula horizontes y pendientes.

Al pasar el ratón cerca de ella, sin parar la órbita, se ilumina un poco y enseña una etiqueta informativa, «Sonda cartográfica · LROC y LOLA», que no recibe el puntero ni el foco y no cambia el panel de abajo. Si el puntero está sobre un cohete o el satélite, gana el cohete y la etiqueta de la sonda no sale. En pantallas táctiles no hay etiqueta.

Para distinguirla del satélite 540 es pequeña, siempre en movimiento, de cuerpo alargado con una sola ala solar y sin dorado ni logo; lo suyo es el lila de las zonas (`--zone`): la órbita, la franja que deja detrás y el haz hacia el suelo. Con `prefers-reduced-motion` (y en el modo de render `onDemand`), la sonda se queda quieta a la vista y sin estela. El plano de la órbita (`setOrbitPlane`) está elegido para que, en reposo, pase por debajo de los cohetes sin taparlos.

## Satélite 540

Arriba a la derecha flota un satélite con el logo de 540. Para que se vea, lleva luces como las de un avión: una roja y una verde fijas en las puntas de las alas solares, un destello blanco doble en cada punta y una baliza roja en la antena de látigo (en imagen fija solo quedan las fijas). Al hacer clic (o con el teclado, desde su etiqueta «Quiénes somos»), la cámara se acerca y se abre la ficha de quiénes somos, con el enlace a <https://www.540deg.com>. Con `#540` en la URL se abre directamente. Los textos de la ficha salen de la web de 540 y están en el `#about` de `index.html`; el logo es `tex/logo-540.png`.

## De dónde sale

`index.html` es la exportación de un artifact, en un solo fichero y con los textos del código en español. Si se vuelve a exportar encima, hay que conservar lo añadido aquí: el `href` de `ZONES`, el desvío de `forward()`, el `pageshow` que restaura la página al volver con «atrás» (búscalos por `href` y `leaving`) el satélite de 540 (búscalo por `SAT` y `about`) y la sonda cartográfica (búscala por `PROBE`, `makeProbe` y `setOrbitPlane`). Y el tutorial de la primera visita (búscalo por `Tutorial`, `tutorialBtn` y `data-zone`), que usa el motor y los estilos de `../web/` (`js/common/tour-engine.js` y `styles/tour.css`). También los ajustes para móvil: las media queries de pantallas pequeñas, bajas y apaisadas, el tope de alto de `.destcard` y los textos de ayuda táctiles (`HINT`). Y la capa «Explorar la Luna» (búscala por `EXPLORE`, `exploreBtn`, `zcard`, `placePins`, `faceQ` y `view.e`): los textos, el `fetch` de `data/zones.json`, su paso del tutorial, el giro del globo en el bucle y la costura del sombreador de la Luna en 180° de longitud (`seamD`). Y los parámetros de calidad y `window.__bench` del banco de medición (búscalos por `Quality (URL)`, `Q.` y `__bench`), con las estrellas de semilla fija (`starRand`). Y el modo de render y el aviso de 3D no disponible (búscalos por `RENDER_MODE`, `wake` y `glost`).

El globo de la Luna ya no está en `index.html`: desde G1.2 (#140) sale de [`shared/render/moon-globe.js`](../shared/render/moon-globe.js) (`createMoonGlobe`: material, sombreador del polo `POLE_DISP`, casquete polar `capGeometry`, material de profundidad de las sombras y texturas). Si el artifact se vuelve a exportar con su propio bloque «Luna», hay que quitarlo y dejar la llamada a `createMoonGlobe` (búscala por `MOON`), con el cargador `tex` que despierta el bucle, `ensureColor` (la textura de 4k con `MOON.useColor`) y `MOON.setCapGrid` en `applyLevel`.

Las texturas de la Luna, en `../shared/render/tex/`, son del [CGI Moon Kit de NASA SVS](https://svs.gsfc.nasa.gov/4720) (color de LROC WAC y alturas de LOLA). El relieve se dibuja a ×0,75 de su altura real (y se suaviza al sur de 85° S).

Las de la Tierra (`shared/render/tex/earth-*`, que solo se descargan al abrir «Explorar la Luna») son imágenes de la NASA de dominio público, reducidas a 2048 × 1024 desde la copia del paquete `three-globe` (`example/img/`): día del [Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble), luces nocturnas del [Black Marble](https://earthobservatory.nasa.gov/features/NightLights), nubes (el canal alfa de su capa, en grises) y la máscara de agua, que da el reflejo del Sol en los océanos. En «Explorar la Luna», la Tierra cuelga de la Luna sobre el centro de la cara visible (la Luna siempre le enseña la misma cara), a su tamaño aparente real (~7°): aparece por el borde al girar la Luna desde la cara oculta.
