# Mirador del Polo Sur · decisiones de arquitectura en este repo

Fecha: 2026-11-14 (revisado el mismo día por #120). El [desglose del tour](desglose-tour-lunar.md) se escribió pensando en un repo con otro stack (Vite + TypeScript, Cloudflare Pages, pipeline en Python, la API desplegada). Este documento recoge **en qué nos apartamos y por qué**. Donde choque con el desglose, manda este documento; el resto del desglose (épicas, contratos, reparto del cálculo) sigue valiendo.

## Glosario: cómo llamamos a cada cosa

Antes de #120 la misma pantalla tenía cinco nombres y «tour» significaba tres cosas. A partir de ahora:

| Nombre | Qué es | Dónde |
|---|---|---|
| **Mirador del Polo Sur** | La pantalla entera, con sus dos puertas | Carpeta `viewpoint/`, misión 02 de la portada |
| **Exploración** | La puerta sin parámetros: el polo sur en 3D con el Sol y la Tierra reales. Es la que sigue el desglose y el artifact del Mirador | `viewpoint/` |
| **Visor de misión** | La puerta que abre el simulador con «Ver en 3D»: la misión de Planificar reproducida sobre el relieve, con el veredicto | `viewpoint/?site=…&t0=…&days=…` (`viewpoint/src/mission.js`) |
| **Visita guiada** | Los capítulos con preguntas de la épica E6 del desglose. Empezó con #493: el motor y el capítulo «Mueve la bandera»; E6.2 añade «Sombras de kilómetros», «Llamar a casa» y «Tú decides» | Botón «Empezar la visita» de la exploración (`viewpoint/src/visit-ui.js`) |
| **Tutorial** | La ayuda de la primera visita (pasos sobre la pantalla) | Botón «Tutorial»; motor compartido `web/js/common/tour-engine.js` |

La carpeta se llama `viewpoint/` desde #126 (antes `tour/`; la URL publicada pasó de `/tour/` a `/viewpoint/`). «Tour» queda solo en la etiqueta de GitHub y en identificadores de código ya existentes (la zona `tour` de la portada, la clave del tutorial). En textos, issues y documentos se usa el nombre de la tabla.

## Una pantalla, dos puertas

`viewpoint/src/main.js` decide la puerta: si la dirección trae `?site=`, carga el visor de misión; si no, la exploración. Las dos comparten la escena (`viewpoint/src/scene.js`), las regiones de relieve (`viewpoint/data/<región>/`) y la línea de tiempo.

- **Exploración:** sigue el desglose. Hoy tiene E0 (Sol real y línea de tiempo), el relieve LOLA de E9 y **E1** (#121: anillo, barras y cuenta atrás en el panel «Luz y Tierra en la bandera»; detalle en [`viewpoint/README.md`](../viewpoint/README.md)). Lo siguiente es **E2** (mover la bandera) y una **E6** corta con los capítulos de la vista dron (1, 4 y 6).
- **Visor de misión:** en el desglose cuenta como **E10, el enlace con el planificador, adelantado y ampliado**. Su regla propia (#79): la escena ilustra y el veredicto decide.

## La fuente de verdad: datos reales precalculados

Si en un instante hay luz o sombra y si se ve la Tierra, lo dicen los **datos reales precalculados**: efemérides del motor de `backend/src/` y horizonte LOLA, generados por `pipeline/` y publicados como ficheros estáticos. Las dos puertas tienen que dar la misma respuesta para el mismo sitio y el mismo instante.

- El motor simulado de `web/` solo es el último recurso (API → precalculado → simulado) y, cuando se usa, la pantalla lo dice.
- Hoy la exploración ya lee datos reales (`series-2027.json`). El visor, en GitHub Pages, aún cae al simulado y lo avisa («veredicto con datos de ejemplo», opción b de #82). Deja de hacerlo con **#94** (ventanas reales precalculadas) y **#95** (cielo real precalculado).
- Para que «real» sea lo mismo en las dos puertas (criterios añadidos en #94 y #95):
  - **Un mismo punto para la Cresta.** `connecting-ridge` de la web (−89,45°, −137,3°) y `shackleton-rim` (−89,44027°, −137,12649°) están a unos 90 m.
  - **Generado con el DEM**, con `horizonModel: "mask"` y no esfera.
  - **Una sola versión del DEM** para relieve, series y ventanas, y un solo fichero de cielo por sitio.

## Equivalencias entre las issues y el desglose

| Issue | Qué hizo | En el desglose |
|---|---|---|
| E0.1 a E0.5 (#8 a #12) | Pantalla, efemérides, Sol, línea de tiempo y relieve procedural con `SceneFrame` | E0 completa (el orden interno no coincide: el relieve, E0.2 en el desglose, es E0.5 en las issues) |
| E0.6 (#40) | Cielo real (estrellas, Sol y Tierra con textura) | Sin equivalente; reabierta por #120 para la exploración |
| #6 | Contrato de máscara, máscaras de los sitios y relieve en la API | E9.1, E9.3 y E9.5 del desglose |
| E9.1 (#44) | Relieve LOLA real de Shackleton | E9.2 del desglose |
| E9.2 (#45) | Horizonte lejano (anillo de 300 km) | Parte de E9.2 del desglose y de E5.1 |
| E9.3 (#46) | Mons Mouton (`im2-objetivo`) con relieve LOLA | E9.4 del desglose |
| E9.4 (#47) | Nota de datos | E9.6 y E8.3 del desglose |
| V1 (#79): V1.1 a V1.5 (#72 a #75, #81) | Visor de misión | E10.1 y E10.2; E0.4 en modo misión; parte de E1.2 y E1.4. La batería (V1.4) y los saltos (V1.5) no están en el plan del tour |
| V2 (#80): V2.1 a V2.4 (#76 a #78, #82) | Regiones LOLA de los sitios de la web para el visor y aviso de fuentes distintas | E9.4 del desglose, ampliada a los sitios de la web |
| #97 | Relieve más fino, sombras limpias y superficie con detalle | Parte de E5.1 a E5.4 |
| E1 (#121): E1.1 a E1.4 (#122 a #125) | Métricas de un punto en la exploración | E1.1 a E1.4 |
| E3 (#181): E3.1 a E3.5 (#182 a #186) | A pie en primera persona: bajar y mirar, andar, saltar e ir con un clic, brújula y controles táctiles | E3.1 a E3.5. Andar sin la bandera que te sigue (eso es E3.6, #187). Física real en lugar de velocidades exageradas (ver abajo) |

## Regla para issues nuevas del Mirador

Cada issue nueva del Mirador dice, en su cuerpo:

- **Puerta:** exploración, visor de misión o las dos.
- **Desglose:** el id de la historia que cubre (por ejemplo, E2.2), o «fuera del plan» con una línea de por qué.

Así se ve enseguida si el trabajo sigue el plan o se aparta, y la tabla de equivalencias se mantiene sola.

## Decisiones de stack

| Tema | El desglose dice | En este repo | Por qué |
|---|---|---|---|
| Pantalla | Vite + TypeScript, carpetas `src/…` | Carpeta estática **`viewpoint/`** sin compilación, con three.js 0.160 desde CDN (como `home/`). Dentro, como `planner/`: `index.html`, `src/` (código y `src/styles/`), `tests/`, `data/` (lo que genera el pipeline) y `package.json` | Es la forma del repo: una pantalla = una carpeta, servida por `serve.mjs` y publicada tal cual (sin `tests/` ni `package.json`) |
| Despliegue | Cloudflare Pages, URL por PR | **GitHub Pages** con `.github/workflows/pages.yml` en cada push a `main`: https://540.github.io/lunar-landing-site-navigator/ | Ya existe y pasa `npm test` antes de publicar. Sin URL por PR |
| Pipeline del relieve | Python con `rasterio` o GDAL | **Node** (`pipeline/`), también para LOLA: lee el DEM con el motor de `backend/src/terrain/dem.ts` (#44) | Un solo lenguaje en el repo |
| Volcado de efemérides | Paquete compartido pactado con quien lleva la API | Script de Node que llama a **`series()` del motor de `backend/src/`** | El motor de la API está en este repo: paridad por construcción, sin pactar nada |
| Back | API pública con URL | **Sigue siendo local** (`data/`, puerto 3100). La exploración no llama a la API en tiempo de uso; el visor la usa si la encuentra (en local o con `?api=`) y, si no, cae a lo precalculado y luego al simulado | Todo lo necesario se precalcula y se publica como ficheros estáticos |
| Datos generados | Almacenamiento de objetos versionado | **Se suben al repo** dentro de `viewpoint/data/` | Pesan poco (cientos de KB por región y año) y así Pages los publica sin tocar el workflow |
| CI | Typecheck, lint, Vitest, Playwright, presupuestos | Los tests del Mirador están en `viewpoint/tests/` (`npm test --prefix viewpoint`) y cuelgan de **`npm test`** en la raíz | Es lo que ya ejecutan el workflow de Pages y la release. Playwright y presupuestos, cuando llegue E5 |
| Prototipo | Artifact «Mirador del Polo Sur» | Copia congelada de la v1 en [`mirador-polo-sur/`](mirador-polo-sur/). La v3, con datos reales (https://claude.ai/artifact/Y7ZWbWKPWK1mbcpYonNuGV), es la referencia visual de la exploración (#40) | Para portar con líneas concretas |

## Convenciones que se mantienen

- Las de la API v1: azimut desde el norte selenográfico local hacia el este (0 a 360°), longitud este positiva, fechas UTC.
- En la escena, como en el prototipo: `x` y `z` en km respecto al centro de la región, con el azimut 0° hacia `-z`.
- Código en inglés; textos que ve el usuario, en español y en un diccionario (`viewpoint/src/texts.js`, nada escrito a fuego).
- Lo simulado se dice: el aviso de la esquina sale de `meta.source.type` y avisa cuando el relieve y el veredicto tienen fuentes distintas.

## Rango y regiones

- Serie de efemérides: **solo 2027**, que es donde está el ejemplo de paridad de la API (`shackleton-rim`, 2027-01-15T00:00Z → Sol a 229,72° y 0,38°). Se amplía cuando haga falta (el capítulo 1 de la visita guiada, Athena, es del 2025-03-06).
- Región por defecto de la exploración: **cresta de conexión de Shackleton** (`shackleton-rim`, −89,44027°, −137,12649°; punto C1 de Gläser et al. 2018 refinado con el DEM LOLA. Hasta noviembre de 2026 era el «borde de Shackleton», −89,45°, −137,0°).
- Regiones con relieve LOLA en `viewpoint/data/`: `shackleton-rim` e `im2-objetivo` (con serie), y `ridge-slope`, `malapert`, `gerlache` y `mouton` (sitios de la web, para el visor).

## Escena 3D: relieve, sombras y relleno (#97)

Lo que dibuja `viewpoint/src/scene.js` (el tour y «Ver en 3D» de Planificar y Replanificar), y por qué:

- **Relieve por niveles.** La zona de 40 km sigue a 156 m, y alrededor del sitio hay dos rejillas más finas del mismo DEM LOLA: 20 km a 78 m y 10 km a 19,5 m (`meta.detail`, las genera `pipeline/relief.mjs` para cada sitio con ventana LOLA de 20 m; un relieve simulado o procedural no las lleva y se dibuja igual, con su rejilla de 156 m). Cada nivel deja un hueco donde va el siguiente; `viewpoint/src/core/relief.js` los cose (misma altura y misma normal en el borde) y calcula las normales de cada nodo con la pendiente del DEM. Si una rejilla fina no carga, se dibuja con las anteriores.
- **Sombras.** Con el Sol a 1°, un texel de altura del mapa de sombras se estira 60 veces sobre el suelo. La cámara de sombras se ajusta en cada cambio del Sol a la caja de la zona vista desde él (`fitShadowFrustum`): pasa de más de 60 km de alto a entre 5 y 7, es decir, de 15 m a menos de 2 m por texel con el mismo mapa de 4096 × 4096. El sesgo va a lo largo del rayo (apenas mueve la sombra) y no hay sesgo por la normal, que con luz rasante la desplazaba cientos de metros. Filtro suave (`PCFSoftShadowMap`).
- **Relleno.** Dos luces tenues que no proyectan sombra, para que el relieve en sombra se lea: la que devuelven las laderas iluminadas (llega del lado opuesto al Sol) y la de la Tierra (desde su azimut, solo si está sobre el horizonte). Están exageradas respecto a la realidad y lo dice el código; quedan muy por debajo del suelo al sol. Los colores e intensidades del Sol, el ambiente, el rebote y la Tierra, y el color del regolito, son los de `shared/render/lighting.js`, comunes con la cabina del juego y el cielo 3D del planificador (#339); el Mirador solo elige su exposición.
- **Regla de verdad.** Nada de esto decide: el anillo del módulo y los indicadores de luz y Tierra salen de las ventanas del veredicto, no del mapa de sombras.
- **Portabilidad.** Materiales y luces estándar de three.js (`MeshLambertMaterial`, `DirectionalLight`, curva de tonos ACES del renderizador). El único GLSL propio es el del aspecto del suelo, que se engancha al material estándar del relieve (siguiente punto).
- **Aspecto de regolito (#393).** El material del relieve (`viewpoint/src/terrain-material.js`, con los números y el GLSL en `core/surface-detail.js`) añade al sombreado, sin fotos ni mapas de albedo:
  - **Detalle ilustrativo:** grano (ruido por octavas, de ~1 km a ~2 cm), cráteres pequeños y, a la escala de las botas, piedras. Solo inclina la normal y matiza el brillo: no mueve la geometría ni entra en el mapa de sombras, las máscaras o el veredicto. «Fuentes» lo dice.
  - **Por debajo del relieve:** cada malla lleva el paso de su rejilla y un rasgo solo se dibuja si es más pequeño que lo que esa rejilla resuelve (cráteres de menos de 1 a 2 pasos de diámetro, grano de menos de 2 a 4 pasos de onda). Lo que el LOLA puede enseñar sale del LOLA.
  - **Por encima del píxel:** un rasgo se desvanece antes de medir menos de 1,5 a 4 píxeles en pantalla (según la distancia y lo rasante de la vista), así que no parpadea al mover la cámara.
  - **Sol rasante:** donde el Sol roza el suelo, un bulto de dos grados sale muchas veces más brillante o negro; la inclinación del detalle baja ahí al 24 % y es completa en las laderas que miran al Sol.
  - **Hombro de luces:** antes de la curva ACES, la luz del suelo pasa por `techo · (1 − exp(−luz / techo))`. Lo oscuro queda igual (sombras y suelo rasante no cambian) y las laderas que miran al Sol, muchas veces más brillantes, conservan el detalle en vez de quemarse en blanco.
  - En calidad «bajo» se dibuja un cráter por celda en lugar de dos.
- **Peso.** Las rejillas finas van comprimidas (`delta16-gzip`, la mitad que en plano): unos 0,32 MB por sitio. `viewpoint/data/` pasa de 1,58 MB a 3,22 MB (cinco de las seis zonas llevan detalle; `mouton`, que sale solo del DEM de 160 m, no); cada misión descarga solo su zona.
- **Horizonte lejano (E9.2).** El anillo de 300 km sigue igual: la rejilla de 156 m se funde con él en su franja del borde y sobre esa rejilla ya fundida se montan los niveles finos, que acaban a 10 km del borde. El anillo no proyecta sombras, así que la cámara de sombras se ajusta solo a la zona de 40 km.

## A pie: física real (E3, #181)

La vista a pie es en primera persona y se mueve como un astronauta en la Luna, no como en un juego. Se aparta del desglose y de las issues, que pedían velocidades exageradas (5 m/s y 50 m/s) para cruzar rápido la zona de 40 km:

- **Velocidades de las EVA del Apolo:** 1 m/s andando y 2,2 m/s en el trote a saltitos (*lope*) de Apolo 16 y 17.
- **Agarre:** las botas empujan como mucho rozamiento × peso, y el peso es un sexto del terrestre: unos 1 m/s² para arrancar y frenar. Se tarda en ponerse en marcha y al parar se resbala un poco (unos 2,5 m desde el trote).
- **En el aire no se cambia de rumbo:** la velocidad horizontal se conserva hasta aterrizar.
- **Salto con el traje:** 1,3 m/s de impulso, medio metro de altura y 1,6 s en el aire con 1,62 m/s².
- **Pendiente máxima:** 30°.
- **Paso:** los ojos suben y bajan unos centímetros con cada zancada (nada con «reducir movimiento»). La vista se enmarca con el borde del visor del casco.

Las reglas están en `viewpoint/src/core/walk.js` y `foot-camera.js`, con sus tests en `viewpoint/tests/foot.test.js`. El criterio de E3.2 «1 s andando avanza la velocidad de andar» se comprueba ya en marcha, porque con inercia no se arranca a velocidad plena.

**Tu propio traje.** Si bajas la mirada ves desde dentro del casco el traje **Z-2 de NASA**, el prototipo pensado para andar por otros mundos. Es el modelo 3D de NASA 3D Resources, de dominio público, con sus texturas de 4096 px: tela con polvo de regolito, costuras, bandas, el panel de control del pecho y los guantes. `pipeline/suit.mjs` lo prepara: le quita la compresión Draco y las copias JPEG y lo deja en 3,2 MB, en `viewpoint/assets/suit-z2.glb`, que solo se descarga al bajar a pie. En el navegador (`viewpoint/src/suit-body.js`, con las reglas puras en `core/`):

- **Sin casco:** las piezas del casco se quitan enteras. Cada triángulo del torso que cruza el anillo del cuello, a 1,6 m, se corta justo a esa altura, así que el pecho queda entero, sin agujeros ni astillas (`clipBelow` en `core/suit-rig.js`).
- **Nunca se ve a través del traje:** su interior se dibuja oscuro (las caras de dentro, con la misma piel y los mismos huesos). Dentro del torso va tu propio cuerpo, en sombra. Al mirar abajo por el anillo del cuello ves oscuridad, no el suelo ni las piernas vacías del traje.
- **Ojos donde los tendría una persona:** 18 cm por encima del anillo y un poco adelantados. El modelo se escala ×0,955 para que coincidan con la cámara a 1,7 m.
- **Sin facetas ni grietas:** la tela se curva con triángulos PN (Vlachos et al. 2001, `core/pn-triangles.js`): 9 triángulos por cada uno en calidad alta y media, y 4 en baja: vistos a 30 cm, los guantes se facetan con menos. Las piezas duras (el panel del pecho) se quedan rectas.
  - Los parches se forman con una normal por posición (`weldNormals`): 1 700 posiciones del Z-2 tienen una normal distinta a cada lado de una costura, y cada lado se curvaba por su cuenta y abría una grieta por la que asomaba el forro negro.
  - Primero se curva y luego se corta en el anillo del cuello: al revés, los triángulos largos del torso que suben al casco quedaban en astillas que se abrían en abanico sobre los hombros.
- **Cuello y cintura:** como en un traje presurizado, la cabeza solo baja 35° dentro del casco. Para mirar más abajo te doblas por la cintura (hasta 35° más, con un hueso de columna): los ojos se adelantan y bajan, y al tope (70°) ves tus botas. La mirada nunca entra en tu propio cuerpo (`core/foot-camera.js`).
- **Cuerpo dibujado aparte, como en los juegos en primera persona:** el traje está en su propia capa y se dibuja después del mundo, con la profundidad borrada, así que el suelo nunca lo corta y no se ve a través de él. Además, el campo de visión no pasa de 110° en horizontal: en una pantalla muy ancha se estrecha el vertical en lugar de estirar los hombros y los brazos de los bordes.
- **Postura relajada:** el modelo viene con los brazos levantados y abiertos, como un maniquí. Se bajan casi rectos desde el rodamiento y los codos guardan la ligera flexión de un traje presurizado: al mirar abajo del todo, los guantes asoman por el borde inferior (`ARM_REST` en `core/arm-motion.js`).
- **Esqueleto:** el modelo no trae esqueleto, así que se le pone uno (cadera, rodillas, hombros y codos), con pesos por zonas. Las piernas siguen el paso, el trote y el salto (`core/suit-pose.js`).
  - **Por piezas:** el torso rígido (la fibra del pecho y los hombros, la mochila y las piezas duras) va entero con la columna. Antes se mezclaba con los hombros: se doblaba como tela, rompía la bandera del hombro y plegaba las capas unas sobre otras.
  - **El hombro gira en su rodamiento:** el pivote está en el centro del anillo que comparten el torso y el brazo (medido en el modelo), y lo que se estira es la tela del brazo en sus primeros 6 cm. Con el pivote 13 cm por detrás, el brazo se salía del puño del torso y dejaba un agujero.
- **Brazos naturales:** cada articulación sigue su objetivo con un muelle amortiguado (`core/arm-motion.js`), así que tienen inercia y no van rígidos.
  - **Balanceo:** van contra las piernas, más amplio en el trote, y el codo se dobla al adelantar el brazo.
  - **Inercia:** se quedan atrás al acelerar, siguen hacia delante al frenar y se van de lado al girar.
  - **Salto:** en el aire se levantan y se abren, y al aterrizar caen.
  - **Respiración:** quieto, respiras; solo mientras miras el traje y nunca con «reducir movimiento».
  - **Ritmo lunar:** un brazo colgando es un péndulo y oscila más despacio con menos gravedad (ω ∝ √g, unas 0,4 veces la de la Tierra). El traje lo amortigua: se para en una o dos oscilaciones.
- **Lo que se ve, como en un traje real:** los brazos adelantados con los guantes delante de la tripa, el panel del pecho al mirar abajo y casi nada de los pies, que tapan el torso rígido y el anillo del cuello.
- **Texturas a 30 cm** (`core/suit-maps.js`): el atlas del Z-2 pone sus piezas sobre un fondo blanco y su relieve es un mapa de alturas gris con piezas negras.
  - Usado como *bump map*, cada borde de pieza era un acantilado: rayas negras y blancas en las costuras. Se convierte en un mapa de normales cuya pendiente solo se lee dentro de una pieza y nunca a través de un salto.
  - El color se dilata sobre el fondo, así que al filtrar no entra blanco en los bordes de las piezas.
- **Luces propias del cuerpo** (`scene.js`, `BODY_*`): el Sol del mundo vale 40 para que el suelo, que lo recibe rasante, reciba sin(el) de él; el traje lo recibe de frente y se quemaba en blanco.
  - El cuerpo tiene su Sol, en la misma dirección y con la fuerza de un traje blanco al sol, y la luz que el regolito devuelve desde abajo.
  - Tiene también las lámparas del casco, una luz suave desde los ojos hacia lo que miras, para que los guantes y el reloj se lean a contraluz.
  - Si el relieve tapa el Sol donde estás, su luz baja con la parte del disco que se ve (`core/sunlit.js`). El cuerpo se dibuja aparte del mundo y no recibe sus sombras.
- El crédito del modelo está en «Fuentes».

**Reloj de muñeca (al estilo de los juegos de supervivencia).** Con la tecla R, o el botón ⌚, levantas el brazo izquierdo y bajas un poco la cabeza para mirar el reloj; con R otra vez, lo bajas.

- **Qué dice:** lo mismo que el panel «Luz y Tierra en la bandera» de E1 (#121, PR #267), con sus mismas funciones puras:
  - la hora UTC;
  - el estado del Sol y de la Tierra, con la cuenta atrás hasta que se pongan o salgan;
  - el anillo del horizonte visto desde arriba, con hacia dónde miras;
  - la luz y la Tierra del periodo.
- **Bajado,** solo enseña la hora, atenuada. El lector de pantalla lo anuncia al levantarlo.
- **Ficheros compartidos con #267:** `core/sky-state.js`, `core/horizon-ring.js` y los `data/<región>/mask.json` son copias exactas de esa PR, así que al fusionar las dos no chocan.
- **El brazo** se coloca con cinemática inversa de dos huesos (`core/arm-ik.js`), como hacen los juegos: el antebrazo cruza delante del pecho, al alcance real del brazo.
- **Sin choques entre piezas, medido y no supuesto** (`core/surface-fit.js`):
  - El reloj cuelga del hueso del antebrazo, que ahí mueve la tela de forma rígida (peso 1), así que lo medido vale en cualquier postura.
  - Al cargar se mide la superficie real del antebrazo alrededor de la correa, en 72 sectores.
  - La correa sigue ese perfil a 2,5 mm y la caja se asienta en el punto más alto bajo ella, con 0,8 mm de holgura.
  - La pantalla va 0,6 mm por delante de la caja, para que no haya *z-fighting*.
  - Comprobado en el navegador con todos los vértices del traje ya deformados (brazo bajado, reloj arriba, mirando abajo y trotando): ninguno dentro de la caja ni de la correa.
- **Traje de astronauta:** la textura del Z-2 es la de un traje de pruebas gastado. Al cargar se limpia (`core/suit-texture.js`): la tela queda blanca con su trama y costuras, los guantes de tela gris clara y los rodamientos de metal oscuro. Las franjas rojas de EVA y las bandas azules se mantienen. El logo de NASA, la bandera, el parche de misión y el crédito del Advanced Concepts Lab que trae el atlas del Z-2 se pintan encima al preparar el modelo (`pipeline/suit-branding.mjs`): el traje solo lleva el parche de 540.
  - Mugre o color se decide por el croma y el tono, no por la saturación HSL. Un marrón oscuro tiene tanta saturación como una franja y se quedaba en manchas grises en rodillas y guantes; el azul en sombra de las bandas, en cambio, sigue azul.
  - Rodamiento o tela se decide por la pieza entera (`darkParts` en `core/suit-maps.js`): el centro de una mancha es tan oscuro como un rodamiento.
  - Las reglas entran en una banda, no con un umbral, así que no dejan bordes.
- **Bajar la cabeza para leer** solo mueve la mirada dentro del casco, nunca la cintura y nunca más de lo que deja el cuello (`headDown` en `footPose`). Si los ojos bajaban también con la cintura, la cámara se metía en tu propio brazo.

**Tus gestos con la cámara.** Con el botón de la cámara (a pie), la cámara de tu equipo sigue tus gestos y el astronauta los repite. MediaPipe Tasks (Google, Apache 2.0) busca en la imagen los puntos de tu cuerpo, tus manos y tu cara, en tu navegador: la imagen no sale del dispositivo. El módulo se descarga de jsDelivr y los modelos (unos 17 MB) del almacenamiento de Google, y solo al encender la cámara. Un espejo pequeño enseña tu imagen con los puntos que se siguen: brazos en ámbar, manos en blanco, ojos e iris en azul. `gesture-ui.js` lleva la cámara, los detectores y el espejo; las reglas son puras, en `core/`:

- **Brazos** (`core/body-track.js`): los puntos del brazo pasan al marco de tu propio torso (de hombro derecho a izquierdo, de caderas a hombros), así que da igual cómo estés girado respecto a la cámara.
  - Tu brazo izquierdo es el izquierdo del astronauta, como en primera persona.
  - El traje toma solo las direcciones del brazo y el antebrazo, con sus propias longitudes.
  - Ninguna mano ni ningún codo entra en el pecho del traje (`clearOfTorso`).
  - Un brazo que la cámara apenas ve no se sigue y vuelve a la animación.
- **El reloj por gesto:** levanta el antebrazo izquierdo delante del pecho, con el codo doblado y la muñeca hacia el centro, sin mirar hacia arriba, y el astronauta mira su reloj.
  - Se activa tras mantener la postura un momento y se baja tras dejarla un poco más, así que ni parpadea ni salta por casualidad.
  - La tecla R sigue funcionando entre medias.
- **Dedos** (`core/hand-track.js` y `core/hand-rig.js`): el Z-2 no trae huesos en las manos, así que los dedos se encuentran en la propia malla del guante.
  - Se mide la distancia sobre su superficie desde la muñeca: las puntas son sus máximos y cada punto es del dedo al que sube.
  - El nudillo está donde el dedo deja de tocar a sus vecinos.
  - Cada guante recibe así 11 huesos: la mano y dos por dedo, el primero en el nudillo y el segundo a mitad del dedo.
  - De tus 21 puntos por mano sale cuánto se dobla cada articulación, solo en el sentido del doblez y no en el de abrir los dedos.
  - Cada mano detectada es la tuya del lado de la muñeca más cercana en la pose: la etiqueta de MediaPipe supone una imagen de espejo.
- **Cabeza y ojos** (`core/head-track.js`):
  - La cabeza se lee de la geometría de la cara (mejillas, frente y barbilla) y los ojos de sus coeficientes de mirada; sin ellos, del iris entre las comisuras.
  - Al empezar se toma tu cabeza en reposo, y se puede recalibrar.
  - Como en los simuladores de vuelo, girar la cabeza 1° gira la vista 2°, y los ojos añaden hasta 18°.
  - Más allá de 65°, el cuerpo sigue girando hacia ese lado, para que puedas darte la vuelta con la cabeza.
  - La cabeza gira dentro del casco y el cuerpo sigue mirando a donde iba: al girarla ves tu propio hombro.
- **Brazos como bisagra** (`hingePose` en `core/arm-ik.js`): el brazo toma a la vez su dirección y el plano del codo, y el codo solo se dobla en ese plano. Antes cada hueso se alineaba por el giro más corto: el giro del brazo sobre sí mismo quedaba al azar y el antebrazo se retorcía como si el brazo se partiera. Con el brazo recto se mantiene el plano que tenía.
- **Esqueleto a la vista:** en el panel se puede ver sobre el traje el esqueleto que mueve la cámara (hombros, codos, muñecas y dedos), con los mismos puntos que se dibujan sobre tu imagen, desde los hombros.
- **Tercera persona** (tecla V o su botón): la cámara va detrás del astronauta y un poco por encima, mirando a donde miras, para ver tus gestos desde fuera. Se ve el casco entero y una sombra suave bajo las botas, y el relieve puede taparlo (`thirdPersonPose` en `core/foot-camera.js`).
- **Suavizado:** todos los puntos pasan por un filtro One Euro (`core/one-euro.js`), que en reposo no tiembla y en movimiento no se retrasa.
- **Seguridad:** la cámara solo funciona en un contexto seguro (https o localhost); en una dirección http de la red local el panel lo explica.

- **Brazos en reposo:** cuelgan a los lados; al mirar abajo del todo solo asoman las manos en las esquinas y las botas.

**En realidad virtual (#396).** Con unas gafas compatibles con WebXR (Meta Quest y otras) aparece «Entrar en VR»: bajas a pie, si no lo estabas ya, y estás dentro del traje, a tamaño real y en estéreo. Sin visor el botón no aparece y nada cambia. La cámara solo funciona en una dirección segura (https o localhost). La lógica pura está en `core/xr-input.js`, el bucle en `scene.js`, el paso a pie en `foot-view.js` (`xrFrame`) y el botón en `xr-ui.js`.

- **Cabeza:** el visor mueve la vista con sus seis grados de libertad.
  - Tus ojos quedan a tu altura real, la mediana de los primeros instantes, y el traje se escala a ella, así que siempre estás dentro.
  - Andar por la habitación también te mueve por el terreno.
  - El cuerpo gira tras la cabeza, un momento después.
- **Moverse:** stick izquierdo para andar, con la física lunar de E3.2 (al tope, corres); stick derecho para girar a saltos de 30°, que marean menos que un giro continuo; botón A para saltar.
- **Brazos y dedos:** las muñecas van a los mandos, o a las manos con seguimiento de manos, con IK de dos huesos desde el hombro.
  - Con manos, sus 25 articulaciones dan los 21 puntos de MediaPipe y los dedos se doblan igual que con la cámara.
  - Con mandos, el gatillo dobla el índice, el agarre los otros tres dedos y el pulgar se apoya al tocar el stick o los botones.
- **Reloj:** se despierta al llevar la muñeca izquierda delante de los ojos y un poco por debajo, a menos de 45 cm; el gesto tiene histéresis.
- **Cómo se dibuja:**
  - En VR, three.js usa la capa 1 para el ojo izquierdo y la 2 para el derecho, sean cuales sean las capas de la cámara. Por eso el cuerpo pasa a la capa 0, y su pase, con sus propias luces, se hace por visibilidad, con el mundo oculto.
  - El visor da metros y la escena está en km: la cámara cuelga de un rig ×0,001, y en el espacio de los ojos los planos cercano y lejano van en metros (2 cm y 20.000 km), con profundidad logarítmica.
  - El tamaño de un sprite no incluye la escala de la vista, así que el Sol y el halo de la Tierra se multiplican por mil mientras dura la VR.
  - Estrellas: fuera del visor el Mirador usa el campo común de `shared/render/stars.js` (#340), sin cambios. Dentro, ese campo (puntos fijos de 1,6 px) no se ve bien: parpadea a través de las lentes. Mientras dura la sesión se muestra en su lugar el catálogo Yale BSC5 (9.096 estrellas hasta magnitud 6,5; dominio público; `pipeline/stars.mjs` lo convierte en `assets/stars-bsc5.bin`, 71 KB, que solo se descarga la primera vez que se entra en VR): cada estrella es un punto suave en su posición real a la hora de la escena (`star-field.js`, con `core/star-sky.js`), con su brillo y su color. Al salir se restaura el campo común.
- **Entrada y salida a prueba de fallos:** el estado de la escena (planos de la cámara, rig, sprites, estrellas, vista a pie) solo se cambia cuando `setSession` ha resuelto. Si lanza (por ejemplo, un visor sin espacio de suelo), se cierra la sesión pedida y la interfaz sigue a pie, con un aviso. Se pide `local-floor` como opcional; si el visor no lo da se usa `local` y se suma la altura de una persona de pie (`core/xr-session.js`, `referenceSpaceFor`). Al terminar la sesión hay una sola restauración, en un orden fijo (`xrRestoreSteps`): al volver al dron, `exit()` espera al final de la sesión y el dron conserva sus planos; al volver a pie se recuperan la tercera persona y la inclinación de la mirada de antes de entrar.
- **Probado** con el emulador de WebXR de Meta (IWER, Quest 3) en Chromium: entrar, mirar, andar, girar, reloj, manos y salir. Falta probarlo en un visor real.

**PlayStation VR (PS4), solo con la web (#396), experimental.** Las PS VR no tienen WebXR, pero en Chrome o Edge en un ordenador funcionan sin instalar nada (`psvr.js` y la lógica pura en `core/psvr.js`). Como WebHID está en todo Chrome y Edge de escritorio, haya visor o no, la PS VR solo se ofrece con `?psvr=1` en la dirección (`offersPSVR`): sin el parámetro no se crean su botón ni su registro, no se carga `psvr.js` y no se llama a WebHID ni a WebUSB, así que la pantalla es la de siempre.

- **Conexión.** La caja procesadora va al ordenador por USB y HDMI; Windows ve sus gafas como una pantalla más, que debe estar en modo extendido.
- **«Conectar PS VR».** El navegador pide el dispositivo y, por WebHID, enciende las gafas y las pasa a modo VR. Son los comandos que usa el controlador de OpenHMD, que son informes HID: 0x17 encender, 0x23 modo VR y 0x11 seguimiento.
- **El modo VR en Windows y macOS.** El driver HID del sistema no deja pasar los comandos: la interfaz de control solo muestra informes *feature*. En Windows, una sola vez, **Zadig** (gratis, sin instalación) pone el driver WinUSB en la interfaz 5, y Chrome manda las tramas por **WebUSB** con el botón «Activar modo VR (USB)». Es lo mismo que pide PSVRToolbox. El permiso se recuerda: la próxima vez basta «Conectar PS VR». En macOS no hay forma de quitarle la interfaz al sistema, así que no hay modo VR, solo modo cine con la cabeza.
- **Registro visible.** Un panel cuenta qué interfaces da el sistema, cada comando enviado o su error, los informes del sensor y las pantallas encontradas.
- **«Entrar en VR (PS VR)».** Pone la página a pantalla completa en la pantalla de las gafas (Window Management API), sin nada de la interfaz por encima. Son dos clics porque el navegador pide uno para cada permiso.
- **La cabeza** sale del sensor de las gafas (BMI055 a 2.000 Hz). El giróscopo la gira y el acelerómetro la mantiene recta (filtro de Mahony). Solo es giro: la posición la daría la PS Camera. El rumbo deriva poco a poco; Options del mando recentra.
- **La imagen.** Cada ojo se dibuja en su textura, con su cámara a media distancia interpupilar (64 mm) a cada lado. Luego un pase aplica la distorsión de barril de las lentes (k1 = 0,22, k2 = 0,24) y su aberración cromática, con las medidas de PSVRFramework.
- **Mandos.** El DualShock 4, o cualquier mando, anda con el stick izquierdo, gira a saltos con el derecho, salta con ✕ y levanta el reloj con △. Los brazos y los dedos siguen a la cámara del ordenador si los gestos están encendidos.
- **Salir.** Esc te saca de las gafas y te deja a pie.
- **Probado** con unas PS VR simuladas: un WebHID falso que recibe los comandos y emite informes del sensor girando la cabeza. Falta probarlo con unas reales: el protocolo no es público y sale de la ingeniería inversa de la comunidad.

## Suelo real a pie: LOLA de 5 m (E3, #181)

A pie, el nivel más fino del relieve era el de 19,5 m: a la altura de una persona el suelo salía liso. Ahora se añade un nivel más, solo con datos medidos:

- **Fuente:** los DEM LOLA de 5 m/px de los sitios del polo sur (producto 78 de PGDA/GSFC, Barker et al. 2021, doi 10.1016/j.pss.2020.105119). Son los mismos datos del láser LOLA que el resto del relieve, ajustados por el equipo de LOLA para estos sitios.
- **Qué añade:** `pipeline/ground.mjs` lee del GeoTIFF solo la ventana alrededor del sitio (por peticiones de rango HTTP, sin descargar los 41 MB). Escribe `terrain-lod3.bin`: 2,5 km alrededor del sitio, 513 × 513 nodos, uno cada 4,88 m (cuatro por celda del nivel de 19,5 m, así que encaja exacto). Es un nivel más de `meta.detail`, y el visor lo cose al anterior igual que los otros, sin cambios en `scene.js`.
- **Dónde hay datos:** la cresta de conexión (Site01) cubre `shackleton-rim` y `ridge-slope`, y el macizo de Malapert (Site23) cubre `malapert`. Ningún DEM de 5 m cubre De Gerlache (`gerlache`, ya que Site11 está en el borde, no en el sitio), el objetivo de IM-2 (`im2-objetivo`) ni Mons Mouton (`mouton`, que solo tiene relieve de 160 m). Esas regiones se quedan como estaban: o hay datos reales o no se añade nada.
- **Honestidad del dato:** el propio producto dice que solo un 9,5–11 % de sus celdas de 5 m tiene un disparo del láser; el resto está interpolado, con un error típico de 0,32 a 0,40 m. La nota de «Fuentes» lo enseña con esas cifras y cita el producto.
- **Coherencia:** frente al nivel de 19,5 m, en sus nodos, la media de la diferencia es de −0,01 a −0,14 m y el RMS de 0,31 a 0,37 m. Es el mismo suelo visto más fino, no otro (hay un test para ello).
- **Peso:** unos 240 KB por región; cada región descarga solo el suyo.

**Por qué no hay textura de foto ni de albedo.** No hay datos reales que la den a escala humana para el relieve dinámico:

- Las imágenes LROC NAC (1 m/px) llevan horneadas las sombras de cuando se tomaron, que con el Sol rasante del polo son casi todo. Pegarlas sobre el relieve iluminado en tiempo real daría sombras dobles y falsas.
- El albedo LOLA a 1064 nm solo existe en rejillas de cientos de metros a kilómetros.

Con la regla de «solo datos reales», lo que da la forma del suelo de cerca es el relieve de 5 m con su sombreado por la luz real del Sol. A la geometría no se le ha añadido ningún detalle inventado; el grano del sombreado es ilustrativo y va aparte (siguiente apartado).


## Textura fina del suelo (E3, #181, y #393)

El detalle fino del suelo es el del **aspecto de regolito** (#393, `viewpoint/src/terrain-material.js`; ver «Escena 3D», arriba). Lo usan también la cabina del juego y el cielo en 3D de Planificar (`web/js/common/sky3d.js`), que le pasa con `cell` el paso de su malla en cada píxel: sus anillos se espacian con la distancia. Sustituye a la textura que se portó del artifact del Mirador en #181, que solo se veía a pie y quedaba borrosa. Se probaron también la foto LROC, el albedo LOLA y la fotometría lunar-Lambert, y se retiraron a petición: sigue sin haber fotos ni mapas de albedo.

- **Qué es:** grano, cráteres pequeños y piedras que solo cambian el sombreado (brillo y perturbación de la normal).
- **Dónde actúa:** solo por debajo de la resolución del relieve de cada nivel (el suelo de 5 m, el de 19,5 m, la zona y el anillo lejano) y por encima del tamaño de un píxel en pantalla.
- **Qué no es: es ilustrativa.** No son rocas ni cráteres reales, no mueve la geometría y no entra en sombras, máscaras ni veredicto. Lo dicen el botón y «Fuentes».
- **Cuándo:** siempre desde el dron y en el visor de misión (antes de #393 no la tenían). A pie está encendida por defecto y el botón «Textura fina» la apaga para ver solo los datos.
- **Sol rasante:** con el Sol a menos de un grado, un bulto inclinado se convierte en una mancha blanca y negra. Por eso la inclinación del detalle baja donde el Sol roza el suelo y solo es completa en las laderas que lo miran.
