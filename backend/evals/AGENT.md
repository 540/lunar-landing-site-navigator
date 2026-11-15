# Explorador de evals: instrucciones comunes (Claude y opencode)

Eres un **explorador** en una competición: buscas la posición lunar con **mayor puntuación** en un benchmark fijo.
**No decides quién gana**: lo decide después un juez automático (`evals/competition.ts`). El juez comprueba las reglas
en la base de datos y reevalúa tus mejores puntos con **robustez espacial**: un punto al borde de un "acantilado"
pierde aunque su puntuación nominal sea alta.

## Cómo se trabaja
- Directorio de trabajo: `backend/`. Lee `evals/README.md` si necesitas detalle.
- Ejecutar una evaluación:
  ```sh
  node evals/run.ts <escenario.json> --label <PREFIJO><algo> [--set clave=valor ...] --quiet
  ```
  Cada ejecución se guarda en `evals/evals.db` (SQLite).
- Ver tus resultados:
  ```sh
  sqlite3 -header -column evals/evals.db "select id,label,best_lat,best_lon,best_score,best_feasible,total_evaluated from runs where label like '<PREFIJO>%' order by best_score desc"
  ```
- Ver los candidatos de una ejecución: tabla `candidates`, con `run_id`, `lat`, `lon`, `score`, `feasible`, `worst_date` y las métricas. Las métricas por fecha están en `candidate_dates`.
- **Modo puntos:** copia el escenario en tu carpeta de trabajo, borra `region` y `search`, añade `"points": [{"lat":…, "lon":…, "name":"…"}]` y deja intacto todo lo demás.

## Reglas (el juez las comprueba; si las incumples, la ejecución no cuenta)
1. Solo puedes cambiar **dónde** se busca: `region.*`, `search.*` o `points`. **No** cambies `dates`, `missionDays`, `stepMinutes`, `mode`, `earthMode`, `earthMinElevationDeg`, `aggregate`, `weights`, `constraints` ni `robustness`.
2. Todas tus etiquetas empiezan por tu **PREFIJO**.
3. Respeta el presupuesto: como mucho **MAX_RUNS** ejecuciones y **MAX_CANDIDATES** candidatos por ejecución (`total_evaluated`). Si una malla sale demasiado grande, reduce la región o aumenta `search.spacingKm`.
4. **No modifiques ningún fichero del repositorio** (código, escenarios, tests). Los ficheros auxiliares van **solo** en tu CARPETA DE TRABAJO. No hagas commits.
5. No inventes resultados: todo lo que informes debe salir de la base de datos.

## Consejos aprendidos
- La puntuación es escalonada (las métricas van a pasos de 1 h) y tiene mesetas: diferencias de centésimas pueden ser ruido.
- Evita los bordes donde la Tierra deja de verse: el juez penaliza los puntos cuyos vecinos a 1 km empeoran mucho.
- Mira qué limita a los mejores (`worst_date`, métricas por fecha) antes de buscar a ciegas.

## Informe final
Termina con un bloque JSON (el juez no lo necesita, pero ayuda a comparar):
```json
{"mejor": {"lat": 0, "lon": 0, "score": 0, "label": "…"}, "ejecuciones": 0, "aprendizaje": "una o dos frases"}
```
