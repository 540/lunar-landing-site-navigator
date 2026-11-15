# Prototipo · Planificador de misión

Prototipo navegable del Lunar Landing Site Navigator para el perfil **planificador de misión**. **Todos los datos son simulados**: sirve para enseñar el flujo y acordar qué datos necesita la interfaz, no para tomar decisiones.

## Arrancar

```bash
node prototipo/servir.mjs
```

- Producto: <http://localhost:4541>
- Modo explicación: <http://localhost:4541/?debug=1>, o el botón «Modo explicación» de la barra. Cada elemento lleva un «?» morado con qué es, qué te dice, de dónde sale hoy, de dónde saldrá en el producto, cómo se calcula, quién lo construye y sus valores en ese momento.

No necesita instalar nada: es HTML y JavaScript sin dependencias (solo carga las fuentes de Google Fonts).

## Qué hace

| Vista | Para qué |
|---|---|
| Planificar | A la izquierda, las características de la misión (nave, requisitos y ventana de aterrizaje) y **Ver**; a la derecha, el mejor sitio y fecha, con su reloj lunar y su cielo |
| Avanzado | El top 3 de sitios lado a lado, con el panel lateral para ajustar la misión y el mapa del polo sur |
| Replanificar | «¿Qué ha cambiado?»: el plan con los cambios, la salida A (mismo sitio, siguiente ventana), la salida B (otro sitio, misma fecha), la prueba de desvío y el barrido de retraso |
| Fuentes de datos | De dónde saldrá cada dato real, quién lo trae y en qué estado está |

La búsqueda de la mejor opción está en `js/busqueda.js` y es **simulada**: imita lo que hemos pedido al backend en [CONTRATO-BACKEND.md](CONTRATO-BACKEND.md).

En el panel lateral: perfil de misión con sus umbrales, fecha, retraso, mapa del polo sur con capa de luz o de Tierra en tiempo real, y lista de sitios. Si pulsas en un punto vacío del mapa, se crea un sitio propio con su horizonte calculado al momento.

## Qué es falso

| Pieza | En el prototipo | En el producto |
|---|---|---|
| Posición del Sol y de la Tierra | Modelo medio: ciclo de 29,5 días, inclinación de ±1,54° y libración aproximada (`js/modelo.js → subpuntos`) | JPL Horizons o SPICE |
| Relieve | Cráteres y montes con nombre real y posición aproximada, pero formas y alturas inventadas (`js/modelo.js → altura`) | DEM de LOLA (PGDA, producto 78) |
| Coordenadas de los sitios | Aproximadas (`js/datos.js`) | Copiadas de Quickmap |
| Umbrales de los perfiles | Ejemplos, salvo los 6–7 días de Sol de Artemis III | Los pone cada misión |

## Contrato con el motor de datos

La interfaz solo usa tres funciones de `js/modelo.js`. Si el motor de datos devuelve lo mismo con datos reales, la interfaz no cambia.

| Función | Devuelve | Sustituto real |
|---|---|---|
| `calcularHorizonte(sitio)` | `{ mascara: Float32Array(360), alturaKm }`: grados que tapa el relieve en cada azimut, de 0 a 359 (0 = norte, 90 = este), con la curvatura ya restada | Horizonte calculado con el DEM de LOLA |
| `efemerides(sitio, ms)` | `{ sol: { az, el }, tierra: { az, el } }` en grados, sin relieve | Horizons/SPICE (observador en la Luna, cuerpo 301) |
| `visibleEnPunto(x, y, cuerpo, subpunto)` | Margen en grados sobre el relieve; > 0 = visible. Solo para la capa del mapa | El mismo cálculo con LOLA, o un mapa precalculado |

Propuesta de formato precalculado por sitio (JSON):

```json
{
  "sitio": { "id": "cresta", "nombre": "Cresta de conexión de Shackleton", "lat": -89.45, "lon": -137.3 },
  "horizonte": { "paso_az_grados": 1, "elevacion_grados": [/* 360 valores */] },
  "serie": {
    "inicio": "2027-04-04T12:00:00Z", "paso_min": 60,
    "sol":    { "az": [/* … */], "el": [/* … */] },
    "tierra": { "az": [/* … */], "el": [/* … */] }
  }
}
```

## Ficheros

| Fichero | Contenido |
|---|---|
| `index.html`, `estilos.css` | Estructura y estilo |
| `js/app.js` | Interfaz: mapa, tarjetas, barrido, fuentes y modo explicación |
| `js/modelo.js` | Modelo falso (efemérides, relieve, horizonte, métricas y veredicto) |
| `js/datos.js` | Sitios, perfiles de misión y fuentes |
| `js/explicaciones.js` | Textos del modo explicación y glosario |
| `servir.mjs` | Servidor estático en el puerto 4541 |
