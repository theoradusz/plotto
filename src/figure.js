// Figure: computes the views, scales and layout, then draws the title, info table, strips, legend and panels as one SVG.
// Observable Plot draws each panel. drawPanels() draws them again after a zoom or a legend click.
import * as Plot from "@observablehq/plot";
import * as d3 from "d3";
import { facetPanels } from "./facets.js";
import { drawInfo, infoModel } from "./info.js";
import { LAYERS } from "./layers.js";
import { drawLegend, legendsModel } from "./legend.js";
import { directModel, LINE, place, TICK } from "./layout.js";
import { AXIS_CHANNELS, axisKind, colorScale, equalize, geoAspect, ticks, trainDomain } from "./scales.js";
import { normalize } from "./spec.js";
import { svgElement, svgText } from "./svg.js";
import { fontSizes } from "./theme.js";
import { layerEdges, makeView } from "./views.js";

const NARROW = 560; // px: below this width, a right legend moves to the bottom
const MIN_HEIGHT = 240; // px: the smallest height of a reflowed figure
const ASPECT_GROWTH = 1.2; // a theme aspect makes a reflowed figure at most this much taller
const SHRINK_STEP = 0.05; // a format with "shrink" tries the legend and info text smaller by this share at each step
const ROOM_TOLERANCE = 0.2;
const MIN_SHAPE = 0.3; // a panel flatter than this (height / width) gets nothing from more width: it does not count // it keeps the largest text whose panel area is at most this share below the best layout

// options: document (the browser or jsdom), width (lay out at this width), domains and hidden (keep a view after a resize).
export function figure(spec, { document: doc = globalThis.document, width, domains, hidden = new Set() } = {}) {
  const ns = normalize(spec);
  const theme = ns.theme;
  const W = Math.round(width ?? theme.width);
  const reflowed = width && theme.reflow && !theme.fixedHeight;
  let H = reflowed ? Math.max(MIN_HEIGHT, Math.round((W * theme.height) / theme.width)) : theme.height;
  if (theme.legend === "right" && W < NARROW) theme.legend = "bottom";
  const grid = facetPanels(ns);
  const kind = { x: axisKind(ns, "x"), y: axisKind(ns, "y") };
  const geo = ns.coord?.type === "geo";
  if (geo && (kind.x !== "linear" || kind.y !== "linear")) throw new Error('coord("geo"): x and y must be number axes (longitude and latitude), not log, time or category');
  const color = colorScale(ns);
  const fill = colorScale(ns, "fill");
  const ctx = { ns, kind, colorLevels: color.domain ?? [], colorKind: color.kind, edges: layerEdges(ns) };
  for (const p of grid.panels) p.views = ns.layers.map((layer, li) => makeView(ctx, layer, p.rows[li], new Set()));
  const home = homeDomains(ns, grid, kind);
  const direct = directModel(ns, fontSizes(theme).tick, W);
  // A map: the panels take the shape of the map at equal distance per px (the median shape when the panels have their
  // own extent), unless theme(aspect=) sets it. Each panel then grows its extent on one side to fill its box.
  if (geo && !theme.aspect) theme.aspect = d3.median(home, geoAspect);
  // One layout: the place of the legend and of the info card (right or bottom), and their text size (share k).
  // cut counts what does not show well: legend labels and info keys with an ellipsis, a second legend column,
  // the "+N more" entries of the info card.
  const arrange = (H, where, k) => {
    const base = fontSizes(theme);
    const f = { ...base, legend: Math.round(base.legend * k * 10) / 10 };
    const info = infoModel(ns, f, { W, H, narrow: W < NARROW, place: where.info });
    const above = info?.position === "right" ? info.height + f.base : 0; // the info card sits above a right legend
    const legend = legendsModel(ns, [color, fill], f, { horizontal: where.legend === "bottom", maxWidth: W * 0.9, maxHeight: H * 0.8 - above });
    const layout = place({ ns, grid, kind, home, legend, info, direct, fonts: f, W, H });
    const items = legend?.kind === "stack" ? legend.parts.flatMap((part) => part.model.items ?? []) : (legend?.items ?? []);
    const cut = items.filter((it) => it.lines.at(-1).endsWith("…")).length + (items.some((it) => !legend.horizontal && it.x > 0) ? 1 : 0) + (info?.cut ?? 0);
    const p = layout.panels[0];
    const usual = where.legend === theme.legend && where.info === ns.info?.position; // the places of the theme and spec
    return { fonts: f, info, legend, layout, k, cut, usual, area: Math.min(p.innerW, p.innerH / MIN_SHAPE) * p.innerH };
  };
  // The layout to draw. A screen plot keeps the places of the theme and the text size. A fixed size (slide, report,
  // a set height) also tries the legend and the info card on the right and at the bottom, unless the spec sets
  // their place; a format with "shrink" (slide) also tries smaller text, down to that share. Of the layouts that cut
  // the least and whose panel area is at most ROOM_TOLERANCE below the best, it keeps the largest text, then the
  // usual places, then the largest area.
  const choose = (H) => {
    const fixed = !theme.fitHeight;
    const legends = fixed && !theme.legendSet && theme.legend !== "none" ? ["right", "bottom"] : [theme.legend];
    const infos = fixed && ns.info && !ns.info.set ? ["right", "bottom"] : [ns.info?.position];
    const scales = [];
    for (let k = 1; k >= (theme.shrink ?? 1) - 1e-9; k -= SHRINK_STEP) scales.push(k);
    const all = legends.flatMap((l) => infos.flatMap((i) => scales.map((k) => arrange(H, { legend: l, info: i }, k))));
    const fewest = d3.min(all, (a) => a.cut);
    const pool = all.filter((a) => a.cut === fewest);
    const best = d3.max(pool, (a) => a.area);
    return pool.filter((a) => a.area >= best * (1 - ROOM_TOLERANCE)).sort((a, b) => b.k - a.k || b.usual - a.usual || b.area - a.area)[0];
  };
  let { fonts, info, legend, layout } = choose(H);
  // aspect: when the height follows the width, it changes so that the panels get their shape, up to 1.2 times the
  // usual height; beyond that, the panels get narrower.
  if (theme.aspect && theme.fitHeight) {
    const fit = H + grid.nrow * (layout.room.w * theme.aspect - layout.room.h);
    H = Math.round(Math.min(H * ASPECT_GROWTH, Math.max(MIN_HEIGHT, fit)));
    ({ fonts, info, legend, layout } = choose(H));
  }

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
  if (info) svg.append(drawInfo(doc, info, theme, layout.info));
  for (const s of layout.strips) svg.append(strip(doc, s, theme));
  // Insets: after the main panels, in layout.panels and in the domains, each with the views of its panel.
  const mainCount = grid.panels.length;
  const insets = insetPanels(ns, kind, layout.panels);
  layout.panels.push(...insets.map((s) => s.box));
  const homeAll = [...home, ...insets.map((s) => s.domain)];
  const state = { spec, ns, doc, svg, theme, fonts, grid, kind, geo, color, fill, ctx, legend, info, layout, home: homeAll, direct, insets, mainCount, W, H };
  state.domains = domains ?? homeAll;
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
  const panels = [...grid.panels, ...state.insets.map((s) => grid.panels[s.parent])];
  state.panels = panels.map((p, i) => drawPanel(state, p, i));
  if (state.legendG) state.legendG.replaceWith((state.legendG = placedLegend(state)));
}

function placedLegend(state) {
  const g = drawLegend(state.doc, state.legend, state.theme, state.fonts, state.hidden);
  g.setAttribute("transform", `translate(${state.layout.legend.x},${state.layout.legend.y})`);
  return g;
}

function drawPanel(state, p, i) {
  const { ns, doc, theme, fonts, kind, color, fill } = state;
  const box = state.layout.panels[i];
  // A map draws its stored domain grown to equal distance per px in x and y; the stored domain does not change.
  const drawn = state.geo ? equalize(state.domains[i], box.innerW, box.innerH) : state.domains[i];
  const domain = { x: plotDomain(kind.x, drawn.x), y: plotDomain(kind.y, drawn.y) };
  // The band of a category, as in Observable Plot with padding 0.2.
  const band = (k, size) => (kind[k] === "category" ? (size / (domain[k].length + 0.2)) * 0.8 : 0);
  const bandwidth = { x: band("x", box.innerW), y: band("y", box.innerH) };
  // The scale bar, the north arrow and the insets of a main panel: boxes that text(repel=true) keeps clear of.
  const keys = state.geo && !box.inset ? mapKeyBoxes(state, drawn, box) : {};
  const blocked = [
    ...Object.values(keys),
    ...state.insets.filter((s) => !box.inset && s.parent === i).map(({ box: b }) => ({ x: b.x - box.x, y: b.y - box.y, w: b.w, h: b.h })),
  ].map(({ x, y, w, h }) => ({ x0: x, y0: y, x1: x + w, y1: y + h }));
  const layers = ns.layers.map((layer, li) => {
    const view = p.views[li];
    const c = context({ view, layer, kind, color, fill, theme, fonts, domain, bandwidth, direct: box.inset ? null : state.direct, obstacles: () => obstacles(ns, p, theme), blocked });
    return { layer, view, c, marks: view.n ? LAYERS[layer.type](c) : [] };
  });
  const axis = (k) => {
    const t = ticks(kind[k], drawn[k], box.count[k], ns.scales[k]);
    const inside = (v) => kind[k] === "category" || (+v >= +domain[k][0] && +v <= +domain[k][1]);
    return { major: t.major.filter(inside), minor: t.minor, format: t.format };
  };
  const ax = axis("x");
  const ay = axis("y");
  const gridStyle = (minor) => ({ stroke: minor ? theme.gridMinor : theme.grid, strokeOpacity: 1, strokeWidth: minor ? 0.6 : 0.9 });
  const axisStyle = { tickSize: TICK.size, tickPadding: TICK.padding, fontSize: fonts.tick, stroke: theme.tick, fill: theme.muted, label: null };
  const marks = [];
  // An inset covers the panel under it with the background, and has a frame instead of axes and grid lines.
  if (box.inset) marks.push(Plot.frame({ fill: theme.background, stroke: null }));
  if (kind.x !== "category" && !box.inset) marks.push(Plot.gridX(ax.minor, gridStyle(true)), Plot.gridX(ax.major, gridStyle(false)));
  if (kind.y !== "category" && !box.inset) marks.push(Plot.gridY(ay.minor, gridStyle(true)), Plot.gridY(ay.major, gridStyle(false)));
  marks.push(...layers.flatMap((l) => l.marks));
  if (box.inset) marks.push(Plot.frame({ stroke: theme.tick, strokeWidth: 1 }));
  if (box.showX) {
    const rotate = box.rotateX ? { tickRotate: -40, textAnchor: "end" } : {};
    const wrapped = (v) => box.wrapX.get(String(v))?.join("\n") ?? ax.format(v);
    const wrap = box.wrapX.size ? { tickFormat: wrapped, lineHeight: LINE } : labelsOf(kind.x, ax.format);
    marks.push(Plot.axisX(ax.major, { ...axisStyle, ...rotate, anchor: "bottom", ...wrap }));
  }
  if (box.showY) marks.push(Plot.axisY(ay.major, { ...axisStyle, anchor: "left", ...labelsOf(kind.y, ay.format) }));
  const plot = Plot.plot({
    document: doc,
    width: box.w,
    height: box.h,
    marginLeft: box.ml,
    marginRight: box.mr,
    marginTop: 0,
    marginBottom: box.mb,
    x: scaleOptions(kind.x, domain.x),
    y: scaleOptions(kind.y, domain.y),
    color: { type: "identity" },
    marks,
  });
  const g = svgElement(doc, "g", { class: "pt-panel", "data-panel": i, transform: `translate(${box.x},${box.y})`, fill: "currentColor", "text-anchor": "middle" });
  for (const child of [...plot.childNodes]) if (child.nodeName.toLowerCase() !== "style") g.append(child);
  if (state.geo && !box.inset) g.append(mapKeys(state, keys));
  state.panelLayer.append(g);
  return { g, plot, box, layers };
}

// The inset panels: for each main panel and each inset, a box at the inset's place in the panel, its extent and
// the index of its panel. Insets need number or time axes.
function insetPanels(ns, kind, boxes) {
  if (!ns.insets.length) return [];
  if (kind.x === "category" || kind.y === "category") throw new Error("inset(): x and y must be number or time axes, not category axes");
  return boxes.flatMap((b, parent) =>
    ns.insets.map(({ x, y, at: [l, bottom, r, top] }) => {
      const [w, h] = [(r - l) * b.innerW, (top - bottom) * b.innerH];
      const box = { x: b.x + b.ml + l * b.innerW, y: b.y + (1 - top) * b.innerH, w, h, ml: 0, mr: 0, mb: 0, innerW: w, innerH: h };
      Object.assign(box, { count: { x: 2, y: 2 }, showX: false, showY: false, rotateX: false, wrapX: new Map(), inset: true });
      return { parent, box, domain: { x, y } };
    }),
  );
}

// The points of the point layers of a panel, which text(repel=true) keeps clear of: data arrays and radii.
function obstacles(ns, p, theme) {
  return ns.layers.flatMap((layer, li) => (layer.type === "point" && p.views[li].n ? [{ x: p.views[li].cols.x, y: p.views[li].cols.y, r: layer.options.size ?? theme.point }] : []));
}

// The places of the scale bar and the north arrow of a map panel (coord("geo", scalebar=, north=)), in the corners
// that the spec sets, 0.8 em inside the frame, in panel px. The bar is a round length (1, 2 or 5 × 10^k km) near a
// fifth of the panel width.
const KM_PER_DEGREE = 111.32;
function mapKeyBoxes(state, drawn, box) {
  const { fonts, ns } = state;
  const { scalebar, north } = ns.coord;
  const m = fonts.base * 0.8;
  const at = (corner, w, h) => ({ x: box.ml + (corner.endsWith("left") ? m : box.innerW - m - w), y: corner.startsWith("top") ? m : box.innerH - m - h, w, h });
  const out = {};
  if (scalebar) {
    const phi = ((drawn.y[0] + drawn.y[1]) / 2) * (Math.PI / 180);
    const kmPerPx = ((drawn.x[1] - drawn.x[0]) * KM_PER_DEGREE * Math.cos(phi)) / box.innerW;
    const target = kmPerPx * box.innerW * 0.2;
    const e = 10 ** Math.floor(Math.log10(target));
    const km = [5, 2, 1].map((k) => k * e).find((v) => v <= target);
    out.scalebar = { ...at(scalebar, km / kmPerPx, fonts.tick * 1.3 + 5), km };
  }
  if (north) out.north = at(north, fonts.tick, fonts.tick * 2.5);
  return out;
}

function mapKeys(state, keys) {
  const { doc, theme, fonts } = state;
  const g = svgElement(doc, "g", { class: "pt-map-keys", "font-size": fonts.tick, fill: theme.ink });
  const halo = { stroke: theme.background, "stroke-width": 3, "stroke-linejoin": "round", "paint-order": "stroke" };
  if (keys.scalebar) {
    const { x, y, w, h, km } = keys.scalebar;
    const base = y + h - 1;
    const bar = svgElement(doc, "g", { class: "pt-scalebar", "data-km": km, "data-px": w });
    const line = `M${x},${base - 4}V${base}H${x + w}V${base - 4}`;
    bar.append(svgElement(doc, "path", { d: line, fill: "none", stroke: theme.background, "stroke-width": 4, "stroke-linejoin": "round" }));
    bar.append(svgElement(doc, "path", { d: line, fill: "none", stroke: theme.ink, "stroke-width": 1.5 }));
    bar.append(svgText(doc, `${d3.format(",~r")(km)} km`, { x: x + w / 2, y: base - 7, "text-anchor": "middle", ...halo }));
    g.append(bar);
  }
  if (keys.north) {
    const { x, y, w, h } = keys.north;
    const cx = x + w / 2;
    const arrow = svgElement(doc, "g", { class: "pt-north" });
    arrow.append(svgText(doc, "N", { x: cx, y: y + fonts.tick * 0.85, "text-anchor": "middle", "font-weight": "bold", ...halo }));
    const tip = y + fonts.tick * 1.15;
    const points = `${cx},${tip} ${x + w},${y + h} ${cx},${y + h - w * 0.4} ${x},${y + h}`;
    arrow.append(svgElement(doc, "polygon", { points, fill: theme.ink, stroke: theme.background, "stroke-width": 1, "stroke-linejoin": "round" }));
    g.append(arrow);
  }
  return g;
}

// Channel accessors of one layer view in one panel, for layers.js. Time values become Date objects.
function context({ view, layer, kind, color, fill, theme, fonts, domain, bandwidth, direct, obstacles, blocked }) {
  const axisOf = (ch) => (AXIS_CHANNELS.x.includes(ch) ? "x" : AXIS_CHANNELS.y.includes(ch) ? "y" : null);
  const cache = {};
  const v = (ch) => {
    if (ch in cache) return cache[ch];
    let values = view.cols[ch];
    if (values && kind[axisOf(ch)] === "time") values = values.map((t) => (t === null ? null : new Date(t)));
    return (cache[ch] = values);
  };
  const colorCh = layer.channels.color;
  const fillCh = layer.channels.fill;
  return {
    index: d3.range(view.n),
    v,
    options: layer.options,
    colors: (fallback) => (!colorCh ? fallback : "value" in colorCh ? colorCh.value : v("color").map(color.apply)),
    fills: (fallback) => (!fillCh ? fallback : "value" in fillCh ? fillCh.value : v("fill").map(fill.apply)),
    shift: view.shift,
    groups: () => v("group") ?? (colorCh?.column ? v("color") : undefined),
    kind,
    theme,
    fonts,
    domain,
    bandwidth,
    direct,
    obstacles,
    blocked,
  };
}

// The tick labels of an axis. On a log axis, Observable Plot passes a tickFormat through d3's log tickFormat, which
// blanks the labels of some multiples (for example 5) when the axis has many ticks: the text channel shows them all.
function labelsOf(kind, format) {
  return kind === "log" ? { text: (v) => format(v) } : { tickFormat: format };
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

function strip(doc, s, theme) {
  const g = svgElement(doc, "g", { class: "pt-strip" });
  g.append(svgElement(doc, "rect", { x: s.x, y: s.y, width: s.w, height: s.h, fill: theme.strip }));
  const attrs = s.vertical
    ? { transform: `translate(${s.x + s.w / 2},${s.y + s.h / 2}) rotate(90)`, dy: "0.35em" }
    : { x: s.x + s.w / 2, y: s.y + s.h / 2, dy: "0.35em" };
  const text = svgText(doc, s.text, { ...attrs, "text-anchor": "middle", "font-weight": "bold", "font-size": s.size, fill: theme.ink });
  if (s.text !== String(s.full)) text.append(svgText(doc, s.full, {}, "title"));
  g.append(text);
  return g;
}
