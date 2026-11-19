// Validates a spec and adds the defaults. This is the only file that knows the defaults.
// Output: tables, layers with resolved channels ({column} or {value}), facet, scales, labels, info and theme.
import GRAMMAR from "../grammar.json" with { type: "json" };
import { colorOf, colorTokens, resolveTheme } from "./theme.js";

export function normalize(spec, overrides = {}) {
  if (typeof spec?.spec === "function") spec = spec.spec(); // a builder
  if (spec?.version !== 1) throw new Error("plotto: unknown spec version");
  const theme = resolveTheme({ ...spec.theme, ...overrides });
  theme.legendSet = (overrides.legend ?? spec.theme?.legend) != null; // a legend place from the spec, not the default
  const tables = spec.data.map(toTable);
  const layers = spec.layers.map((l) => resolveLayer(l, spec.mapping ?? {}, tables, theme));
  if (!layers.length) throw new Error("plotto: the plot has no layers. Add one, for example .line() or .point()");
  const facet = resolveFacet(spec.facet);
  const coord = spec.coord ?? null;
  let scales = spec.scales ?? {};
  let geoLabels = {};
  if (coord?.type === "geo") {
    // x is the longitude and y the latitude: tick labels in degrees, and no axis titles unless set.
    if (facet && facet.free.x !== facet.free.y) throw new Error('coord("geo"): facet free must be "both" or unset, so that each panel keeps the same distance per px in x and y');
    scales = { ...scales, x: { ...scales.x, degrees: "lon" }, y: { ...scales.y, degrees: "lat" } };
    geoLabels = { x: null, y: null };
  }
  const labels = { ...defaultLabels(layers), ...geoLabels, ...spec.labels };
  const info = spec.info?.entries?.length ? { entries: spec.info.entries, position: spec.info.position ?? "right", set: !!spec.info.position } : null;
  return { tables, layers, facet, scales, labels, info, coord, theme };
}

function toTable({ columns }) {
  const names = Object.keys(columns);
  const n = names.length ? columns[names[0]].values.length : 1;
  return { columns, n };
}

function resolveLayer(layer, plotMapping, tables, theme) {
  const def = GRAMMAR.layers[layer.type];
  if (!def) throw new Error(`plotto: unknown layer type "${layer.type}". Valid: ${Object.keys(GRAMMAR.layers).join(", ")}`);
  const table = layer.data ?? 0;
  const columns = tables[table].columns;
  const channels = {};
  for (const ch of def.channels) {
    if (layer.mapping?.[ch] !== undefined) channels[ch] = { column: layer.mapping[ch] };
    else if (layer.set?.[ch] !== undefined) channels[ch] = { value: layer.set[ch] };
    else if (def.inherit !== false && plotMapping[ch] in columns) channels[ch] = { column: plotMapping[ch] };
  }
  const missing = def.requires.filter((ch) => !channels[ch]);
  if (missing.length) throw new Error(`${layer.type}(): set ${missing.join(" and ")}, as a column name or a value`);
  for (const ch of ["color", "fill"]) {
    if (!channels[ch] || !("value" in channels[ch])) continue;
    const color = colorOf(theme, channels[ch].value);
    if (!color) throw new Error(`${layer.type}(): "${channels[ch].value}" is not a column or a color. Theme colors: ${colorTokens(theme).join(", ")}`);
    channels[ch] = { value: color };
  }
  // Geometry columns go to the geometry channel only, and a polygon draws Polygon and MultiPolygon geometries.
  for (const [ch, c] of Object.entries(channels)) {
    const type = c.column && columns[c.column].type;
    if ((type === "geometry") !== (ch === "geometry")) {
      throw new Error(ch === "geometry" ? `${layer.type}(): geometry must be a geometry column (GeoJSON Polygon or MultiPolygon)` : `${layer.type}(): "${c.column}" is a geometry column; use it as geometry`);
    }
    if (ch === "geometry") {
      const other = columns[c.column].values.find((g) => g && g.type !== "Polygon" && g.type !== "MultiPolygon");
      if (other) throw new Error(`${layer.type}(): geometry must be Polygon or MultiPolygon, not ${other.type}`);
    }
  }
  const options = {};
  for (const opt of def.options) if (layer.set?.[opt] !== undefined) options[opt] = layer.set[opt];
  return { type: layer.type, table, channels, options };
}

function resolveFacet(facet) {
  if (!facet) return null;
  const free = { x: ["x", "both"].includes(facet.free), y: ["y", "both"].includes(facet.free) };
  if (facet.wrap) return { kind: "wrap", by: facet.wrap, ncol: facet.ncol ?? null, free };
  return { kind: "grid", rows: facet.rows ?? null, cols: facet.cols ?? null, free };
}

// Axis and legend titles default to the first mapped column name. Stat layers name their computed y.
function defaultLabels(layers) {
  const first = (names) => {
    for (const l of layers) for (const n of names) if (l.channels[n]?.column) return l.channels[n].column;
    return undefined;
  };
  const stat = layers.find((l) => l.type === "hist" || l.type === "density");
  const y = first(["y", "ymin", "yend"]) ?? (stat ? (stat.type === "density" || stat.options.density ? "density" : "count") : undefined);
  return { x: first(["x", "xmin", "xend"]), y, color: first(["color"]), fill: first(["fill"]) };
}
