# Precisión del motor de cálculo frente a JPL Horizons

Generado con `npm run accuracy -- --write`; no se edita a mano. Regenerarlo en el mismo commit que cambie el
cálculo: el diff de este fichero dice si el cambio mejora o empeora la precisión.

Referencia: JPL Horizons (DE441, marco MEAN_ME, esfera de 1737,4 km, sin refracción), 2026–2030.
Presupuesto: 0,0060° de máximo y 0,0025° de media cuadrática.

## Dirección

Separación angular entre la posición calculada y la de Horizons. El máximo cuenta también el error de
elevación por separado.

| Sitio de referencia | Cuerpo | Puntos | Máximo (°) | Percentil 99 (°) | Media cuadrática (°) |
|---|---|---:|---:|---:|---:|
| equator | Sol | 2003 | 0,0047 | 0,0042 | 0,0022 |
| equator | Tierra | 2003 | 0,0042 | 0,0037 | 0,0018 |
| equator-12km | Sol | 2003 | 0,0047 | 0,0042 | 0,0022 |
| equator-12km | Tierra | 2003 | 0,0042 | 0,0037 | 0,0018 |
| east-limb | Sol | 2003 | 0,0047 | 0,0042 | 0,0022 |
| east-limb | Tierra | 2003 | 0,0042 | 0,0037 | 0,0018 |
| far-side | Sol | 2003 | 0,0047 | 0,0042 | 0,0022 |
| far-side | Tierra | 2003 | 0,0042 | 0,0037 | 0,0018 |
| south-pole | Sol | 2003 | 0,0047 | 0,0042 | 0,0022 |
| south-pole | Tierra | 2003 | 0,0042 | 0,0037 | 0,0018 |

## Ortos y ocasos

Instante de cada orto y ocaso frente al de Horizons, juntando los tres modos (`limb`, `center` y `full`).
El error en tiempo es el error de dirección dividido por la velocidad con que el astro cruza el horizonte:
por eso crece hacia los polos. El «equivalente» es ese error en tiempo multiplicado por la velocidad de
elevación, y es lo que se compara con el presupuesto. Sin fila: el astro no sale ni se pone en ese sitio.

| Sitio | Cuerpo | Eventos | Faltan | Sobran | Error mediano | Percentil 99 | Máximo | Equivalente máx. (°) | Horas visibles: cálculo − Horizons |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| apollo11 | Sol | 372 | 0 | 0 | 9 s | 30 s | 30 s | 0,0043 | 0,03 h |
| apollo12 | Sol | 369 | 0 | 0 | 7 s | 27 s | 28 s | 0,0040 | -0,03 h |
| apollo14 | Sol | 369 | 0 | 0 | 7 s | 27 s | 28 s | 0,0040 | -0,03 h |
| apollo15 | Sol | 369 | 0 | 0 | 11 s | 34 s | 37 s | 0,0047 | 0,01 h |
| apollo16 | Sol | 372 | 0 | 0 | 8 s | 27 s | 29 s | 0,0040 | 0,01 h |
| apollo17 | Sol | 372 | 0 | 0 | 10 s | 32 s | 33 s | 0,0044 | 0,04 h |
| im1 | Sol | 369 | 0 | 0 | 34 s | 1,7 min | 1,8 min | 0,0026 | -0,14 h |
| im2-objetivo | Sol | 372 | 0 | 0 | 56 s | 2,5 min | 2,6 min | 0,0020 | -0,34 h |
| im2-objetivo | Tierra | 402 | 0 | 0 | 46 s | 4,3 min | 4,5 min | 0,0037 | -1,97 h |
| im2-alunizaje | Sol | 372 | 0 | 0 | 56 s | 2,5 min | 2,6 min | 0,0020 | -0,34 h |
| im2-alunizaje | Tierra | 402 | 0 | 0 | 46 s | 4,2 min | 4,5 min | 0,0037 | -1,96 h |
| blueghost1 | Sol | 372 | 0 | 0 | 10 s | 28 s | 28 s | 0,0038 | 0,07 h |
| chandrayaan3 | Sol | 372 | 0 | 0 | 14 s | 42 s | 46 s | 0,0023 | -0,02 h |
| slim | Sol | 372 | 0 | 0 | 8 s | 28 s | 28 s | 0,0039 | 0,02 h |
| change4 | Sol | 369 | 0 | 0 | 16 s | 41 s | 45 s | 0,0045 | -0,01 h |
| change6 | Sol | 372 | 0 | 0 | 13 s | 36 s | 40 s | 0,0042 | -0,04 h |
| shackleton-rim | Sol | 91 | 0 | 0 | 11,1 min | 69,5 min | 69,5 min | 0,0021 | -2,69 h |
| shackleton-rim | Tierra | 402 | 0 | 0 | 51 s | 3,8 min | 4,1 min | 0,0039 | -1,93 h |

Todo dentro del presupuesto.
