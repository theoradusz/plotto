// Hover: finds what is under the pointer in one panel, and the content of its label box. One mode per kind of layer:
// - lines and areas (line, step, area, density, smooth, ribbon): every series at the nearest x, with a crosshair;
// - bars and bins: the whole stack (or dodge group) at that x, with the total of a stack;
// - box: the quartiles of the box; tile: the value of the cell;
// - points (and error bars): the nearest point. It stays picked until another point is clearly nearer.
import * as d3 from "d3";
import { hoverFormat } from "./scales.js";

const RADIUS = 40; // px: the largest distance to a point or a line
const CLOSE = 10; // px: a point this close wins over the lines
const SNAP = 6; // px: series whose nearest x is this close to the snapped x share the label
const KEEP = 4; // px: a new point must be this much nearer to replace the picked one
const MAX_ROWS = 6; // more series than this at one x: the label shows only the series under the pointer
const UNIFIED = ["line", "step", "area", "density", "smooth", "ribbon"];
const SHAPES = ["bar", "hist", "tile", "box"];
const POINTS = ["point", "path", "errorbar"];

// (x, y): px inside panel i. previous: the last hit (for hysteresis). Returns a hit or null.
export function pick(state, i, x, y, previous) {
  const panel = state.panels[i];
  const sx = panel.plot.scale("x");
  const sy = panel.plot.scale("y");
  const px = (v) => sx.apply(v) + (sx.bandwidth ?? 0) / 2;
  const py = (v) => sy.apply(v) + (sy.bandwidth ?? 0) / 2;
  const ctx = { state, sx, sy, px, py };
  const box = boxUnderAny(ctx, panel, x);
  if (box) return { ...box, panel: i };
  const point = nearestPoint(ctx, panel, x, y, previous?.panel === i ? previous : null);
  if (point && point.d <= CLOSE) return { ...pointHit(ctx, point), panel: i };
  const lines = unified(ctx, panel, x, y, previous?.panel === i ? previous : null);
  if (lines) return { ...lines, panel: i };
  const shape = shapeUnder(ctx, panel, x, y);
  if (shape) return { ...shape, panel: i };
  if (point) return { ...pointHit(ctx, point), panel: i };
  return null;
}

function seriesColor(state, layer, view, c, k) {
  const ch = layer.channels.color;
  if (!ch) return layer.type === "smooth" ? state.theme.accent : state.theme.palette[0];
  return "value" in ch ? ch.value : state.color.apply(view.cols.color[k]);
}

function fmt(state, axis, v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (axis && state.kind[axis] === "time") return timeFormat(state, axis)(v);
  if (axis && state.kind[axis] === "category") return String(v);
  return typeof v === "number" ? hoverFormat.number(v) : String(v);
}

// The time format of the hover label follows the data: months, days, minutes or seconds.
function timeFormat(state, axis) {
  state.timeFormats ??= {};
  if (state.timeFormats[axis]) return state.timeFormats[axis];
  const values = state.grid.panels.flatMap((p) => p.views.flatMap((v) => v.cols[axis] ?? [])).filter((t) => t !== null);
  const all = (test) => values.every((t) => test(new Date(t)));
  const pattern = all((d) => d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0)
    ? "%Y-%m"
    : all((d) => d.getUTCHours() === 0 && d.getUTCMinutes() === 0)
      ? "%Y-%m-%d"
      : all((d) => d.getUTCSeconds() === 0)
        ? "%m-%d %H:%M"
        : "%m-%d %H:%M:%S";
  return (state.timeFormats[axis] = d3.utcFormat(pattern));
}

function fieldText(state, f, k) {
  return f.values2 ? `${fmt(state, f.axis, f.values[k])} – ${fmt(state, f.axis, f.values2[k])}` : fmt(state, f.axis, f.values[k]);
}

// --- points ---------------------------------------------------------------------------------

function nearestPoint({ px, py }, panel, x, y, previous) {
  let best = null;
  let kept = null;
  for (const { layer, view, c } of panel.layers) {
    if (!POINTS.includes(layer.type) || !view.hover || !view.n) continue;
    const { hx, hy } = view.hover;
    for (let k = 0; k < view.n; k++) {
      if (hx[k] === null || hy[k] === null) continue;
      const d = Math.hypot(px(hx[k]) - x, py(hy[k]) - y);
      if (d > RADIUS) continue;
      const hit = { layer, view, c, k, d, x: px(hx[k]), y: py(hy[k]) };
      if (!best || d < best.d) best = hit;
      if (previous?.layer === layer && previous.k === k) kept = hit;
    }
  }
  return kept && best && best.d > kept.d - KEEP ? kept : best;
}

function pointHit({ state }, { layer, view, c, k, x, y, d }) {
  const color = seriesColor(state, layer, view, c, k);
  const name = layer.channels.color?.column ? fmt(state, null, view.cols.color[k]) : null;
  // A row that repeats the header (x and color map the same column) is left out.
  const rows = view.hover.fields.map((f) => ({ label: f.label, value: fieldText(state, f, k) })).filter((r) => r.value !== name);
  return { layer, k, d, color, header: name, rows, marks: [{ x, y, color }], anchor: { x, y } };
}

// --- lines and areas: every series at the nearest x -------------------------------------------

function unified({ state, px, py }, panel, x, y, previous) {
  const candidates = [];
  for (const { layer, view, c } of panel.layers) {
    if (!UNIFIED.includes(layer.type) || !view.hover || !view.n) continue;
    const { hx, hy } = view.hover;
    const series = c.groups() ?? [];
    const nearest = new Map(); // series → candidate
    for (let k = 0; k < view.n; k++) {
      if (hx[k] === null || hy[k] === null) continue;
      const dx = Math.abs(px(hx[k]) - x);
      const key = series[k] ?? "";
      if (dx <= RADIUS && (!nearest.has(key) || dx < nearest.get(key).dx)) nearest.set(key, { layer, view, c, k, dx, series: key });
    }
    candidates.push(...nearest.values());
  }
  if (!candidates.length) return null;
  const snap = d3.least(candidates, (m) => m.dx);
  const snapX = px(snap.view.hover.hx[snap.k]);
  const members = candidates.filter((m) => Math.abs(px(m.view.hover.hx[m.k]) - snapX) <= SNAP);
  for (const m of members) m.y = py(m.view.hover.hy[m.k]);
  // The series under the pointer. It stays picked until another series is clearly nearer (noisy, crossing lines).
  let strong = d3.least(members, (m) => Math.abs(m.y - y));
  const kept = previous?.series !== undefined && members.find((m) => m.layer === previous.layer && m.series === previous.series);
  if (kept && Math.abs(kept.y - y) < Math.abs(strong.y - y) + KEEP) strong = kept;
  const name = (m) =>
    m.layer.channels.color?.column ? fmt(state, null, m.view.cols.color[m.k]) : m.series !== "" ? String(m.series) : (m.view.hover.fields[1]?.label ?? m.layer.type);
  const color = (m) => seriesColor(state, m.layer, m.view, m.c, m.k);
  const xField = snap.view.hover.fields[0];
  const xText = fmt(state, "x", snap.view.hover.hx[snap.k]);
  const base = { crosshair: snapX, anchor: { x: snapX, y }, layer: strong.layer, series: strong.series };

  // Many series: only the one under the pointer, like a single line; the others are counted.
  if (members.length === 1 || members.length > MAX_ROWS) {
    const rows = [{ label: xField?.label ?? "x", value: xText }, { label: strong.view.hover.fields[1]?.label ?? "y", value: unifiedValue(state, strong.layer, strong.view, strong.k) }];
    const others = members.length - 1;
    return { ...base, color: color(strong), header: name(strong), rows, note: others ? `${others} other series at this x` : null, marks: [{ x: snapX, y: strong.y, color: color(strong) }] };
  }

  // A few series: one row each, in the legend order; the one under the pointer in bold.
  const order = seriesOrder(state);
  members.sort((a, b) => order(a) - order(b) || a.y - b.y);
  const rows = members.map((m) => ({ swatch: color(m), label: name(m), value: unifiedValue(state, m.layer, m.view, m.k), strong: m === strong }));
  return {
    ...base,
    color: state.theme.ink,
    header: xField ? `${xField.label}  ${xText}` : xText,
    rows,
    marks: members.map((m) => ({ x: snapX, y: m.y, color: color(m) })),
  };
}

// A sort key of a series: the legend position of its color, its color value (a number), or the plot order.
function seriesOrder(state) {
  const { color } = state;
  return (m) => {
    const v = m.layer.channels.color?.column ? m.view.cols.color[m.k] : null;
    if (v === null) return state.ns.layers.indexOf(m.layer);
    if (color.kind === "ordinal") return color.domain.indexOf(v);
    return typeof v === "number" ? v : 0;
  };
}

function unifiedValue(state, layer, view, k) {
  const f = view.hover.fields;
  if (layer.type === "smooth" && f[2]) return `${fieldText(state, f[1], k)}  (${fieldText(state, f[2], k)})`;
  return fieldText(state, f[1], k);
}

// --- bars, bins, tiles and boxes ------------------------------------------------------------

// A box wins over the points drawn with it (a box with jittered points).
function boxUnderAny(ctx, panel, x) {
  for (const { layer, view, c } of panel.layers) if (layer.type === "box" && view.n) return boxUnder(ctx, layer, view, c, x);
  return null;
}

// Bars and bins: the column under the pointer (gaps between columns included), the segment under the pointer
// or else the top one. Tiles: the cell under the pointer (band padding included).
function shapeUnder(ctx, panel, x, y) {
  const { state, sx, sy } = ctx;
  for (const { layer, view, c } of panel.layers) {
    if (!SHAPES.includes(layer.type) || layer.type === "box" || !view.n) continue;
    const tile = layer.type === "tile";
    let best = null;
    for (let k = 0; k < view.n; k++) {
      const [x0, x1] = shapeX(layer, view, k, sx);
      // Tiles: the cell itself plus its padding. Bars: the nearest column, up to one bar width away (gaps included).
      const dx = Math.abs((x0 + x1) / 2 - x);
      if (tile ? x < x0 - pad(sx, x1 - x0) || x > x1 + pad(sx, x1 - x0) : dx > x1 - x0) continue;
      const [ya, yb] = shapeY(layer, view, k, sy);
      const [y0, y1] = [Math.min(ya, yb), Math.max(ya, yb)];
      const padY = tile ? pad(sy, y1 - y0) : 0;
      const inside = y >= y0 - padY && y <= y1 + padY;
      if (tile && !inside) continue;
      // The nearest column first; in it, the segment under the pointer, or else the top segment.
      const score = Math.round(dx) * 1e6 + (inside ? 0 : 1e5 + y0);
      if (!best || score < best.score) best = { k, score, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
    }
    if (!best) continue;
    const { k, rect } = best;
    const color = seriesColor(state, layer, view, c, k);
    if (tile) {
      const label = state.ns.labels.color ?? layer.channels.color?.column ?? "value";
      const value = layer.channels.color?.column ? fmt(state, null, view.cols.color[k]) : null;
      const rows = view.hover.fields.filter((f) => f.label !== label).map((f) => ({ label: f.label, value: fieldText(state, f, k) }));
      return { color, header: value !== null ? `${label}  ${value}` : null, rows, marks: [{ rect, color: state.theme.ink }], anchor: { x: rect.x + rect.width, y } };
    }
    return stackHit(state, layer, view, c, k, rect);
  }
  return null;
}

// Half of the free space around a band (category) cell, in px.
function pad(scale, size) {
  return scale.bandwidth !== undefined ? (scale.step - scale.bandwidth) / 2 || size * 0.125 : 0.5;
}

// All segments at the x of segment k: one row per color, the hovered one in bold, and the total of a stack.
function stackHit(state, layer, view, c, k, rect) {
  const sameX = layer.type === "hist" ? (j) => view.cols.xmin[j] === view.cols.xmin[k] : (j) => String(view.cols.x[j]) === String(view.cols.x[k]);
  const at = d3.range(view.n).filter(sameX);
  const colored = !!layer.channels.color?.column;
  const rows = at
    .sort((a, b) => (colored && state.color.kind === "ordinal" ? state.color.domain.indexOf(view.cols.color[a]) - state.color.domain.indexOf(view.cols.color[b]) : view.cols.ymax[b] - view.cols.ymax[a]))
    .map((j) => ({
      swatch: seriesColor(state, layer, view, c, j),
      label: colored ? fmt(state, null, view.cols.color[j]) : view.hover.fields[1].label,
      value: fmt(state, null, view.cols.value[j]),
      strong: j === k && at.length > 1,
    }));
  const position = layer.options.position ?? "stack";
  if (position === "stack" && at.length > 1) rows.push({ label: "total", value: fmt(state, null, d3.sum(at, (j) => view.cols.value[j])), strong: false, total: true });
  const xf = view.hover.fields[0];
  return { color: seriesColor(state, layer, view, c, k), header: `${xf.label}  ${fieldText(state, xf, k)}`, rows, marks: [{ rect, color: state.theme.ink }], anchor: { x: rect.x + rect.width, y: rect.y } };
}

function boxUnder({ state, sx }, layer, view, c, x) {
  if (sx.bandwidth === undefined) return null;
  const k = d3.range(view.n).find((j) => {
    const x0 = sx.apply(view.cols.x[j]);
    return x >= x0 && x <= x0 + sx.bandwidth;
  });
  if (k === undefined) return null;
  const key = String(view.cols.x[k]);
  const values = d3.range(view.n).filter((j) => String(view.cols.x[j]) === key).map((j) => view.cols.y[j]).filter((v) => v !== null).sort(d3.ascending);
  const [q1, median, q3] = [0.25, 0.5, 0.75].map((p) => d3.quantile(values, p));
  const iqr = q3 - q1;
  const low = d3.min(values.filter((v) => v >= q1 - 1.5 * iqr));
  const high = d3.max(values.filter((v) => v <= q3 + 1.5 * iqr));
  const outliers = values.filter((v) => v < low || v > high).length;
  const f = (v) => fmt(state, "y", v);
  const rows = [
    { label: "max (whisker)", value: f(high) },
    { label: "q3", value: f(q3) },
    { label: "median", value: f(median), strong: true },
    { label: "q1", value: f(q1) },
    { label: "min (whisker)", value: f(low) },
    { label: "n", value: String(values.length) },
  ];
  if (outliers) rows.push({ label: "outliers", value: String(outliers) });
  const x0 = sx.apply(view.cols.x[k]);
  const color = layer.channels.color?.column ? seriesColor(state, layer, view, c, k) : state.theme.ink;
  return { color, header: `${view.hover.fields[0].label}  ${key}`, rows, marks: [], anchor: { x: x0 + sx.bandwidth, y: null } };
}

function shapeX(layer, view, k, sx) {
  if (view.cols.xmin && layer.type !== "tile") return [sx.apply(view.cols.xmin[k]), sx.apply(view.cols.xmax[k])];
  if (sx.bandwidth !== undefined) {
    const slots = view.cols.slots?.[k] ?? 1;
    const slice = sx.bandwidth / slots;
    const x0 = sx.apply(view.cols.x[k]) + (view.cols.slot?.[k] ?? 0) * slice;
    return [x0, x0 + slice];
  }
  const half = halfStep(view.cols.x, sx);
  const cx = sx.apply(view.cols.x[k]);
  return [cx - half, cx + half];
}

function shapeY(layer, view, k, sy) {
  if (layer.type === "tile") {
    if (sy.bandwidth !== undefined) return [sy.apply(view.cols.y[k]), sy.apply(view.cols.y[k]) + sy.bandwidth];
    const half = halfStep(view.cols.y, sy);
    const cy = sy.apply(view.cols.y[k]);
    return [cy - half, cy + half];
  }
  return [sy.apply(view.cols.ymin[k]), sy.apply(view.cols.ymax[k])];
}

// Half of the smallest step between values, in px.
function halfStep(values, scale) {
  const sorted = [...new Set(values.map(Number))].sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < sorted.length; i++) step = Math.min(step, sorted[i] - sorted[i - 1]);
  if (!Number.isFinite(step)) return 6;
  return Math.abs(scale.apply(sorted[0] + step) - scale.apply(sorted[0])) / 2;
}
