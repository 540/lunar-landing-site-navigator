# Varados en el polo · prototipo de referencia

Copia congelada del artifact «Varados en el polo» (versión `1794600849-21ae`), el prototipo del juego educativo. **Solo es referencia: no se edita ni se publica.** El juego de verdad se construye siguiendo el [desglose](../desglose-juego-rol.md).

- Original: https://claude.ai/artifact/GeMFf9P3QqpwZN1w6mqumr
- Un único HTML con three.js r128 desde CDN y la textura `moon.jpg` (copiada aquí, 136 KB). **Datos simulados**: relieve procedural y efemérides de juguete (`sunAt`, `earthAt`).
- Para verlo, sírvelo por HTTP (la textura no carga con `file://`); sin ella, la Luna 3D usa una textura de ruido.

## Qué portar (líneas de `index.html`)

| Qué | Línea | Destino según el desglose |
|---|---|---|
| `Core` (constantes `N`, `CELL`, `AZB`, `START`, `PAD`, `HILL`) | 192-195 | Escenario (`scenario.json`) |
| `makeWorld`: relieve de la rejilla y máscaras de 72 azimuts | 197-221 | Pipeline: `cells.bin`, `masks.bin` (J0.2) |
| `maskAt`, `sunFrac`, `earthVis` | 222-226 | Pipeline: `sun.bin`, `earth.bin` (J0.2) |
| `LEVELS` | 227-230 | `levels.json` |
| `newGame`, `pass`, `check`, `move`, `wait`, `transmit` | 231-257 | Motor de reglas puro (J0.3, J2, J3) |
| `stepCost`, `pathTo` (Dijkstra sin heap) | 243-250 | Cliente, con heap (J1.1) |
| `Terrain.build`, `blur`, `shadow`, `light` | 259-302 | Pipeline y shader (J4.1, J4.2) |
| `Moon3D` | 303-354 | Vista órbita del Mirador (J8) |
| `TXT`, `INTRO`, `LOGT` | 373-406 | Diccionario de textos es/en (J5, J10.1) |
| `drawRing` | 447-457 | Referencia visual del anillo del horizonte (J3.4) |
| `showGoal`, `GICON`, `padPulse` | 479-497 | Modal de misión y pulso (J1.4, J6.2) |
| `hint`, `renderPlay`, `act` | 524-556 | Interfaz de la misión (J1, J2.4) |
| `endGame`, `renderEnd` | 562-574 | Final y lecciones (J7) |

Lo que **no** se porta: `sunAt` y `earthAt` (líneas 223-224) son efemérides falsas; se sustituyen por la serie del escenario.
