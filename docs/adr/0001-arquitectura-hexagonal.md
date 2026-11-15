# ADR 0001 · Arquitectura hexagonal (puertos y adaptadores) en la interfaz

- **Estado:** propuesto
- **Fecha:** 2026-11-14
- **Decide:** los tres responsables de `web/` y quien lleva `planner/`
- **Historia:** Replanificar tras un retraso (iniciativa `replanificar-fecha-o-sitio-tras-un-retraso-sin-comparar-esce`, borrador de la sección 8)

## Contexto

Hoy `web/` no consume datos reales: todo sale del motor simulado `web/js/engine/model.js` (relieve inventado y efemérides aproximadas). Ese motor se importa directamente desde seis módulos: las vistas, el mapa, los gráficos y el estado. Las vistas, además, leen el DOM y calculan reglas de negocio dentro del `render`. Pasar a datos reales obligaría a tocar todas las vistas.

En el repo ya hay dos piezas que encajan:

- `planner/src/rules.js` e `intervals.js` son un **dominio puro**: ESM, sin dependencias de Node, con tests. Reciben **ventanas de visibilidad** (intervalos de Sol y de Tierra) y un perfil de misión, y devuelven un veredicto con su motivo.
- `planner/src/api.js` ya convierte `/v1/windows` de la API de datos (`data/`) en esas ventanas: en la práctica, es un adaptador.

Hay dos semáforos que no coinciden: `web/` decide con 3 reglas (`M.verdict`) y `planner/` con 7. Y el sitio publicado en GitHub Pages es estático, así que no puede llamar a `localhost:3100`.

## Decisión

Separar dominio, puertos y adaptadores, empezando por **una sola parte vertical: Replanificar**. Planificar y Avanzado migran después, cada una con su responsable.

| Capa | Dónde | Qué hay |
|---|---|---|
| Dominio | `planner/src/` | `rules.js` (reglas y veredicto, con la nueva R8 «Tierra suficiente»), `intervals.js` y `replan.js` (opciones A, B y C, margen, distancia y sugerencia). Funciones puras y síncronas |
| Puerto | `web/js/ports/visibility.js` | `loadWindows(site, fromMs, toMs) → Promise<w>`, con `w` en la forma de `planner`: `{ site, startMs, endMs, sun, earth, sunAndEarth }` |
| Adaptadores de salida | `web/js/adapters/` | `visibility-fake.js` (el motor simulado, con su relieve, convertido en ventanas). Más adelante: la API v1 (envolviendo `planner/src/api.js`) o un JSON precalculado por sitio para Pages |
| Aplicación | `web/js/application/replan-service.js` | Precarga las ventanas una vez (asíncrono), las guarda en caché y llama al dominio (síncrono) |
| Adaptador de entrada | `web/js/views/replan.js` | Lee el formulario, llama al servicio y pinta |
| Raíz de composición | `web/js/app.js` | Elige el adaptador y se lo da al servicio |

Reglas:

1. El dominio no importa nada de `web/` ni del DOM.
2. Las vistas migradas no importan `engine/model.js` para decidir: piden al servicio.
3. El puerto es asíncrono desde el principio. La precarga deja el dominio y el `render` síncronos: el usuario ve «Calculando…» una vez al entrar o al cambiar la ventana de fechas.
4. Los perfiles de `web/` se traducen a reglas de `planner/`: R1, R2, R4 (batería) y R8 (% de Tierra) activas; R3, R5, R6 y R7 apagadas.

Para servir el dominio en el navegador, `planner` se añade a `MOUNTS` en `serve.mjs` y su `src/` se copia en el workflow de Pages.

## Alternativas descartadas

- **Sacar `rules.js` e `intervals.js` a un paquete `core/` nuevo.** Queda más limpio, pero mueve código de otra persona y rompe sus rutas. Se puede hacer más adelante sin cambiar la arquitectura.
- **Copiar el dominio en `web/js/domain/`.** Dos copias que divergen.
- **Puerto síncrono.** Funciona con el motor simulado, pero obliga a rehacer todo cuando llegue la API.
- **Migrar todo `web/` de golpe.** Toca las tres zonas a la vez y retrasa la demo.
- **Usar ya la API v1.** No tiene relieve: en el polo casi todo sale viable y la replanificación pierde sentido; además, no funciona en Pages.

## Consecuencias

- Durante la transición, **Planificar y Avanzado siguen con `M.verdict` y Replanificar usa `planner/`**. Con R8 las reglas coinciden, pero «Justo» cambia: en `planner/` es cualquier regla con menos de un 10 % de margen. Un mismo plan puede salir «Viable» en una vista y «Justo» en otra en los casos límite. Se resuelve migrando las otras dos vistas (issue aparte).
- El adaptador simulado muestrea el modelo cada 30 minutos: los bordes de cada ventana tienen un error de ±15 minutos.
- Cambiar de datos simulados a reales es un adaptador nuevo y una línea en `app.js`.
- Lo que le pediremos al backend para replanificar es la forma que devuelve `replanOptions`: en el producto puede calcularse en el servidor o seguir en el navegador sobre `/v1/windows`.
- Los tests del dominio de replanificar viven en `planner/test/` y entran en `npm test` de la raíz, así que la release y Pages los ejecutan.

## Seguimiento

- **2026-11-14 · Planificar y Avanzado migrados.** Usan el mismo puerto y el mismo adaptador que Replanificar, a través de `web/js/application/mission-service.js`, y deciden con `planner/src/rules.js` (R1, R2, R4 y R8). Las tres vistas dan ya el mismo veredicto para el mismo aterrizaje, también «Justo». El margen ante retrasos sale de `marginDays` de `planner/src/replan.js` en las tres. La puntuación y el orden de la búsqueda siguen en `web/js/engine/search.js`. El puerto gana un método opcional, `loadSky`, solo para dibujar el cielo hora a hora (`/v1/track` y `/v1/horizon` de la API 1.2, o el motor simulado): no decide nada.
