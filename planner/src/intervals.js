// Operaciones con intervalos de tiempo [inicioMs, finMs). Todas esperan y devuelven listas ordenadas y sin solapes.

/** Recorta los intervalos a [from, to). */
export function clip(intervals, from, to) {
  const out = [];
  for (const [a, b] of intervals) {
    const s = Math.max(a, from), e = Math.min(b, to);
    if (e > s) out.push([s, e]);
  }
  return out;
}

/** Tramos en los que se cumplen los dos conjuntos a la vez. */
export function intersect(x, y) {
  const out = [];
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    const s = Math.max(x[i][0], y[j][0]), e = Math.min(x[i][1], y[j][1]);
    if (e > s) out.push([s, e]);
    if (x[i][1] < y[j][1]) i++; else j++;
  }
  return out;
}

/** Huecos que dejan los intervalos dentro de [from, to). */
export function gaps(intervals, from, to) {
  const out = [];
  let cursor = from;
  for (const [a, b] of clip(intervals, from, to)) {
    if (a > cursor) out.push([cursor, a]);
    cursor = b;
  }
  if (cursor < to) out.push([cursor, to]);
  return out;
}

export const totalMs = (intervals) => intervals.reduce((sum, [a, b]) => sum + (b - a), 0);

/** El intervalo más largo, o null si no hay ninguno. */
export function longest(intervals) {
  let best = null;
  for (const iv of intervals) if (!best || iv[1] - iv[0] > best[1] - best[0]) best = iv;
  return best;
}

/** El intervalo que contiene el instante t (inicio incluido, fin excluido), o null. */
export const containing = (intervals, t) => intervals.find(([a, b]) => a <= t && t < b) ?? null;

/** El primer intervalo que empieza después de t, o null. */
export const nextAfter = (intervals, t) => intervals.find(([a]) => a > t) ?? null;
