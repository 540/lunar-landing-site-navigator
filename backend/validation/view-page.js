// Human view of the validation matrix (view.ts inlines this file into validation-view.html). Plain browser script, no
// dependencies: reads the JSON of #validation-data and draws the summary, the filters and every row, whose charts
// (inline SVG) are drawn the first time the row is opened.
(() => {
  'use strict';
  const DATA = JSON.parse(document.getElementById('validation-data').textContent);
  const STATUSES = ['✅', '⚠️', '❌', 'ℹ️', '⏭️'];
  const STATUS_NAME = { '✅': 'Dentro', '⚠️': 'Conocido', '❌': 'Fuera', 'ℹ️': 'Informativa', '⏭️': 'No ejecutada' };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const TOP = 10;
  const ALL_MAX = 2000;

  // ------------------------------------------------------------ helpers

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
    return e;
  };
  const sv = (tag, attrs = {}, ...kids) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
    for (const k of kids.flat()) if (k !== null && k !== undefined) e.append(k);
    return e;
  };
  /** Number as VALIDATION.md writes it: decimal comma, true minus sign, tiny values in exponent notation. */
  const fmt = (x, digits) => {
    if (x === null || x === undefined || Number.isNaN(x)) return '—';
    const s = Math.abs(x) < 1e-3 && x !== 0 && digits >= 4 ? x.toExponential(1) : x.toFixed(digits);
    return s.replace('.', ',').replace(/^-/, '−');
  };
  const signed = (x, digits) => (x > 0 ? '+' : '') + fmt(x, digits);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const point = (p) => ({ id: p[0], lat: p[1], lon: p[2], ours: p[3], ref: p[4], d: p[5], tol: p[6], ok: p[7], x: p[8], y: p[9] });
  const coord = (p) => (p.lat === null ? '—' : `${fmt(p.lat, 4)}°, ${fmt(p.lon, 4)}°`);

  /** Nice ticks of [a, b]. */
  function ticks(a, b, n = 5) {
    if (a === b) { a -= 1; b += 1; }
    const raw = (b - a) / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { values: out, digits: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
  }
  const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  const tip = (p, row) => {
    const u = row.unit, dg = Math.max(row.digits, 2);
    return [p.id, p.lat !== null ? `lat/lon: ${coord(p)}` : null,
      p.ours !== null ? `nuestro: ${fmt(p.ours, dg)} ${u}` : null, p.ref !== null ? `referencia: ${fmt(p.ref, dg)} ${u}` : null,
      p.d !== null ? `d: ${row.signed ? signed(p.d, dg) : fmt(p.d, dg)} ${u} (tolerancia ${fmt(p.tol, dg)})` : null,
      p.ok ? 'dentro de tolerancia' : (p.d === null ? 'comprobación fallida' : 'fuera de tolerancia')].filter(Boolean).join('\n');
  };

  // ------------------------------------------------------------ tooltip

  const tipBox = el('div', { id: 'tip', role: 'tooltip' });
  const showTip = (target, x, y) => {
    tipBox.textContent = target.getAttribute('data-tip');
    tipBox.classList.add('on');
    const w = tipBox.offsetWidth, h = tipBox.offsetHeight;
    tipBox.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x + 12))}px`;
    tipBox.style.top = `${y + h + 16 > window.innerHeight ? y - h - 10 : y + 14}px`;
  };
  document.addEventListener('pointermove', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) showTip(t, e.clientX, e.clientY); else tipBox.classList.remove('on'); });
  document.addEventListener('focusin', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) { const r = t.getBoundingClientRect(); showTip(t, r.right, r.top); } });
  document.addEventListener('focusout', () => tipBox.classList.remove('on'));

  // ------------------------------------------------------------ charts

  const W = 360, H = 280, M = { l: 54, r: 12, t: 10, b: 42 };

  function axes(svg, x, y, xt, yt, xLabel, yLabel) {
    for (const v of xt.values) {
      svg.append(sv('line', { class: 'grid', x1: x(v), x2: x(v), y1: M.t, y2: H - M.b }));
      svg.append(sv('text', { x: x(v), y: H - M.b + 14, 'text-anchor': 'middle' }, fmt(v, xt.digits)));
    }
    for (const v of yt.values) {
      svg.append(sv('line', { class: 'grid', x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }));
      svg.append(sv('text', { x: M.l - 6, y: y(v) + 3.5, 'text-anchor': 'end' }, fmt(v, yt.digits)));
    }
    svg.append(sv('line', { class: 'axis', x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b }));
    svg.append(sv('line', { class: 'axis', x1: M.l, x2: M.l, y1: M.t, y2: H - M.b }));
    svg.append(sv('text', { class: 'title', x: (M.l + W - M.r) / 2, y: H - 6, 'text-anchor': 'middle' }, xLabel));
    svg.append(sv('text', { class: 'title', transform: `translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)`, 'text-anchor': 'middle' }, yLabel));
  }
  const svgRoot = (label, w = W, h = H) => sv('svg', { class: 'chart', viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label });
  const marker = (cx, cy, ok, fill, tipText, cls = 'pt') => (ok
    ? sv('circle', { class: cls, cx, cy, r: 4, fill, 'data-tip': tipText, tabindex: 0 })
    : sv('rect', { class: cls, x: cx - 4, y: cy - 4, width: 8, height: 8, fill, transform: `rotate(45 ${cx} ${cy})`, 'data-tip': tipText, tabindex: 0 }));
  const legend = (...items) => el('div', { class: 'legend' }, items);
  const sw = (color, dia = false) => el('span', { class: `sw${dia ? ' dia' : ''}`, style: `background:${color}` });

  /** Ours against the reference, the 1:1 diagonal and the tolerance band. */
  function scatter(row, pts) {
    const all = pts.flatMap((p) => [p.ours, p.ref]);
    let lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.06; lo -= pad; hi += pad;
    const x = scale(lo, hi, M.l, W - M.r), y = scale(lo, hi, H - M.b, M.t);
    const svg = svgRoot(`Dispersión: nuestro valor frente a la referencia, ${pts.length} puntos`);
    const id = `clip${Math.random().toString(36).slice(2)}`;
    svg.append(sv('defs', {}, sv('clipPath', { id }, sv('rect', { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b }))));
    const t = ticks(lo, hi);
    axes(svg, x, y, t, t, `Referencia (${row.unit})`, `Nuestro valor (${row.unit})`);
    const tols = pts.map((p) => p.tol), constant = tols.every((v) => v === tols[0]);
    let band;
    if (constant) {
      const k = tols[0];
      band = [[lo, lo - k], [hi, hi - k], [hi, hi + k], [lo, lo + k]];
    } else {
      const s = [...pts].sort((a, b) => a.ref - b.ref);
      band = [...s.map((p) => [p.ref, p.ref - p.tol]), ...s.reverse().map((p) => [p.ref, p.ref + p.tol])];
    }
    svg.append(sv('polygon', { class: 'band', 'clip-path': `url(#${id})`, points: band.map(([a, b]) => `${x(a)},${y(b)}`).join(' ') }));
    svg.append(sv('line', { class: 'diag', 'clip-path': `url(#${id})`, x1: x(lo), y1: y(lo), x2: x(hi), y2: y(hi) }));
    const inC = css('--accent'), outC = css('--critical');
    for (const p of [...pts].sort((a, b) => b.ok - a.ok)) svg.append(marker(x(p.ref), y(p.ours), p.ok, p.ok ? inC : outC, tip(p, row)));
    return el('figure', {}, el('figcaption', {}, 'Nuestro valor frente a la referencia ', el('span', { class: 'sub' }, '(diagonal 1:1, banda de tolerancia)')), svg,
      legend(el('span', {}, sw(inC), 'dentro de tolerancia'), el('span', {}, sw(outC, true), 'fuera de tolerancia'),
        el('span', {}, el('span', { class: 'sw', style: `background:${css('--band')};border-radius:2px` }), constant ? `±${fmt(tols[0], Math.max(row.digits, 2))} ${row.unit}` : 'tolerancia por punto')));
  }

  /** Histogram of the per-point errors, with the tolerance marked when it is the same for every point. */
  function histogram(row, pts) {
    const ds = pts.map((p) => p.d);
    const anyOut = pts.some((p) => !p.ok);
    const tols = pts.map((p) => p.tol), tol = tols.every((v) => v === tols[0]) ? tols[0] : null;
    let lo = Math.min(...ds, row.signed ? 0 : 0), hi = Math.max(...ds, 0);
    if (tol !== null && tol <= Math.max(Math.abs(lo), Math.abs(hi)) * 4) { hi = Math.max(hi, tol); if (row.signed) lo = Math.min(lo, -tol); }
    if (lo === hi) { lo -= 1; hi += 1; }
    const nb = Math.max(6, Math.min(40, Math.ceil(Math.sqrt(ds.length) * 1.5)));
    const step = (hi - lo) / nb, counts = new Array(nb).fill(0), outs = new Array(nb).fill(0);
    pts.forEach((p) => { const i = Math.min(nb - 1, Math.floor((p.d - lo) / step)); counts[i]++; if (!p.ok) outs[i]++; });
    const cmax = Math.max(...counts, 4), x = scale(lo, hi, M.l, W - M.r), y = scale(0, cmax, H - M.b, M.t);
    const svg = svgRoot(`Histograma de los errores por punto, ${ds.length} puntos`);
    const yt = ticks(0, cmax, 4);
    axes(svg, x, y, ticks(lo, hi), { values: yt.values.filter(Number.isInteger), digits: 0 }, row.signed ? `d = nuestro − referencia (${row.unit})` : `|error| (${row.unit})`, 'puntos');
    const inC = css('--bar'), outC = css('--bar-out'), dg = Math.max(row.digits, 2);
    counts.forEach((c, i) => {
      if (!c) return;
      const a = lo + i * step, b = a + step;
      // A bar per bin: the points within their tolerance below, the ones outside on top.
      const bar = (from, n, fill) => n && svg.append(sv('rect', { class: 'bar', x: x(a) + 0.5, y: y(from + n), width: Math.max(1, x(b) - x(a) - 1), height: y(from) - y(from + n), rx: 1.5, fill,
        'data-tip': `${fmt(a, dg)} a ${fmt(b, dg)} ${row.unit}\n${c} punto${c === 1 ? '' : 's'}, ${outs[i]} fuera de tolerancia` }));
      bar(0, c - outs[i], inC);
      bar(c - outs[i], outs[i], outC);
    });
    if (tol !== null) for (const t of row.signed ? [-tol, tol] : [tol]) if (t >= lo && t <= hi) svg.append(sv('line', { class: 'tolline', x1: x(t), x2: x(t), y1: M.t, y2: H - M.b }));
    if (row.signed && lo < 0 && hi > 0) svg.append(sv('line', { class: 'axis', x1: x(0), x2: x(0), y1: M.t, y2: H - M.b }));
    return el('figure', {}, el('figcaption', {}, 'Errores por punto ', el('span', { class: 'sub' }, `(${ds.length} puntos)`)), svg,
      legend(el('span', {}, sw(inC), 'dentro'), anyOut ? el('span', {}, sw(outC), 'fuera') : null,
        tol !== null ? el('span', {}, `discontinua: tolerancia ±${fmt(tol, dg)} ${row.unit}`) : el('span', {}, 'la tolerancia cambia por punto')));
  }

  /** Diverging colour of d in [−L, L] (blue: ours below the reference; red: above; grey: equal). */
  function colorScale(lim, isSigned) {
    const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const neg = hex(css('--neg')), mid = hex(css('--mid')), pos = hex(css('--pos'));
    const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
    const f = (d) => {
      const t = Math.max(-1, Math.min(1, d / lim));
      if (!isSigned) return mix(mid, pos, Math.abs(t));
      return t < 0 ? mix(mid, neg, -t) : mix(mid, pos, t);
    };
    f.ramp = isSigned ? `linear-gradient(90deg, ${css('--neg')}, ${css('--mid')}, ${css('--pos')})` : `linear-gradient(90deg, ${css('--mid')}, ${css('--pos')})`;
    return f;
  }

  /** South-polar stereographic map (the projection of the DEM, 0° up, 90°E right) of the polar points, coloured by error. */
  function polarMap(row, pts) {
    const S = 320;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 2) / 2 * 1.15 + 1;
    const X = scale(cx - half, cx + half, 0, S), Y = scale(cy - half, cy + half, S, 0), k = S / (2 * half);
    const svg = svgRoot(`Mapa polar sur de ${pts.length} puntos coloreados por el error`, S, S);
    const id = `clip${Math.random().toString(36).slice(2)}`;
    svg.append(sv('defs', {}, sv('clipPath', { id }, sv('rect', { x: 0, y: 0, width: S, height: S }))));
    const g = sv('g', { 'clip-path': `url(#${id})` });
    svg.append(sv('rect', { x: 0, y: 0, width: S, height: S, fill: 'none', class: 'axis' }));
    svg.append(g);
    const far = Math.hypot(Math.abs(cx) + half, Math.abs(cy) + half);
    const near = Math.max(0, Math.hypot(Math.max(0, Math.abs(cx) - half), Math.max(0, Math.abs(cy) - half)));
    const placed = [];
    const label = (lx, ly, text, anchor = 'start') => {
      if (placed.some(([px, py]) => Math.hypot(px - lx, py - ly) < 26)) return;
      placed.push([lx, ly]);
      g.append(sv('text', { x: lx, y: ly, 'text-anchor': anchor }, text));
    };
    for (const c of [...DATA.graticule].sort((a, b) => a.rKm - b.rKm)) {
      if (c.rKm < near || c.rKm > far) continue;
      g.append(sv('circle', { class: 'grid', cx: X(0), cy: Y(0), r: c.rKm * k, fill: 'none' }));
      // Label at the point of the circle nearest the centre of the view, if it is inside.
      const ang = Math.hypot(cx, cy) > 1e-9 ? Math.atan2(cy, cx) : -Math.PI / 2;
      const lx = c.rKm * Math.cos(ang), ly = c.rKm * Math.sin(ang);
      if (Math.abs(lx - cx) < half * 0.9 && Math.abs(ly - cy) < half * 0.9) label(X(lx) + 3, Y(ly) - 3, `${fmt(-c.lat, c.lat % 1 ? 1 : 0)}°S`);
    }
    for (let lon = 0; lon < 360; lon += 30) {
      const a = (lon * Math.PI) / 180, dx = Math.sin(a), dy = Math.cos(a);
      g.append(sv('line', { class: 'grid', x1: X(0), y1: Y(0), x2: X(dx * far), y2: Y(dy * far) }));
      // Label at the point where the meridian leaves the view (slab method).
      let t0 = 0, t1 = far;
      for (const [d, c0] of [[dx, cx], [dy, cy]]) {
        if (Math.abs(d) < 1e-12) { if (Math.abs(c0) > half) t1 = -1; continue; }
        const ta = (c0 - half) / d, tb = (c0 + half) / d;
        t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
      }
      if (t1 > t0 && t1 > 0) {
        const t = t1 - half * 0.03;
        const name = lon === 0 ? '0°' : lon === 180 ? '180°' : lon < 180 ? `${lon}°E` : `${360 - lon}°W`;
        const ex = X(dx * t), ey = Y(dy * t), side = ex < 30 ? 'start' : ex > S - 30 ? 'end' : 'middle';
        label(ex, Math.max(11, Math.min(S - 4, ey + 3.5)), name, side);
      }
    }
    if (Math.abs(cx) < half && Math.abs(cy) < half) g.append(sv('circle', { cx: X(0), cy: Y(0), r: 2, fill: css('--ink-2'), 'data-tip': 'polo sur' }));
    let color, legendItem;
    const dg = Math.max(row.digits, 2);
    if (row.check) {
      color = (p) => (p.ok ? css('--good') : css('--critical'));
      legendItem = [el('span', {}, sw(css('--good')), 'correcto'), el('span', {}, sw(css('--critical'), true), 'falla')];
    } else {
      const abs = pts.map((p) => Math.abs(p.d)).sort((a, b) => a - b);
      const q95 = abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))];
      const lim = Math.max(q95, Math.min(...pts.map((p) => p.tol))) || 1;
      const f = colorScale(lim, row.signed);
      color = (p) => f(p.d);
      legendItem = [el('span', {}, row.signed ? `−${fmt(lim, dg)}` : '0', el('span', { class: 'ramp', style: `background:${f.ramp}` }), `${row.signed ? '+' : ''}${fmt(lim, dg)} ${row.unit}`),
        el('span', {}, row.signed ? 'azul: nuestro valor menor; rojo: mayor' : 'más rojo, más error'), el('span', {}, sw(css('--ink-2'), true), 'rombo: fuera de tolerancia')];
    }
    // The worst on top.
    const order = [...pts].sort((a, b) => (b.ok - a.ok) || (Math.abs(a.d ?? 0) - Math.abs(b.d ?? 0)));
    for (const p of order) g.append(marker(X(p.x), Y(p.y), p.ok, color(p), tip(p, row), 'pt ring'));
    return el('figure', {}, el('figcaption', {}, 'Mapa polar sur ', el('span', { class: 'sub' }, '(estereográfico, 0° arriba)')), svg, legend(...legendItem));
  }

  /** Points table: the worst first (outside the tolerance, then by |d|). */
  function pointsTable(row, pts, limit) {
    const hasCoord = pts.some((p) => p.lat !== null), hasOurs = pts.some((p) => p.ours !== null), hasRef = pts.some((p) => p.ref !== null), hasD = !row.check;
    const dg = Math.max(row.digits, 2);
    const sorted = [...pts].sort((a, b) => (a.ok - b.ok) || (Math.abs(b.d ?? 0) - Math.abs(a.d ?? 0)));
    const shown = sorted.slice(0, limit);
    const head = el('tr', {}, el('th', {}, 'Punto'), hasCoord ? el('th', {}, 'Lat, lon') : null, hasOurs ? el('th', { class: 'num' }, `Nuestro (${row.unit})`) : null,
      hasRef ? el('th', { class: 'num' }, `Referencia (${row.unit})`) : null, hasD ? el('th', { class: 'num' }, row.signed ? 'd' : '|error|') : null,
      hasD ? el('th', { class: 'num' }, 'Tolerancia') : null, el('th', {}, row.check ? 'Resultado' : 'Dentro'));
    const body = shown.map((p) => el('tr', {}, el('td', {}, p.id), hasCoord ? el('td', { class: 'num' }, coord(p)) : null,
      hasOurs ? el('td', { class: 'num' }, fmt(p.ours, dg)) : null, hasRef ? el('td', { class: 'num' }, fmt(p.ref, dg)) : null,
      hasD ? el('td', { class: 'num' }, row.signed ? signed(p.d, dg) : fmt(p.d, dg)) : null, hasD ? el('td', { class: 'num' }, fmt(p.tol, dg)) : null,
      el('td', { class: p.ok ? 'ok-yes' : 'ok-no' }, p.ok ? '✓ sí' : '✗ no')));
    return el('div', { class: 'scroll' }, el('table', {}, el('thead', {}, head), el('tbody', {}, body)));
  }

  function rowBody(row) {
    const pts = row.points.map(point);
    const facts = el('dl', { class: 'facts' },
      el('dt', {}, 'Referencia oficial'), el('dd', { html: row.sourceHtml }),
      el('dt', {}, 'Tolerancia por punto'), el('dd', {}, row.tolText),
      row.limits ? [el('dt', {}, row.known ? 'Tope (valor actual)' : 'Límites de la fila'), el('dd', {}, row.limits)] : null,
      row.known ? [el('dt', {}, 'Problema conocido'), el('dd', {}, `#${row.known}`)] : null,
      row.informative ? [el('dt', {}, 'Tipo'), el('dd', {}, 'informativa: sin aprobado ni suspenso')] : null,
      row.note ? [el('dt', {}, row.status === '❌' ? 'Fuera de límites' : 'Nota'), el('dd', { class: row.status === '❌' ? 'note-bad' : null }, row.note)] : null);
    const out = [facts];
    if (row.status === '⏭️') return out;
    const s = row.stats;
    out.push(el('div', { class: 'scroll stats' }, el('table', {},
      el('thead', {}, el('tr', {}, ['n', 'Sesgo', 'MAE', 'RMS', '% ref', 'Máx', '% dentro'].map((h) => el('th', { class: 'num' }, h)))),
      el('tbody', {}, el('tr', {}, [s.n, s.bias, s.mae, s.rms, s.pctRef, s.max, s.within].map((v) => el('td', { class: 'num' }, v)))))));
    const charts = [];
    const numeric = pts.filter((p) => p.d !== null);
    const paired = numeric.filter((p) => p.ours !== null && p.ref !== null);
    if (!row.check && paired.length >= 2 && row.signed) charts.push(scatter(row, paired));
    if (!row.check && numeric.length >= 3) charts.push(histogram(row, numeric));
    const polar = pts.filter((p) => p.x !== null);
    if (polar.length >= 2) charts.push(polarMap(row, polar));
    if (charts.length) out.push(el('div', { class: 'charts' }, charts));
    const few = pts.length <= TOP;
    out.push(el('h3', { style: 'font-size:0.9rem;margin:12px 0 4px' }, few ? 'Puntos' : `Los ${TOP} peores puntos de ${pts.length}`));
    const holder = el('div', {}, pointsTable(row, pts, TOP));
    out.push(holder);
    if (!few) {
      const n = Math.min(ALL_MAX, pts.length);
      const btn = el('button', { class: 'btn more', type: 'button', onclick: () => { holder.replaceChildren(pointsTable(row, pts, ALL_MAX)); btn.remove(); } },
        pts.length > ALL_MAX ? `Mostrar los ${n} peores` : `Mostrar los ${pts.length} puntos`);
      out.push(btn);
    }
    return out;
  }

  // ------------------------------------------------------------ page

  const state = { statuses: new Set(STATUSES), section: '', text: '' };
  const rowsEls = [];
  const sections = [...new Set(DATA.rows.map((r) => r.section))];
  const count = (rows, st) => rows.filter((r) => r.status === st).length;
  const m = DATA.meta;

  const themeBtn = el('button', { class: 'btn', type: 'button', onclick: () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? null : 'dark';
    if (next) document.documentElement.setAttribute('data-theme', next); else document.documentElement.removeAttribute('data-theme');
    try { if (next) localStorage.setItem('validation-theme', next); else localStorage.removeItem('validation-theme'); } catch { /* private mode */ }
    themeBtn.textContent = themeLabel();
    redrawOpen();
  } });
  const themeLabel = () => ({ dark: 'Tema: oscuro', light: 'Tema: claro' }[document.documentElement.getAttribute('data-theme')] ?? 'Tema: sistema');
  try { const t = localStorage.getItem('validation-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch { /* private mode */ }
  themeBtn.textContent = themeLabel();

  const header = el('header', { class: 'top' },
    el('div', {}, el('h1', {}, 'Matriz de validación frente a fuentes oficiales'),
      el('p', { class: 'meta' },
        el('span', {}, 'DEM LOLA: ', el('code', {}, m.demVersion ?? 'ninguno')),
        el('span', {}, `medida el ${new Date(m.generatedAt).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })}`),
        el('span', {}, 'commit ', el('code', {}, m.commit ?? 'desconocido')),
        m.seconds !== null ? el('span', {}, `${m.seconds} s con ${m.workers} hilos`) : null)),
    themeBtn);

  const tiles = el('div', { class: 'tiles' }, STATUSES.map((st) => el('div', { class: 'tile' }, el('div', { class: 'k' }, `${st} ${STATUS_NAME[st]}`), el('div', { class: 'v' }, String(count(DATA.rows, st))))));

  const sectionSelect = el('select', { 'aria-label': 'Endpoint', onchange: (e) => { state.section = e.target.value; apply(); } },
    el('option', { value: '' }, 'Todos los endpoints'), sections.map((s) => el('option', { value: s }, s)));
  const endpoints = el('div', { class: 'scroll' }, el('table', { class: 'endpoints' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Endpoint · métrica'), STATUSES.map((st) => el('th', { class: 'num', title: STATUS_NAME[st] }, st)))),
    el('tbody', {}, sections.map((sec) => {
      const rs = DATA.rows.filter((r) => r.section === sec);
      return el('tr', {}, el('td', {}, el('button', { type: 'button', onclick: () => { sectionSelect.value = sec; state.section = sec; apply(); document.getElementById('rows').scrollIntoView({ behavior: 'smooth' }); } }, sec)),
        STATUSES.map((st) => { const c = count(rs, st); return el('td', { class: `num${c ? '' : ' zero'}` }, c ? String(c) : '·'); }));
    }))));

  const chips = STATUSES.map((st) => el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', title: STATUS_NAME[st],
    onclick: (e) => { const on = state.statuses.has(st); if (on) state.statuses.delete(st); else state.statuses.add(st); e.currentTarget.setAttribute('aria-pressed', String(!on)); apply(); } },
  `${st} ${count(DATA.rows, st)}`));
  const search = el('input', { type: 'search', placeholder: 'Buscar en las filas', 'aria-label': 'Buscar', oninput: (e) => { state.text = e.target.value.toLowerCase(); apply(); } });
  const openAll = (open) => { for (const r of rowsEls) if (!r.el.hidden) r.el.open = open; };
  const filters = el('div', { class: 'filters', role: 'group', 'aria-label': 'Filtros' }, chips, sectionSelect, search,
    el('button', { class: 'btn', type: 'button', onclick: () => openAll(true) }, 'Desplegar'), el('button', { class: 'btn', type: 'button', onclick: () => openAll(false) }, 'Plegar'));

  const list = el('main', { id: 'rows' });
  const empty = el('p', { class: 'empty', hidden: true }, 'Ninguna fila con estos filtros.');
  const heads = new Map();
  for (const sec of sections) {
    const h = el('h2', {}, sec);
    heads.set(sec, h);
    list.append(h);
    for (const row of DATA.rows.filter((r) => r.section === sec)) {
      const s = row.stats;
      const quick = row.status === '⏭️' ? el('span', {}, 'no ejecutada')
        : el('span', {}, 'n ', el('b', {}, s.n), row.check ? null : [' · RMS ', el('b', {}, s.rms), ' · máx ', el('b', {}, s.max), ` ${row.unit}`], ' · dentro ', el('b', {}, s.within));
      const body = el('div', { class: 'body' });
      const d = el('details', { class: 'row' }, el('summary', {}, el('span', { class: 'st', title: STATUS_NAME[row.status] }, row.status), el('span', { class: 'what', html: `${row.whatHtml} (${row.unit})` }), el('span', { class: 'quick' }, quick)), body);
      const entry = { el: d, row, body, drawn: false };
      d.addEventListener('toggle', () => { if (d.open && !entry.drawn) { body.replaceChildren(...rowBody(row)); entry.drawn = true; } });
      rowsEls.push(entry);
      list.append(d);
    }
  }
  function redrawOpen() { for (const r of rowsEls) { r.drawn = false; if (r.el.open) { r.body.replaceChildren(...rowBody(r.row)); r.drawn = true; } } }
  function apply() {
    let shown = 0;
    const visible = new Set();
    for (const r of rowsEls) {
      const ok = state.statuses.has(r.row.status) && (!state.section || r.row.section === state.section)
        && (!state.text || `${r.row.what} ${r.row.section} ${r.row.sourceHtml} ${r.row.note}`.toLowerCase().includes(state.text));
      r.el.hidden = !ok;
      if (ok) { shown++; visible.add(r.row.section); }
    }
    for (const [sec, h] of heads) h.hidden = !visible.has(sec);
    empty.hidden = shown > 0;
  }

  document.getElementById('app').append(el('div', { class: 'wrap' }, header, tiles, el('h2', {}, 'Por endpoint'), endpoints, filters, list, empty,
    el('footer', {}, 'Generado con ', el('code', {}, 'npm run validate:view'), '. La matriz para la CI y los LLM es ', el('code', {}, 'VALIDATION.md'),
      '; esta página usa los mismos números y añade cada punto. d = nuestro valor − referencia.')), tipBox);
  // A failing row opens by itself.
  for (const r of rowsEls) if (r.row.status === '❌') r.el.open = true;
})();
