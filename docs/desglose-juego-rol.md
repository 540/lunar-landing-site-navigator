# Varados en el polo · Plan: objetivo, necesidades, reparto del cálculo y épicas

Fecha: 2026-11-14. Estado: propuesta para validar con el equipo antes de crear las épicas en el repo de código (`540/lunar-landing-site-navigator`).

Fuentes:
- Prototipo del juego publicado como artifact («Varados en el polo», https://claude.ai/artifact/GeMFf9P3QqpwZN1w6mqumr; copia congelada en [`juego-rol/`](juego-rol/)): un único HTML de unos 74 KB, con un mapa de relieve en canvas 2D, una Luna 3D con Three.js r128 y una textura (`moon.jpg`). Datos simulados.
- Plan de la pantalla 3D, con la que comparte base: `iniciativas/mirador-polo-sur/anexos/2026-11-13-plan-mirador-del-polo-sur.md` (en adelante, «plan del Mirador»).
- Reto: `fuentes/2026-11-13-reto-lunar-landing-site-navigator.md`. El reto cita expresamente «an educational game» como formato válido (§ Objectives, último párrafo).
- API pública v1 del grupo: `fuentes/2026-11-13-api-publica-v1-openapi.yaml` y `fuentes/2026-11-13-api-publica-v1-hilo-slack.md`.

Leyenda: `REVISAR` = sin fuente, pendiente de confirmar con quien se indica. 💡 = propuesto por la IA, pendiente de validar.

## Índice

0. Resumen
1. Qué es el juego hoy: inventario del prototipo
2. Objetivo
3. Necesidades previas
4. Desarrollo por partes: qué se calcula y dónde
5. Relación con el Mirador: qué se comparte
6. Cómo troceamos
7. Mapa de épicas
8. Épicas, historias y cómo las abordaremos
9. Hitos de entrega
10. Orden, carriles y equipo
11. Calidad: pruebas, equilibrio y dispositivos
12. Demo y entrega
13. Riesgos
14. Cómo pasarlo a GitHub
15. Temas pendientes

## 0. Resumen

1. **Qué:** convertir el prototipo «Varados en el polo» en un juego educativo real. Un rover tripulado aterriza desviado al borde de un cráter y tiene que cargar al Sol, enviar datos cuando ve la Tierra y llegar a la nave de ascenso antes de que se cierre la ventana.
2. **Por qué un juego:** el Mirador explica; el juego obliga a **decidir** con las mismas reglas (Sol rasante, relieve, Tierra en el horizonte). Es el formato que el reto menciona para educadores y público.
3. **Mismo principio de reparto que el Mirador:** casi todo se precalcula. El prototipo calcula en el navegador el relieve, unos 10 millones de muestras para las máscaras al cargar y la iluminación del mapa píxel a píxel. Todo eso pasa al pipeline. El cliente solo aplica las reglas del juego sobre tablas.
4. **Pieza nueva clave: el escenario.** Un fichero que fija región, zona de juego, salida, plataforma, fecha UTC de inicio de la misión y parámetros por nivel. El pipeline genera sus tablas: Sol y Tierra por celda y por hora, pendientes y máscaras.
5. **Pieza nueva clave: el motor de reglas compartido.** El mismo código decide qué pasa al conducir, esperar o transmitir, en el navegador y en un **resolutor** (un jugador automático) que se ejecuta en el pipeline. El resolutor comprueba que cada escenario y nivel se puede ganar, sin ser trivial, y da una ruta de referencia para el final.
6. **Comparte casi toda la base con el Mirador:** repo, despliegue, catálogo, efemérides, pipeline del relieve, anillo del horizonte y vista órbita. No se construye dos veces.
7. **Troceo:** 11 épicas (J0 a J10) más una futura (J11, multijugador en clase), empezando por un walking skeleton jugable de punta a punta.
8. **Hitos:** G0 (jugable mínimo) → G1 (misión completa, demo defendible) → G2 (bonito y ligero) → G3 (experiencia completa con introducción, niveles y final) → G4 (relieve real) → G5 (pulido).

## 1. Qué es el juego hoy: inventario del prototipo

### 1.1 Estructura

| Parte | Qué ve y hace el jugador |
|---|---|
| **Introducción** | «Te has posado a 400 m del objetivo» (paralelismo con Athena, IM-2, 2025-03-06). Opción de saltar directamente a la misión |
| **Prueba 1 · Sombras** | Predicción sobre qué hacen las sombras en 2 días; revelación con una animación de 48 h en el mapa: las sombras giran, no se acortan |
| **Prueba 2 · Energía** | Predicción sobre la batería tras 10 h en sombra; revelación con un minigráfico de batería al sol y en sombra durante 24 h |
| **Prueba 3 · Comunicaciones** | Predicción sobre desde dónde se ve la Tierra; revelación con la capa de celdas que ven la Tierra |
| **Misión** | Modal «Tres pasos para salir de la Luna»; pulso animado que señala la plataforma y su distancia. Objetivo: enviar N paquetes cuando se vea la Tierra y llegar a la plataforma con un mínimo de batería antes del día límite |
| **Final** | Despegue confirmado, batería agotada o ventana cerrada; mapa tintado según el % del tiempo con Sol durante la misión; tres lecciones («El Sol rueda rasante», «El relieve manda», «La Tierra roza el horizonte»); jugar otra vez o volver a la introducción |

### 1.2 Mecánicas

| Mecánica | Detalle en el prototipo | Dónde está |
|---|---|---|
| Mapa | Rejilla de 48 × 48 celdas de 250 m (12 × 12 km) con relieve procedural, cráter grande, colinas y 420 cráteres de detalle visual | `Core.makeWorld`, `Terrain.build` |
| Iluminación del mapa | Sombras calculadas píxel a píxel trazando rayos hacia el Sol, a 256 o 512 de resolución, con sombreado de pendiente, albedo y oclusión ambiental | `Terrain.shadow`, `Terrain.light`, `relight` |
| Máscaras | 72 azimuts por celda, 60 pasos por rayo, calculadas al cargar | `Core.makeWorld` (bucle `M`) |
| Sol y Tierra | Fórmulas simuladas; el Sol se trata como disco (fracción visible) | `Core.sunAt`, `Core.earthAt`, `Core.sunFrac`, `Core.earthVis` |
| Rutas | Tocar el mapa calcula la ruta con Dijkstra (búsqueda del camino más barato) con pendiente máxima por nivel y coste creciente con la cuesta; vista previa con km, horas y batería estimada; «Conducir» la anima | `Core.pathTo`, `Core.move`, clic en `#map`, `act` |
| Energía | Carga al Sol según la fracción de disco visible (con umbral mínimo de paneles en experto); consumo distinto al Sol y en sombra; conducir suma consumo | `Core.pass`, `LEVELS` |
| Tiempo | Esperar 2 h, 6 h, hasta tener Sol o hasta ver la Tierra | `Core.wait` |
| Comunicación | «Transmitir» solo si se ve la Tierra; cuesta tiempo y batería | `Core.transmit` |
| Eventos | En intermedio y experto, uno al azar: pico de consumo (−12 %) o fallo de antena (transmitir tarda el doble durante 24 h) | `Core.newGame`, `Core.pass` |
| Niveles | Principiante, intermedio y experto: paquetes (3, 4, 5), batería inicial, día límite (14, 12, 10), carga, consumos, batería mínima al despegar, pendiente máxima, capa de Tierra (siempre, a voluntad, nunca) | `Core.LEVELS` |
| Ayudas | Pista contextual (no en experto), capa «Tierra visible», anillo del horizonte, registro de eventos | `hint`, `showEarth`, `drawRing`, `S.log` |
| HUD | Batería con marca del mínimo, paquetes, reloj, comprobaciones animadas | `renderHud`, `checksHtml` |
| Luna 3D | La Luna con la trayectoria del Sol y la Tierra en el cielo lunar, estelas, flechas de sentido, marcador pulsante en el polo sur; arrastrar y rueda | `Moon3D` |
| Idioma y nivel | es/en y tres niveles, en la cabecera | `TXT`, `INTRO`, `#langSeg`, `#lvSeg` |
| Multijugador en clase | Solo anunciado: proyector con mapa compartido, equipos por QR (ciencia quiere el hielo en sombra, ingeniería luz y Tierra), votos por equipo y rutas de todos al final | `#classBtn` |
| Móvil | Pestañas Mapa / Luna por debajo de 940 px | `#tabs` |

## 2. Objetivo

### 2.1 Qué queremos conseguir

Que el jugador **viva** por qué el sitio y la fecha deciden una misión al polo sur: que tenga que buscar luz para no quedarse sin batería, subir a zonas altas para ver la Tierra y calcular si le da tiempo, y que al final sepa explicar las tres lecciones.

| Objetivo de `contexto.md` | Qué aporta el juego |
|---|---|
| `entender-la-luna` | Es su razón de ser (reto § Objectives 7, § Engagement and impact: «educational tool») |
| `ventanas-operativas-claras` | El jugador usa ventanas de Sol y Tierra para decidir; la batería traduce la luz en horas de aguante |
| `demo-convincente` | Una pieza jugable y distinta del resto de equipos |
| `comparar-sitios-rapido` | Indirecto: la vista previa de ruta compara destinos por energía y tiempo |

### 2.2 Para quién

- **Público general y estudiantes:** la misión en principiante o intermedio.
- **Educadores:** las pruebas de la introducción y el final con lecciones; en el futuro, el multijugador en clase.
- **Jurado:** una partida corta de demo.

### 2.3 Hipótesis 💡 (REVISAR con el equipo)

| Hipótesis | Métrica | Umbral | Plazo |
|---|---|---|---|
| Tras una partida, el jugador sabe explicar las tres lecciones | Personas que explican al menos dos de tres, en una prueba con 5 personas | 4 de 5 | Antes de la entrega |
| El nivel principiante se gana sin frustrar | Personas que ganan en el primer o segundo intento | 4 de 5 | Antes de la entrega |
| La partida cabe en una demo | Duración media de una misión en principiante | Entre 5 y 10 minutos | Antes de la entrega |
| El juego va fluido en un equipo modesto | Fotogramas por segundo al animar la conducción | 30 o más | En cada hito desde G2 |

### 2.4 Qué no es

- No es un simulador de ingeniería: el modelo de batería es didáctico y sus cifras lo dicen.
- No es el multijugador en clase: queda como épica futura (J11).
- No cubre cualquier sitio de la Luna: solo los escenarios diseñados.

## 3. Necesidades previas

### 3.1 Del Mirador y del grupo (base común)

El juego reutiliza piezas del plan del Mirador. Si el juego va primero, estas piezas se construyen dentro de J0.

| Necesidad | Origen | Bloquea |
|---|---|---|
| Repo, despliegue, CI y diccionario de textos | Mirador E0.1 | J0 |
| Copia del catálogo (`catalog.json`) | Mirador E0.2 | J9 |
| Volcado de efemérides con el código de la API | Mirador E0.3 | J9 (en J0 basta con efemérides simuladas o reales de una fecha) |
| Pipeline del relieve con formato definitivo | Mirador E0.2 y E9 | J4, J9 |
| Anillo del horizonte como componente | Mirador E1.1 | J3 |
| Vista órbita como componente | Mirador E4 | J8 |
| Acuerdo de que este frente hace el preprocesado del relieve | Grupo (hilo de Slack) | J9 |

### 3.2 Decisiones propias del juego

| Decisión | Quién | Bloquea | Propuesta |
|---|---|---|---|
| **¿Mirador o juego primero?** | Equipo y negocio | Todo el orden | Ver sección 10.2 |
| Región real del escenario principal | Producto y técnico | J9 | Una de las del Mirador (por ejemplo, Shackleton), para compartir datos 💡 |
| Zona y rejilla de juego | Técnico | J0 | Mantener 48 × 48 celdas de 250 m (12 × 12 km), como el prototipo 💡 |
| Fecha UTC de inicio de la misión por escenario | Producto | J9 | Una fecha en la que haya Sol al principio y la Tierra asome a mitad de partida, elegida con el resolutor 💡 |
| Modelo de batería y parámetros por nivel | Producto y técnico | J2 | Los del prototipo como punto de partida, ajustados con el resolutor |
| Coherencia con el planificador | Producto y planificador | J2 | Expresar el aguante de la batería en las mismas magnitudes que los requisitos de misión del planificador (horas máximas en sombra, `maxDarkHours`) |
| Mapa en WebGL o canvas 2D | Técnico | J4 | WebGL con shader para la iluminación; canvas 2D con tablas por celda como modo ligero |

### 3.3 Datos y material

| Qué | Para qué | Estado |
|---|---|---|
| Textos de introducción, pruebas, pistas, eventos y final en es/en y tres niveles | Todo el juego | En el prototipo (`TXT`, `INTRO`, `LOGT`, `hint`, `renderEnd`) |
| Iconos e ilustraciones animadas del modal de misión | J6 | En el prototipo (`IC`, `GICON`) |
| Textura de la Luna | J8 | En el artifact (`moon.jpg`); se unifica con las del Mirador |
| DEM de LOLA | J9 | El del Mirador (REVISAR producto y resolución) |
| Cifras de Athena y temperaturas de las regiones en sombra permanente (unos 35 a 40 K) | Textos | REVISAR fuente |

### 3.4 Accesos y entorno

Los mismos que el Mirador. Además, **Node en el pipeline** para el resolutor, porque usa el motor de reglas del juego, que es JavaScript.

## 4. Desarrollo por partes: qué se calcula y dónde

### 4.1 La regla (la misma que en el Mirador)

| Nivel | Qué hace en el juego |
|---|---|
| **Preprocesado** | Todo lo que depende del relieve y de la fecha del escenario: imagen del mapa, máscaras, tablas de Sol y Tierra por celda y hora, pendientes, validación con el resolutor |
| **Backend** | Nada en tiempo de juego. La API solo se usa en el pipeline (efemérides con su código) |
| **Cliente** | Reglas del juego sobre tablas, búsqueda de ruta en una rejilla pequeña, animación e interfaz |

La única excepción consciente: **la búsqueda de ruta se hace en el cliente**, porque depende de dónde toque el jugador y del estado de la partida. Con 2.304 celdas y una cola de prioridad (heap) tarda menos de 5 ms. El prototipo usa una búsqueda sin heap que recorre todas las celdas en cada paso (unos 5 millones de operaciones por clic), y eso hay que cambiarlo.

### 4.2 Qué depende de qué

| Depende de… | Ejemplos | Dónde |
|---|---|---|
| Solo del relieve | Imagen del mapa (normales, albedo, oclusión, cráteres de detalle), horizonte por píxel, máscaras por celda, pendientes entre celdas | Preprocesado |
| Del relieve y de la fecha del escenario | Fracción de Sol y visibilidad de la Tierra por celda y hora; mapa de iluminación media | Preprocesado |
| De las reglas y de cada nivel | ¿Se puede ganar? ¿Con cuánto margen? Ruta de referencia | Preprocesado (resolutor) |
| De lo que hace el jugador | Posición, batería, tiempo, paquetes, ruta, eventos | Cliente (motor de reglas) |

### 4.3 Tabla completa

| Cálculo | En el prototipo | Propuesta | Por qué |
|---|---|---|---|
| Relieve de la rejilla | Cliente (`makeWorld`) | **Preprocesado**: altura por celda | Fijo |
| Relieve de detalle e imagen del mapa | Cliente (`Terrain.build`: ruido, 420 cráteres, desenfoque para la oclusión, a 1024 × 1024) | **Preprocesado**: texturas de normales, albedo y oclusión | Es lo más lento del arranque |
| Máscaras por celda (anillo del horizonte) | Cliente: unos 10 millones de muestras al cargar | **Preprocesado**: 2.304 celdas × 72 azimuts en 16 bits (unos 330 KB) | El cuello de botella del arranque en equipos modestos |
| Sombras del mapa en cada instante | Cliente: rayos por píxel en cada cambio de hora | **Preprocesado: horizonte por píxel** (por ejemplo, 256 × 256 × 32 direcciones, unos 2 MB). El shader (programa de la tarjeta gráfica) compara la elevación del Sol con ese horizonte | De lo más caro en CPU a casi gratis en GPU |
| Fracción de Sol por celda y hora | Cliente (`sunFrac`, en cada paso de simulación) | **Preprocesado**: 2.304 celdas × horas de misión en 8 bits (unos 780 KB para 14 días) | El motor de reglas solo consulta |
| Tierra visible por celda y hora | Cliente (`earthVis`) | **Preprocesado**: 1 bit por celda y hora (unos 100 KB) | Igual; alimenta también la capa azul |
| Pendientes y coste de paso entre celdas | Cliente (`slope`, `stepCost`) | **Preprocesado**: pendiente hacia cada una de las 8 vecinas | El coste por nivel (pendiente máxima) se aplica en el cliente |
| Ruta | Cliente (Dijkstra sin heap) | **Cliente**, con heap | Depende del clic; con heap es barata |
| Vista previa de la ruta (batería estimada) | Cliente (simula la conducción) | **Cliente**, con el motor de reglas y las tablas | Unas decenas de pasos de consulta |
| Batería, tiempo, paquetes y eventos | Cliente | **Cliente**, motor de reglas puro y determinista, con semilla para los eventos | Es el juego |
| Mapa de iluminación del final | Cliente (media sobre la misión en el momento) | **Cliente**, media de la tabla de Sol entre el inicio y el final de la partida | Una suma sobre una tabla |
| ¿Se puede ganar cada nivel? Margen y ruta de referencia | No existe | **Preprocesado: resolutor** con el mismo motor de reglas | Equilibrio garantizado con datos reales |
| Sol y Tierra en la Luna 3D | Cliente (fórmulas) | **Preprocesado**: serie del escenario (formato del Mirador) | Mismos datos que el resto |
| Reglas, niveles y textos | En el código | **Ficheros estáticos** (`levels.json`, textos) | Equilibrar sin tocar código |

### 4.4 El escenario y sus ficheros

Un **escenario** es una partida diseñada: región, zona de juego, salida, plataforma, fecha de inicio y niveles. Ficheros por escenario (formatos orientativos, REVISAR con técnico):

| Fichero | Contenido | Tamaño orientativo |
|---|---|---|
| `scenario.json` | Id, nombre es/en, región del catálogo, extensión y paso de la rejilla, `SceneFrame`, salida, plataforma, fecha UTC de inicio, duración máxima, versión y fuentes | Unos KB |
| `levels.json` | Parámetros por nivel (los de `LEVELS` del prototipo) | Unos KB |
| `cells.bin` | Altura por celda y pendiente hacia sus 8 vecinas | Unos 30 KB |
| `sun.bin` | Fracción de Sol por celda y hora | Unos 780 KB (14 días) |
| `earth.bin` | Tierra visible por celda y hora | Unos 100 KB |
| `masks.bin` | Máscara de 72 azimuts por celda | Unos 330 KB |
| `map-normals.png`, `map-albedo.png`, `map-ao.png` | Imagen del relieve | 1 a 2 MB |
| `map-horizon.bin` | Horizonte por píxel (32 direcciones) | Unos 2 MB |
| `series.bin` | Sol y Tierra por hora en los ejes de la región (formato del Mirador) | Unos 10 KB para 14 días |
| `solver.json` | Por nivel: se puede ganar o no, margen de batería y de tiempo, ruta y acciones de referencia | Unos KB |

Total por escenario: de 3 a 5 MB. El modo ligero (J10) solo necesita unos 1,3 MB (sin texturas ni horizonte por píxel).

### 4.5 El motor de reglas y el resolutor

- **Motor de reglas:** un módulo puro (sin DOM) que recibe estado, acción y tablas y devuelve el estado nuevo. Se porta de `Core.pass`, `Core.move`, `Core.wait`, `Core.transmit` y `Core.check`. Determinista: mismos datos, misma semilla y mismas acciones dan siempre el mismo resultado.
- **Resolutor:** un programa del pipeline (Node) que usa ese mismo motor para buscar una buena secuencia de acciones en cada escenario y nivel (por ejemplo, búsqueda en un grafo de estados reducido: celdas clave, esperas y transmisiones). Produce `solver.json`.
- **Para qué sirve el resolutor:**
  - Garantiza que cada nivel se puede ganar con datos reales.
  - Avisa si un nivel es trivial (gana sin esperar ni buscar la Tierra).
  - Ayuda a elegir la fecha de inicio y la posición de la plataforma.
  - Da la ruta de referencia que se enseña en el final.

### 4.6 El cliente

- Dibuja el mapa en WebGL: un shader combina normales, albedo, oclusión y horizonte por píxel con la posición del Sol interpolada de la serie.
- Superpone capas (Tierra visible, iluminación media, ruta, vista previa) a partir de las tablas por celda.
- Ejecuta el motor de reglas, la búsqueda de ruta y las animaciones.

Presupuestos:

| Presupuesto | Objetivo |
|---|---|
| Descarga hasta ver el mapa | ≤ 3 MB |
| Descarga total del escenario | ≤ 5 MB |
| Búsqueda de ruta | ≤ 10 ms |
| Respuesta al tocar el mapa (ruta y vista previa) | ≤ 50 ms |
| Fotogramas al animar | ≥ 30 en un equipo modesto |

## 5. Relación con el Mirador: qué se comparte

| Pieza | Mirador | Juego | Cómo se comparte |
|---|---|---|---|
| Repo, despliegue, CI | E0.1 | J0 | El mismo repo y el mismo despliegue, con dos páginas: `/` (Mirador) y `/juego` (Vite con varias páginas) |
| Catálogo, `SceneFrame`, convenciones de la API | E0.2 | J9 | Mismo `src/core` y mismo `src/data` |
| Efemérides (volcado) | E0.3 | J9 | Mismo pipeline; el juego pide una serie por escenario |
| Pipeline del relieve | E0, E9 | J4, J9 | Mismo pipeline, con una salida más: el escenario de juego |
| Anillo del horizonte | E1.1 | J3 | Mismo componente; el juego le pasa la máscara de su celda |
| Vista órbita | E4 | J8 | Mismo componente; el juego activa las estelas y las flechas del prototipo |
| Idioma, niveles y accesibilidad | E8 | J10 | Mismo diccionario y mismo selector |
| Calidad gráfica | E5.5 | J4 | Mismos niveles y presupuestos |
| Three.js | 0.160 | r128 en el prototipo | Se unifica en 0.160 |
| Enlaces cruzados | Final de la visita | Final de la partida | «¿Te atreves? Juega la misión» desde el Mirador; «Explora este sitio en 3D» desde el final del juego |

## 6. Cómo troceamos

Mismos principios y misma definición de terminado que el plan del Mirador (sección 4), con tres añadidos:

1. **El motor de reglas no toca el DOM** y tiene tests de partidas completas: secuencias de acciones con resultado conocido.
2. **Todo escenario publicado pasa el resolutor**: cada nivel se puede ganar y ninguno es trivial.
3. **Equilibrar es cambiar datos** (`levels.json`, `scenario.json`), no código.

## 7. Mapa de épicas

```
Base común (Mirador E0) ─► J0 Esqueleto jugable ─► J1 Rutas ─► J2 Energía y tiempo ─► J3 Tierra ─┬─► J5 Introducción ─┐
                                                                                                  ├─► J6 Niveles ──────┼─► J7 Final
                                                                                                  └─► J4 Mapa ligero ──┘
                         J8 Luna 3D (reutiliza Mirador E4)        J9 Escenario real (tras Mirador E9)
                         J10 Idioma, accesibilidad y modo ligero   J11 Multijugador en clase (futuro)
```

| Épica | Valor para el jugador en una frase | Depende de | Historias | Tamaño |
|---|---|---|---|---|
| J0 Esqueleto jugable | «Puedo ganar o perder una misión mínima en una URL» | Base común | 5 | S+M+M+S+S |
| J1 Rutas | «Planeo una ruta, veo lo que me cuesta y conduzco» | J0 | 4 | M+M+S+S |
| J2 Energía y tiempo | «Entiendo que la sombra me vacía la batería y espero al Sol cuando toca» | J1 | 4 | M+S+S+S |
| J3 Tierra | «Busco dónde y cuándo se ve la Tierra para transmitir» | J2, Mirador E1.1 | 4 | M+S+S+S |
| J4 Mapa ligero | «El mapa es precioso, las sombras giran y va fluido en mi equipo» | J0, Mirador E5 | 4 | M+M+S+S |
| J5 Introducción | «Tres pruebas cortas me enseñan las reglas antes de jugar» | J3 | 4 | S+M+M+S |
| J6 Niveles, eventos y ayudas | «Elijo dificultad y la partida me sorprende y me orienta» | J3 | 5 | S+M+S+M+S |
| J7 Final | «Al acabar entiendo qué ha pasado y por qué» | J6 | 4 | S+M+S+S |
| J8 Luna 3D | «Veo cómo se mueven el Sol y la Tierra en el cielo lunar mientras juego» | J0, Mirador E4 | 2 | S+S |
| J9 Escenario real | «Juego sobre el relieve real del polo sur en una fecha real» | Mirador E9, J7 | 4 | M+M+S+S |
| J10 Idioma, accesibilidad y modo ligero | «Juego en inglés, en el móvil, con teclado o sin 3D» | J3 | 4 | M+S+M+S |
| J11 Multijugador en clase (futuro) | «Mi clase juega por equipos desde el móvil» | J7, backend en tiempo real | — | Fuera de alcance |

## 8. Épicas, historias y cómo las abordaremos

### J0 · Walking skeleton jugable

**Objetivo.** Una misión mínima, de punta a punta, en `/juego`: mapa, rover, plataforma, tiempo, batería, ganar o perder. Todo desde ficheros generados por el pipeline.

**Cómo la abordaremos.**
- El pipeline genera el escenario con el relieve procedural del prototipo (`makeWorld`), pero ya con el formato definitivo (sección 4.4). El día del relieve real solo cambia la fuente.
- El mapa de J0 es una imagen estática de sombreado del relieve con un tinte por celda (iluminada o en sombra) sacado de `sun.bin`. El shader bonito llega en J4.
- El motor de reglas se porta primero, con tests, y la interfaz se cuelga de él.

**J0.1 · La página del juego existe**
- Ve: `/juego` con el título «Varados en el polo» y el aviso «Demo · relieve simulado».
- Incluye: segunda página en el mismo repo y despliegue que el Mirador; carpeta `src/game`.
- Tamaño: S.

**J0.2 · El escenario generado por el pipeline**
- Ve: el mapa de 12 × 12 km con la salida y la plataforma; las celdas en sombra se oscurecen según la hora.
- Incluye: pipeline: `scenario.json`, `cells.bin`, `sun.bin`, `earth.bin` e imagen de sombreado; cliente: carga y dibujo.
- Criterios: los ficheros validan contra su esquema; el cliente no calcula relieve ni máscaras; la descarga es menor de 3 MB.
- Reutiliza: `Core.makeWorld` y `Core.sunFrac` (portados al pipeline).
- Tamaño: M.

**J0.3 · El rover se mueve y el tiempo pasa**
- Ve: al tocar una celda, el rover va en línea recta (sin pendientes todavía); el reloj avanza; la batería sube al Sol y baja en sombra.
- Incluye: motor de reglas (`pass`, `move`, `check`) con los parámetros del nivel intermedio en `levels.json`.
- Criterios: tests del motor: una secuencia fija de acciones da siempre el mismo estado final.
- Reutiliza: `Core.pass`, `Core.move`, `Core.check`, `Core.newGame`.
- Tamaño: M.

**J0.4 · Ganar o perder**
- Ve: llegar a la plataforma con batería suficiente gana; batería a cero o día límite pierde; pantalla final básica con el motivo y «Jugar otra vez». En J0 no hace falta transmitir: los paquetes llegan en J3.
- Reutiliza: `Core.check`, `renderEnd` (versión mínima).
- Tamaño: S.

**J0.5 · El esqueleto está probado**
- Incluye: tests del motor de reglas, validación de esquemas y prueba de humo de `/juego`.
- Tamaño: S.

**Hito G0.**

### J1 · Planificar rutas

**Objetivo.** Que moverse sea una decisión: ver la ruta, lo que cuesta y si se llega.

**Cómo la abordaremos.** Pendientes precalculadas en `cells.bin`; la pendiente máxima y el coste por cuesta se aplican en el cliente según el nivel. Búsqueda de ruta con heap. La vista previa usa el motor de reglas sobre una copia del estado, sin eventos.

**J1.1 · Ruta por el terreno**
- Ve: al tocar una celda, la ruta discontinua por el camino más barato, evitando pendientes de más de la máxima del nivel; si no hay ruta, «No hay ruta posible: las pendientes superan X°».
- Criterios: búsqueda en menos de 10 ms; test con un mapa conocido.
- Reutiliza: `Core.pathTo`, `Core.stepCost` (con heap).
- Tamaño: M.

**J1.2 · Vista previa del coste**
- Ve: km, horas y batería de ahora frente a la de llegada; en rojo si se agota en ruta, en amarillo si se llega por debajo del mínimo; nota «Estimación: las sombras se mueven mientras conduces»; «Conducir» o «Cancelar».
- Criterios: la vista previa coincide con el resultado real de conducir sin eventos.
- Reutiliza: clic en `#map`, `preview`, `renderPlay`.
- Tamaño: M.

**J1.3 · Conducir con animación**
- Ve: el rover avanza por la ruta, el reloj corre y las sombras giran mientras conduce; la ruta recorrida queda dibujada.
- Criterios: animación de 1,8 s como mucho; los botones se bloquean mientras dura.
- Reutiliza: `act`, `disp`, dibujo de la ruta en `drawMap`.
- Tamaño: S.

**J1.4 · Pulso hacia la plataforma**
- Ve: al empezar, un pulso señala la plataforma con la distancia en km.
- Reutiliza: `padPulse`, `drawPadHint`.
- Tamaño: S.

### J2 · Energía y tiempo

**Objetivo.** Que el jugador sienta que la luz es batería.

**Cómo la abordaremos.** Todo es motor de reglas y tablas. Los parámetros del modelo se expresan también en «horas de aguante en sombra», la magnitud que usa el planificador (`maxDarkHours`), para que los dos productos cuenten lo mismo.

**J2.1 · Esperar**
- Ve: «Esperar 2 h», «Esperar 6 h» y «Hasta tener sol» (para en cuanto la celda tiene Sol, con 24 h como máximo).
- Reutiliza: `Core.wait`.
- Tamaño: M.

**J2.2 · Batería en el HUD**
- Ve: barra de batería con la marca del mínimo para despegar, en verde, amarillo o rojo; reloj de misión.
- Reutiliza: `renderHud`, `.batt`.
- Tamaño: S.

**J2.3 · Umbral de paneles**
- Ve: en experto, los paneles solo cargan si asoma al menos la mitad del disco solar.
- Reutiliza: `panelMin` de `LEVELS`.
- Tamaño: S.

**J2.4 · Pista de energía**
- Ve: «Estás en sombra y la batería baja: muévete a una zona iluminada».
- Reutiliza: `hint`.
- Tamaño: S.

### J3 · Comunicación con la Tierra

**Objetivo.** Que el jugador busque el sitio **y** el momento para hablar con casa.

**Cómo la abordaremos.** `earth.bin` decide si se ve la Tierra. El anillo del horizonte es el componente del Mirador, con la máscara de la celda (`masks.bin`).

**J3.1 · Transmitir paquetes**
- Ve: «Transmitir · 2 h · −3 %», activo solo si se ve la Tierra; contador de paquetes en el HUD; la condición de victoria pasa a exigir N paquetes.
- Reutiliza: `Core.transmit`, `.pk`.
- Tamaño: M.

**J3.2 · Capa «Tierra visible»**
- Ve: las celdas desde las que se ve la Tierra ahora, en azul.
- Reutiliza: `earthLayer`, `showEarth`.
- Tamaño: S.

**J3.3 · Esperar a la Tierra**
- Ve: «Hasta ver la Tierra».
- Reutiliza: `Core.wait` con condición.
- Tamaño: S.

**J3.4 · Anillo del horizonte**
- Ve: el anillo de la celda del rover, con el Sol y la Tierra.
- Reutiliza: componente del Mirador (E1.1); `drawRing` del prototipo como referencia visual.
- Tamaño: S.

**Hito G1: misión completa, demo defendible.**

### J4 · Mapa bonito y ligero

**Objetivo.** La calidad visual del prototipo sin calcular sombras en la CPU.

**Cómo la abordaremos.**
- Las texturas (normales, albedo con cráteres de detalle, oclusión) y el horizonte por píxel salen del pipeline.
- Un shader WebGL combina todo con la posición del Sol interpolada.
- Trampa: el horizonte por píxel con 32 direcciones debe cuadrar con `sun.bin` (que manda en las reglas). Se valida que el mapa no enseña Sol donde las reglas dicen sombra.

**J4.1 · Texturas del relieve**
- Incluye: pipeline: `map-normals.png`, `map-albedo.png`, `map-ao.png` con los 420 cráteres de detalle.
- Reutiliza: `Terrain.build`, `blur` (portados al pipeline).
- Tamaño: M.

**J4.2 · Sombras que giran, en la GPU**
- Ve: las sombras largas girando mientras pasa el tiempo, con penumbra cuando el disco asoma a medias.
- Incluye: pipeline: `map-horizon.bin`; cliente: shader.
- Criterios: en el 99 % de las celdas y horas, el mapa y `sun.bin` coinciden en iluminado o en sombra; CPU por fotograma dentro del presupuesto.
- Reutiliza: `Terrain.shadow`, `Terrain.light` (la lógica se porta al pipeline y al shader).
- Tamaño: M.

**J4.3 · Calidad gráfica**
- Ve: en calidad baja, el horizonte por píxel a menos resolución y sin penumbra.
- Reutiliza: niveles del Mirador (E5.5).
- Tamaño: S.

**J4.4 · Etiquetas y leyenda del mapa**
- Ve: «ASCENSO» en la plataforma, leyenda (iluminado, sombra, Tierra visible, rover, plataforma, ruta).
- Reutiliza: `label`, `TXT.leg`.
- Tamaño: S.

**Hito G2.**

### J5 · Introducción y pruebas

**Objetivo.** Enseñar las tres reglas antes de jugar, con predicción y revelación.

**Cómo la abordaremos.** Las pruebas son datos (como los capítulos del Mirador) con su animación asociada. La animación de sombras usa el mismo shader y la misma serie que el juego.

**J5.1 · Pantalla de introducción** (el aterrizaje desviado, «Empezar las pruebas» o «Saltar a la misión»; barra de pasos)
- Reutiliza: `INTRO.intro0`, `renderIntro`, `#steps`.
- Tamaño: S.

**J5.2 · Prueba 1: sombras** (predicción, revelación y animación de 48 h, «Repetir animación»)
- Reutiliza: `INTRO.A`, `runIntroAnim`.
- Tamaño: M.

**J5.3 · Prueba 2: energía** (predicción, revelación y minigráfico de batería al sol y en sombra con los parámetros del nivel)
- Reutiliza: `INTRO.B`, `drawBatteryMini`.
- Tamaño: M.

**J5.4 · Prueba 3: comunicaciones** (predicción, revelación y capa de Tierra en un instante fijo)
- Criterios: el texto experto con «la Tierra asoma hacia el día 2 y se esconde hacia el día 14» sale de `earth.bin` del escenario, no fijo en el texto.
- Reutiliza: `INTRO.C`, `onAnswer`.
- Tamaño: S.

### J6 · Niveles, eventos y ayudas

**Objetivo.** Que la partida se adapte al jugador y tenga algo de sorpresa.

**Cómo la abordaremos.** Niveles en `levels.json`, validados por el resolutor. Eventos con semilla para que una partida se pueda reproducir (útil para pruebas y para el futuro multijugador).

**J6.1 · Selector de nivel** (principiante, intermedio, experto; cambiar de nivel reinicia la misión)
- Reutiliza: `#lvSeg`, `LEVELS`.
- Tamaño: S.

**J6.2 · Modal de misión** (los tres pasos con ilustraciones animadas y las cifras del nivel)
- Reutiliza: `showGoal`, `GICON`, `.gstep`.
- Tamaño: M.

**J6.3 · Comprobaciones en el HUD** (paquetes enviados y listo para despegar, con animación al completarse)
- Reutiliza: `checksHtml`, `.ck`.
- Tamaño: S.

**J6.4 · Eventos** (pico de consumo o fallo de antena en intermedio y experto; registro con fecha)
- Criterios: con la misma semilla, el evento ocurre a la misma hora (test); el resolutor valida que el nivel se gana con cualquiera de los dos eventos.
- Reutiliza: `evAt`, `evType`, `LOGT`, `.log`.
- Tamaño: M.

**J6.5 · Pistas por nivel** (sin pistas en experto; capa de Tierra siempre, a voluntad o nunca)
- Reutiliza: `hint`, `earth` de `LEVELS`, `#layerbtns`.
- Tamaño: S.

### J7 · Final y aprendizaje

**Objetivo.** Cerrar con lo aprendido y con ganas de explorar más.

**Cómo la abordaremos.** El mapa de iluminación media sale de `sun.bin`. La ruta de referencia, de `solver.json`. El enlace al Mirador usa el mismo formato que el del planificador (`?site=…&date=…`).

**J7.1 · Tres finales** (despegue, batería agotada, ventana cerrada, cada uno con su explicación)
- Reutiliza: `renderEnd`.
- Tamaño: S.

**J7.2 · Mapa de iluminación y lecciones** (mapa tintado según el % de tiempo con Sol durante la misión; las tres lecciones)
- Reutiliza: `endGame`, `illumLayer`, bloque «Lo que acabas de vivir».
- Tamaño: M.

**J7.3 · Ruta de referencia**
- Ve: «Así lo resolvió el ordenador»: la ruta del resolutor junto a la del jugador, con su batería mínima y su día de llegada.
- Incluye: `solver.json`.
- Tamaño: S.

**J7.4 · Enlace al Mirador** («Explora este sitio en 3D» abre el Mirador en la región y la fecha de la misión)
- Depende de: Mirador E10.1.
- Tamaño: S.

**Hito G3: experiencia completa.**

### J8 · La Luna 3D del juego

**Objetivo.** Ver, mientras se juega, por qué el Sol rueda por el horizonte y la Tierra apenas se mueve.

**Cómo la abordaremos.** Se reutiliza la vista órbita del Mirador (E4) con lo que el prototipo añade: estelas, trayectorias de un periodo con flechas y marcador pulsante en el polo sur. Datos de la serie del escenario.

- **J8.1 · Panel de la Luna con trayectorias** (sincronizado con el reloj del juego). Reutiliza `Moon3D.setTime` como referencia. S.
- **J8.2 · Pestañas en móvil** (Mapa / Luna por debajo de 940 px). Reutiliza `#tabs`. S.

### J9 · Escenario real

**Objetivo.** Jugar sobre el relieve real del polo sur, en una fecha real, con las cifras de la API.

**Cómo la abordaremos.**
- Cuando el pipeline del Mirador lea LOLA (E9.2), se genera el escenario del juego sobre la misma región, con la rejilla del juego (12 × 12 km a 250 m).
- La fecha de inicio, la salida y la plataforma se eligen con el resolutor: Sol al principio, la Tierra que asoma a mitad de partida, y cada nivel ganable con margen.
- Trampa: en el relieve real puede no existir una combinación tan «didáctica» como en el procedural. El resolutor prueba varias fechas y posiciones y propone las mejores; la decisión final es de producto.

**J9.1 · Resolutor en el pipeline**
- Incluye: resolutor en Node con el motor de reglas; `solver.json`; el pipeline falla si algún nivel no se puede ganar o es trivial.
- Criterios: sobre el escenario procedural, el resolutor gana los tres niveles.
- Tamaño: M.

**J9.2 · Escenario sobre LOLA**
- Ve: el mapa con el relieve real y la fecha UTC real en el reloj; el aviso pasa a «Relieve real de <región>».
- Incluye: pipeline: escenario sobre LOLA con efemérides del volcado.
- Criterios: el resolutor valida los tres niveles; la región se reconoce frente a Quickmap.
- Depende de: Mirador E9.2.
- Tamaño: M.

**J9.3 · Fecha y posiciones elegidas con el resolutor**
- Incluye: el resolutor propone las tres mejores combinaciones de fecha, salida y plataforma con sus márgenes; producto elige.
- Tamaño: S.

**J9.4 · Textos con cifras reales**
- Ve: los textos de nivel experto (días en que asoma la Tierra, elevación máxima del Sol) salen de los datos del escenario.
- Tamaño: S.

**Hito G4.**

### J10 · Idioma, accesibilidad y modo ligero

**Objetivo.** Que lo pueda jugar cualquiera, en cualquier equipo.

**Cómo la abordaremos.** El diccionario de textos existe desde J0. El juego tiene un problema propio de accesibilidad: se juega tocando un mapa. Se añade una forma de elegir el destino con teclado. El modo ligero pinta celdas a partir de las tablas, sin texturas ni shader.

- **J10.1 · Inglés.** Todos los textos en es/en; recuerda la elección. M.
- **J10.2 · Reducir movimiento** (sin animaciones del modal ni del pulso; la conducción salta al final). S.
- **J10.3 · Jugar con teclado** (mover un cursor por el mapa con flechas, Intro para planear la ruta y atajos para esperar y transmitir; lector de pantalla con el estado de la celda: iluminada, Tierra visible, distancia a la plataforma). M.
- **J10.4 · Modo ligero** (sin WebGL o a voluntad: mapa por celdas, unos 1,3 MB, misma partida). S.

### J11 · Multijugador en clase (futuro, fuera de alcance)

Lo que anuncia el prototipo: proyector con el mapa compartido y el reloj, equipos que entran con un QR sin cuentas, roles enfrentados (ciencia quiere el hielo en sombra; ingeniería, luz y Tierra), decisiones votadas por equipo y rutas de todos al final sobre el mapa de iluminación.

Por qué queda fuera: es lo único que necesita un **backend en tiempo real** (estado compartido entre dispositivos). Lo que ya deja preparado este plan: motor de reglas determinista con semilla (todas las pantallas calculan lo mismo con las mismas acciones) y escenarios como datos. Cuando toque, se añade un servicio aparte sin tocar el juego.

## 9. Hitos de entrega

| Hito | Al cerrar | Qué se puede enseñar |
|---|---|---|
| G0 | J0 | Una misión mínima jugable en una URL |
| G1 | J1, J2, J3 | La misión completa: rutas, energía y Tierra. Demo defendible |
| G2 | J4 | Mapa bonito y fluido en equipos modestos |
| G3 | J5, J6, J7 (+ J8) | Experiencia completa: introducción, niveles, final con lecciones y Luna 3D |
| G4 | J9 | Relieve real y fecha real, validados con el resolutor |
| G5 | J10 | Inglés, accesibilidad, teclado y modo ligero |

## 10. Orden, carriles y equipo

### 10.1 Carriles

| Carril | Épicas | Carpetas |
|---|---|---|
| Juego | J0 → J1 → J2 → J3 → J5, J6, J7 | `src/game` |
| Render | J4, J8 (con el carril B y C del Mirador) | `src/scene`, shaders |
| Pipeline | Escenario de J0, J9 (con el carril D del Mirador) | `pipeline/` |
| Cualquiera con hueco | J10 | `src/ui` |

### 10.2 Mirador o juego primero

| Opción | A favor | En contra |
|---|---|---|
| Mirador primero | Su base (E0, E1) es la que el juego reutiliza; cubre mejor «ventanas operativas» | El juego llega tarde a la demo |
| Juego primero | El reto cita el juego educativo; es más diferencial ante el jurado; el walking skeleton es más corto (mapa 2D) | Hay que construir la base común dentro de J0 |
| **En paralelo (recomendado si hay gente)** 💡 | La base común (Mirador E0) la hace un carril y los dos productos avanzan a la vez desde G0 | Requiere al menos dos personas o dos agentes en carriles distintos |

Decisión: REVISAR con el equipo y negocio.

### 10.3 Orden dentro del juego

1. J0 y el motor de reglas con tests, prioridad máxima.
2. J1 → J2 → J3 en serie: cada una añade una regla y el juego sigue siendo ganable.
3. J4 en paralelo desde G1 (no bloquea jugar).
4. J5, J6 y J7 tras G1, en cualquier orden.
5. J9.1 (resolutor) en cuanto exista el motor de reglas: equilibra el procedural y prepara el real.
6. J9.2 en cuanto el Mirador tenga LOLA.

## 11. Calidad: pruebas, equilibrio y dispositivos

| Tipo | Qué comprueba | Dónde |
|---|---|---|
| Motor de reglas | Partidas completas con resultado conocido; determinismo con semilla | CI |
| Equilibrio | El resolutor gana cada nivel con margen y ninguno es trivial | Pipeline (falla si no) |
| Esquemas | Ficheros del escenario | Pipeline y CI |
| Coherencia | Mapa (shader) frente a `sun.bin`; vista previa frente a conducción real | CI |
| Paridad | Serie del escenario frente a la API | CI (la del Mirador) |
| Rendimiento | Descarga, búsqueda de ruta, fotogramas | CI (Playwright) y equipo de referencia |
| Prueba con personas | Hipótesis de la sección 2.3 | Antes de la entrega |

## 12. Demo y entrega

- **Partida de demo 💡:** nivel principiante con un escenario y una semilla fijos, de unos 3 minutos: aterrizaje → saltar las pruebas → ruta al Sol → esperar a la Tierra → transmitir → despegue → mapa de iluminación y ruta de referencia → «Explora este sitio en 3D». REVISAR con el equipo.
- **Plan B sin red:** escenario de demo precargado con service worker (un pequeño programa del navegador que guarda ficheros para usarlos sin conexión), como en el Mirador.
- **Plan C:** vídeo grabado de la partida.
- **Créditos:** los del Mirador más la mención a Athena (IM-2) como inspiración, con su fuente.

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Con relieve real no sale un escenario didáctico | El juego pierde gracia o es imposible | Resolutor que explora fechas y posiciones (J9.3); si no hay ninguno bueno, mantener el procedural para principiante, con aviso |
| El mapa enseña algo distinto de lo que dicen las reglas | Confusión («había Sol y no cargué») | Test de coherencia shader frente a `sun.bin` (J4.2) |
| Modelo de batería poco creíble para el jurado | Credibilidad | Cifras etiquetadas como didácticas; coherencia con `maxDarkHours` del planificador |
| Búsqueda de ruta lenta en móviles | Toques que tardan | Heap y presupuesto de 10 ms en el CI |
| Dos productos compitiendo por el mismo equipo | Ninguno llega pulido | Decisión explícita de la sección 10.2; base común compartida |
| Jugar tocando un mapa excluye a quien usa teclado o lector de pantalla | Accesibilidad | J10.3 |
| Cifras de Athena y temperaturas sin fuente | Credibilidad | REVISAR fuente antes de G3 |

## 14. Cómo pasarlo a GitHub

Misma plantilla que el plan del Mirador (sección 12), con la etiqueta `juego` en las épicas J y dos campos más en cada historia:

```markdown
## Reglas afectadas
<qué parte del motor de reglas cambia, o «ninguna»>

## Equilibrio
- [ ] El resolutor sigue ganando los tres niveles (si cambia reglas, niveles o escenario)
```

## 15. Temas pendientes

| Tema | Quién lo confirma |
|---|---|
| ¿Mirador o juego primero, o en paralelo? | Equipo y negocio |
| Región real, fecha de inicio, salida y plataforma del escenario principal | Producto y técnico (con el resolutor) |
| Rejilla de juego (48 × 48 a 250 m) | Técnico |
| Modelo de batería y su coherencia con los requisitos de misión del planificador | Producto, técnico y planificador |
| Formatos y tamaños de los ficheros del escenario | Técnico |
| Hipótesis, umbrales y partida de demo 💡 | Equipo |
| Cifras de Athena y temperaturas de las regiones en sombra permanente | Producto (REVISAR fuente) |
| Los otros artifacts del espacio («Sombras del Polo Sur», «Lunar Site Navigator») no se han analizado aquí: ¿son variantes o piezas distintas? | Equipo |
| Esta iniciativa no tiene aún `prd.md` ni ha pasado por el embudo | Producto |
