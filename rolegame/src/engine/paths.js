// Routes (J1.1): slope between cells, cost of a step and cheapest path (Dijkstra, 8 neighbours).
// Pure: reads heights from the tables, never mutates anything.

const NEIGHBOURS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

// Degrees between two neighbouring cells (indices into the tables).
export function slope(tables, a, b) {
  const n = tables.n;
  const dist = a % n !== b % n && Math.floor(a / n) !== Math.floor(b / n) ? Math.SQRT2 : 1;
  const rise = Math.abs(tables.height(b) - tables.height(a));
  return (Math.atan(rise / (tables.cellM * dist)) * 180) / Math.PI;
}

// Hours of driving one step, or null when the slope exceeds level.maxSlope.
export function stepCost(tables, level, a, b) {
  const n = tables.n;
  const dist = a % n !== b % n && Math.floor(a / n) !== Math.floor(b / n) ? Math.SQRT2 : 1;
  const rise = Math.abs(tables.height(b) - tables.height(a));
  const deg = (Math.atan(rise / (tables.cellM * dist)) * 180) / Math.PI;
  if (deg > level.maxSlope) return null;
  return dist * (1 + deg / level.slopeCost);
}

// Binary min-heap of [priority, cell] pairs.
class Heap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    const a = this.items;
    let i = a.push(item) - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// Cheapest list of cells {x, y} from the rover to target (both included), or null if unreachable.
export function pathTo(state, target) {
  const { tables, level } = state;
  const n = tables.n;
  if (!Number.isInteger(target.x) || !Number.isInteger(target.y)) {
    throw new RangeError('target must have integer coordinates');
  }
  if (target.x < 0 || target.y < 0 || target.x >= n || target.y >= n) {
    throw new RangeError('target outside the grid');
  }
  const start = state.y * n + state.x;
  const goal = target.y * n + target.x;
  const best = new Float64Array(n * n).fill(Infinity);
  const prev = new Int32Array(n * n).fill(-1);
  const heap = new Heap();
  best[start] = 0;
  heap.push([0, start]);
  while (heap.size > 0) {
    const [d, c] = heap.pop();
    if (d > best[c]) continue;
    if (c === goal) break;
    const cx = c % n;
    const cy = (c - cx) / n;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const next = y * n + x;
      const cost = stepCost(tables, level, c, next);
      if (cost === null) continue;
      if (d + cost < best[next]) {
        best[next] = d + cost;
        prev[next] = c;
        heap.push([best[next], next]);
      }
    }
  }
  if (best[goal] === Infinity) return null;
  const path = [];
  for (let c = goal; c !== -1; c = prev[c]) path.push({ x: c % n, y: (c - (c % n)) / n });
  return path.reverse();
}
