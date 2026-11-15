# rolegame/ · «Varados en el polo»

Juego de rol educativo de la misión 03 de la portada. Decisiones de arquitectura en [`docs/arquitectura-juego.md`](../docs/arquitectura-juego.md); qué construir, en el [desglose](../docs/desglose-juego-rol.md).

```
index.html     la pantalla (se publica tal cual en /rolegame/)
src/           código: main.js, game.js, tap.js, texts.js
src/engine/    motor de reglas puro
src/styles/    estilos de la pantalla
data/          escenarios y niveles generados por pipeline/game-scenario.mjs
tests/         tests (node --test)
```

## Motor de reglas (J0.3)

Módulos ES puros en `src/engine/`, sin DOM, red ni azar. Parámetros de nivel en `data/levels.json`.

- `createTables(sunBuffer, scenario, cellsBuffer)` → `{ n, hours, cellM, height(cell), sunFrac(cell, hour) }` (`cells.bin`: alturas `Float32` de `n × n`; sin él, relieve llano).
- `newGame(scenario, level, tables)`, `pass(state, hours, extraLoad)`, `move(state, path)`, `check(state)`: devuelven un estado nuevo.
- Rutas (J1.1, `src/engine/paths.js`): `slope(tables, a, b)` en grados, `stepCost(tables, level, a, b)` (`null` si supera `maxSlope`; si no, `distancia × (1 + pendiente / slopeCost)`) y `pathTo(state, target)` (Dijkstra sobre las 8 vecinas; lista de celdas o `null`). `move` sigue una ruta y cada paso dura su `stepCost` en horas.

## Pantalla (J0.4)

`src/game.js` carga `data/procedural-shackleton/` (`scenario.json`, `sun.bin`, `cells.bin`, `map.png`) y `data/levels.json` (nivel `beg`), dibuja el mapa en el `<canvas>` con un velo por celda según la fracción de Sol de la hora, y cada toque pide la ruta con `pathTo` y mueve el rover por ella (si no hay ruta, avisa con los grados del nivel). Panel con batería, mínimo para despegar, reloj de misión y fecha UTC; pantalla final con «Jugar otra vez». El cliente no calcula relieve, máscaras ni Sol. Se juega en http://localhost:4540/rolegame/ con `npm start`.

## Pulso hacia la plataforma (J1.3)

`src/hint.js` (puro: distancia en km desde `scenario.start`, `scenario.pad` y `grid.cellM`, y temporización) y su dibujo en `src/game.js`. Al empezar y al pulsar «Jugar otra vez» sale un pulso de la plataforma con una pista hacia el rover y la distancia; dura 5 s como mucho y se apaga al mover el rover o al pulsar una flecha. En la primera visita espera a que se cierre el tutorial. El anuncio incluye la dirección (p. ej. «al noreste»). Con `prefers-reduced-motion` solo se ve la pista fija. La región `aria-live` anuncia dónde está la plataforma.

## Batería y pista de energía (J2.2 y J2.4)

`src/battery.js` (puro): `batteryLevel(battery, level)` da `bad` bajo `minBat`, `warn` bajo 40 % y `good` en otro caso; `darkHours(battery, level)` son las horas enteras que aguanta parado en sombra (`battery / loadDark`, el `maxDarkHours` del planificador). En el panel la batería es una barra (`role="meter"`) con el color del nivel y una marca en el mínimo para despegar, y debajo «Aguante en sombra»; las dos cambian en cada fotograma al mover o esperar.

`src/energy-hint.js` (puro): `energyHint(state)` da `'shadow-low'` si la celda del rover no tiene Sol (`sunFrac <= 0,5`) y la batería está por debajo de 60 %, y `null` con la partida acabada. Con `'shadow-low'` el panel cambia la ayuda por el aviso en amarillo; se recalcula al empezar, tras mover y tras esperar, y el lector de pantalla lo oye una vez cada vez que aparece (`announceHint`).

## Modo ligero (J10.4)

Dos formas de pintar el mismo mapa; la partida, las reglas, la ruta y el final no cambian (el motor no sabe cuál se usa):

| Modo | Qué pinta | Qué descarga antes del primer dibujo |
|---|---|---|
| Ligero (`src/map-2d.js`) | `map.png` en un canvas 2D y un velo de sombra por celda (`sun.bin`) | `scenario.json`, `levels.json`, `sun.bin`, `cells.bin`, `earth.bin`, `masks.bin`, `series.json` y `map.png` (≈ 1,3 MB, `LIGHT_FILES` de `src/map-mode.js`) |
| Completo (`src/map-gl.js`) | Relieve en WebGL con normales, albedo y oclusión, iluminado desde donde está el Sol (J4) | Lo mismo más las texturas de J4 |

`chooseMapMode` (`src/map-mode.js`) decide al arrancar: sin WebGL, siempre ligero; si no, lo elegido en la cabecera (`llsn.gameMap`); si no, ligero con render por software o si la calibración de la portada dijo que el equipo va lento (`tooSlow`, #144), y completo en otro caso. El botón «Modo ligero» de la cabecera pasa a ligero en el momento, sin perder la partida; al desactivarlo se recarga la página (el mapa completo necesita un contexto WebGL nuevo). Si WebGL falla o pierde el contexto, el juego sigue en ligero con el mismo estado y lo dice en el panel y al lector de pantalla.

## Luna 3D (J8.1 y J8.2)

Recuadro «Dónde estás» con la Luna en 3D: la zona de juego en el polo sur (anillo que late), el Sol y la Tierra de `series.json`, su estela de los próximos 4 días y su órbita aparente de un periodo, al ritmo del reloj de la partida (`game.js` llama a `onTime(view.t)` en cada dibujo). Se gira arrastrando o con las flechas y se acerca con la rueda o con `+` y `−`. En el móvil comparte el cuadrado del mapa con dos pestañas, «Mapa» y «Luna 3D»; con «Luna 3D» elegida, el mapa no se pinta (`isMapHidden`).

| Fichero | Qué hace |
|---|---|
| `src/moon-sky.js` | Puro: `poleDir`, `skyAt`, `trail`, `orbitPath` y `chevrons` sobre la serie |
| `src/moon3d.js` | La escena con three.js y el globo compartido (`shared/render/moon-globe.js`). Solo se carga con `import()` |
| `src/moon-panel.js` | Cuándo cargarla (`shouldLoadMoon`: solo en modo completo y, en el móvil, al abrir la pestaña), el resumen para el lector de pantalla y el aviso si no hay 3D |
| `src/view-tabs.js` | Pestañas accesibles: `nextTab` (puro) y `wireTabs` |

## Idiomas (J10.1)

El juego está en español y en inglés. El selector «ES | EN» de la cabecera cambia el idioma al momento, sin perder la partida, y lo guarda en `llsn.lang` (`shared/i18n/lang.js`); la primera vez arranca en inglés si el navegador no está en español. `?lang=en` (o `es`) en la dirección manda sobre lo guardado, y los enlaces a otras pantallas llevan el idioma en uso (`carryLang`, #283).

Cómo se añade un texto:

1. La clave en español en `TEXTS` de `src/texts.js` y la misma clave en inglés en `EN` de `src/texts.en.js`. Si lleva cifras, una función con los mismos argumentos en los dos (`es-ES` da «1,5 km»; `en-GB`, «1.5 km»).
2. En el código, `TEXTS.clave` (en `game.js`, `TEXTS` es el diccionario del idioma en uso) o el diccionario que reciba la función; en `index.html`, `data-text`, `data-aria-label` o `data-title`.
3. Una clave sin inglés no rompe el juego (sale en español), pero `tests/texts.test.js` la lista y falla hasta que se traduce.



`npm test --prefix rolegame` (también cuelga de `npm test` en la raíz).
