# Contexto · grupo Planificador de misión

Resumen de lo trabajado el 2026-11-13 para el perfil **planificador de misión** del reto [Lunar Landing Site Navigator](https://github.com/540/lunar-landing-site-navigator-discovery/blob/main/fuentes/2026-11-13-reto-lunar-landing-site-navigator.md). Es material de trabajo del grupo: lo que tenga que pasar al ciclo de discovery (PRD, historias) se lleva con `/iniciativa` y `/prd`.

## 1. El reto en corto

- Una nave que aterriza en el **polo sur de la Luna** necesita **Sol** (paneles solares: sin Sol, la batería se agota y muere) y **ver la Tierra** (radio directa, sin satélites intermedios).
- **Por qué el polo sur:** en el fondo de sus cráteres hay zonas que nunca reciben luz y conservan **hielo de agua** (agua, oxígeno, combustible). Es el objetivo de Artemis y de las misiones comerciales (CLPS).
- **El problema:** en el polo el Sol va rasante, a 1–2° sobre el horizonte, y cualquier loma lo tapa. La Tierra también se ve muy baja. Y todo cambia con la fecha: un día lunar dura ~29,5 días (unas 2 semanas de luz y 2 de noche), hay estaciones (±1,5°) y la Tierra se balancea en el cielo (libración, ±7°).
- **Caso real:** Athena (IM-2), marzo de 2025. Aterrizó a ~400 m de su objetivo, dentro de un cráter y con el Sol bajo, y se apagó en ~12 h ([Spaceflight Now](https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/)).

## 2. El planificador: qué decide y qué le falta

**Decide** si una combinación de sitio y fecha es viable para su nave y, si un retraso la rompe, cuál es la alternativa más cercana. NASA lo plantea como equilibrar «adonde queremos ir» con «adonde podemos ir con seguridad», y en las primeras misiones el sitio depende sobre todo de cuándo se lanza ([NASA, *Lunar Site Selection*, 2023](https://ntrs.nasa.gov/api/citations/20230016267/downloads/Lunar%20Site%20Selection.pdf)).

**Le falta hoy:**

- JPL Horizons da la posición del Sol, pero sin relieve.
- Quickmap y PGDA dan el relieve, pero con la luz promediada de años.
- Cada sitio y cada fecha es un cálculo a mano. Con un retraso, vuelta a empezar.

**Requisito de viabilidad** (decidido):

1. Al aterrizar se ven el Sol y la Tierra.
2. Durante toda la misión, la sombra más larga no supera lo que aguanta la batería.
3. La Tierra se ve al menos el % pedido.

El resultado es Viable / Justo / No viable, siempre con su motivo.

## 3. Qué queremos mostrar: tres paneles

1. **Planificar → la mejor opción.** Formulario guiado con las condiciones de la misión:
   - perfil de nave;
   - **ventana** de aterrizaje (fecha más temprana y más tardía);
   - zona;
   - días en superficie, horas que aguanta sin Sol y % mínimo de Tierra;
   - **prioridad** (margen de energía / comunicación / aterrizar antes / aguantar retrasos).

   El backend devuelve **la mejor opción**: sitio, fecha, veredicto, motivos, las 4 cifras clave comparadas con los requisitos y el **margen ante retrasos** («sigue siendo viable aunque te retrases hasta N días»). Debajo van el reloj lunar y el cielo de 360°.
2. **Otras opciones.** El ranking que devuelve el backend, las opciones en el mapa y hasta 3 lado a lado. Cualquiera se puede marcar como plan.
3. **Replanificar.** «¿Qué ha cambiado?»: retraso, nave, zona o aterrizaje desviado. Responde si el plan sigue valiendo y compara **mismo sitio en la siguiente ventana** con **otro sitio en la misma fecha**. Incluye la tabla de retrasos y la prueba de desvío: de 8 puntos a R metros, ¿cuántos siguen siendo viables?

La lógica de «cuál es el mejor sitio» la pone el backend. Nosotros decidimos qué se muestra, qué se pide y qué requisitos cuentan.

## 4. Backend

- La API v1 del otro equipo (efemérides con astronomy-engine, validadas contra Horizons, **todavía sin relieve LOLA**) tiene `/v1/sites`, `/v1/sun-earth`, `/v1/windows` y `/v1/rank`. Corre en local en el puerto 3100; aún no está desplegada.
- Qué nos cubre, qué falta y qué les hemos pedido: [CONTRATO-BACKEND.md](CONTRATO-BACKEND.md).
- Mientras tanto, `js/busqueda.js` simula la búsqueda con la forma que les hemos pedido. Cuando llegue la real, se sustituye esa función.
- El prototipo vive también en este repo de código (`prototipo/`), junto a la API de datos (`data/`) y el evaluador de viabilidad (`planner/`).

## 5. Estado del prototipo (`prototipo/`)

- Arranque: `node prototipo/servir.mjs` → <http://localhost:4541> (con `?debug=1`, el modo explicación).
- **Hecho** (flujo simplificado el 2026-11-13):
  1. **Planificar:** a la izquierda, las características de la misión (nave, requisitos y ventana de aterrizaje) y el botón **Ver**; a la derecha, el mejor sitio con su fecha y veredicto, el reloj lunar y el cielo, y el enlace a la vista avanzada.
  2. **Avanzado:** el top 3 de sitios lado a lado (cada uno en su mejor fecha), con el panel lateral para ajustar la misión y el mapa.
  3. **Replanificar:** «¿Qué ha cambiado?» (retraso, batería, duración, desvío) → el plan con los cambios, la salida A (mismo sitio, siguiente ventana), la salida B (otro sitio, misma fecha), la prueba de desvío y el barrido de retraso.
  - Además: Fuentes de datos, modo explicación y tema gris antracita.
- **Pendiente:** conectar con la API v1 real (`js/api.js`) en cuanto tengamos el `openapi.yaml`, y sustituir `js/busqueda.js` por `/v1/rank` cuando acepte requisitos y ventana.
- Todo son **datos simulados**: relieve inventado, efemérides aproximadas y coordenadas aproximadas. Detalle en el [README](README.md).

## 6. Material de presentación

- Vídeo explicativo de 4 minutos, en 15 escenas: por qué el sur, el problema, la fecha, Athena, qué necesita una misión, cómo se hace hoy, la propuesta y el recorrido por las vistas. Es un artefacto privado de quien lo creó; hay que pedírselo o que lo comparta.
- La locución (voz Jorge, sincronizada con el vídeo) está en `presentacion/`, con el guion en `presentacion/guion.json`.

## 7. Qué puede hacer el compañero en paralelo

1. **Correr la API v1 en local** (pedir el repo o la carpeta `data/` y el `openapi.yaml`) y comprobar los nombres reales de los campos de `/v1/windows` y `/v1/rank`. Con eso se escribe `js/api.js` (la capa que llama al backend y, si no responde, usa lo simulado).
2. **Coordenadas reales** de los sitios del catálogo con Quickmap, y cruzarlas con `/v1/sites` (`coordinatesVerified`). Sustituir las de `js/datos.js`.
3. **Requisitos reales de naves:** autonomía de batería, duración típica y necesidades de comunicación de landers CLPS y de Artemis III (hoy solo está confirmado «6–7 días de Sol» para Artemis III). Son los valores de los perfiles.
4. **Llevarlo al ciclo de discovery:** `/iniciativa` con los tres paneles y `/prd` del panel Planificar, para que salgan historias para la software-factory.
5. **Probar con alguien de fuera:** «encuentra dónde y cuándo aterrizar con esta nave» y medir el tiempo y dónde se atasca (objetivo `comparar-sitios-rapido` del `contexto.md` del repo de discovery).
6. **Hacer de backend en el hilo:** perseguir lo pedido en CONTRATO-BACKEND.md, sobre todo `/rank` con requisitos y ventana, y la fecha del relieve LOLA.
