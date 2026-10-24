// Figure: computes the views, scales and layout, then draws the title, strips, legend and panels as one SVG.
// Observable Plot draws each panel. drawPanels() draws them again after a zoom or a legend click.
import * as Plot from "@observablehq/plot";
import * as d3 from "d3";
import { facetPanels } from "./facets.js";
import { LAYERS } from "./layers.js";
import { drawLegend, legendModel } from "./legend.js";
import { place, TICK } from "./layout.js";
import { AXIS_CHANNELS, axisKind, colorScale, ticks, trainDomain } from "./scales.js";
import { normalize } from "./spec.js";
import { svgElement, svgText } from "./svg.js";
import { fontSizes } from "./theme.js";
import { layerEdges, makeView } from "./views.js";

const NARROW = 560; // px: below this width, a right legend moves to the bottom
const MIN_HEIGHT = 240; // px: the smallest height of a reflowed figure

// options: document (the browser or jsdom), width (lay out at this width), domains and hidden (keep a view after a resize).
export function figure(spec, { document: doc = globalThis.document, width, domains, hidden = new Set() } = {}) {
  const ns = normalize(spec);
  const theme = ns.theme;
  const W = Math.round(width ?? theme.width);
  const reflowed = width && theme.reflow && !theme.fixedHeight;
  const H = reflowed ? Math.max(MIN_HEIGHT, Math.round((W * theme.height) / theme.width)) : theme.height;
  if (theme.legend === "right" && W < NARROW) theme.legend = "bottom";
  const fonts = fontSizes(theme);
  const grid = facetPanels(ns);
  const kind = { x: axisKind(ns, "x"), y: axisKind(ns, "y") };
  const color = colorScale(ns);
  const ctx = { ns, kind, colorLevels: color.domain ?? [], edges: layerEdges(ns) };
  for (const p of grid.panels) p.views = ns.layers.map((layer, li) => makeView(ctx, layer, p.rows[li], new Set()));
  const home = homeDomains(ns, grid, kind);
  const horizontal = theme.legend === "bottom";
  const legend = legendModel(ns, color, fonts, { horizontal, maxWidth: W * 0.9, maxHeight: H * 0.8 });
  const layout = place({ ns, grid, kind, home, legend, fonts, W, H });

  const svg = svgElement(doc, "svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: W,
    height: H,
    viewBox: `0 0 ${W} ${H}`,
    "font-family": theme.font,
    "font-size": fonts.base,
    style: `color:${theme.ink}`,
  });
  svg.append(svgElement(doc, "rect", { width: W, height: H, fill: theme.background }));
  for (const t of layout.texts) svg.append(svgText(doc, t.text, t.attrs));
  for (const s of layout.strips) svg.append(strip(doc, s, theme, fonts));
  const state = { spec, ns, doc, svg, theme, fonts, grid, kind, color, ctx, legend, layout, home, W, H };
  state.domains = domains ?? home;
  state.hidden = hidden;
  state.panelLayer = svg.appendChild(svgElement(doc, "g", { class: "pt-panels" }));
  if (legend) state.legendG = svg.appendChild(placedLegend(state));
  drawPanels(state);
  return state;
}

export function toSVG(spec, options) {
  return figure(spec, options).svg.outerHTML;
}

// Draws every panel with state.domains and state.hidden (the legend values that are switched off).
export function drawPanels(state) {
  const { ns, grid, ctx, hidden } = state;
  if (hidden.size || state.filtered) {
    for (const p of grid.panels) p.views = ns.layers.map((layer, li) => makeView(ctx, layer, p.rows[li], hidden));
    state.filtered = hidden.size > 0;
  }
  state.panelLayer.replaceChildren();
  state.panels = grid.panels.map((p, i) => drawPanel(state, p, i));
  if (state.legendG) state.legendG.replaceWith((state.legendG = placedLegend(state)));
}

function placedLegend(state) {
  const g = drawLegend(state.doc, state.legend, state.theme, state.fonts, state.hidden);
  g.setAttribute("transform", `translate(${state.layout.legend.x},${state.layout.legend.y})`);
  return g;
}

function drawPanel(state, p, i) {
  const { ns, doc, theme, fonts, kind, color } = state;
  const box = state.layout.panels[i];
  const domain = { x: plotDomain(kind.x, state.domains[i].x), y: plotDomain(kind.y, state.domains[i].y) };
  const bandwidth = { x: kind.x === "category" ? (box.innerW / (domain.x.length + 0.2)) * 0.8 : 0 };
  const layers = ns.layers.map((layer, li) => {
    const view = p.views[li];
    const c = context({ view, layer, kind, color, theme, fonts, domain, bandwidth });
    return { layer, view, c, marks: view.n ? LAYERS[layer.type](c) : [] };
  });
  const axis = (k) => {
    const t = ticks(kind[k], state.domains[i][k], box.count[k], ns.scales[k]?.format);
    const inside = (v) => kind[k] === "category" || (+v >= +domain[k][0] && +v <= +domain[k][1]);
    return { major: t.major.filter(inside), minor: t.minor, format: t.format };
  };
  const ax = axis("x");
  const ay = axis("y");
  const gridStyle = (minor) => ({ stroke: minor ? theme.gridMinor : theme.grid, strokeOpacity: 1, strokeWidth: minor ? 0.6 : 0.9 });
  const axisStyle = { tickSize: TICK.size, tickPadding: TICK.padding, fontSize: fonts.tick, stroke: theme.tick, fill: theme.muted, label: null };
  const marks = [];
  if (kind.x !== "category") marks.push(Plot.gridX(ax.minor, gridStyle(true)), Plot.gridX(ax.major, gridStyle(false)));
  if (kind.y !== "category") marks.push(Plot.gridY(ay.minor, gridStyle(true)), Plot.gridY(ay.major, gridStyle(false)));
  marks.push(...layers.flatMap((l) => l.marks));
  if (box.showX) {
    const rotate = box.rotateX ? { tickRotate: -40, textAnchor: "end" } : {};
    marks.push(Plot.axisX(ax.major, { ...axisStyle, ...rotate, anchor: "bottom", tickFormat: ax.format }));
  }
  if (box.showY) marks.push(Plot.axisY(ay.major, { ...axisStyle, anchor: "left", tickFormat: ay.format }));
  const plot = Plot.plot({
    document: doc,
    width: box.w,
    height: box.h,
    marginLeft: box.ml,
    marginRight: 0,
    marginTop: 0,
    marginBottom: box.mb,
    x: scaleOptions(kind.x, domain.x),
    y: scaleOptions(kind.y, domain.y),
    color: { type: "identity" },
    marks,
  });
  const g = svgElement(doc, "g", { class: "pt-panel", "data-panel": i, transform: `translate(${box.x},${box.y})`, fill: "currentColor", "text-anchor": "middle" });
  for (const child of [...plot.childNodes]) if (child.nodeName.toLowerCase() !== "style") g.append(child);
  state.panelLayer.append(g);
  return { g, plot, box, layers };
}

// Channel accessors of one layer view in one panel, for layers.js. Time values become Date objects.
function context({ view, layer, kind, color, theme, fonts, domain, bandwidth }) {
  const axisOf = (ch) => (AXIS_CHANNELS.x.includes(ch) ? "x" : AXIS_CHANNELS.y.includes(ch) ? "y" : null);
  const cache = {};
  const v = (ch) => {
    if (ch in cache) return cache[ch];
    let values = view.cols[ch];
    if (values && kind[axisOf(ch)] === "time") values = values.map((t) => (t === null ? null : new Date(t)));
    return (cache[ch] = values);
  };
  const colorCh = layer.channels.color;
  return {
    index: d3.range(view.n),
    v,
    options: layer.options,
    colors: (fallback) => (!colorCh ? fallback : "value" in colorCh ? colorCh.value : v("color").map(color.apply)),
    groups: () => v("group") ?? (colorCh?.column ? v("color") : undefined),
    kind,
    theme,
    fonts,
    domain,
    bandwidth,
  };
}

function plotDomain(kind, d) {
  return kind === "time" ? d.map((t) => new Date(t)) : d;
}

function scaleOptions(kind, domain) {
  const type = { linear: "linear", log: "log", time: "utc", category: "band" }[kind];
  return { type, domain, axis: null, ...(kind === "category" ? { padding: 0.2, round: false } : {}) };
}

// The first view of each panel. A free axis has one domain per panel (wrap) or per row or column (grid).
function homeDomains(ns, grid, kind) {
  const free = ns.facet?.free ?? { x: false, y: false };
  const groupOf = (axis, p, i) => (!free[axis] ? "all" : grid.kind === "grid" ? (axis === "x" ? `c${p.col}` : `r${p.row}`) : `p${i}`);
  const domains = grid.panels.map(() => ({}));
  for (const axis of ["x", "y"]) {
    const groups = d3.group(grid.panels.map((p, i) => [p, i]), ([p, i]) => groupOf(axis, p, i));
    for (const members of groups.values()) {
      const d = homeDomain(ns, axis, kind[axis], members.map(([p]) => p));
      for (const [, i] of members) domains[i][axis] = d;
    }
  }
  return domains;
}

// Set limits win; a null bound (or no limits) takes the trained bound, with its 5% space.
// On a category axis, the limits are the categories and their order.
function homeDomain(ns, axis, kind, panels) {
  const limits = ns.scales[axis]?.limits;
  if (limits && (kind === "category" || limits.every((v) => v !== null))) return limits;
  const trained = trainDomain(ns, axis, kind, panels);
  return limits ? [limits[0] ?? trained[0], limits[1] ?? trained[1]] : trained;
}

function strip(doc, s, theme, fonts) {
  const g = svgElement(doc, "g", { class: "pt-strip" });
  g.append(svgElement(doc, "rect", { x: s.x, y: s.y, width: s.w, height: s.h, fill: theme.strip }));
  const attrs = s.vertical
    ? { transform: `translate(${s.x + s.w / 2},${s.y + s.h / 2}) rotate(90)`, dy: "0.35em" }
    : { x: s.x + s.w / 2, y: s.y + s.h / 2, dy: "0.35em" };
  const text = svgText(doc, s.text, { ...attrs, "text-anchor": "middle", "font-weight": "bold", "font-size": fonts.strip, fill: theme.ink });
  if (s.text !== String(s.full)) text.append(svgText(doc, s.full, {}, "title"));
  g.append(text);
  return g;
}
