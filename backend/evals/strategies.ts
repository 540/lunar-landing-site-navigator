// Exploration strategies for the evals competition (the ones that worked in previous rounds).
export const STRATEGIES: Readonly<Record<string, string>> = {
  grid: `MALLA FINA AMPLIA. Barre la región completa con mallas cada vez más finas (search.spacingKm 20 → 12 → 8) y
mucho refinamiento (search.keepTop 10–20, search.maxIterations 8). Después, sub-regiones alrededor de lo mejor y mallas
"desplazadas" (mueve ligeramente latMin/latMax/lonMin/lonMax) para caer en otros escalones.`,
  sectors: `SECTORES DE LONGITUD. Divide la región en sectores de 30° de longitud (region.lonMin/lonMax), optimiza cada uno
con malla fina y compara. Afina después en sectores de 5–10° alrededor de los mejores. Explica de qué depende la longitud óptima.`,
  hillclimb: `ESCALADA LOCAL CON VARIOS ARRANQUES (modo points). Desde 4–6 arranques distintos, evalúa en cada paso el centro y
8 vecinos (N, NE, E, SE, S, SO, O, NO) a una distancia d: empieza en 20 km y reduce a la mitad hasta ~0,5 km
(1° de latitud ≈ 30,32 km; en longitud divide por cos(lat)). Lanza todas las cadenas en la misma ejecución.`,
  latitudes: `FUERA DE LO OBVIO. Exploración gruesa por bandas de 30° de latitud dentro de la cara visible (lon −90..90),
incluido el hemisferio norte. Refina en las 2–3 mejores bandas y explica dónde está el óptimo global y por qué.`,
  data: `GUIADO POR DATOS. Antes de buscar, analiza en la base (candidates, candidate_dates, worst_date) qué fecha y qué
métrica limitan a los mejores candidatos de las ejecuciones existentes del benchmark. Diseña búsquedas dirigidas
(regiones estrechas o listas de puntos) donde esa limitación se arregle, y repite el análisis con tus ejecuciones.`,
  robust: `ROBUSTEZ PRIMERO. El juez reevalúa con robustez espacial (peor valor en 1 km). Busca mesetas amplias, no picos:
para cada buen candidato, evalúa en modo points sus vecinos a 0,5 y 1 km y quédate con los que no caen.`,
};
