<!--
Copia de constancia del plan de troceo del Mirador del Polo Sur.
Original (fuente de verdad): repo de discovery `540/lunar-landing-site-navigator-discovery`,
`iniciativas/mirador-polo-sur/anexos/2026-11-13-plan-mirador-del-polo-sur.md`.
Si cambia allí, hay que actualizar esta copia. Las rutas relativas que cita
(`fuentes/…`, `contexto.md`) son de ese repo, no de este.
-->

> **Prototipo asociado (artifact «Mirador del Polo Sur»):** https://claude.ai/artifact/K1C3tMgR48zNbKqCyQ1gi9?sk=2mcfQjP0RkBSR6nJes86Fw · copia congelada en [`mirador-polo-sur/`](mirador-polo-sur/)
>
> **En este repo la arquitectura cambia** (estático sin compilación, GitHub Pages, pipeline en Node, efemérides de `data/src/core`): ver [`arquitectura-tour.md`](arquitectura-tour.md), que manda donde choque con este plan.

# Mirador del Polo Sur · Plan: objetivo, necesidades, reparto del cálculo y épicas

Fecha: 2026-11-13. Estado: propuesta para decidir con el equipo antes de crear las épicas en el repo de código (`540/lunar-landing-site-navigator`). Sustituye a `2026-11-13-slicing-walking-skeleton.md`.

Fuentes:
- Prototipo publicado como artifact («Mirador del Polo Sur», https://claude.ai/artifact/K1C3tMgR48zNbKqCyQ1gi9): un único HTML de unos 116 KB con Three.js 0.160 y siete texturas de la NASA. Datos simulados.
- Reto: `fuentes/2026-11-13-reto-lunar-landing-site-navigator.md`.
- API pública v1 del grupo: `fuentes/2026-11-13-api-publica-v1-openapi.yaml` y el hilo en `fuentes/2026-11-13-api-publica-v1-hilo-slack.md`.
- Objetivos con negocio: `contexto.md`.

Leyenda: `REVISAR` = sin fuente, pendiente de confirmar con quien se indica. 💡 = propuesto por la IA, pendiente de validar.

## Índice

0. Resumen
1. Objetivo
2. Necesidades previas
3. Desarrollo por partes: qué se calcula y dónde
4. Cómo troceamos
5. Mapa de épicas
6. Épicas, historias y cómo las abordaremos
7. Hitos de entrega
8. Orden, carriles y equipo
9. Calidad: pruebas, rendimiento y dispositivos
10. Demo y entrega
11. Riesgos
12. Cómo pasarlo a GitHub
13. Temas pendientes

## 0. Resumen

1. **Qué:** convertir el prototipo «Mirador del Polo Sur» en una pantalla 3D real, rápida en equipos modestos, con datos de la NASA y coherente con la API y los paneles del planificador del grupo.
2. **Principio de reparto:** el relieve de la Luna no cambia nunca, así que **casi todo se calcula antes** (pipeline) y se sirve como ficheros. El cliente solo pinta, interpola y consulta tablas. El backend (la API del grupo) da lo que depende de un punto arbitrario o de una fecha fuera de lo precalculado.
3. **Efemérides:** el cliente no calcula ninguna. Un volcado hecho con el mismo código que la API genera, por región, la serie horaria del Sol y la Tierra en los ejes de la escena. Así los números son idénticos a los de la API por construcción.
4. **Relieve:** un pipeline genera, por región, la malla en varios niveles de detalle, el sombreado de los huecos, un mini horizonte por vértice para las sombras, una rejilla de máscaras de horizonte y un mapa de calor de luz y Tierra. Las máscaras de los sitios del catálogo se publican también para la API.
5. **Troceo:** 11 épicas en rebanadas verticales, empezando por un walking skeleton que ya usa el pipeline y el volcado de efemérides, aunque con relieve procedural.
6. **Aportación al grupo:** el pipeline del relieve es la fábrica de datos de todos. Desbloquea la petición 4 del planificador (`/v1/horizon`) y quita el «resultados optimistas en el polo» de la API.
7. **Hitos:** R0 (esqueleto) → R1 (métricas) → R2 (exploración, demo defendible) → R3 (relieve real) → R4 (visita completa) → R5 (pulido y enlace con el planificador).

## 1. Objetivo

### 1.1 Qué queremos conseguir

Que cualquier persona, sin formación previa, entienda **por qué unos cientos de metros o unos días deciden una misión al polo sur lunar**: con el Sol rasante, el relieve decide si hay energía, y la libración y el relieve deciden si hay comunicación directa con la Tierra. Y que pueda explorarlo por sí misma en un terreno real.

| Objetivo de `contexto.md` | Qué aporta esta pantalla |
|---|---|
| `entender-la-luna` | La visita guiada con predicciones y la exploración libre (reto § Objectives 7 y § User experience) |
| `ventanas-operativas-claras` | Anillo del horizonte, barras de luz y Tierra, cuenta atrás hasta la puesta, sobre el horizonte real (reto § Objectives 3 y 4) |
| `demo-convincente` | Una pieza visual y fluida, con datos reales y coherente con el resto del grupo |
| `comparar-sitios-rapido` | Indirecto: lo cubren los paneles del planificador; esta pantalla enlaza con ellos (E10) |

### 1.2 Para quién

- **Público general y educadores:** la visita guiada, en tres niveles (principiante, intermedio, experto).
- **Planificadores:** la exploración del terreno y el enlace de ida y vuelta con sus paneles.
- **Jurado:** la demo.

### 1.3 Hipótesis 💡 (métrica, umbral y plazo, REVISAR con el equipo)

| Hipótesis | Métrica | Umbral | Plazo |
|---|---|---|---|
| Tras la visita, una persona sin formación sabe explicar por qué el sitio importa en el polo | Personas que lo explican bien, en una prueba con 5 personas | 4 de 5 | Antes de la entrega |
| Con la pantalla, una persona sin formación contesta «¿cuántas horas de Sol y de comunicación hay aquí esta semana?» | Tiempo hasta contestar bien | Menos de 2 minutos | Antes de la entrega |
| La pantalla va fluida en un equipo modesto | Fotogramas por segundo en calidad baja, en un móvil de gama media o un portátil de hace 5 años | 30 fps o más | En cada hito desde R2 |

### 1.4 Qué no es

- No es el comparador de sitios y fechas: eso lo construyen los paneles del planificador sobre la API.
- No es el «modo clase» (votación por QR, pantalla del profesor): queda anunciado en el cajón como «próximamente».
- No cubre toda la Luna con relieve real: solo las regiones elegidas del polo sur. Fuera de ellas, se usa la API sin relieve.

## 2. Necesidades previas

Lo que hace falta tener o decidir antes de empezar cada parte. La columna «Bloquea» dice qué épica no puede arrancar sin ello.

### 2.1 Acuerdos con el grupo

| Necesidad | Con quién | Bloquea | Propuesta |
|---|---|---|---|
| Que este frente haga el preprocesado del relieve para todo el grupo | Grupo, en el hilo de Slack | E9 (y la utilidad de E1 para la API) | Sí |
| Formato de la máscara de horizonte | Quien lleva la API | E9.1 | 360 valores, uno por grado, con el azimut con la convención de la API, más versión del DEM, resolución, distancia máxima y altura del observador |
| Cómo generamos el volcado de efemérides con su mismo código | Quien lleva la API | E0.3 | Paquete compartido; si no, un script que llama a la API en local y guarda las respuestas |
| Convención de azimut cerca del polo escrita en el contrato | Quien lleva la API | E0.2 | Norte selenográfico local del punto pedido |
| IM-2 Athena (objetivo y punto de reposo) en el catálogo | Quien lleva la API | E6.1 | Si no, ampliación local con `coordinatesVerified: false` |
| `/v1/track` y `/v1/horizon` | Quien lleva la API | E10.3, E9.5 | `/v1/track` con paso configurable; `/v1/horizon` leyendo nuestras máscaras |
| Formato del enlace con el planificador | Planificador | E10 | `?site=<id>&date=<ISO>` o `?lat=…&lon=…&date=…`, con los nombres de parámetro de la API |
| Nota de «optimista» visible en los paneles hasta que haya relieve | Planificador | Coherencia de la demo | Sí |

### 2.2 Decisiones técnicas

| Decisión | Quién | Bloquea | Propuesta |
|---|---|---|---|
| Regiones del polo sur con relieve real | Técnico y producto | E9 | Las tres del prototipo: borde de Shackleton, Mons Mouton y borde de Nobile, más el ecuador para el capítulo 2 |
| Zona explorable por región y paso de la rejilla | Técnico | E1.1 | 4 × 4 km alrededor del sitio, una máscara cada 100 m (unos 1.600 puntos) 💡 |
| Periodo de efemérides precalculadas | Técnico y producto | E0.3 | De 2025-03-01 (Athena) a 2030-12-31, cada hora 💡 |
| Año de referencia del mapa de calor | Producto | E2.6 | Un año desde la fecha por defecto de la pantalla 💡 |
| Producto y resolución de LOLA | Técnico | E9.2 | REVISAR (productos del PGDA de Goddard) |
| Hosting de la web y de los datos | Técnico | E0.1 | Cloudflare Pages para la web; los ficheros grandes, en almacenamiento de objetos (Cloudflare R2) si superan el límite por fichero de Pages (comprobar el límite actual) |
| Presupuestos de rendimiento | Técnico | E5 | Sección 3.6 |

### 2.3 Datos y material

| Qué | Para qué | Estado |
|---|---|---|
| Catálogo de sitios (`/v1/sites`, 14 sitios) | Regiones y puntos | En la API |
| Puntos de la visita que no son sitios de misión (borde e interior de Shackleton, borde de Nobile, ecuador) | Capítulos 2 a 6 | Ampliación local, `coordinatesVerified: false` |
| Texturas de la Luna (NASA SVS, CGI Moon Kit: LROC WAC y LOLA) y de la Tierra (Blue Marble, ejemplos de three.js) | Vista órbita | En el artifact (`tex/`) |
| DEM de LOLA del polo sur | Relieve real | Pendiente de elegir (2.2) |
| Textos de los seis capítulos en es/en y tres niveles | Visita | En el prototipo (`CH`, `UI`) |
| Cifras de Athena: aterrizaje el 2025-03-06, desviación de 250 a 400 m según la fuente | Capítulo 1 | REVISAR fuente |
| Rango publicado de iluminación en el borde de Shackleton | Validar el relieve real | REVISAR fuente (técnico) |

### 2.4 Accesos y entorno

| Necesidad | Para qué |
|---|---|
| Permisos en el repo de código y en su configuración de Actions | E0.1 |
| Cuenta de Cloudflare (Pages y, si hace falta, R2) | E0.1, E9 |
| Configuración del epic-runner para el repo de código | Ejecutar las historias |
| Node (web y volcado de efemérides) y Python con `rasterio` o GDAL (pipeline del relieve) | E0, E9 |
| Acceso a la API en local (carpeta `data/`) o a su URL pública | E0.3 |
| Un equipo modesto de referencia (móvil de gama media o portátil antiguo) | Pruebas de rendimiento desde R2 |

### 2.5 Equipo y calendario

| Necesidad | Estado |
|---|---|
| Fechas y duración de la hackatón | REVISAR |
| Personas por carril (sección 8) | REVISAR |
| Criterios del jurado y entregables que pide Space Apps (vídeo, página del proyecto…) | REVISAR en la web de Space Apps |

## 3. Desarrollo por partes: qué se calcula y dónde

### 3.1 La regla

| Nivel | Qué hace | Regla |
|---|---|---|
| **1. Preprocesado** (pipeline, sin conexión) | Todo lo que depende solo del relieve y las efemérides de las regiones elegidas | Si no depende de lo que haga el usuario en el momento, se calcula una vez y se guarda como fichero |
| **2. Backend** (la API del grupo) | Puntos fuera de las regiones con relieve, fechas fuera del periodo precalculado, cifras oficiales compartidas con el planificador | Respuestas de milisegundos, deterministas (misma pregunta, misma respuesta) y cacheables por una CDN |
| **3. Cliente** (navegador) | Pintar, interpolar, consultar tablas y comparar una serie contra una tabla | Nunca recorre el terreno ni calcula efemérides. Su cálculo más pesado es comparar como mucho unas 10.000 posiciones del Sol con una máscara (menos de 2 ms) |

### 3.2 Qué depende de qué

Esta es la razón del reparto:

| Depende de… | Ejemplos | Dónde |
|---|---|---|
| Solo del relieve (no cambia nunca) | Malla, normales, sombreado de los huecos, máscaras, mini horizonte por vértice, rocas | Preprocesado |
| Solo de la fecha y la región | Dirección del Sol y la Tierra en los ejes de la región | Preprocesado (volcado de efemérides) |
| Del relieve y de un periodo largo fijo | Mapa de calor anual | Preprocesado |
| Del punto y del periodo que elige el usuario | Ventanas, rachas, próxima puesta | Cliente (serie contra máscara) dentro de las regiones; backend fuera |
| De lo que hace el usuario en cada fotograma | Cámara, posición de la bandera, interfaz | Cliente |

Por qué basta **una serie de efemérides por región** y no una por punto: dentro de una zona de 4 × 4 km, la dirección del Sol y la Tierra en los ejes de la escena apenas cambia (el paralaje es despreciable). Lo que sí cambia es la vertical local por la curvatura de la Luna, unos 0,03° por km. Esa corrección se precalcula para cada punto de la rejilla (dos números) y el cliente la aplica con una rotación.

### 3.3 Tabla completa: cada cálculo, dónde va y por qué

| Cálculo | En el prototipo | Propuesta | Por qué |
|---|---|---|---|
| Malla del terreno | Cliente (`buildRadialAsync`, `Hr`) | **Preprocesado**: alturas en varios niveles de detalle (LOD: más detalle cerca, menos lejos) | Construir la malla es lo más caro del arranque |
| Normales y sombreado de los huecos | Cliente (`bakeAO`) | **Preprocesado**, como texturas | Pesado y fijo |
| Textura de regolito | Cliente (ruido en canvas) | **Preprocesado**: una imagen | Fijo |
| Rocas y piedras | Cliente, con semilla | **Preprocesado**: lista de posiciones y tamaños | El cliente solo las instancia |
| Sombras del terreno | Cliente: mapas de sombra en la tarjeta gráfica | **Preprocesado: mini horizonte por vértice** (por ejemplo, 32 direcciones). El shader, el programa de la tarjeta gráfica que pinta cada punto, compara la elevación del Sol con ese horizonte | Más barato que los mapas de sombra y más correcto: incluye montañas fuera de la escena. Los mapas de sombra quedan para las rocas en calidad alta |
| Máscara de horizonte de los sitios del catálogo | Cliente (`computeMask`) | **Preprocesado**, con horizonte lejano | Lo más caro de todo; lo necesita también la API |
| Máscara al mover la bandera | Cliente (unos 16.000 muestreos por recálculo) | **Preprocesado: rejilla de máscaras**. El cliente toma la más cercana o interpola entre las cuatro vecinas | Pasa a ser una búsqueda en tabla |
| Mapa de calor anual (luz, Tierra y puntuación) | No existe | **Preprocesado** | Vista previa instantánea al arrastrar y capa visual nueva |
| Mejor punto cercano | Cliente (81 máscaras) | **Consulta del máximo en el mapa de calor** | De lo más caro a nada |
| Sol y Tierra en el tiempo | Cliente (fórmulas simuladas) | **Preprocesado: volcado horario por región**, con el código de la API | Cero efemérides en el cliente; paridad con la API por construcción |
| Orientación de la Luna y Sol en la vista órbita | Cliente | **Preprocesado**, en el mismo volcado | Órbita y dron usan los mismos datos |
| Ventanas, rachas y próxima puesta en el periodo elegido | Cliente (`stats`) | **Cliente**, comparando la serie con la máscara (menos de 10.000 posiciones) | Respuesta instantánea al arrastrar sin depender de la red |
| Las mismas cifras «oficiales» para el planificador | No existe | **Backend** (`/v1/windows` con nuestras máscaras) | Una sola fuente para el grupo; test de paridad con el cliente |
| Punto fuera de las regiones o fecha fuera del periodo | No existe | **Backend** (`/v1/track`, `/v1/sun-earth`, sin relieve) | Caso raro; no merece precalcularse |
| Conversión entre escena y latitud/longitud | No existe | **Preprocesado** en los metadatos de la región; el cliente aplica la fórmula | Fija por región |
| Escena del ecuador (capítulo 2) | Cliente | **Preprocesado**, como una región más | Mismo formato |
| Contenido de la visita | En el código | **Fichero estático** | Añadir un capítulo es añadir datos |
| Calidad gráfica automática | Cliente (`autoLow`) | **Cliente** | Depende del equipo del usuario |

### 3.4 El pipeline (preprocesado)

Dos partes con la misma salida: una carpeta de datos por región, versionada.

| Parte | Lenguaje | Entrada | Salida |
|---|---|---|---|
| Relieve | Python (`rasterio` o GDAL, `numpy`) | DEM (procedural en E0, LOLA en E9) y catálogo | Alturas por LOD, texturas de normales y de sombreado de huecos, mini horizonte por vértice, rejilla de máscaras con su corrección de vertical, mapa de calor, rocas, máscaras de los sitios del catálogo para la API |
| Efemérides | Node, con el código de la API (paquete compartido, o llamadas a la API en local) | Catálogo, periodo, centro y ejes de cada región | Serie horaria del Sol y la Tierra en los ejes de cada región; orientación de la Luna para la vista órbita |

Ficheros por región (formatos orientativos, REVISAR con técnico):

| Fichero | Contenido | Tamaño orientativo |
|---|---|---|
| `meta.json` | Id, nombre es/en, centro, proyección y fórmula de `SceneFrame`, extensión, paso de la rejilla, LOD disponibles, versión y fuentes | Unos KB |
| `terrain-lod{0,1,2}.bin` | Alturas en 16 bits | 0,5 a 4 MB en total |
| `normals.png`, `ao.png` | Normales y sombreado de los huecos | 1 a 2 MB |
| `horizon-vertex.bin` | Mini horizonte por vértice (32 direcciones, 1 byte cada una) | 1 a 2 MB |
| `masks.bin` | Rejilla de máscaras: unos 1.600 puntos × 360 valores en 16 bits, más la corrección de vertical | Unos 1,2 MB |
| `heatmap.bin` | Luz, Tierra y puntuación por punto de la rejilla | Unos KB |
| `rocks.bin` | Posición, tamaño y giro de rocas y piedras | Unos 100 KB |
| `series-<año>.bin` | Sol y Tierra por hora (azimut y elevación en los ejes de la región, 16 bits) | Unos 70 KB por año |

Comunes: `catalog.json` (copia versionada de `/v1/sites` más la ampliación local), `tour.json` (capítulos), `regolith.jpg`, texturas de órbita, y `api-masks/<siteId>.json` (máscaras de los sitios del catálogo en el formato pactado con la API).

Reglas del pipeline:
- **Reproducible:** el mismo DEM y la misma versión dan los mismos ficheros. Un comando por región.
- **Validado:** cada fichero se comprueba contra su esquema antes de publicarse.
- **Fuera del CI de la web:** el DEM pesa mucho; el pipeline se ejecuta en local y publica sus salidas con la versión en la ruta (`data/v3/shackleton/…`). La web apunta a una versión concreta.

### 3.5 El backend (la API del grupo)

| Uso | Ruta | Cuándo |
|---|---|---|
| Copia del catálogo | `/v1/sites` | En el pipeline, no en tiempo de uso |
| Volcado de efemérides | `/v1/sun-earth` o `/v1/track` (o el paquete compartido) | En el pipeline |
| Punto fuera de las regiones o fecha fuera del periodo | `/v1/track` (pedida por el planificador) | En tiempo de uso, raro |
| Cifras oficiales con relieve | `/v1/windows` y `/v1/sun-earth` con `horizonModel: mask` | Cuando la API cargue nuestras máscaras (E9.5) |
| Máscara de un sitio | `/v1/horizon` (pedida por el planificador) | La sirve la API a partir de nuestras máscaras |

Lo que no pedimos al backend: calcular horizontes al vuelo, que exigiría tener el DEM regional en memoria (del orden de 100 MB por región a 20 m por píxel). Si hiciera falta para puntos fuera de las rejillas, sería una ruta aparte y posterior.

Caché: como las respuestas son deterministas, se sirven con caché larga y una CDN absorbe la carga. Plan B de la demo: la pantalla funciona entera con los ficheros estáticos, sin la API.

### 3.6 El cliente

Responsabilidades: cargar ficheros, pintar con Three.js, interpolar la serie entre horas, buscar en la rejilla y el mapa de calor, comparar la serie con la máscara, comparar en el shader la elevación del Sol con el horizonte por vértice e interfaz (tarjetas, barras, anillo, línea de tiempo).

Calidades:

| Calidad | Qué incluye | Para quién |
|---|---|---|
| Baja | LOD 0 y 1, sombras solo por horizonte de vértice, sin piedras, texturas 2k, densidad de píxeles 1 | Móviles y equipos modestos (por defecto si `autoLow`) |
| Alta | Todos los LOD, mapas de sombra para rocas, piedras, texturas 4k, resplandor del Sol | Portátiles recientes |

Presupuestos (los comprueba el CI desde E5):

| Presupuesto | Baja | Alta |
|---|---|---|
| Descarga inicial (hasta ver la primera escena) | ≤ 5 MB | ≤ 15 MB |
| Descarga total por región | ≤ 10 MB | ≤ 25 MB |
| CPU por fotograma | ≤ 4 ms | ≤ 6 ms |
| Fotogramas por segundo | ≥ 30 | ≥ 60 |
| Recalcular métricas al soltar la bandera | ≤ 50 ms | ≤ 50 ms |

### 3.7 Contratos y convenciones

Un **contrato** es la forma acordada de los datos entre dos piezas. Se adoptan las convenciones de la API para no traducir en cada frontera: azimut desde el norte selenográfico local hacia el este (0 a 360°), longitud este positiva, fechas UTC.

| Contrato | Qué define | Lo produce | Lo consume |
|---|---|---|---|
| `Region` (`meta.json`) | Extensión, LOD, rejilla, versión, fuentes | Pipeline | Cliente |
| `SceneFrame` | `toScene(lat, lon)`, `fromScene(x, z)`, `azimuthToScene` | Pipeline (parámetros), cliente (fórmula) | Cliente |
| `Series` | Sol y Tierra por hora en los ejes de la región | Volcado de efemérides | Cliente |
| `MaskGrid` | Rejilla de máscaras y corrección de vertical | Pipeline | Cliente |
| `HorizonMask` (API) | Máscara de un sitio en el formato pactado | Pipeline | API |
| `Metrics` | `meanSunDiskFraction`, `sunTimeFraction`, `earthTimeFraction`, `sunAndEarthTimeFraction`, `longestNightHours`, `longestEarthOutageHours` (nombres de `RankResult.metrics`) | Cliente, API | Interfaz, planificador |
| `Site` | Campos de `Site` de la API | API (copia en el pipeline) | Pipeline, cliente |

Por qué `SceneFrame` es imprescindible: en el borde de Shackleton (−89,45°) el punto está a unos 16,7 km del polo. Moverse 1 km de lado cambia la longitud unos 3,4° y, con ella, la dirección del norte local. La escena usa ejes fijos; la API mide respecto al norte local.

Discos: el Sol (radio aparente de unos 0,27°) y la Tierra (unos 0,95°) se tratan como discos, como en la API. «Visible» sigue el criterio del disco entero (`full`), como el veredicto; la energía usa la fracción del disco visible.

### 3.8 Flujo de una visita: qué se descarga y cuándo

1. **Al entrar:** `catalog.json`, `tour.json`, texturas de órbita en 2k y la serie del año actual de la región por defecto. Se ve la vista órbita.
2. **Al elegir región o empezar la visita:** `meta.json`, LOD 0, normales, sombreado y horizonte por vértice. Se ve el terreno.
3. **En segundo plano:** LOD 1 y 2, `masks.bin`, `heatmap.bin` y, en calidad alta, `rocks.bin` y texturas 4k.
4. **Al cambiar de fecha:** la serie de ese año si no estaba cargada (unos 70 KB).
5. **Fuera de las regiones o del periodo:** petición a la API.

## 4. Cómo troceamos

### 4.1 Principios

1. **Vertical, no por capas.** Cada historia atraviesa pipeline, datos, cliente e interfaz en lo que necesite y termina en algo visible en la URL.
2. **Walking skeleton primero.** Antes de que nada sea bonito, toda la cadena funciona y está publicada: pipeline → ficheros → cliente → pantalla.
3. **Mismo formato desde el primer día.** El pipeline arranca con relieve procedural, pero produce los ficheros con el formato definitivo. El día de LOLA solo cambia la fuente.
4. **Cada historia se despliega sola y no rompe lo anterior.**
5. **Lo simulado se dice.** «Demo · relieve simulado» hasta E9.
6. **Portar antes que reescribir.** Cada historia cita las funciones del prototipo que reutilizar; lo que el prototipo calculaba en el cliente se porta al pipeline.
7. **Cuadrar con la API.** Lo que también calcula la API lleva un test de paridad.
8. **Tamaño.** S: menos de medio día de un agente o una persona. M: alrededor de un día. L: más de un día; si sale L, se parte.

### 4.2 Definición de terminado, común

- Desplegada en la URL de prueba del PR y, al fusionar, en la principal.
- Tests de lo que añade o cambia; paridad con la API si aplica.
- Los ficheros nuevos del pipeline validan contra su esquema.
- Ningún texto escrito a fuego: todo en el diccionario de textos.
- Cumple los presupuestos de la sección 3.6 que le apliquen.
- La prueba de humo de Playwright pasa.
- Funciona sin la API (salvo las historias que son precisamente de la API).

## 5. Mapa de épicas

```
E0 Esqueleto ─► E1 Métricas de un punto ─► E2 Explorar el terreno ─┬─► E3 A pie ───────────┐
(pipeline +          │                                             ├─► E4 Órbita ──────────┤
 volcado)            │                                             ├─► E5 Realismo ligero ─┼─► E6 Visita guiada
                     │                                             └─► E8 Idioma y acc. ───┘
                     └─► E9 Relieve real LOLA, compartido con la API (carril paralelo; E9.1 ya)
                         E7 Transiciones (cuando haya ≥ 2 vistas)
                         E10 Enlace con el planificador y la API en directo (tras E1)
                         E11 Modo ligero sin 3D (opcional, tras E1)
```

| Épica | Valor para el usuario en una frase | Depende de | Historias | Tamaño |
|---|---|---|---|---|
| E0 Walking skeleton | «Veo el Sol real dar la vuelta al horizonte en el polo sur, en una fecha real» | — | 5 | S+M+M+M+S |
| E1 Métricas de un punto | «Sé si en este punto hay luz y Tierra, ahora y en el periodo que elija» | E0 | 4 | M+S+M+S |
| E2 Explorar el terreno | «Muevo la bandera y entiendo por qué unos metros lo cambian todo» | E1 | 6 | M+M+S+M+S+M |
| E3 A pie | «Me pongo de pie en la Luna y veo lo bajo que va el Sol» | E2 | 5 | M+S+S+S+M |
| E4 Órbita | «Veo la Luna entera girar y el Sol barrer el polo» | E0 | 4 | M+M+S+S |
| E5 Realismo ligero | «El terreno parece la Luna de verdad y va fluido en mi equipo» | E2 | 6 | M+M+S+M+M+S |
| E6 Visita guiada | «Una visita me explica, con preguntas, por qué elegir sitio es difícil» | E1, E2, E3, E4 | 7 | M+M+M+S+S+S+S |
| E7 Transiciones | «Paso de una vista a otra sin perderme» | Dos vistas | 3 | S+M+M |
| E8 Idioma y accesibilidad | «La uso en inglés, en el móvil y con teclado» | E0 | 4 | M+S+S+S |
| E9 Relieve real | «El relieve y sus sombras son los de la NASA, y la API dice lo mismo» | E1 | 6 | S+M+M+S+S+S |
| E10 Planificador y API | «Paso del planificador al 3D y vuelvo; puedo ir a cualquier fecha» | E1 | 3 | S+S+M |
| E11 Modo ligero (opcional) | «Aunque mi equipo no pueda con el 3D, veo el anillo, el mapa y las métricas» | E1, E2.6 | 2 | M+S |

## 6. Épicas, historias y cómo las abordaremos

Cada épica tiene: objetivo, **cómo la abordaremos** (enfoque y trampas conocidas) e historias. Cada historia: qué ve el usuario, qué incluye, criterios de aceptación, qué reutilizar y tamaño.

### E0 · Walking skeleton: el Sol real en el polo sur

**Objetivo.** Tener en una URL pública la cadena completa funcionando: pipeline → ficheros → cliente → pantalla, con efemérides reales y relieve procedural.

**Cómo la abordaremos.**
- Primero la tubería, luego lo bonito: la escena de E0 puede ser fea.
- El pipeline nace aquí con el relieve procedural del prototipo (`Hr`, `feat`), pero escribiendo el formato definitivo (sección 3.4). Así E9 solo cambia la fuente.
- El volcado de efemérides usa el código de la API: si aún no hay paquete compartido, un script que llama a la API en local, hora a hora, y guarda la serie. Es lento (miles de llamadas), pero se hace una vez.
- Trampa conocida: los ejes. `SceneFrame` va con tests desde el primer día.

**E0.1 · La pantalla existe en una URL**
- Ve: página negra con el título «Mirador del Polo Sur» y el aviso «Demo · relieve simulado».
- Incluye: repo con Vite + TypeScript; carpetas `pipeline/relief`, `pipeline/ephemeris`, `src/core`, `src/data`, `src/scene`, `src/ui`, `src/tour`; diccionario de textos; despliegue en Cloudflare Pages con URL por PR; CI con typecheck, lint, Vitest y prueba de humo; `CLAUDE.md` del repo con las reglas («el cliente no calcula efemérides ni recorre el terreno», «convenciones de la API v1»).
- Criterios: `main` se publica sola; cada PR tiene URL; un error de tipos bloquea la fusión.
- Reutiliza: colores y tipografías del `:root` del prototipo.
- Tamaño: S.

**E0.2 · Una región generada por el pipeline**
- Ve: el terreno de la región de Shackleton en 3D, con cámara fija tipo dron y la bandera en `shackleton-rim`.
- Incluye: copia versionada del catálogo (`catalog.json`) con la ampliación local; pipeline del relieve con fuente procedural que genera `meta.json` (con `SceneFrame`) y `terrain-lod0.bin`; el cliente construye la malla a partir de las alturas.
- Criterios: `fromScene(toScene(lat, lon))` devuelve el mismo punto con error menor de 1 m; la bandera está en las coordenadas del catálogo; los ficheros validan contra su esquema; la malla se construye en menos de 100 ms.
- Reutiliza: `REGIONS.shackleton`, `Hr`, `feat`, `rng` (portados a Python).
- Tamaño: M.

**E0.3 · El Sol real ilumina el terreno**
- Ve: el Sol como luz rasante desde su posición real; lectura «Sol a 0,39° · azimut 229,6°».
- Incluye: volcado de efemérides de la región (`series-2027.bin` para empezar); el cliente lee la serie y orienta la luz.
- Criterios: test de paridad: `shackleton-rim`, 2027-01-15T00:00:00Z → Sol a 229,60° de azimut y 0,39° de elevación (tolerancia 0,01°, ejemplo de `/v1/sun-earth`); el cliente no importa ninguna librería de efemérides.
- Tamaño: M.

**E0.4 · El tiempo pasa, en fechas reales**
- Ve: línea de tiempo con play o pausa, deslizador de 60 días desde una fecha de inicio y velocidad; el Sol gira y la lectura muestra la fecha y hora UTC.
- Incluye: interpolación entre horas; selector de fecha de inicio dentro del periodo precalculado.
- Criterios: con velocidad 1, un día por segundo; el deslizador responde sin saltos; la interpolación coincide con la serie en las horas exactas (test).
- Reutiliza: `setPlay`, `paintSpeed`, `#tRange`, parte de `loop`.
- Tamaño: M.

**E0.5 · El esqueleto está probado**
- Incluye: tests de `SceneFrame`, de la interpolación, de la validación de esquemas y de paridad con la API (Sol y Tierra); medida de la descarga inicial en el CI.
- Criterios: los tests corren en menos de 10 s.
- Tamaño: S.

**Hito R0.**

### E1 · Métricas de un punto: luz y Tierra

**Objetivo.** Responder, con el relieve en cuenta, a las dos preguntas del reto (energía y comunicación directa) para el punto de la bandera.

**Cómo la abordaremos.**
- La rejilla de máscaras se genera en el pipeline desde ya (con relieve procedural). El cliente no calcula ninguna máscara.
- Las métricas del periodo elegido se calculan en el cliente comparando la serie con la máscara: es barato y no depende de la red.
- Nombres y criterios de las métricas, los de la API, para que el test de paridad con `/v1/windows` sea directo (con máscara plana ahora, con nuestras máscaras en E9.5).

**E1.1 · El anillo del horizonte con el Sol**
- Ve: el anillo con el perfil del relieve en 360° y el disco del Sol moviéndose; «Sol a la vista», «a medias» o «tapado».
- Incluye: pipeline: `masks.bin` (rejilla y corrección de vertical); cliente: busca la máscara de la bandera y la dibuja.
- Criterios: el cliente no recorre el terreno; el disco del Sol coincide con la serie.
- Reutiliza: `maskAt`, `drawRing`; `computeMask` se porta al pipeline.
- Tamaño: M.

**E1.2 · La Tierra en el anillo**
- Ve: el disco de la Tierra balanceándose por la libración real; «Tierra a la vista» o «tapada».
- Criterios: paridad con el ejemplo de `/v1/sun-earth` para la Tierra con máscara plana.
- Tamaño: S.

**E1.3 · Las barras del periodo**
- Ve: «Luz solar» y «Tierra a la vista» en el periodo elegido, con porcentaje y racha más larga sin Sol y sin Tierra.
- Incluye: contrato `Metrics`; serie contra máscara en el cliente.
- Criterios: con máscara plana, coincide con `/v1/windows` y `/v1/rank` (paridad); el cálculo tarda menos de 50 ms; el objetivo de Athena y su punto de reposo dan valores claramente distintos.
- Reutiliza: `stats`, `updStats`.
- Tamaño: M.

**E1.4 · Sol y Tierra en la escena y cuenta atrás**
- Ve: etiquetas «Sol» y «Tierra» en su dirección y cuenta atrás hasta la próxima puesta de cada uno.
- Criterios: con máscara plana, la próxima puesta coincide con `nextSet` de la API con pocos minutos de diferencia.
- Reutiliza: `showLbl`, `labels`.
- Tamaño: S.

**Hito R1.**

### E2 · Explorar el terreno con el dron

**Objetivo.** Que el usuario descubra que unos cientos de metros lo cambian todo.

**Cómo la abordaremos.**
- La bandera se mueve libre, pero sus métricas salen de la rejilla: vista previa del mapa de calor mientras se arrastra y cálculo de serie contra máscara al soltar.
- La zona explorable es la de la rejilla: fuera de ella, la bandera no entra (o, más adelante, se pide a la API sin relieve, con aviso).
- El mapa de calor convierte el «mejor punto cercano» en una consulta.

**E2.1 · Mover la cámara**
- Ve: orbitar, desplazar, acercar y centrar con doble clic, con ratón y táctil.
- Criterios: la cámara no atraviesa el suelo.
- Reutiliza: `droneCamUpdate`, `panBy`, `pinchDist`, `pinchMid`, `stepControls`, `rigPose`.
- Tamaño: M.

**E2.2 · Arrastrar la bandera**
- Ve: la bandera se arrastra; mientras, las barras muestran la vista previa del mapa de calor; al soltar, las cifras del periodo; se muestran latitud y longitud.
- Criterios: actualización en menos de 50 ms al soltar; la bandera no sale de la rejilla.
- Reutiliza: `flagNear`, `rayGround`, `mkMarker`, `place`.
- Tamaño: M.

**E2.3 · Restablecer la vista y ayuda de controles**
- Reutiliza: `resetRig`, `showHelp`, `helpDrone`.
- Tamaño: S.

**E2.4 · Cambiar de región**
- Ve: selector con las regiones y sus sitios del catálogo, con aviso si `coordinatesVerified` es `false`.
- Incluye: el pipeline genera las tres regiones con relieve procedural; el cliente carga por región (sección 3.8).
- Criterios: cambio en menos de 2 s con calidad baja; añadir una región es ejecutar el pipeline, sin tocar código.
- Reutiliza: `setRegion`.
- Tamaño: M.

**E2.5 · Buscar el mejor punto cercano**
- Ve: botón que lleva la bandera al mejor punto en 2 km a la redonda.
- Incluye: pipeline: `heatmap.bin` con la puntuación de la API (0,7 × `meanSunDiskFraction` + 0,3 × `earthTimeFraction`); cliente: consulta del máximo.
- Criterios: los pesos salen de una constante compartida con la API; el resultado es instantáneo.
- Reutiliza: idea de `bestNear` (portada al pipeline).
- Tamaño: S.

**E2.6 · Capa de mapa de calor**
- Ve: una capa opcional sobre el terreno que colorea cada zona según su luz, su Tierra o su puntuación anual, con leyenda.
- Criterios: la leyenda dice el periodo de referencia; la capa se activa desde el cajón; legible con daltonismo.
- Tamaño: M.

**Hito R2: demo defendible.**

### E3 · Ver desde la superficie: a pie

**Objetivo.** Sentir lo bajo que va el Sol y lo cerca que está el horizonte.

**Cómo la abordaremos.** Todo es cliente (cámara e interacción) sobre los datos ya cargados. La altura del suelo sale de las alturas del LOD más fino, sin rayos al terreno caros. Trampa: la brújula debe usar el norte local de `SceneFrame`.

**E3.1 · Bajar a pie y mirar alrededor**
- Reutiliza: `footPose`, `footCamUpdate`, `enterLocalCam`, `footY`.
- Tamaño: M.

**E3.2 · Andar** (WASD, Mayús para correr; la bandera sigue al usuario y las métricas se actualizan)
- Reutiliza: `footCamUpdate`, `resetWalk`.
- Tamaño: S.

**E3.3 · Saltar y clic para ir** (1/6 g, clic en el suelo, bloqueo de ratón)
- Reutiliza: `rayFoot`, `S.walkTo`, `S.vy`, `S.air`.
- Tamaño: S.

**E3.4 · Brújula** (Sol en ámbar, Tierra en azul, marca del norte selenográfico local que gira cerca del polo)
- Reutiliza: `#compass`.
- Tamaño: S.

**E3.5 · Controles táctiles** (joystick, arrastrar, tocar para ir, pellizcar)
- Criterios: probado en un móvil real o en emulación táctil de Playwright.
- Reutiliza: `#joy`, `#knob`, `helpTouch`.
- Tamaño: M.

### E4 · La Luna entera: vista órbita

**Objetivo.** Situar al usuario: la Luna gira, el Sol barre el polo y la Tierra está casi quieta en el cielo lunar.

**Cómo la abordaremos.** Texturas estáticas en 2k o 4k según la calidad. La orientación de la Luna y la dirección del Sol salen del volcado de efemérides, no de fórmulas en el cliente. Test de coherencia con la vista dron.

**E4.1 · La Luna con texturas de la NASA** (orientación real para la fecha; polo sur y sitios del catálogo señalados)
- Reutiliza: `tex`, `noiseCanvas`, `updateOrbit`, `lunarize`.
- Tamaño: M.

**E4.2 · La Tierra y el Sol** (día, noche, nubes, brillo; resplandor del Sol solo en calidad alta; estrellas; aviso de escala)
- Reutiliza: `makeEarth`, `makeSun`, `sunTexture`, `makeStars`, `setupComposer`.
- Tamaño: M.

**E4.3 · El Sol barre el polo**
- Criterios: para el mismo instante, el Sol está en la misma dirección en órbita y en dron (test).
- Reutiliza: `dirLL`.
- Tamaño: S.

**E4.4 · Pantalla de inicio** (titular, subtítulo y «Empezar la visita»)
- Reutiliza: `.cta`, `ctaTitle`, `ctaSub`.
- Tamaño: S.

### E5 · Realismo ligero: que parezca la Luna sin pedir un equipo potente

**Objetivo.** Calidad visual del prototipo con mucho menos coste en el cliente.

**Cómo la abordaremos.**
- Todo lo que el prototipo hacía en el cliente para el realismo (malla radial, regolito, rocas, sombreado de huecos) pasa al pipeline.
- Las sombras del terreno se hacen con el mini horizonte por vértice; los mapas de sombra quedan solo para las rocas en calidad alta.
- Cada historia se mide contra los presupuestos de la sección 3.6 en el equipo de referencia.
- Trampa: el horizonte por vértice necesita interpolar bien entre las 32 direcciones; se valida contra la máscara completa en los puntos de la rejilla.

**E5.1 · Niveles de detalle**
- Ve: más detalle cerca y menos lejos, cargado por partes sin congelar.
- Incluye: pipeline: `terrain-lod{0,1,2}.bin`; cliente: carga progresiva y cambio de LOD por distancia.
- Reutiliza: idea de `buildRadial`, `updatePatch`.
- Tamaño: M.

**E5.2 · Sombras por horizonte de vértice**
- Ve: las sombras largas del relieve, incluidas las de montañas fuera de la escena, en todas las calidades.
- Incluye: pipeline: `horizon-vertex.bin`; cliente: shader que compara la elevación del Sol con el horizonte del vértice.
- Criterios: en los puntos de la rejilla, «iluminado» coincide con la máscara completa en el 99 % de las horas (test); coste en el shader dentro del presupuesto.
- Tamaño: M.

**E5.3 · Sombreado de los huecos** (pipeline: `ao.png`, `normals.png`)
- Reutiliza: `bakeAO`, `albedo` (portados al pipeline).
- Tamaño: S.

**E5.4 · Regolito, rocas y piedras**
- Ve: regolito en primer plano; rocas con sombra en calidad alta; piedras solo en calidad alta.
- Incluye: pipeline: `regolith.jpg`, `rocks.bin`; cliente: instancias.
- Reutiliza: `makeRegolith`, `buildRocks`, `buildPebbles` (portados al pipeline), `buildRockShadows`.
- Tamaño: M.

**E5.5 · Calidad gráfica y presupuestos en el CI**
- Ve: Auto, Alta o Baja en el cajón.
- Incluye: los niveles de la sección 3.6; medida de descarga y fotogramas en el CI con Playwright.
- Criterios: los presupuestos de la sección 3.6 se cumplen y el CI avisa si se superan.
- Reutiliza: `autoLow`, `applyQuality`, `setShadowQuality`.
- Tamaño: M.

**E5.6 · Carga progresiva** («Cargando texturas de la NASA…»; primera escena con LOD 0 en menos de 5 MB)
- Reutiliza: `#loading`, `done`, `pending`.
- Tamaño: S.

### E6 · Visita guiada con preguntas

**Objetivo.** La parte educativa del reto (objetivo 7).

**Cómo la abordaremos.**
- Los capítulos son datos (`tour.json`): sitio del catálogo, **fecha UTC real**, vista, pregunta, opciones, revelación y acción.
- Las regiones y fechas de los capítulos están dentro de lo precalculado: la visita funciona entera sin la API.
- Si el jurado pesa más lo educativo, E6.1 y E6.2 se adelantan justo detrás de E2 con los capítulos de la vista dron (1, 4 y 6).

**E6.1 · Motor de la visita y capítulo 1 (400 metros)**
- Ve: el capítulo sobre Athena en su fecha real (2025-03-06), «Ver dónde acabó», la bandera viaja al cráter en sombra, revelación; navegación por puntos, Anterior, Siguiente, Plegar y Salir.
- Criterios: añadir un capítulo es añadir datos.
- Reutiliza: `CH[0]`, `goCh`, `renderCard`, `doReveal`, `nav`.
- Tamaño: M.

**E6.2 · Preguntas de predicción y niveles**
- Reutiliza: `.q`, `.opts`, `LV3`, `S.level`.
- Tamaño: M.

**E6.3 · Capítulo 2: ¿dónde está el Sol? (polo frente a ecuador)**
- Incluye: pantalla partida; región del ecuador generada por el pipeline.
- Criterios: en calidad baja, la pantalla partida sigue dentro del presupuesto (dos escenas con LOD 0).
- Reutiliza: `ensureEq`, `eqSun`, `updateEq`, `#divider`, `#splitL`, `#splitR`.
- Tamaño: M.

**E6.4 · Capítulo 3: sombras de kilómetros**
- Criterios: el texto experto muestra L = 1 / tan(1,5°) ≈ 38,2 km, con test.
- Reutiliza: `CH[2]`, acción `shadows`.
- Tamaño: S.

**E6.5 · Capítulo 4: mueve la bandera**
- Criterios: el texto aclara que ningún punto del polo sur tiene luz siempre.
- Reutiliza: `CH[3]`, acción `moveIn`.
- Tamaño: S.

**E6.6 · Capítulo 5: llamar a casa**
- Reutiliza: `CH[4]`, acción `lookEarth`.
- Tamaño: S.

**E6.7 · Capítulo 6: tú decides** (con el mejor punto cercano y la capa de mapa de calor)
- Reutiliza: `CH[5]`, acción `best`.
- Tamaño: S.

**Hito R4.**

### E7 · Transiciones entre vistas

**Cómo la abordaremos.** Empieza con un fundido simple en cuanto haya dos vistas; los vuelos de cámara llegan después. En calidad baja o con «reducir movimiento», fundido en lugar de vuelo.

- **E7.1 · Selector de vistas con fundido.** Reutiliza `goView`, `fade`, `paintViews`. S.
- **E7.2 · Vuelo de cámara entre vistas** («Bajar aquí», «Subir al dron»). Reutiliza `flyView`, `startTween`, `stepTween`, `tweenP`, `snapshot`. M.
- **E7.3 · Vuelo entre regiones** (precarga la región destino durante el vuelo). Reutiliza `flyRegion`. M.

### E8 · Idioma, opciones y accesibilidad

**Cómo la abordaremos.** El diccionario de textos existe desde E0.1, así que E8.1 es traducir y poner el selector. Los errores de la API se muestran a partir de su `code`, nunca su `message` (está en castellano y puede cambiar).

- **E8.1 · Cajón de opciones e inglés.** Recuerda la elección; arranca en inglés si el navegador no está en español. Reutiliza `UI`, `i18n`, `paintSegs`, `#drawer`. M.
- **E8.2 · Capas** (anillo y barras siempre visibles, etiquetas, mapa de calor). Reutiliza `updateLayers`. S.
- **E8.3 · Nota de datos, créditos y avance del modo clase.** Qué es real (efemérides con el código de la API, validadas contra JPL Horizons) y qué es simulado (relieve, hasta E9); créditos de texturas y de LOLA. S.
- **E8.4 · Accesibilidad básica.** Foco visible, nombres accesibles, «reducir movimiento», 375 px; la visita completa se recorre con teclado; contraste AA en el HUD. S.

### E9 · Relieve real LOLA, compartido con la API

**Objetivo.** Cambiar la fuente del pipeline de procedural a LOLA y publicar las máscaras para la API. Es la aportación de este frente al grupo.

**Cómo la abordaremos.**
- Como el formato es el mismo desde E0, la pantalla no cambia: solo se regeneran los ficheros.
- Una región primero (Shackleton), a resolución moderada; luego el resto.
- El horizonte lejano exige un DEM regional amplio (más de 100 km alrededor), aunque la malla visible sea de pocos km.
- Trampa: la proyección polar del DEM y su encaje con `SceneFrame`; se valida comparando con Quickmap.
- E9.1 puede arrancar ya, en paralelo con E0: solo es pactar un formato.

**E9.1 · Contrato de máscara pactado con el grupo**
- Incluye: esquema de `HorizonMask` y un fichero de ejemplo generado con el relieve procedural.
- Criterios: formato aceptado en el hilo por quien lleva la API.
- Tamaño: S.

**E9.2 · Relieve real de una región**
- Ve: Shackleton con su relieve real, sombras incluidas; aviso «Demo · relieve real en Shackleton».
- Incluye: el pipeline lee LOLA, recorta, reproyecta y genera todos los ficheros de la región.
- Criterios: el cráter es reconocible frente a Quickmap; los ficheros validan; los presupuestos se mantienen.
- Tamaño: M.

**E9.3 · Máscaras de los sitios del catálogo para la API**
- Incluye: `api-masks/<siteId>.json` de los sitios del catálogo del polo sur, con horizonte lejano.
- Criterios: la luz en el borde de Shackleton cae en el rango publicado (REVISAR fuente); quien lleva la API confirma que las carga.
- Tamaño: M.

**E9.4 · Las otras regiones** (Mons Mouton, Nobile, y Athena en sus coordenadas reales con fuente citada)
- Tamaño: S.

**E9.5 · La API usa nuestras máscaras**
- Lo hace quien lleva la API (`horizonModel: mask`, `/v1/horizon`); aquí: test de paridad entre las métricas del cliente y las de `/v1/windows` con máscara.
- Tamaño: S (de nuestro lado).

**E9.6 · Fuera el aviso** («Datos: LOLA y efemérides validadas contra JPL Horizons»; la nota explica lo que sigue aproximado, como la distancia comprimida en la vista órbita)
- Tamaño: S.

**Hito R3: relieve real en al menos una región y máscaras publicadas para la API.**

### E10 · Enlace con el planificador y API en directo

**Objetivo.** Coser esta pantalla con los paneles del planificador y cubrir lo que no está precalculado.

**Cómo la abordaremos.** El comparador de sitios y fechas lo construye el planificador sobre la API; aquí no se duplica. Los enlaces usan los mismos nombres de parámetro que la API. La API en directo solo se usa para lo que no está precalculado, y siempre con aviso de «sin relieve».

- **E10.1 · Abrir esta pantalla desde el planificador.** Lee `?site=<id>&date=<ISO>` o `?lat=…&lon=…&date=…`. S.
- **E10.2 · Volver al planificador** («Comparar en el planificador» desde la bandera). S.
- **E10.3 · Cualquier sitio y cualquier fecha.** Fuera de las regiones o del periodo precalculado, la pantalla pide la serie a `/v1/track` y muestra anillo y métricas sin relieve, con aviso; sin 3D del terreno si no hay región. Depende de que exista `/v1/track` y de una URL pública de la API. M.

### E11 · Modo ligero sin 3D (opcional)

**Objetivo.** Que la herramienta sirva en equipos que no pueden con WebGL o en conexiones lentas. Encaja con los «mapas 2D» del reto (objetivo 5).

**Cómo la abordaremos.** Usa los mismos datos (máscaras, mapa de calor, series) sin malla ni texturas: unos cientos de KB.

- **E11.1 · Vista 2D:** mapa de calor de la región visto desde arriba, bandera arrastrable, anillo, barras y cuenta atrás. Se activa sola si no hay WebGL o a mano desde el cajón. M.
- **E11.2 · Visita en modo ligero:** los capítulos 1, 4 y 6 funcionan en la vista 2D. S.

## 7. Hitos de entrega

| Hito | Al cerrar | Qué se puede enseñar | Cubre del reto |
|---|---|---|---|
| R0 | E0 | La cadena completa: Sol real sobre el polo, fechas reales, en una URL | Objetivos 2, 3 y 6 (parcial) |
| R1 | E1 | Luz y Tierra en un punto, con relieve (simulado), y cuenta atrás | Objetivos 3, 4 y 6 |
| R2 | E2 (+ E7.1) | Explorar tres regiones con la bandera y el mapa de calor | Objetivos 1 (parcial) y 5 |
| R3 | E9.1 a E9.3 | Relieve real en una región; máscaras para la API | «Data and accuracy» |
| R4 | E3, E4, E5, E6 | La visita completa, fluida en equipos modestos | Objetivo 7 |
| R5 | E8, E9.4 a E9.6, E7, E10 (y E11 si da tiempo) | Pulido, inglés, accesibilidad, todas las regiones reales, enlace con el planificador | Experiencia de usuario y objetivo 1 |

## 8. Orden, carriles y equipo

### 8.1 Carriles

| Carril | Épicas | Carpetas | Perfil |
|---|---|---|---|
| A · Núcleo e interacción | E0 → E1 → E2 → E6 | `src/core`, `src/ui`, `src/tour` | Front |
| B · Escenas | E4, E3, E7 | `src/scene` | Front con 3D |
| C · Render ligero | E5 | `src/scene/terrain`, shaders, `pipeline/relief` (texturas) | 3D y shaders |
| D · Pipeline y relieve | Pipeline de E0, E1.1, E2.5, E9 | `pipeline/` | Python y datos geoespaciales |
| Cualquiera con hueco | E8, E10, E11 | `src/ui` | — |

### 8.2 Orden recomendado

1. **E0 y E1 en serie, prioridad máxima.** Fijan la cadena, los formatos y la paridad.
2. **E9.1 ya**, en paralelo con E0: pactar el formato desbloquea a la API y al planificador.
3. **El carril D empieza con E0**: el pipeline es parte del esqueleto, no un extra.
4. **E2 antes que las otras vistas**: ahí está la idea central.
5. **E9.2 y E9.3 en cuanto haya producto de LOLA elegido**: mayor riesgo y mayor valor para el grupo.
6. **E5 antes de R4**: la visita completa debe ir fluida en el equipo de referencia.
7. **E6 lo último**, salvo decisión de adelantar los capítulos de la vista dron.
8. **E10 cuando el planificador tenga sus paneles**; **E11** solo si sobra tiempo o si las pruebas en equipos modestos fallan.

## 9. Calidad: pruebas, rendimiento y dispositivos

| Tipo | Qué comprueba | Dónde |
|---|---|---|
| Esquemas | Cada fichero del pipeline cumple su contrato | Pipeline y CI |
| Paridad con la API | Efemérides, métricas y próxima puesta coinciden con los ejemplos y respuestas de la API | CI |
| Coherencia | Órbita y dron dan la misma dirección del Sol; horizonte por vértice frente a máscara completa | CI |
| Valores de referencia | Sombra de 38,2 km; Shackleton dentro del rango publicado (REVISAR) | CI |
| Humo | La web carga y pinta | CI (Playwright) |
| Rendimiento | Descarga y fotogramas dentro de presupuesto | CI (Playwright) y equipo de referencia |
| Dispositivos | Chrome y Safari de escritorio, Safari de iOS y Chrome de Android, equipo modesto de referencia | A mano en cada hito |
| Prueba con personas | Hipótesis de la sección 1.3 | Antes de la entrega |

## 10. Demo y entrega

- **Guion de demo** de 3 minutos 💡: órbita → capítulo 1 (Athena) → arrastrar la bandera con el mapa de calor → bajar a pie y ver el Sol rasante → «Ver en 3D» desde el planificador. REVISAR con el equipo.
- **Plan B sin red:** la región y las fechas del guion precargadas en caché (un service worker, un pequeño programa del navegador que guarda ficheros para usarlos sin conexión) y la pantalla sin depender de la API.
- **Plan C:** vídeo grabado del guion.
- **Entregables de Space Apps** (vídeo, página del proyecto, enlace): REVISAR en la web de Space Apps.
- **Créditos y licencias:** texturas de NASA SVS (CGI Moon Kit) y Blue Marble, datos LOLA, astronomy-engine (MIT), visibles en el cajón.

## 11. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| LOLA es grande y su proyección polar complica el recorte | E9 se alarga y todo el grupo sigue sin relieve | Formato fijado desde E0; una región primero; resolución moderada |
| El volcado de efemérides diverge de la API | Números distintos ante el jurado | Volcado con el código de la API y test de paridad |
| Conversión de ejes mal hecha cerca del polo | El Sol de la escena no cuadra | `SceneFrame` con tests desde E0.2; brújula con norte local |
| El horizonte por vértice no es lo bastante fino | Sombras que no cuadran con las barras | Validación contra la máscara completa (E5.2); subir a 64 direcciones si hace falta |
| La rejilla de máscaras pesa más de lo previsto | Carga lenta en móviles | Ajustar paso y zona; cuantizar a 8 bits con desplazamiento; carga en segundo plano |
| La API sin URL pública | E10.3 no se puede hacer | Todo lo demás funciona con estáticos |
| Contradicción entre productos (100 % de Sol en Shackleton sin relieve) | Credibilidad | Máscaras pronto (E9.3); nota de «optimista» en los paneles |
| Rendimiento en el portátil del jurado | Demo a tirones | Presupuestos en el CI; calidad automática; modo ligero (E11) |
| Portar desde un único fichero con estado global | Historias que se pisan | Estructura fijada en E0.1; cada historia porta solo sus funciones |
| Cifras de Athena sin fuente firme | Credibilidad | REVISAR fuente antes de R4 |

## 12. Cómo pasarlo a GitHub

Una épica es un issue con la etiqueta `epica`; cada historia es un sub-issue enlazado. Plantilla:

```markdown
## Qué ve el usuario
<una o dos frases, en términos de pantalla>

## Qué incluye
- Pipeline: …
- Datos (ficheros y contrato): …
- Cliente: …
- Interfaz: …

## Dónde se calcula
<preprocesado | backend | cliente, y por qué (sección 3 del plan)>

## Criterios de aceptación
- [ ] …
- [ ] Paridad con la API (si aplica): ruta, parámetros, valor esperado y tolerancia
- [ ] Presupuestos (si aplica): descarga, CPU por fotograma, fps

## Reutilizar
- Prototipo: `…` (artifact «Mirador del Polo Sur», sección «…»)
- API v1: `…` (fuentes/2026-11-13-api-publica-v1-openapi.yaml)

## Fuera de alcance
- …

## Depende de
#<issue>

Tamaño: S | M
Épica: #<issue>
```

## 13. Temas pendientes

| Tema | Quién lo confirma |
|---|---|
| Este frente hace el preprocesado del relieve para el grupo | Grupo, en el hilo de Slack |
| Formato de la máscara (E9.1) | Quien lleva la API |
| Volcado de efemérides con el código de la API (paquete compartido o llamadas en local) | Quien lleva la API |
| Convención de azimut cerca del polo escrita en el contrato | Quien lleva la API |
| IM-2 Athena en el catálogo | Quien lleva la API |
| `/v1/track`, `/v1/horizon` y URL pública de la API | Quien lleva la API |
| `mode`: `center` para «se ve o no», fracción del disco para energía, `full` como opción conservadora | Equipo, en el hilo de Slack |
| Formato del enlace con el planificador | Planificador |
| Zona explorable, paso de la rejilla y periodo precalculado | Técnico |
| Producto y resolución de LOLA | Técnico |
| Hosting de datos grandes y límite por fichero de Cloudflare Pages | Técnico |
| Hipótesis, umbrales y guion de demo 💡 | Equipo |
| Fechas de la hackatón, personas por carril, criterios del jurado y entregables | Equipo (REVISAR) |
| Rango publicado de iluminación en el borde de Shackleton | Técnico (REVISAR fuente) |
| Fuente de las coordenadas y la desviación de Athena | Producto (REVISAR fuente) |
| Esta iniciativa no tiene aún `prd.md` ni ha pasado por el embudo | Producto |
