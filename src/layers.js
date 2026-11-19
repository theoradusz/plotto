// Layer table: each layer type returns the Observable Plot marks of its view in one panel.
// The context `c` (made by figure.js) gives the view columns: c.v("x"), c.colors(fallback), c.groups().
// To add a layer type: add one entry here, one entry in grammar.json and, for a statistic, a case in views.js.
import * as Plot from "@observablehq/plot";
import * as d3 from "d3";
import { DIRECT } from "./layout.js";
import { boxStats } from "./stats.js";
import { readable } from "./theme.js";

const DASH = { solid: undefined, dashed: "6,4", dotted: "1.5,3", dashdot: "6,3,1.5,3" };
const clip = "frame";

const strokeStyle = (c, fallback) => ({
  stroke: c.colors(fallback),
  strokeWidth: c.options.size ?? c.theme.line,
  strokeOpacity: c.options.alpha ?? 1,
  strokeDasharray: DASH[c.options.dash],
  strokeLinejoin: "round",
  strokeLinecap: "round",
});

const fillStyle = (c, fallback, alpha = 1) => ({ fill: c.colors(fallback), fillOpacity: c.options.alpha ?? alpha });
const first = (c) => c.theme.palette[0];

const lineOf = (curve) => (c) => [Plot.line(c.index, { x: c.v("x"), y: c.v("y"), z: c.groups(), curve, ...strokeStyle(c, first(c)), clip })];

export const LAYERS = {
  line: (c) => [
    Plot.line(c.index, { x: c.v("x"), y: c.v("y"), z: c.groups(), sort: { channel: "x" }, ...strokeStyle(c, first(c)), clip }),
    ...(c.options.direct ? endLabels(c) : []),
  ],

  path: lineOf("linear"),

  step: (c) => [Plot.line(c.index, { x: c.v("x"), y: c.v("y"), z: c.groups(), sort: { channel: "x" }, curve: "step-after", ...strokeStyle(c, first(c)), clip })],

  point: (c) => {
    const options = { x: jittered(c), y: c.v("y"), r: c.options.size ?? c.theme.point, ...fillStyle(c, first(c)), clip };
    const jitter = c.options.jitter && c.kind.x === "category" ? jitterRender(c.options.jitter) : null;
    const render = [dodgeRender(c), jitter].filter(Boolean);
    if (render.length) options.render = render.reduce(composeRender);
    return [Plot.dot(c.index, options)];
  },

  bar: (c) => {
    const fill = { ...fillStyle(c, first(c), stackAlpha(c, 1)), clip };
    if (c.kind.x !== "category") return [Plot.rect(c.index, { x1: c.v("xmin"), x2: c.v("xmax"), y1: c.v("ymin"), y2: c.v("ymax"), ...fill })];
    const slots = c.v("slots")[0] ?? 1;
    if (slots === 1) return [Plot.barY(c.index, { x: c.v("x"), y1: c.v("ymin"), y2: c.v("ymax"), ...fill })];
    // Dodge: one bar mark per slot, narrowed with insets to its share of the band.
    // Channel arrays align with the data array, so each slot takes its own subset of every array.
    const slice = c.bandwidth.x / slots;
    const at = (values, rows) => (Array.isArray(values) ? rows.map((i) => values[i]) : values);
    return d3.range(slots).map((k) => {
      const rows = c.index.filter((i) => c.v("slot")[i] === k);
      const channels = { x: at(c.v("x"), rows), y1: at(c.v("ymin"), rows), y2: at(c.v("ymax"), rows), fill: at(fill.fill, rows) };
      return Plot.barY(d3.range(rows.length), { ...fill, ...channels, insetLeft: k * slice + 0.5, insetRight: (slots - 1 - k) * slice + 0.5 });
    });
  },

  hist: (c) => [Plot.rect(c.index, { x1: c.v("xmin"), x2: c.v("xmax"), y1: c.v("ymin"), y2: c.v("ymax"), insetLeft: 0.5, insetRight: 0.5, ...fillStyle(c, first(c), stackAlpha(c)), clip })],

  density: (c) => [
    Plot.areaY(c.index, { x: c.v("x"), y: c.v("y"), z: c.groups(), fill: c.colors(first(c)), fillOpacity: 0.15, clip }),
    Plot.line(c.index, { x: c.v("x"), y: c.v("y"), z: c.groups(), ...strokeStyle(c, first(c)), clip }),
  ],

  area: (c) => [
    Plot.areaY(c.index, { x: c.v("x"), y1: c.v("ymin"), y2: c.v("ymax"), z: c.groups(), ...fillStyle(c, first(c), stackAlpha(c, 0.8)), clip }),
  ],

  ribbon: (c) => [Plot.areaY(c.index, { x: c.v("x"), y1: c.v("ymin"), y2: c.v("ymax"), z: c.groups(), ...fillStyle(c, first(c), 0.2), clip })],

  smooth: (c) => {
    const marks = [];
    if (c.v("ymin").some((v) => v !== null)) {
      marks.push(Plot.areaY(c.index, { x: c.v("x"), y1: c.v("ymin"), y2: c.v("ymax"), z: c.groups(), fill: c.colors(c.theme.muted), fillOpacity: 0.15, clip }));
    }
    marks.push(Plot.line(c.index, { x: c.v("x"), y: c.v("y"), z: c.groups(), ...strokeStyle(c, c.theme.accent), clip }));
    return marks;
  },

  hline: (c) => [Plot.ruleY(c.index, { y: c.v("y"), ...strokeStyle(c, c.theme.muted), strokeWidth: c.options.size ?? 1, clip })],

  vline: (c) => [Plot.ruleX(c.index, { x: c.v("x"), ...strokeStyle(c, c.theme.muted), strokeWidth: c.options.size ?? 1, clip })],

  abline: (c) => {
    const [x0, x1] = c.domain.x.map(Number);
    const { slope = 1, intercept = 0 } = c.options;
    return [Plot.line([0, 1], { x: [x0, x1], y: [intercept + slope * x0, intercept + slope * x1], ...strokeStyle(c, c.theme.muted), strokeWidth: c.options.size ?? 1, clip })];
  },

  segment: (c) => [Plot.link(c.index, { x1: c.v("x"), y1: c.v("y"), x2: c.v("xend"), y2: c.v("yend"), ...strokeStyle(c, c.theme.ink), render: dodgeRender(c), clip })],

  rect: (c) => [Plot.rect(c.index, { x1: c.v("xmin"), x2: c.v("xmax"), y1: c.v("ymin"), y2: c.v("ymax"), ...fillStyle(c, first(c)), clip })],

  // A band without a bound spans the full panel on that side.
  band: (c) => {
    const edge = (ch, axis, i) => c.v(ch) ?? c.index.map(() => c.domain[axis][i]);
    const box = { x1: edge("xmin", "x", 0), x2: edge("xmax", "x", 1), y1: edge("ymin", "y", 0), y2: edge("ymax", "y", 1) };
    return [Plot.rect(c.index, { ...box, ...fillStyle(c, c.theme.muted, 0.12), clip })];
  },

  tile: (c) => {
    const fill = fillStyle(c, first(c));
    const [cx, cy] = [c.kind.x === "category", c.kind.y === "category"];
    if (cx && cy) return [Plot.cell(c.index, { x: c.v("x"), y: c.v("y"), ...fill, inset: 0.5, clip })];
    const [x1, x2] = cx ? [] : spread(c.v("x"));
    const [y1, y2] = cy ? [] : spread(c.v("y"));
    if (cx) return [Plot.barY(c.index, { x: c.v("x"), y1, y2, ...fill, clip })];
    if (cy) return [Plot.barX(c.index, { y: c.v("y"), x1, x2, ...fill, insetTop: 0.5, insetBottom: 0.5, clip })];
    return [Plot.rect(c.index, { x1, x2, y1, y2, ...fill, clip })];
  },

  text: (c) => [
    Plot.text(c.index, { x: c.v("x"), y: c.v("y"), text: c.v("label"), fontSize: c.options.size ?? c.fonts.tick, ...fillStyle(c, c.theme.ink), clip }),
  ],

  errorbar: (c) => {
    const style = { ...strokeStyle(c, c.theme.ink), strokeWidth: c.options.size ?? 1.2, render: dodgeRender(c) };
    const rule = Plot.ruleX(c.index, { x: c.v("x"), y1: c.v("ymin"), y2: c.v("ymax"), ...style, clip });
    if (c.kind.x === "category") {
      // A cap is 30% of the band, or 60% of its slot when the colors dodge.
      const inset = (c.bandwidth.x - Math.min(0.3, 0.6 / (c.shift?.slots ?? 1)) * c.bandwidth.x) / 2;
      const cap = (ch) => Plot.tickY(c.index, { x: c.v("x"), y: c.v(ch), ...style, insetLeft: inset, insetRight: inset, clip });
      return [rule, cap("ymin"), cap("ymax")];
    }
    const [x1, x2] = spread(c.v("x"), 0.25);
    const cap = (ch) => Plot.link(c.index, { x1, x2, y1: c.v(ch), y2: c.v(ch), ...style, clip });
    return [rule, cap("ymin"), cap("ymax")];
  },

  // One Tukey box per category, in the series color: a light box from q1 to q3, a bold median, whiskers with caps,
  // and the outliers as small dots (they blend with jittered points drawn on top).
  box: (c) => {
    const [x, y, colors] = [c.v("x"), c.v("y"), c.colors(c.theme.muted)]; // gray without a color mapping
    const boxes = [];
    for (const [key, rows] of d3.group(c.index, (i) => x[i])) {
      const stats = boxStats(rows.map((i) => y[i]));
      if (stats.n) boxes.push({ key, color: Array.isArray(colors) ? colors[rows[0]] : colors, ...stats });
    }
    const outliers = boxes.flatMap((b) => b.outliers.map((v) => ({ key: b.key, v, color: b.color })));
    const inset = (share) => ({ insetLeft: c.bandwidth.x * share, insetRight: c.bandwidth.x * share });
    const line = { x: "key", stroke: "color", strokeWidth: 1.25, clip };
    return [
      Plot.ruleX(boxes, { ...line, y1: "q3", y2: "high" }),
      Plot.ruleX(boxes, { ...line, y1: "low", y2: "q1" }),
      Plot.tickY(boxes, { ...line, y: "high", ...inset(0.38) }),
      Plot.tickY(boxes, { ...line, y: "low", ...inset(0.38) }),
      Plot.barY(boxes, { ...line, y1: "q1", y2: "q3", fill: "color", fillOpacity: c.options.alpha ?? 0.3, ...inset(0.22) }),
      Plot.tickY(boxes, { x: "key", y: "median", stroke: c.theme.ink, strokeWidth: 2.25, ...inset(0.22), clip }),
      Plot.dot(outliers, { x: "key", y: "v", fill: "color", r: c.theme.point, clip }),
    ];
  },
};

// Direct labels: the name of each series right of its last point in view, in the series color made readable.
// The labels are outside the frame (in the right margin of the panel), so they are not clipped.
function endLabels(c) {
  const keys = c.groups();
  if (!keys || !c.direct) return [];
  const [x, y, colors] = [c.v("x"), c.v("y"), c.colors(first(c))];
  const [lo, hi] = c.domain.x.map(Number);
  const ends = new Map(); // series → row of its last point in view
  for (const i of c.index) {
    if (x[i] === null || y[i] === null || +x[i] < lo || +x[i] > hi) continue;
    const k = keys[i];
    if (!ends.has(k) || +x[i] > +x[ends.get(k)]) ends.set(k, i);
  }
  const size = c.direct.size;
  const rows = [...ends].map(([k, i]) => {
    const lines = c.direct.lines.get(String(k)) ?? [String(k)];
    return { x: x[i], y: y[i], text: lines.join("\n"), h: lines.length * size * DIRECT.line, color: readable(Array.isArray(colors) ? colors[i] : colors, c.theme.background) };
  });
  return [
    Plot.text(rows, {
      x: "x",
      y: "y",
      text: "text",
      fill: "color",
      fontSize: size,
      lineHeight: DIRECT.line,
      textAnchor: "start",
      dx: size * DIRECT.gap,
      render: spreadY(rows.map((r) => r.h)),
    }),
  ];
}

// Moves labels apart vertically so that they do not overlap, and keeps them inside the panel when there is room.
function spreadY(heights) {
  return (index, scales, values, dimensions, context, next) => {
    const y = Float64Array.from(values.y);
    const [top, bottom] = [dimensions.marginTop, dimensions.height - dimensions.marginBottom];
    const order = [...index].sort((a, b) => y[a] - y[b]);
    const apart = (a, b) => (heights[a] + heights[b]) / 2;
    for (let k = 1; k < order.length; k++) y[order[k]] = Math.max(y[order[k]], y[order[k - 1]] + apart(order[k - 1], order[k]));
    const last = order.at(-1);
    if (last !== undefined) y[last] = Math.min(y[last], bottom - heights[last] / 2);
    for (let k = order.length - 2; k >= 0; k--) y[order[k]] = Math.min(y[order[k]], y[order[k + 1]] - apart(order[k], order[k + 1]));
    const head = order[0];
    if (head !== undefined) y[head] = Math.max(y[head], top + heights[head] / 2);
    for (let k = 1; k < order.length; k++) y[order[k]] = Math.max(y[order[k]], y[order[k - 1]] + apart(order[k - 1], order[k]));
    return next(index, scales, { ...values, y }, dimensions, context);
  };
}

// Overlaid fills are see-through, stacked fills are solid.
function stackAlpha(c, solid = 0.9) {
  return c.options.position === "overlay" ? 0.45 : solid;
}

// Intervals of a fraction of the data resolution (the smallest step between values) around each value.
function spread(values, fraction = 0.5) {
  const nums = values.map(Number);
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const step = d3.min(d3.pairs(sorted), ([a, b]) => b - a) ?? 1;
  const back = values[0] instanceof Date ? (v) => new Date(v) : (v) => v;
  return [nums.map((v) => back(v - step * fraction)), nums.map((v) => back(v + step * fraction))];
}

// Seeded jitter, so that each redraw and each output put the points at the same place.
function jittered(c) {
  const x = c.v("x");
  if (!c.options.jitter || c.kind.x === "category") return x;
  const random = d3.randomUniform.source(d3.randomLcg(42))(-1, 1);
  const [lo] = spread(x, c.options.jitter);
  return x.map((v, i) => +v + (+v - +lo[i]) * random()).map((v) => (x[0] instanceof Date ? new Date(v) : v));
}

// Dodge: moves each row along the category axis by its offset (c.shift, from views.js), as a share of the band.
// Observable Plot centers a band mark with a transform of the group, so the offset adds to the channel values.
function dodgeRender(c) {
  if (!c.shift) return undefined;
  const { axis, frac } = c.shift;
  const step = c.bandwidth[axis];
  const keys = axis === "x" ? ["x", "x1", "x2"] : ["y", "y1", "y2"];
  return (index, scales, values, dimensions, context, next) => {
    const moved = { ...values };
    for (const k of keys) if (values[k]) moved[k] = Float64Array.from(values[k], (v, i) => v + frac[i] * step);
    return next(index, scales, moved, dimensions, context);
  };
}

// Two render transforms in a row: a runs first, then b, then the mark.
function composeRender(a, b) {
  return (index, scales, values, dimensions, context, next) =>
    a(index, scales, values, dimensions, context, (i, s, v, d, ctx) => b(i, s, v, d, ctx, next));
}

function jitterRender(fraction) {
  return (index, scales, values, dimensions, context, next) => {
    const random = d3.randomUniform.source(d3.randomLcg(42))(-1, 1);
    const step = scales.scales.x?.bandwidth ?? 20;
    const x = Float64Array.from(values.x, (v) => v + random() * step * fraction * 0.5);
    return next(index, scales, { ...values, x }, dimensions, context);
  };
}
