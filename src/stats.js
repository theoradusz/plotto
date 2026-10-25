// Statistics of the stat layers: summary, stack and dodge, bins, density and smooth.
// Input and output are columns: { x: [...], y: [...], color: [...], ... }. Times are epoch ms numbers.
import * as d3 from "d3";

const GRID = 80; // points of a smooth or density curve

// Rows grouped by the values of the given columns, in first-seen order: [{ key: [...], idx: [...] }].
export function groupRows(cols, names, n) {
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const key = names.map((k) => cols[k]?.[i] ?? null);
    const id = JSON.stringify(key);
    if (!groups.has(id)) groups.set(id, { key, idx: [] });
    groups.get(id).idx.push(i);
  }
  return [...groups.values()];
}

// One row per (x, color, group): y is the summary of the group values.
export function summarize(cols, n, fn) {
  const reduce = { mean: d3.mean, median: d3.median, min: d3.min, max: d3.max, sum: d3.sum }[fn];
  const out = { x: [], y: [], color: [], group: [] };
  for (const { key, idx } of groupRows(cols, ["x", "color", "group"], n)) {
    if (key[0] === null) continue;
    out.x.push(key[0]);
    out.y.push(reduce(idx, (i) => cols.y[i]));
    out.color.push(key[1]);
    out.group.push(key[2]);
  }
  return out;
}

// Stacks y within each x, in the order of the color levels: positive values up, negative values down.
// overlay: no stack (ymin = 0). dodge: each color gets a slot k of nk at the same x.
export function position(cols, n, mode, colorLevels) {
  const order = (i) => (cols.color ? colorLevels.indexOf(cols.color[i]) : 0);
  const present = cols.color ? colorLevels.filter((v) => cols.color.includes(v)) : [null];
  const out = { ...cols, ymin: new Array(n), ymax: new Array(n), value: cols.y.slice(), slot: new Array(n), slots: new Array(n) };
  // Dodge stacks within (x, color), so that each color has its own column of bars.
  for (const { idx } of groupRows(cols, mode === "dodge" ? ["x", "color"] : ["x"], n)) {
    idx.sort((a, b) => order(a) - order(b));
    let up = 0;
    let down = 0;
    idx.forEach((i, k) => {
      const v = cols.y[i] ?? 0;
      if (mode !== "overlay") {
        const base = v >= 0 ? up : down;
        [out.ymin[i], out.ymax[i]] = [base, base + v];
        if (v >= 0) up += v;
        else down += v;
      } else [out.ymin[i], out.ymax[i]] = [0, v];
      out.slot[i] = mode === "dodge" && cols.color ? present.indexOf(cols.color[i]) : 0;
      out.slots[i] = mode === "dodge" ? present.length : 1;
    });
  }
  out.y = out.ymax;
  return out;
}

// x intervals for bars on a continuous x: 90% of the data resolution, split into the dodge slots.
export function barIntervals(cols, n) {
  const xs = [...new Set(cols.x.filter((v) => v !== null))].sort((a, b) => a - b);
  const step = d3.min(d3.pairs(xs), ([a, b]) => b - a) ?? 1;
  const w = step * 0.9;
  const xmin = [];
  const xmax = [];
  for (let i = 0; i < n; i++) {
    const slice = w / cols.slots[i];
    xmin.push(cols.x[i] - w / 2 + cols.slot[i] * slice);
    xmax.push(cols.x[i] - w / 2 + (cols.slot[i] + 1) * slice);
  }
  return { ...cols, xmin, xmax };
}

// Shared bin edges for all panels and colors: about `bins` bins on nice values.
export function binEdges(values, bins) {
  const finite = values.filter((v) => v !== null && Number.isFinite(v));
  const [lo, hi] = d3.extent(finite);
  if (lo === undefined) return [0, 1];
  if (lo === hi) return [lo - 0.5, hi + 0.5];
  const edges = d3.ticks(...d3.nice(lo, hi, bins), bins);
  if (edges[0] > lo) edges.unshift(edges[0] - (edges[1] - edges[0]));
  if (edges.at(-1) < hi) edges.push(edges.at(-1) + (edges[1] - edges[0]));
  return edges;
}

// Counts (or densities) per bin and color: one row per (bin, color), with x = the bin center.
export function bin(cols, n, edges, density) {
  const out = { x: [], xmin: [], xmax: [], y: [], color: [] };
  const binner = d3.bin().domain([edges[0], edges.at(-1)]).thresholds(edges.slice(1, -1));
  for (const { key, idx } of groupRows(cols, ["color"], n)) {
    const values = idx.map((i) => cols.x[i]).filter((v) => v !== null && Number.isFinite(v));
    for (const b of binner(values)) {
      const count = b.length;
      out.x.push((b.x0 + b.x1) / 2);
      out.xmin.push(b.x0);
      out.xmax.push(b.x1);
      out.y.push(density ? count / (values.length * (b.x1 - b.x0) || 1) : count);
      out.color.push(key[0]);
    }
  }
  return out;
}

// Tukey box of one group: quartiles, whiskers at the last values within 1.5 IQR of the box, and the outliers.
export function boxStats(values) {
  const v = values.filter((y) => y !== null && Number.isFinite(y)).sort(d3.ascending);
  const [q1, median, q3] = [0.25, 0.5, 0.75].map((p) => d3.quantile(v, p));
  const iqr = q3 - q1;
  const low = d3.min(v.filter((y) => y >= q1 - 1.5 * iqr));
  const high = d3.max(v.filter((y) => y <= q3 + 1.5 * iqr));
  return { n: v.length, q1, median, q3, low, high, outliers: v.filter((y) => y < low || y > high) };
}

// Gaussian kernel density per color, with the Silverman bandwidth, on a grid that covers the data ± 3 bandwidths.
export function density(cols, n) {
  const out = { x: [], y: [], color: [], group: [] };
  for (const { key, idx } of groupRows(cols, ["color"], n)) {
    const v = idx.map((i) => cols.x[i]).filter((x) => x !== null && Number.isFinite(x));
    if (v.length < 2) continue;
    const sd = d3.deviation(v);
    const iqr = d3.quantile(v, 0.75) - d3.quantile(v, 0.25);
    const bw = 0.9 * Math.min(sd, iqr / 1.34 || sd) * v.length ** -0.2 || 1;
    const [lo, hi] = d3.extent(v);
    for (const x of d3.range(GRID).map((k) => lo - 3 * bw + ((hi - lo + 6 * bw) * k) / (GRID - 1))) {
      const y = d3.sum(v, (xi) => Math.exp(-0.5 * ((x - xi) / bw) ** 2)) / (v.length * bw * Math.sqrt(2 * Math.PI));
      out.x.push(x);
      out.y.push(y);
      out.color.push(key[0]);
      out.group.push(key[0]);
    }
  }
  return out;
}

// A smooth curve per color: "lm" (least squares, with a 95% confidence band) or "loess" (local linear, tricube weights).
export function smooth(cols, n, { method = "lm", span = 0.75, band = true }) {
  const out = { x: [], y: [], ymin: [], ymax: [], color: [], group: [] };
  for (const { key, idx } of groupRows(cols, ["color"], n)) {
    const pts = idx.map((i) => [cols.x[i], cols.y[i]]).filter(([x, y]) => x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y));
    if (pts.length < 3) continue;
    pts.sort((a, b) => a[0] - b[0]);
    const [lo, hi] = [pts[0][0], pts.at(-1)[0]];
    const grid = d3.range(GRID).map((k) => lo + ((hi - lo) * k) / (GRID - 1));
    const fit = method === "loess" ? loess(pts, grid, span) : linear(pts, grid);
    fit.forEach(({ x, y, se }) => {
      const t = tQuantile(pts.length - 2);
      out.x.push(x);
      out.y.push(y);
      out.ymin.push(band && se !== undefined ? y - t * se : null);
      out.ymax.push(band && se !== undefined ? y + t * se : null);
      out.color.push(key[0]);
      out.group.push(key[0]);
    });
  }
  return out;
}

function linear(pts, grid) {
  const n = pts.length;
  const mx = d3.mean(pts, (p) => p[0]);
  const my = d3.mean(pts, (p) => p[1]);
  const sxx = d3.sum(pts, (p) => (p[0] - mx) ** 2) || 1;
  const b = d3.sum(pts, (p) => (p[0] - mx) * (p[1] - my)) / sxx;
  const a = my - b * mx;
  const s = Math.sqrt(d3.sum(pts, (p) => (p[1] - a - b * p[0]) ** 2) / Math.max(1, n - 2));
  return grid.map((x) => ({ x, y: a + b * x, se: s * Math.sqrt(1 / n + (x - mx) ** 2 / sxx) }));
}

function loess(pts, grid, span) {
  const k = Math.max(3, Math.ceil(span * pts.length));
  return grid.map((x) => {
    const near = pts.map(([px, py]) => [Math.abs(px - x), px, py]).sort((a, b) => a[0] - b[0]).slice(0, k);
    const dmax = near.at(-1)[0] || 1;
    let [sw, swx, swy, swxx, swxy] = [0, 0, 0, 0, 0];
    for (const [d, px, py] of near) {
      const w = (1 - (d / dmax) ** 3) ** 3;
      sw += w;
      swx += w * px;
      swy += w * py;
      swxx += w * px * px;
      swxy += w * px * py;
    }
    const det = sw * swxx - swx * swx;
    const b = Math.abs(det) < 1e-12 ? 0 : (sw * swxy - swx * swy) / det;
    const a = (swy - b * swx) / sw;
    return { x, y: a + b * x };
  });
}

// 97.5% quantile of Student's t (two-sided 95%), from a short table.
function tQuantile(df) {
  const table = [12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.2, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.1, 2.09, 2.09];
  if (df < 1) return NaN;
  if (df <= table.length) return table[df - 1];
  return df <= 30 ? 2.05 : df <= 60 ? 2.0 : 1.96;
}
