// Table reader: sun.bin (Uint8, hours x n x n) + cells.bin (Float32, n x n heights) + earth.bin (bits,
// hours x n x n, lsb first) + scenario.json -> sunFrac(cell, hour), height(cell) and seesEarth(cell, hour).
// Without cells.bin the terrain is flat; without earth.bin the Earth is never in sight.
// Pure: the caller loads the files (browser or Node) and passes the ArrayBuffer.

export function createTables(sunBuffer, scenario, cellsBuffer, earthBuffer) {
  const n = scenario.grid?.n ?? scenario.n;
  const hours = scenario.hours ?? scenario.grid?.hours;
  if (!Number.isInteger(n) || !Number.isInteger(hours)) {
    throw new Error('scenario.json lacks grid.n or hours');
  }
  const sun = new Uint8Array(sunBuffer);
  if (sun.length !== hours * n * n) {
    throw new Error(`sun.bin has ${sun.length} bytes, expected ${hours * n * n}`);
  }
  const cells = n * n;
  const cellM = scenario.grid?.cellM ?? scenario.cellM;
  if (!Number.isFinite(cellM) || cellM <= 0) {
    throw new Error('scenario.json lacks grid.cellM (a number greater than 0)');
  }
  let heights;
  if (cellsBuffer === undefined) {
    heights = new Float32Array(cells);
  } else {
    heights = new Float32Array(cellsBuffer);
    if (heights.length !== cells) {
      throw new Error(`cells.bin has ${heights.length} heights, expected ${cells}`);
    }
  }
  const height = (cell) => heights[cell];

  let earth = null;
  if (earthBuffer !== undefined) {
    earth = new Uint8Array(earthBuffer);
    const expected = Math.ceil((hours * cells) / 8);
    if (earth.length !== expected) {
      throw new Error(`earth.bin has ${earth.length} bytes, expected ${expected}`);
    }
  }
  // Whether the Earth is in sight from a cell at a game hour (J3.1). Not interpolated: each hour is what its row says.
  function seesEarth(cell, hour) {
    if (!earth) return false;
    const h = Math.min(Math.max(Math.floor(hour), 0), hours - 1);
    const bit = h * cells + cell;
    return (earth[bit >> 3] & (1 << (bit & 7))) !== 0;
  }

  // Sun fraction 0..1 of a cell at a game hour, linearly interpolated between hours.
  function sunFrac(cell, hour) {
    const h = Math.min(Math.max(hour, 0), hours - 1);
    const h0 = Math.floor(h);
    const h1 = Math.min(h0 + 1, hours - 1);
    const t = h - h0;
    const a = sun[h0 * cells + cell] / 255;
    const b = sun[h1 * cells + cell] / 255;
    return a + (b - a) * t;
  }

  return { n, hours, cellM, height, sunFrac, seesEarth };
}
