// Views: the data that one layer draws in one panel, after its statistic (summary, stack, bins, density, smooth).
// A view has columns named like the channels (x, y, ymin, ...), and the hover anchor and fields of each row.
import { channelValues } from "./scales.js";
import { barIntervals, bin, binEdges, density, position, smooth, summarize } from "./stats.js";

// Bin edges of each hist layer, shared by all panels and colors.
export function layerEdges(ns) {
  return ns.layers.map((layer) => {
    if (layer.type !== "hist" || !layer.channels.x.column) return null;
    return binEdges(ns.tables[layer.table].columns[layer.channels.x.column].values, layer.options.bins ?? 30);
  });
}

// The view of one layer for the given source rows. hidden: the color values that the legend switched off.
export function makeView(ctx, layer, rows, hidden) {
  const { ns, kind, colorLevels, edges } = ctx;
  if (hidden.size && layer.channels.color?.column) {
    const values = ns.tables[layer.table].columns[layer.channels.color.column].values;
    rows = rows.filter((r) => !hidden.has(values[r]));
  }
  const raw = {};
  for (const ch of Object.keys(layer.channels)) raw[ch] = channelValues(ns, layer, ch, rows);
  const n = rows.length;
  const o = layer.options;
  const stacked = (cols, m, mode) => position(cols, m, mode, colorLevels);
  const sizeOf = (cols) => cols.x?.length ?? 0;
  let cols = raw;
  let source = rows;

  if (o.summary && (layer.type === "line" || layer.type === "point")) cols = summarize(raw, n, o.summary);
  else if (layer.type === "bar") {
    cols = stacked(raw, n, o.position ?? "stack");
    if (kind.x !== "category") cols = barIntervals(cols, n);
  } else if (layer.type === "area") cols = stacked(raw, n, o.position ?? "stack");
  else if (layer.type === "hist") {
    const b = bin(raw, n, edges[ns.layers.indexOf(layer)], o.density);
    cols = stacked(b, sizeOf(b), o.position ?? "stack");
  } else if (layer.type === "density") cols = density(raw, n);
  else if (layer.type === "smooth") cols = smooth(raw, n, o);
  else if (layer.type === "polygon") cols = { ...raw, ...bounds(raw.geometry) };
  const derived = cols !== raw && layer.type !== "polygon"; // a statistic makes new rows; a polygon keeps its rows
  if (derived) source = null;
  const view = { cols, n: derived ? sizeOf(cols) : n, rows: source };
  if (o.position === "dodge" && DODGE.includes(layer.type)) view.shift = dodgeShift(ctx, layer, cols, view.n);
  view.hover = hoverOf(ns, layer, view);
  return view;
}

const DODGE = ["point", "segment", "errorbar"]; // bar dodges with its stack (stats.js)

// Dodge of point, segment and errorbar: each color gets a slot of the category band, in the legend order of all
// the colors of the plot, so a color has the same place in every category, panel and layer, and a hidden color
// leaves its slot empty. Returns { axis, frac }: the offset of each row, as a share of the bandwidth.
function dodgeShift({ kind, colorLevels, colorKind }, layer, cols, n) {
  const where = `${layer.type}()`;
  const axis = kind.x === "category" ? "x" : kind.y === "category" && layer.type !== "errorbar" ? "y" : null;
  if (!axis) throw new Error(`${where}: dodge needs a category ${layer.type === "errorbar" ? "x" : "x or y"} axis`);
  if (!layer.channels.color?.column) return { axis, frac: new Array(n).fill(0) };
  if (colorKind !== "ordinal") throw new Error(`${where}: dodge needs color mapped to a category column`);
  const slots = colorLevels.length;
  return { axis, frac: Array.from({ length: n }, (_, i) => (colorLevels.indexOf(cols.color[i]) + 0.5) / slots - 0.5), slots };
}

// The bounding box of each geometry (xmin, xmax, ymin, ymax), which trains the axis domains.
// A geometry object keeps its box, so a redraw (legend click) does not compute it again.
const BOXES = new WeakMap();
function bounds(geometries) {
  const out = { xmin: [], xmax: [], ymin: [], ymax: [] };
  for (const g of geometries) {
    if (g && !BOXES.has(g)) {
      let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
      const walk = (c) => {
        if (typeof c[0] === "number") [x0, x1, y0, y1] = [Math.min(x0, c[0]), Math.max(x1, c[0]), Math.min(y0, c[1]), Math.max(y1, c[1])];
        else for (const part of c) walk(part);
      };
      walk(g.coordinates);
      BOXES.set(g, x0 <= x1 ? [x0, x1, y0, y1] : [null, null, null, null]);
    }
    const [x0, x1, y0, y1] = g ? BOXES.get(g) : [null, null, null, null];
    out.xmin.push(x0), out.xmax.push(x1), out.ymin.push(y0), out.ymax.push(y1);
  }
  return out;
}

// The hover anchor (hx, hy) and the label fields of a view, or null for layers without hover.
function hoverOf(ns, layer, { cols, rows }) {
  // A removed axis title (null) still names the hover row: by the column, or by the channel.
  const X = ns.labels.x || layer.channels.x?.column || "x";
  const Y = ns.labels.y || layer.channels.y?.column || "y";
  const field = (label, axis, values, values2) => ({ label, axis, values, values2 });
  const xField = field(X, "x", cols.x);
  const tooltip = layer.channels.tooltip?.column && rows ? [field(layer.channels.tooltip.column, null, cols.tooltip)] : [];
  switch (layer.type) {
    case "line":
    case "path":
    case "step":
    case "point":
      return { hx: cols.x, hy: cols.y, fields: [xField, field(Y, "y", cols.y), ...tooltip] };
    case "bar":
    case "area":
      return { hx: cols.x, hy: cols.ymax, fields: [xField, field(Y, "y", cols.value), ...tooltip] };
    case "hist":
      return { hx: cols.x, hy: cols.ymax, fields: [field(X, "x", cols.xmin, cols.xmax), field(layer.options.density ? "density" : "count", null, cols.value)] };
    case "density":
      return { hx: cols.x, hy: cols.y, fields: [xField, field("density", null, cols.y)] };
    case "smooth": {
      const band = cols.ymin.some((v) => v !== null) ? [field("95% CI", "y", cols.ymin, cols.ymax)] : [];
      return { hx: cols.x, hy: cols.y, fields: [xField, field(Y, "y", cols.y), ...band] };
    }
    case "ribbon":
      return { hx: cols.x, hy: cols.ymax, fields: [xField, field(Y, "y", cols.ymin, cols.ymax)] };
    case "errorbar":
      return { hx: cols.x, hy: cols.ymax, fields: [xField, field(Y, "y", cols.ymin, cols.ymax)] };
    case "tile": {
      const value = layer.channels.color?.column ? [field(ns.labels.color ?? "value", null, cols.color)] : [];
      return { hx: cols.x, hy: cols.y, fields: [xField, field(Y, "y", cols.y), ...value, ...tooltip], tile: true };
    }
    case "box":
      return { hx: cols.x, hy: cols.y, fields: [xField, field(Y, "y", cols.y)] };
    case "polygon": {
      const value = (ch) => (layer.channels[ch]?.column ? [field(ns.labels[ch] ?? layer.channels[ch].column, null, cols[ch])] : []);
      return { fields: [...value("fill"), ...value("color")], header: tooltip[0] ?? null, polygon: true };
    }
    default:
      return null;
  }
}
