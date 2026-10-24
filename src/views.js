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
  if (cols !== raw) source = null;
  const view = { cols, n: cols === raw ? n : sizeOf(cols), rows: source };
  view.hover = hoverOf(ns, layer, view);
  return view;
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
    default:
      return null;
  }
}
