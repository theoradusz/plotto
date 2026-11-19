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
// scale: the axis options of the spec. breaks set the major ticks (without minor ticks); labels name them.
// degrees ("lon" or "lat", from coord("geo")) writes the labels as 135°E or 35°N.
export function ticks(kind, domain, count, { format, breaks, labels, degrees } = {}) {
  if (breaks && kind === "category") throw new Error("plotto: breaks apply to number, log and time axes, not to a category axis");
  if (kind === "category") return { major: domain, minor: [], format: String };
  const [lo, hi] = domain;
  const geo = (f) => (degrees && !format ? degreeFormat(f, degrees) : f);
  if (breaks) {
    const major = kind === "time" ? breaks.map((t) => new Date(t)) : breaks;
    const base = geo(kind === "time" ? d3.utcFormat(format ?? timePattern(major, hi - lo)) : d3.format(format ?? (kind === "log" ? "~g" : ",~r")));
    const named = labels && new Map(breaks.map((v, i) => [+v, labels[i]]));
    return { major, minor: [], format: named ? (v) => named.get(+v) ?? base(v) : base };
  }
  if (kind === "time") {
    const major = d3.scaleUtc().domain([new Date(lo), new Date(hi)]).ticks(count);
    const pattern = format ?? timePattern(major, hi - lo);
    return { major, minor: midpoints(major, domain, (d) => +d).map((t) => new Date(t)), format: d3.utcFormat(pattern) };
  }
  if (kind === "log") {
    const decades = d3.range(Math.ceil(Math.log10(lo)), Math.floor(Math.log10(hi)) + 1).map((e) => 10 ** e);
    // Fewer than three powers of ten in view: 1, 2 and 5 times the powers of ten.
    const major = decades.length >= 3 ? decades : d3.scaleLog().domain(domain).ticks(count).filter((v) => [1, 2, 5].includes(Math.round(v / 10 ** Math.floor(Math.log10(v) + 1e-9))));
    const minor = decades.flatMap((d) => d3.range(2, 10).map((k) => (d / 10) * k)).filter((v) => v > lo && v < hi);
    return { major, minor, format: d3.format(format ?? "~g") };
  }
  const major = d3.ticks(lo, hi, count);
  return { major, minor: midpoints(major, domain, Number), format: format ? d3.format(format) : geo(d3.tickFormat(lo, hi, count)) };
}

// Degree labels of a map axis: the number without its sign, then °E or °W (longitude), °N or °S (latitude).
function degreeFormat(f, degrees) {
  const [plus, minus] = degrees === "lon" ? ["E", "W"] : ["N", "S"];
  return (v) => `${f(Math.abs(v))}°${v > 0 ? plus : v < 0 ? minus : ""}`;
}

// coord("geo"): the domain grown on one side so that one km has the same length in x (longitude) and y (latitude)
// on a panel of w × h px, at the center latitude. The center does not move.
export function equalize({ x, y }, w, h) {
  const k = Math.cos((((y[0] + y[1]) / 2) * Math.PI) / 180); // one degree of longitude, in degrees of latitude
  const pxX = w / ((x[1] - x[0]) * k); // px per degree of latitude, along x
  const pxY = h / (y[1] - y[0]);
  const grow = ([lo, hi], span) => [(lo + hi) / 2 - span / 2, (lo + hi) / 2 + span / 2];
  return pxX > pxY ? { x: grow(x, w / pxY / k), y } : { x, y: grow(y, h / pxX) };
}

// The panel shape (height / width) of a map domain at equal distance per px.
export function geoAspect({ x, y }) {
  return (y[1] - y[0]) / ((x[1] - x[0]) * Math.cos((((y[0] + y[1]) / 2) * Math.PI) / 180));
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

// A color scale of the plot (channel "color" or "fill"): "none", "ordinal" (a string column), "continuous" (a number
// or time column) or "binned" (a number or time column with breaks).
// apply(value) → color; ramp(t) → the color at t ∈ [0, 1] of the legend ramp.
export function colorScale(ns, channel = "color") {
  const theme = ns.theme;
  const opts = ns.scales[channel] ?? {};
  const mapped = ns.layers.filter((l) => l.channels[channel]?.column);
  if (!mapped.length) return { kind: "none", channel };
  const column = mapped[0].channels[channel].column;
  const other = mapped.find((l) => l.channels[channel].column !== column);
  if (other) throw new Error(`plotto: ${channel} maps "${column}" and "${other.channels[channel].column}". Map ${channel} to one column only`);
  const cols = mapped.map((l) => ns.tables[l.table].columns[column]);
  const type = cols[0].type;
  const all = cols.flatMap((c) => c.values).filter((v) => v !== null);
  const resolve = (c) => colorOf(theme, c) ?? c;
  if (opts.breaks && type === "string") throw new Error(`${channel}(): breaks apply to a number or time column, not to "${column}"`);
  if (opts.breaks) return binnedScale(theme, opts, { channel, column, type });

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
    return { kind: "ordinal", channel, column, domain, apply: (v) => map.get(v) ?? theme.muted };
  }

  const [lo, hi] = limitsOf(opts.limits, d3.extent(all));
  const interpolate = interpolator(theme, opts.values ?? opts.scheme ?? theme.scheme);
  // mid: a diverging scale, with mid at the center of the scheme.
  const mid = opts.mid;
  const t = (v) => (mid === undefined ? (v - lo) / (hi - lo || 1) : v < mid ? 0.5 * ((v - lo) / (mid - lo || 1)) : 0.5 + 0.5 * ((v - mid) / (hi - mid || 1)));
  const inside = (v) => v >= lo && v <= hi;
  const apply = (v) => (v === null ? theme.muted : opts.clamp || inside(v) ? interpolate(Math.max(0, Math.min(1, t(v)))) : theme.muted);
  const ramp = (u) => apply(lo + u * (hi - lo));
  return { kind: "continuous", channel, column, domain: [lo, hi], type, interpolate, apply, ramp };
}

// Classes set by the breaks alone: [b0, b1), …, [b(n-1), bn), [bn, ∞), so the colors do not depend on the data.
// The colors are the values (one per class), or the scheme at the middle of each class (i + 0.5) / k.
// A value below b0 is muted (clamp: the first class); null is muted.
function binnedScale(theme, opts, { channel, column, type }) {
  const breaks = opts.breaks;
  const k = breaks.length;
  const colors = Array.isArray(opts.values)
    ? opts.values.map((c) => colorOf(theme, c) ?? c)
    : d3.range(k).map((i) => interpolator(theme, opts.scheme ?? theme.scheme)((i + 0.5) / k));
  const classOf = (v) => (v === null || v === undefined || Number.isNaN(v) ? -1 : v < breaks[0] ? (opts.clamp ? 0 : -1) : d3.bisectRight(breaks, v) - 1);
  const apply = (v) => colors[classOf(v)] ?? theme.muted;
  return { kind: "binned", channel, column, type, breaks, labels: opts.labels, colors, classOf, apply };
}

// Limits with null bounds: a null bound takes the data bound.
export function limitsOf(limits, data) {
  if (!limits) return data;
  return [limits[0] ?? data[0], limits[1] ?? data[1]];
}
