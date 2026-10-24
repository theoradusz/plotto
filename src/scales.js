// Scales: axis types, domains, ticks, tick labels and the color scale.
// Time values are wall-clock epoch ms, drawn with UTC functions, so the labels show the clock time of the data.
import * as d3 from "d3";
import { colorOf, interpolator, palette } from "./theme.js";

export const AXIS_CHANNELS = { x: ["x", "xmin", "xmax", "xend"], y: ["y", "ymin", "ymax", "yend"] };
const EXPAND = 0.05; // 5% space on each side of a continuous axis, as in ggplot
const DAY = 86_400_000;

// "linear", "log", "time" or "category": the scale type, or else the type of the first mapped column.
export function axisKind(ns, axis) {
  const type = ns.scales[axis]?.type;
  if (type) return type;
  for (const layer of ns.layers) {
    for (const ch of AXIS_CHANNELS[axis]) {
      const col = layer.channels[ch]?.column;
      if (!col) continue;
      const t = ns.tables[layer.table].columns[col].type;
      return t === "time" ? "time" : t === "string" ? "category" : "linear";
    }
  }
  return "linear";
}

// The values of one channel for the given rows of the layer table; a constant repeats for each row.
export function channelValues(ns, layer, ch, rows) {
  const c = layer.channels[ch];
  if (!c) return undefined;
  if ("value" in c) return rows.map(() => c.value);
  const values = ns.tables[layer.table].columns[c.column].values;
  return rows.map((i) => values[i]);
}

// The domain of one axis over the views of a set of panels. Continuous domains get the 5% expansion.
export function trainDomain(ns, axis, kind, panels) {
  const values = [];
  for (const p of panels) {
    for (const view of p.views) {
      for (const ch of AXIS_CHANNELS[axis]) {
        const v = view.cols[ch];
        if (v) for (const x of v) if (x !== null && x !== undefined && (kind === "category" || Number.isFinite(x))) values.push(x);
      }
    }
  }
  if (kind === "category") return categories(ns, axis, values);
  const domain = d3.extent(values.filter((v) => kind !== "log" || v > 0));
  if (domain[0] === undefined) return kind === "log" ? [1, 10] : [0, 1];
  return expand(domain, kind);
}

function categories(ns, axis, values) {
  const levels = ns.layers.map((l) => l.channels[axis]?.column && ns.tables[l.table].columns[l.channels[axis].column].levels).find(Boolean);
  const seen = new Set(values.map(String));
  return levels ? levels.filter((v) => seen.has(v)) : [...seen].sort(naturalOrder);
}

export function naturalOrder(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function expand([lo, hi], kind) {
  if (kind === "log") {
    const [a, b] = expand([Math.log10(lo), Math.log10(hi)], "linear");
    return [10 ** a, 10 ** b];
  }
  const pad = hi > lo ? (hi - lo) * EXPAND : kind === "time" ? 3_600_000 : Math.abs(lo) * EXPAND || 1;
  return [lo - pad, hi + pad];
}

// Major ticks, minor ticks (midpoints, as ggplot) and the label format of one axis.
export function ticks(kind, domain, count, format) {
  if (kind === "category") return { major: domain, minor: [], format: String };
  const [lo, hi] = domain;
  if (kind === "time") {
    const major = d3.scaleUtc().domain([new Date(lo), new Date(hi)]).ticks(count);
    const pattern = format ?? timePattern(major, hi - lo);
    return { major, minor: midpoints(major, domain, (d) => +d).map((t) => new Date(t)), format: d3.utcFormat(pattern) };
  }
  if (kind === "log") {
    const decades = d3.range(Math.ceil(Math.log10(lo)), Math.floor(Math.log10(hi)) + 1).map((e) => 10 ** e);
    // Less than two decades in view: 1, 2 and 5 times the powers of ten.
    const major = decades.length >= 2 ? decades : d3.scaleLog().domain(domain).ticks(count).filter((v) => [1, 2, 5].includes(Math.round(v / 10 ** Math.floor(Math.log10(v) + 1e-9))));
    const minor = decades.flatMap((d) => d3.range(2, 10).map((k) => (d / 10) * k)).filter((v) => v > lo && v < hi);
    return { major, minor, format: d3.format(format ?? "~g") };
  }
  const major = d3.ticks(lo, hi, count);
  return { major, minor: midpoints(major, domain, Number), format: format ? d3.format(format) : d3.tickFormat(lo, hi, count) };
}

function midpoints(major, [lo, hi], num) {
  if (major.length < 2) return [];
  const step = num(major[1]) - num(major[0]);
  const out = [num(major[0]) - step / 2, ...major.map((t) => num(t) + step / 2)];
  return out.filter((v) => v > lo && v < hi);
}

// One-line date labels: the shortest pattern that still shows the tick step.
function timePattern(major, span) {
  const step = major.length >= 2 ? major[1] - major[0] : span;
  if (step >= 28 * DAY) return "%Y-%m";
  if (step >= DAY) return "%m-%d";
  if (step >= 60_000) return span > DAY ? "%m-%d %H:%M" : "%H:%M";
  return "%H:%M:%S";
}

// Hover label formats: 4 significant digits in decimal notation (with thousands separators), and short dates.
const significant = d3.format(",.4~r");
export const hoverFormat = {
  number: (v) => (v === null || v === undefined ? "–" : Math.abs(v) >= 1e15 || (v !== 0 && Math.abs(v) < 1e-4) ? d3.format(".3~e")(v) : significant(v)),
  time: d3.utcFormat("%m-%d %H:%M"),
  string: (v) => (v === null || v === undefined ? "–" : String(v)),
};

// The color scale of the plot: "none", "ordinal" (a string column) or "continuous" (a number or time column).
// apply(value) → color; ramp(t) → the color at t ∈ [0, 1] of the legend ramp.
export function colorScale(ns) {
  const theme = ns.theme;
  const opts = ns.scales.color ?? {};
  const mapped = ns.layers.filter((l) => l.channels.color?.column);
  if (!mapped.length) return { kind: "none" };
  const column = mapped[0].channels.color.column;
  const other = mapped.find((l) => l.channels.color.column !== column);
  if (other) throw new Error(`plotto: color maps "${column}" and "${other.channels.color.column}". Map color to one column only`);
  const cols = mapped.map((l) => ns.tables[l.table].columns[column]);
  const type = cols[0].type;
  const all = cols.flatMap((c) => c.values).filter((v) => v !== null);
  const resolve = (c) => colorOf(theme, c) ?? c;

  if (type === "string") {
    const levels = cols.find((c) => c.levels)?.levels;
    const seen = new Set(all);
    const domain = opts.limits ?? (levels ? levels.filter((v) => seen.has(v)) : [...seen].sort(naturalOrder));
    const colors = opts.palette ? palette(theme, opts.palette) : theme.palette;
    const values = opts.values;
    const pick = Array.isArray(values)
      ? (v, i) => resolve(values[i % values.length])
      : values
        ? (v, i) => resolve(values[v] ?? colors[i % colors.length])
        : (v, i) => colors[i % colors.length];
    const map = new Map(domain.map((v, i) => [v, pick(v, i)]));
    return { kind: "ordinal", column, domain, apply: (v) => map.get(v) ?? theme.muted };
  }

  const [lo, hi] = limitsOf(opts.limits, d3.extent(all));
  const interpolate = interpolator(theme, opts.values ?? opts.scheme ?? theme.scheme);
  // mid: a diverging scale, with mid at the center of the scheme.
  const mid = opts.mid;
  const t = (v) => (mid === undefined ? (v - lo) / (hi - lo || 1) : v < mid ? 0.5 * ((v - lo) / (mid - lo || 1)) : 0.5 + 0.5 * ((v - mid) / (hi - mid || 1)));
  const inside = (v) => v >= lo && v <= hi;
  const apply = (v) => (v === null ? theme.muted : opts.clamp || inside(v) ? interpolate(Math.max(0, Math.min(1, t(v)))) : theme.muted);
  const ramp = (u) => apply(lo + u * (hi - lo));
  return { kind: "continuous", column, domain: [lo, hi], type, interpolate, apply, ramp };
}

// Limits with null bounds: a null bound takes the data bound.
export function limitsOf(limits, data) {
  if (!limits) return data;
  return [limits[0] ?? data[0], limits[1] ?? data[1]];
}
