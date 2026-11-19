// Chainable plot builder. Each method returns a new builder and never changes the old one.
// .spec() returns the JSON spec (SPEC.md). python/plotto/plot.py has the same methods and rules.
import GRAMMAR from "../grammar.json" with { type: "json" };
import THEMES from "../theme.json" with { type: "json" };


const LAYERS = GRAMMAR.layers;
const PLOT_CHANNELS = [...new Set(Object.values(LAYERS).flatMap((l) => l.channels))];
const NO_STACK = ["point", "segment", "errorbar"]; // layers that dodge but do not stack

export function plot(rows, mapping = {}) {
  const data = [toTable(rows, "plot()")];
  for (const [ch, col] of Object.entries(mapping)) {
    if (!PLOT_CHANNELS.includes(ch)) fail("plot()", "channel", ch, PLOT_CHANNELS);
    needColumn(data[0], col, "plot()");
  }
  return new Builder({ data, mapping, layers: [], facet: null, scales: {}, labels: {}, info: null, coord: null, insets: [], theme: { style: "pastel" } });
}

class Builder {
  #s;
  constructor(state) {
    this.#s = state;
  }

  #with(changes) {
    return new Builder({ ...this.#s, ...changes });
  }

  #layer(type, options = {}) {
    const def = LAYERS[type];
    const where = `${type}()`;
    let { data, ...rest } = options;
    let tables = this.#s.data;
    let index = 0;
    if (data !== undefined) {
      tables = [...tables, toTable(data, where)];
      index = tables.length - 1;
    }
    const columns = tables[index].columns;
    const layer = { type, mapping: {}, set: {} };
    if (index) layer.data = index;
    for (const [key, value] of Object.entries(rest)) {
      if (def.channels.includes(key) && typeof value === "string" && value in columns) layer.mapping[key] = value;
      else if (def.channels.includes(key) || def.options.includes(key)) layer.set[key] = constant(key, value, where, columns);
      else fail(where, "option", key, ["data", ...def.channels, ...def.options]);
    }
    if (layer.set.position === "stack" && NO_STACK.includes(type)) throw new Error(`${where}: position must be overlay or dodge`);
    // A polygon takes the column named "geometry" (a GeoJSON or GeoDataFrame table) unless a mapping sets it.
    if (type === "polygon" && !layer.mapping.geometry && !(this.#s.mapping.geometry in columns) && "geometry" in columns) layer.mapping.geometry = "geometry";
    return this.#with({ data: tables, layers: [...this.#s.layers, layer] });
  }

  line(options) { return this.#layer("line", options); }
  step(options) { return this.#layer("step", options); }
  bar(options) { return this.#layer("bar", options); }
  hist(options) { return this.#layer("hist", options); }
  density(options) { return this.#layer("density", options); }
  area(options) { return this.#layer("area", options); }
  ribbon(options) { return this.#layer("ribbon", options); }
  smooth(options) { return this.#layer("smooth", options); }
  path(options) { return this.#layer("path", options); }
  point(options) { return this.#layer("point", options); }
  hline(options) { return this.#layer("hline", options); }
  vline(options) { return this.#layer("vline", options); }
  abline(options) { return this.#layer("abline", options); }
  segment(options) { return this.#layer("segment", options); }
  rect(options) { return this.#layer("rect", options); }
  band(options) { return this.#layer("band", options); }
  tile(options) { return this.#layer("tile", options); }
  text(options) { return this.#layer("text", options); }
  errorbar(options) { return this.#layer("errorbar", options); }
  box(options) { return this.#layer("box", options); }
  polygon(options) { return this.#layer("polygon", options); }
  raster(options) { return this.#layer("raster", options); }

  facet(by, options = {}) {
    needColumn(this.#s.data[0], by, "facet()");
    checkKeys(options, GRAMMAR.facet, "facet()");
    checkFree(options.free, "facet()");
    return this.#with({ facet: { wrap: by, free: options.free ?? null, ncol: options.ncol ?? null } });
  }

  grid({ rows = null, cols = null, ...options } = {}) {
    if (rows === null && cols === null) throw new Error("grid(): set rows, cols or both");
    for (const col of [rows, cols]) if (col !== null) needColumn(this.#s.data[0], col, "grid()");
    checkKeys(options, GRAMMAR.grid, "grid()");
    checkFree(options.free, "grid()");
    return this.#with({ facet: { rows, cols, free: options.free ?? null } });
  }

  x(options) { return this.#scale("x", options); }
  y(options) { return this.#scale("y", options); }
  color(options) { return this.#scale("color", options); }
  fill(options) { return this.#scale("fill", options); }

  #scale(name, options = {}) {
    const where = `${name}()`;
    checkKeys(options, GRAMMAR.scales[name], where);
    if (options.type !== undefined && !GRAMMAR.scaleTypes.includes(options.type)) fail(where, "type", options.type, GRAMMAR.scaleTypes);
    if (options.palette !== undefined && !Array.isArray(options.palette) && !(options.palette in THEMES.palettes)) fail(where, "palette", options.palette, Object.keys(THEMES.palettes));
    if (options.mid !== undefined && typeof options.mid !== "number") throw new Error(`${where}: mid must be a number`);
    const scale = { ...options };
    if (scale.limits) {
      if (!Array.isArray(scale.limits)) throw new Error(`${where}: limits must be a list, for example [0, 10] or [0, null]`);
      scale.limits = scale.limits.map((v) => (v === null || v === undefined ? null : toValue(v)));
    }
    if (scale.breaks !== undefined) {
      if (!Array.isArray(scale.breaks) || !scale.breaks.every((v) => typeof v === "number" || v instanceof Date)) {
        throw new Error(`${where}: breaks must be a list of numbers or dates, for example [1, 2, 5, 10]`);
      }
      scale.breaks = scale.breaks.map(toValue);
    }
    if (scale.labels !== undefined) {
      if (scale.breaks === undefined) throw new Error(`${where}: labels need breaks: one label per break`);
      if (!Array.isArray(scale.labels) || scale.labels.length !== scale.breaks.length || !scale.labels.every((l) => typeof l === "string")) {
        throw new Error(`${where}: labels must have one entry per break, as strings`);
      }
    }
    if (scale.breaks !== undefined && (name === "color" || name === "fill")) checkClasses(scale, where);
    return this.#with({ scales: { ...this.#s.scales, [name]: scale } });
  }

  // Map coordinates: coord("geo") makes x (longitude) and y (latitude) the same distance per px.
  // scalebar, north: true (the default corner) or a corner, for a scale bar and a north arrow.
  coord(type, options = {}) {
    if (!GRAMMAR.coord.includes(type)) fail("coord()", "type", type, GRAMMAR.coord);
    checkKeys(options, GRAMMAR.coordOptions, "coord()");
    const coord = { type };
    for (const [key, corner] of [["scalebar", "bottom-left"], ["north", "top-right"]]) {
      const v = options[key];
      if (v === undefined || v === null || v === false) continue;
      if (v !== true && !GRAMMAR.corners.includes(v)) fail("coord()", key, v, ["true", ...GRAMMAR.corners]);
      coord[key] = v === true ? corner : v;
    }
    return this.#with({ coord });
  }

  // An inset: the panel area at (left, bottom, right, top shares of the panel) shows the extent x × y, for example
  // the Okinawa islands on a map of Japan. Each call adds one inset.
  inset(options = {}) {
    checkKeys(options, GRAMMAR.inset, "inset()");
    const { x, y, at } = options;
    for (const [name, v] of [["x", x], ["y", y]]) {
      if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" || n instanceof Date) || +v[0] >= +v[1]) {
        throw new Error(`inset(): ${name} must be [low, high], for example [122.9, 131.4]`);
      }
    }
    if (!Array.isArray(at) || at.length !== 4 || !at.every((n) => typeof n === "number" && n >= 0 && n <= 1) || at[0] >= at[2] || at[1] >= at[3]) {
      throw new Error("inset(): at must be [left, bottom, right, top] as shares of the panel (0 to 1), for example [0.02, 0.6, 0.3, 0.98]");
    }
    return this.#with({ insets: [...this.#s.insets, { x: x.map(toValue), y: y.map(toValue), at: at.map(toValue) }] });
  }

  labels(options = {}) {
    checkKeys(options, GRAMMAR.labels, "labels()");
    return this.#with({ labels: { ...this.#s.labels, ...options } });
  }

  // A key/value table about the data or the experiment: info({ location: "hayama" }, { position: "right" }). null removes it.
  info(entries, options = {}) {
    checkKeys(options, GRAMMAR.info, "info()");
    const { position } = options;
    if (position !== undefined && !GRAMMAR.infoPosition.includes(position)) fail("info()", "position", position, GRAMMAR.infoPosition);
    if (entries === null || entries === undefined) return this.#with({ info: null });
    const pairs = Array.isArray(entries) ? entries : typeof entries === "object" ? Object.entries(entries) : null;
    if (!pairs) throw new Error("info(): entries must be an object or a list of [key, value] pairs");
    return this.#with({ info: { entries: pairs.map((pair) => infoEntry(pair)), ...(position ? { position } : {}) } });
  }

  theme(style = "pastel", options = {}) {
    checkKeys(options, GRAMMAR.theme, "theme()");
    if (!(style in THEMES.styles)) fail("theme()", "style", style, Object.keys(THEMES.styles));
    if (options.format !== undefined && !(options.format in THEMES.formats)) fail("theme()", "format", options.format, Object.keys(THEMES.formats));
    if (options.legend !== undefined && !GRAMMAR.legend.includes(options.legend)) fail("theme()", "legend", options.legend, GRAMMAR.legend);
    if (options.aspect != null && !(typeof options.aspect === "number" && options.aspect > 0)) throw new Error("theme(): aspect must be a positive number (panel height / width), for example 1 for square panels");
    return this.#with({ theme: { style, ...options } });
  }

  // The JSON spec. Each table keeps only the columns that a mapping or a facet uses.
  spec() {
    const s = this.#s;
    const used = s.data.map(() => new Set());
    for (const col of Object.values(s.mapping)) used.forEach((set, i) => col in s.data[i].columns && set.add(col));
    for (const layer of s.layers) for (const col of Object.values(layer.mapping)) used[layer.data ?? 0].add(col);
    for (const col of [s.facet?.wrap, s.facet?.rows, s.facet?.cols]) {
      if (col) used.forEach((set, i) => col in s.data[i].columns && set.add(col));
    }
    const data = s.data.map((t, i) => ({ columns: Object.fromEntries([...used[i]].map((c) => [c, t.columns[c]])) }));
    return { version: 1, data, mapping: s.mapping, layers: s.layers, facet: s.facet, scales: s.scales, labels: s.labels, ...(s.info ? { info: s.info } : {}), ...(s.coord ? { coord: s.coord } : {}), ...(s.insets.length ? { insets: s.insets } : {}), theme: s.theme };
  }
}

// Rows (array of objects) to columnar data with one type per column: number, time, string or geometry.
// A GeoJSON FeatureCollection gives one row per feature: its properties and its geometry (column "geometry").
function toTable(rows, where) {
  if (rows?.type === "FeatureCollection" && Array.isArray(rows.features)) rows = rows.features.map((f) => ({ ...f.properties, geometry: f.geometry }));
  if (!Array.isArray(rows)) throw new Error(`${where}: data must be an array of row objects or a GeoJSON FeatureCollection`);
  const names = [...new Set(rows.flatMap(Object.keys))];
  const columns = {};
  for (const name of names) {
    const raw = rows.map((r) => r[name] ?? null);
    const first = raw.find((v) => v !== null && !Number.isNaN(v));
    if (isGeometry(first)) {
      columns[name] = { type: "geometry", values: raw.map((v) => (v === null ? null : geometry(v))) };
      continue;
    }
    const type = first instanceof Date ? "time" : typeof first === "number" ? "number" : "string";
    const values = raw.map((v) => (v === null || Number.isNaN(v) ? null : type === "string" ? String(v) : toValue(v)));
    columns[name] = { type, values };
  }
  return { columns };
}

// A GeoJSON geometry object: { type, coordinates }.
function isGeometry(v) {
  return typeof v === "object" && v !== null && typeof v.type === "string" && Array.isArray(v.coordinates);
}

// A geometry with its coordinates rounded to GEO_DIGITS decimals (about 1 m in degrees).
const GEO_DIGITS = 1e5;
function geometry({ type, coordinates }) {
  const round = (c) => (typeof c === "number" ? Math.round(c * GEO_DIGITS) / GEO_DIGITS : c.map(round));
  return { type, coordinates: round(coordinates) };
}

// Dates become wall-clock epoch ms (the time that the clock shows); floats keep 6 significant digits.
function toValue(v) {
  if (v instanceof Date) return v.getTime() - v.getTimezoneOffset() * 60000;
  if (typeof v === "number" && !Number.isInteger(v)) return Number(v.toPrecision(6));
  return v;
}

function constant(key, value, where, columns) {
  const kind = GRAMMAR.options[key];
  if (key === "tooltip" || key === "group") throw new Error(`${where}: ${key} must be a column. Columns: ${Object.keys(columns).join(", ")}`);
  if (Array.isArray(kind) && !kind.includes(value)) fail(where, key, value, kind);
  if (kind === "number" && typeof value !== "number") throw new Error(`${where}: ${key} must be a number`);
  if (kind === "boolean" && typeof value !== "boolean") throw new Error(`${where}: ${key} must be true or false`);
  if (key === "color" || key === "fill" || key === "label") return value; // spec.js validates the color against the theme
  if (typeof value === "string" && !kind) throw new Error(`${where}: "${value}" is not a column. Columns: ${Object.keys(columns).join(", ")}`);
  return toValue(value);
}

// One [key, value] entry of info(). Numbers keep 6 significant digits; the renderer writes the value as text.
function infoEntry(pair) {
  if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") throw new Error("info(): each entry must be a [key, value] pair with a string key");
  const [key, value] = pair;
  if (value === null || value === undefined || (typeof value === "number" && Number.isNaN(value))) return [key, null];
  if (!["string", "number", "boolean"].includes(typeof value)) throw new Error(`info(): the value of "${key}" must be a string, a number, a boolean or null. Format other values as a string`);
  return [key, toValue(value)];
}

// A binned color scale: breaks that increase, colors (a list) of one per class, and no mid.
function checkClasses(scale, where) {
  if (scale.breaks.some((v, i) => i && v <= scale.breaks[i - 1])) throw new Error(`${where}: breaks must increase`);
  if (scale.mid !== undefined) throw new Error(`${where}: mid does not apply with breaks`);
  if (scale.values !== undefined && (!Array.isArray(scale.values) || scale.values.length !== scale.breaks.length)) {
    throw new Error(`${where}: with breaks, values must be a list of one color per break (class)`);
  }
}

function needColumn(table, col, where) {
  if (!(col in table.columns)) throw new Error(`${where}: "${col}" is not a column. Columns: ${Object.keys(table.columns).join(", ")}`);
}

function checkKeys(options, valid, where) {
  for (const key of Object.keys(options)) if (!valid.includes(key)) fail(where, "option", key, valid);
}

function checkFree(free, where) {
  if (free != null && !GRAMMAR.free.includes(free)) fail(where, "free", free, GRAMMAR.free);
}

function fail(where, what, value, valid) {
  throw new Error(`${where}: unknown ${what} "${value}". Valid: ${valid.join(", ")}`);
}
