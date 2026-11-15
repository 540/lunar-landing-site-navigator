# Contrato con el backend · lo que necesita el planificador

Basado en el resumen de la **API pública v1** que compartió el equipo de backend (OpenAPI 3.1, `localhost:3100`). Todavía no tenemos el `openapi.yaml`, así que los nombres de campo de este documento son orientativos: REVISAR contra el fichero.

## Qué tiene la v1

| Ruta | Qué da |
|---|---|
| `GET /v1/health` | Estado |
| `GET /v1/sites` | Catálogo (Apolo, CLPS, Chandrayaan-3, Chang'e, borde de Shackleton…), con `coordinatesVerified` |
| `GET /v1/sun-earth?site\|lat&lon&date&mode=limb\|center\|full` | Sol y Tierra en un instante: azimut, elevación, si se ven y próximo orto u ocaso |
| `GET /v1/windows?site\|lat&lon&start&end&mode` | Ventanas de Sol, de Tierra y de ambos (máximo 366 días) |
| `GET /v1/rank?sites=all\|ids&start&days` | Ranking de sitios (energía 70 % + comunicación 30 %) |

Limitaciones que ellos mismos señalan: **sin relieve LOLA** (horizonte de una Luna lisa, así que en el polo sale optimista) y coordenadas aproximadas en parte del catálogo.

## Qué nos cubre

| Necesidad | Estado | Cómo |
|---|---|---|
| Catálogo y puntos propios | ✅ | `/sites`; las rutas aceptan `lat&lon` |
| Reloj lunar (anillos) | ✅ | `/windows` |
| Hasta la puesta de Sol y de Tierra | ✅ | `/sun-earth` → `nextSet` |
| Métricas de la misión (% de Sol, mayor sombra, % de Tierra, mayor corte) | 🟡 | Calculables en el front recortando `/windows`; mejor si las da el backend |
| **Mejor opción con nuestros requisitos y una ventana de fechas** | 🟡 | `/rank` usa una fecha fija y pesos fijos, sin requisitos |
| Margen ante retrasos / barrido | ❌ | — |
| Cielo de 360° (trayectorias) | ❌ | Falta una serie de azimut y elevación |
| Relieve (horizonte real) | ❌ | Pendiente de LOLA |

## Lo que pedimos, por prioridad

1. **`/v1/rank` con requisitos de misión y ventana.**
   - Entra: `windowStart`, `windowEnd`, `sites`, `duration` (h), `maxDarkHours` (lo que aguanta la batería), `minEarthPct`, `maxEarthGapHours` (opcional), `priority` o pesos (`energy`, `comms`, `early`, `robust`), `limit`.
   - Sale, por opción: `site`, `landing` (la mejor fecha dentro de la ventana), `verdict` (`viable|marginal|not_viable`), `reasons[]`, `score`, `metrics` (`sunPct`, `maxDarkHours`, `earthPct`, `maxEarthGapHours`, `hoursToSunset`, `hoursToEarthset`, `maxSunElevationDeg`) y `robustness` (`maxDelayDays`, `nextWindow`).
2. **Robustez ante retrasos:** `robustness` dentro de `/rank`, o una ruta `/v1/delay-sweep` con veredictos por sitio y día de retraso.
3. **`/v1/track?site&start&end&step`:** azimut y elevación del Sol y de la Tierra por paso, para el cielo de 360°.
4. **`/v1/horizon?site`** (con LOLA): máscara de horizonte, 360 valores de elevación por azimut. ¿Fecha estimada?

**Dudas abiertas:**

- ¿Qué `mode` usamos para el Sol? Proponemos `center` por defecto y `full` como opción conservadora.
- ¿Cuándo habrá una URL pública?
- ¿Cuánto tarda una búsqueda en `/rank`? Si son segundos, la interfaz mostrará un estado de «calculando».

## La simulación en el front

`js/busqueda.js` implementa el punto 1 con datos inventados: prueba un aterrizaje cada 12 h dentro de la ventana, aplica la regla de viabilidad, puntúa según la prioridad y calcula la robustez. Devuelve `{ mejor, opciones[] }` con `sitio`, `aterrizaje`, `ver`, `motivos`, `puntuacion` y `robustez { retrasoMaxDias, proximaVentana }`. Cuando exista la ruta real, se cambia esa función por la llamada.
