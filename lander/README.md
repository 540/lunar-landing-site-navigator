# lander/ · Aterrizaje a bordo

La misión 04 de la portada: los últimos 4,6 km del descenso al polo sur de la Luna, vistos desde dentro de la cabina del módulo de aterrizaje. Eres la comandante, vas sentada con tres tripulantes más y el piloto automático sabe posarse solo. Puedes mirar, levantarte, tocar los controles y tomar el mando.

```
index.html      la pantalla (se publica tal cual en /lander/)
src/main.js     une la simulación con la cabina, el exterior, el sonido y la página
src/sim/        lógica pura, sin three.js ni DOM: es lo que prueban los tests
  physics.js      física del descenso
  autopilot.js    guiado del piloto automático
  mission.js      fases, lo que hace la tripulación, avisos y final del vuelo
  outcome.js      veredicto del contacto
  controls.js     máquina de estados de los controles de la cabina
  terrain.js      relieve procedural del sitio
  collision.js    caminar por la cabina sin atravesar nada
  layout.js       dónde está cada mueble
src/scene/      three.js: world.js (relieve, cielo, Sol y Tierra), cabin.js, panels.js (controles), displays.js (pantallas), crew.js, can.js
src/site.js     sitio y cielo del día
src/audio.js    sonido sintetizado con WebAudio
src/texts.js    todos los textos que lee quien juega (español; inglés en src/texts.en.js)
tests/          tests (node --test)
```

Sin build y sin dependencias que instalar: three.js 0.160 llega del CDN por un import map, igual que en la portada. Necesita conexión.

## Idioma

Español por defecto e inglés («Onboard landing») con `?lang=en`, el conmutador ES / EN de la tarjeta de inicio o un navegador en otro idioma (`shared/i18n/`). `src/texts.en.js` tiene las mismas claves que `src/texts.js` (lo que falte sale en español) y `COCKPIT`, las rotulaciones de paneles, carteles y pantallas de la cabina con su texto en español como clave: un rótulo nuevo se añade ahí, o se queda en español. `tests/texts.test.js` comprueba las claves y que todo rótulo de los controles y de `scene/` tiene inglés.

## Arrancar y probar

```sh
npm start                  # en la raíz: http://localhost:4540/lander/
npm test --prefix lander   # también entra en el `npm test` de la raíz
```

## Cómo se juega

Al entrar salen las instrucciones y «Empezar el descenso». El descenso dura unos dos minutos:

1. **Aproximación.** La nave cae en vuelo libre. El piloto arma el motor.
2. **Frenado.** Ignición a los 6 s. La nave va inclinada unos 30° hacia atrás para frenar los 92 m/s de avance: por el parabrisas se ve el cielo, y el suelo por las ventanas laterales y la del suelo.
3. **Descenso final.** Sobre el sitio, ya vertical, baja cada vez más despacio. El piloto despliega el tren a 700 m.
4. **Contacto.** Luz de contacto, motor parado y resumen.

Si la nave se estrella (`src/sim/crash.js`), hay destello por las ventanas, sacudida, chispas, el parabrisas agrietado, humo, apagón con luces rojas de emergencia y alarma, un golpe sordo y la tripulación se protege. Después sale la tarjeta de aterrizaje fallido.

| Control | Qué hace |
|---|---|
| Ratón | Mirar. El primer clic captura el cursor; Esc lo suelta. Sin captura, se mira arrastrando |
| Clic | Acciona el control al que apunta la retícula. Clic derecho o Mayús + clic, en sentido contrario (selectores y palanca) |
| Rueda | Mueve la palanca de empuje o un selector |
| E | Levantarse del asiento o sentarse |
| W A S D | Caminar por la cabina |
| M | Piloto automático o manual |
| ↑ ↓ | Empuje del motor, en manual |
| ← → | Inclinar la nave, en manual: ← frena, → avanza |
| G | Tren de aterrizaje |

En táctil se mira arrastrando, se toca un control para accionarlo y hay una palanca para caminar y botones para el asiento, el piloto automático, el empuje y la inclinación.

Los controles que vuelan la nave: armar el motor (con tapa), válvulas de propelente, piloto automático, ordenador GNC (sin él no hay piloto automático), RCS (sin él la nave no gira), tren (con tapa), abortar (con tapa y de un solo uso), palanca de empuje, radar altímetro, alarma, luces de cabina y de paneles, focos de aterrizaje, y el selector de la pantalla derecha (sistemas, cámara del suelo o ruta). El resto, más de cien entre interruptores, teclas, selectores y disyuntores, se enciende y se apaga con su luz y su sonido.

## Qué es real

- **Física** (`src/sim/physics.js`): gravedad lunar de 1,62 m/s², masa que baja al quemar combustible, empuje de hasta 45 kN con un mínimo estable del 10 %, consumo `T / (Isp · g0)` con Isp de 311 s (las cifras del motor de descenso del módulo lunar del Apolo), y actitud limitada a 7°/s por los propulsores. Integra a 60 pasos por segundo.
- **Veredicto** (`src/sim/outcome.js`): correcto con 3 m/s en vertical, 1,2 m/s en horizontal y 6° de inclinación como mucho (los límites de diseño del tren del módulo lunar) y el tren desplegado. Hasta 5,5 m/s, 3 m/s y 12° es un aterrizaje duro. Más allá, fallido. Sin tren baja un escalón.
- **Sitio y cielo** (`src/site.js`): el borde de Cabeus B, una de las regiones candidatas de alunizaje de Artemis. La altura y el acimut del Sol y de la Tierra son los del motor del proyecto (`track`, en `backend/src/useCases.ts`) para esas coordenadas el 19 de noviembre de 2027 a las 12:00 UTC: Sol a 8,9° y Tierra a 4,0° sobre el horizonte.

## Qué no lo es

- El relieve es procedural (`src/sim/terrain.js`), no el DEM de LOLA: cráteres y lomas con una semilla fija. Las sombras sí se calculan sobre ese relieve con la altura real del Sol.
- El descenso es en un plano: avance y altura, con cabeceo. No hay deriva lateral ni guiñada.
- Empieza al final del frenado, a 2.100 m y 92 m/s, no desde la órbita.
- La Tierra está dibujada al doble de su tamaño real para que se lea por la ventana.
- La pantalla no llama a la API de datos: funciona igual en GitHub Pages.

## Verificación

`window.__lander` deja probar la pantalla sin jugar el descenso entero (por ejemplo con Playwright): `start()`, `advance(segundos)`, `press(id)`, `aim(id)`, `look(guiñada, cabeceo)`, `view(x, y, z, guiñada, cabeceo)` para mover la cámara y `state()` para leer el estado.

Con `prefers-reduced-motion` la vibración del motor y el golpe del contacto se quedan en una octava parte, y la tripulación se mueve menos. Al estrellarse no hay sacudida, chispas ni parpadeo: el destello, el humo, las grietas y la luz roja llegan con un fundido.
