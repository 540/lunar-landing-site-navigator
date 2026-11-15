# Banco de medición del render

Mide el render 3D de la portada (`home/`) en Chrome sin interfaz: tiempo de cada frame, memoria de GPU y capturas comparables, con los valores de calidad que se le den. Sirve para decidir los niveles de calidad de la épica G1 (#138) con cifras reproducibles y para medir cada nivel (`alto`, `medio` y `bajo`, de [`shared/render/quality.js`](../../shared/README.md)). Historias: #139, #142, #143, #144 y #166.

Sin dependencias de npm: maneja Chrome por el protocolo de DevTools con el `WebSocket` y el `fetch` de Node. Necesita Chrome o Chromium y conexión (la portada carga three.js de un CDN). **No entra en `npm test`**: el CI no tiene GPU. Lo que se puede probar sin Chrome (argumentos, estadística, la métrica de diferencia y el resultado) está en `lib.mjs` y se prueba en [`tests/render-bench.test.mjs`](../../tests/render-bench.test.mjs).

```sh
npm run bench:render -- --zone simulador --secs 2
npm run bench:render -- --q bajo --zone explore --shot bajo.png
npm run bench:render -- --pr 1.5 --shadow 3072 --cap 320 --shot medio.png --label medio
npm run bench:diff -- alto.png medio.png calor.png
```

| Fichero | Qué hace |
|---|---|
| `bench.mjs` | Una medición. Imprime **una línea JSON** en stdout |
| `diff.mjs` | Compara dos capturas PNG |
| `cdp.mjs` | Lanza Chrome sin interfaz y lo maneja por DevTools |
| `lib.mjs` | Lo puro: argumentos, percentiles, métrica de diferencia, resultado y banderas de Chrome |

## Cómo mide

1. Arranca un servidor estático propio de la raíz del repo en un puerto libre (o usa `--url`).
2. Lanza Chrome, emula el tamaño y la densidad de pantalla (`Emulation.setDeviceMetricsOverride`) y, salvo `--motion`, `prefers-reduced-motion: reduce`, que quita el balanceo del menú y acorta las animaciones de cámara.
3. Abre `/home/?<nivel y calidad>&bench` y espera a que la portada esté lista y con la textura de color definitiva.
4. Si `--zone` es una misión, llama a `window.__go(zona)` y espera a que la cámara llegue (`mode()==='zone'` y sin animación). Con `--zone explore`, espera a que pare la cámara del menú, llama a `__bench.explore()` (abre «Explorar la Luna», #135, como el cohete morado; se reintenta hasta que los sitios están cargados) y espera a `mode()==='explore'` sin animación.
5. Deja pasar medio segundo y mide `--secs` segundos. Durante la medición, `__bench.sync` está activo: tras cada render se lee 1 px con `gl.readPixels` para esperar a la GPU, así `renderMs` es el tiempo real de GPU y no solo el de enviar órdenes (`--nosync` lo apaga).
6. Recoge los datos de la página, la memoria de GPU de `nvidia-smi` (antes de lanzar Chrome y al acabar) y, con `--shot`, la captura.

## Opciones de `bench.mjs`

Todas opcionales. Valen `--opción valor` y `--opción=valor`.

| Opción | Por defecto | Qué hace |
|---|---|---|
| `--q` | ninguno | Nivel de calidad: `alto`, `medio` o `bajo` (`?q=…`). Sin él, la portada mide el equipo y lo elige (calibración, #143): empieza en `bajo` si es modesto, como con `--gpu sw`, y en `medio` si no |
| `--pr --shadow --cap --tex --aniso --fs --rs` | ninguno (los del nivel) | Sustituyen valores sueltos del nivel; se pasan tal cual a la URL de la portada (ver [`home/README.md`](../../home/README.md), «Calidad del render»). Sin ellos no se envían |
| `--w`, `--h`, `--dpr` | `1920`, `1080`, `1` | Tamaño CSS y densidad emulados |
| `--gpu` | `hw` | `hw`, `sw` o `default` (ver «Chrome») |
| `--cpu` | `1` | Freno de CPU (`Emulation.setCPUThrottlingRate`); solo frena el JS, no la GPU |
| `--zone` | `menu` | `menu`, `simulador`, `tour`, `rol` o `explore` («Explorar la Luna») |
| `--secs` | `4` | Segundos de medición |
| `--motion` | ausente | Sin ella se emula `prefers-reduced-motion: reduce` |
| `--nosync` | ausente | No espera a la GPU tras cada render |
| `--fresh` | ausente | Borra el nivel guardado (`llsn.quality`) antes de cargar la portada, para que calibre. Cada medición usa ya un perfil de Chrome temporal y limpio, así que hoy no cambia el resultado: deja explícito que se mide con calibración |
| `--lose` | ausente | Tras medir, fuerza la pérdida del contexto WebGL (`__bench.loseContext()`), espera 500 ms y añade `lostNotice` a la salida. Esa pérdida no invalida la medición (#144) |
| `--shot <fichero.png>` | ninguno | Guarda la captura de `__bench.shot()` (solo el canvas WebGL, a tamaño de buffer) |
| `--label <texto>` | `""` | Se copia a la salida |
| `--url <base>` | servidor propio | Base del sitio, por ejemplo `http://localhost:4540` |

Una opción desconocida o un valor no válido sale con código 2 y el motivo en stderr. Los números tienen que ser mayores que 0 (`--rs` solo admite `0` o `1`), y `--shadow`, `--cap`, `--fs`, `--w` y `--h`, enteros: así `q` y `dev` son siempre lo que de verdad se mide.

## Salida

Una línea JSON con estos campos:

| Campo | Qué es |
|---|---|
| `label` | El de `--label` |
| `q` | Valores de calidad pedidos uno a uno (`null`: no se pidió, vale el del nivel) |
| `dev` | `w`, `h`, `dpr`, `gpu`, `cpu` |
| `zone` | Zona medida |
| `level` | Nivel de calidad en uso, de `__bench.quality` (`alto`, `medio` o `bajo`) |
| `levelSource` | De dónde sale el nivel: `url` (`--q`), `stored` (guardado en una visita anterior del mismo perfil) o `auto` (lo eligió la portada midiendo el equipo) |
| `calibration` | Mediciones de la calibración, `[{ level, p50, p95 }]` en ms (una o dos; vacía con `--q`) |
| `tooSlow` | `true` si ni en `bajo` aguanta el render continuo (mediana de más de 33 ms) |
| `renderMode` | Modo de render de la portada (#144): `continuous` o `onDemand` (imagen fija que solo se repinta tras actividad; con render por software, `tooSlow` o `prefers-reduced-motion`, que el banco emula salvo `--motion`). Durante la medición, con `__bench.sync`, la portada pinta todos los frames también en `onDemand`; con `--nosync`, en `onDemand` deja de pintar en reposo |
| `governor` | Gobernador del pixel ratio de la portada (#166), de `__bench.quality.governor`: `{ ratio, frozen, changes }`. `ratio`: escalón en uso (el pixel ratio aplicado es el menor entre este y el del nivel); `frozen`: `true` si una bajada no mejoró el tiempo de frame y ya no cambia más; `changes`: lista de `{ at, from, to }` (ms desde la carga, pixel ratio de antes y de después). `null` si la Luna aún no está en pantalla. **El banco mide sin vsync** (`--disable-gpu-vsync --disable-frame-rate-limit`): los frames salen muy por debajo de 16 ms y todas las ventanas son holgadas, así que en el banco `changes` sale vacío y el gobernador nunca baja; sus umbrales se prueban en `tests/quality.test.mjs` y en equipos reales (#146) |
| `readyMs` | Desde que empieza a cargar la página hasta que la Luna está en pantalla (ms; con calibración, la incluye) |
| `textureMs` | Hasta que está la textura de color definitiva (la de 4k, o la de 2k con `--tex 2k` o en `bajo`, que no pide la de 4k) |
| `frames` | Frames medidos |
| `renderMs` | `{p50, p95, max}` de lo que tarda cada `renderer.render` |
| `frameMs` | `{p50, p95, max}` del intervalo entre frames |
| `megapixels` | Píxeles del buffer, en millones (1920×1080 a densidad 1: 2,07) |
| `buffer` | `[ancho, alto]` del buffer de dibujo |
| `info` | `triangles`, `calls`, `textures`, `geometries` de `renderer.info` |
| `heapMB` | Memoria JS usada por la página (`Runtime.getHeapUsage`) |
| `gpuRenderer` | Nombre de la GPU que da WebGL |
| `maxTex` | `maxTextureSize` |
| `gpuMemDeltaMiB` | Memoria de GPU que añade el navegador entero (de `nvidia-smi`; `null` si no hay) |
| `contextLost` | `true` si se perdió el contexto WebGL |
| `lostNotice` | Con `--lose`, `true` si la portada muestra el aviso de 3D no disponible (`#glost`) tras perder el contexto; sin `--lose`, `null` |
| `shot` | Ruta de la captura, o `null` |
| `error` | `null` si la medición es válida. Si no: contexto WebGL perdido, tiempo agotado o la textura de color pedida (con `--tex` o por el nivel) que no cargó (si falla la de 4k, la portada sigue con la de 2k; si falla la de 2k, con una procedural) |

Los percentiles son de rango más cercano.

**Medición no válida:** si la página registró algún `webglcontextlost` o el contexto está perdido al final, la salida lleva `"contextLost": true` y `"error": "WebGL context lost"`, y el proceso sale con código 1. Un tiempo de espera agotado (la portada no carga en 90 s, la cámara no llega a la zona…) o cualquier otro fallo rellena `error` y también sale con 1. Sin Chrome, sale con código 2.

## Chrome

- Ejecutable: la variable `CHROME`; si no, el primero que exista de `google-chrome-stable`, `google-chrome`, `chromium` y `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- Siempre: `--headless=new --disable-gpu-vsync --disable-frame-rate-limit --disable-background-timer-throttling --disable-renderer-backgrounding --mute-audio`, con un `--user-data-dir` temporal que se borra al acabar.
- `--gpu hw`: `--enable-gpu --ignore-gpu-blocklist --use-angle=gl-egl`. En Linux con NVIDIA, ANGLE sobre Vulkan pierde el contexto sin interfaz; por eso OpenGL/EGL.
- `--gpu sw`: `--use-angle=swiftshader --enable-unsafe-swiftshader` (render por software).
- `--gpu default`: sin banderas de GPU (para macOS).

## Una medición cada vez

Las mediciones comparten la GPU, así que `bench.mjs` crea el directorio `tools/render-bench/.lock` con `mkdir` (atómico en Linux y macOS) antes de lanzar Chrome. Si ya existe, avisa en stderr y espera reintentando; lo borra al salir, también ante `SIGINT`, `SIGTERM` y `SIGHUP`. Si lo dejó un proceso que ya no existe (matado con `-9`), lo quita solo. `.lock` está en `.gitignore`.

## Comparar capturas: `diff.mjs`

```sh
npm run bench:diff -- a.png b.png [calor.png]
```

Imprime `{ size, scaled, meanAbs, pctOver8, pctOver24 }`:

- `size`: `[ancho, alto]` de `a`. Si `b` mide otra cosa, se reescala al tamaño de `a` y `scaled` es `true`.
- `meanAbs`: diferencia absoluta media por canal RGB (0–255; el alfa no cuenta).
- `pctOver8` y `pctOver24`: % de píxeles cuya mayor diferencia de canal supera 8 y 24.
- Con el tercer argumento escribe un mapa de calor PNG: negro donde son iguales, rojo cuanto más difieren y amarillo a partir de 96.

Decodifica los PNG en el propio Chrome sin interfaz (canvas 2D, perfil de color sRGB) para no añadir dependencias; la métrica es `diffStats` de `lib.mjs`, que corre dentro de la página.

**Ruido de referencia:** dos pasadas idénticas a 1920×1080 en la zona `simulador` dieron `meanAbs` ≈ 0,19 y `pctOver8` ≈ 0,18 % con el banco con el que se midió la épica. **Por debajo de `meanAbs` 0,3 y `pctOver8` 0,3 %, dos capturas se consideran iguales.** Con este banco, que fija la semilla de las estrellas y no lanza el tutorial, dos pasadas con `--gpu hw` en una RTX 3060 salieron idénticas (`meanAbs` 0).

## Límites

- Mide el navegador sin interfaz: sin composición de ventanas ni vsync. Los tiempos sirven para comparar niveles entre sí en el mismo equipo, no como tiempo absoluto de un usuario.
- Sin vsync, el gobernador del pixel ratio (#166) ve todas las ventanas holgadas: el banco no lo hace bajar (`governor.changes` vacío).
- `gpuMemDeltaMiB` es del navegador entero y solo con NVIDIA.
- `--cpu` frena el JS, no la GPU: no emula un equipo lento.
- Solo mide `home/` (ni `viewpoint/` ni el cielo 3D de `web/`).
