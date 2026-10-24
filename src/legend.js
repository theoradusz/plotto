// Legend: color swatches (a string column) or a color ramp (a number or time column), as SVG.
import * as d3 from "d3";
import { ticks } from "./scales.js";
import { svgElement, svgText } from "./svg.js";
import { fitText, textWidth } from "./text.js";

const KEY = 18; // swatch width, px
const GAP = 6;
const RAMP = { thick: 12, long: 150, slices: 48 };
const LINE_LAYERS = ["line", "path", "step", "density", "smooth", "hline", "vline", "abline", "segment", "errorbar"];
const FILL_LAYERS = ["bar", "hist", "area", "ribbon", "rect", "tile", "box"];

// The legend model with its size. horizontal: below the plot. maxWidth, maxHeight: the space for it.
export function legendModel(ns, color, fonts, { horizontal, maxWidth, maxHeight }) {
  if (color.kind === "none" || ns.theme.legend === "none") return null;
  const metrics = ns.theme.metrics;
  const width = (t, size, bold) => textWidth(t, size, bold, metrics);
  const title = ns.labels.color === null ? null : (ns.labels.color ?? color.column);
  const titleH = title ? fonts.legend * 1.8 : 0;
  const titleW = title ? width(title, fonts.legend + 1, true) : 0;

  if (color.kind === "continuous") {
    const t = ticks(color.type === "time" ? "time" : "linear", color.domain, 4);
    const labels = t.major.map(t.format);
    const labelW = d3.max(labels, (l) => width(l, fonts.legend)) ?? 0;
    const long = Math.min(RAMP.long, horizontal ? maxWidth : maxHeight - titleH - 4);
    const [w, h] = horizontal ? [long, RAMP.thick + fonts.legend * 1.6] : [RAMP.thick + GAP + labelW, long];
    return { kind: "ramp", title, titleH, color, long, ticks: t.major, labels, width: Math.max(titleW, w), height: titleH + h, horizontal };
  }

  const mapped = ns.layers.filter((l) => l.channels.color?.column);
  const key = mapped.some((l) => FILL_LAYERS.includes(l.type)) ? "square" : mapped.some((l) => LINE_LAYERS.includes(l.type)) ? "line" : "point";
  const rowH = Math.round(fonts.legend * 1.75);
  const maxLabel = Math.max(80, (horizontal ? maxWidth : 220) - KEY - GAP);
  const items = color.domain.map((value) => {
    const label = fitText(value, fonts.legend, maxLabel, false, metrics);
    return { value, label, color: color.apply(value), w: KEY + GAP + width(label, fonts.legend) };
  });
  if (!horizontal) {
    // Columns of rows, so that a long legend fits the panel height.
    const perColumn = Math.max(1, Math.floor((maxHeight - titleH) / rowH));
    const columns = d3.range(Math.ceil(items.length / perColumn)).map((k) => items.slice(k * perColumn, (k + 1) * perColumn));
    let x = 0;
    for (const column of columns) {
      column.forEach((it, i) => Object.assign(it, { x, y: titleH + i * rowH }));
      x += (d3.max(column, (it) => it.w) ?? 0) + fonts.legend;
    }
    const rows = Math.min(items.length, perColumn);
    return { kind: "swatches", title, titleH, key, rowH, items, width: Math.max(titleW, x - fonts.legend), height: titleH + rows * rowH, horizontal };
  }
  let x = 0;
  let y = titleH;
  for (const it of items) {
    if (x > 0 && x + it.w > maxWidth) [x, y] = [0, y + rowH];
    Object.assign(it, { x, y });
    x += it.w + fonts.legend * 1.5;
  }
  const w = Math.max(titleW, d3.max(items, (it) => it.x + it.w) ?? 0);
  return { kind: "swatches", title, titleH, key, rowH, items, width: w, height: y + rowH, horizontal };
}

export function drawLegend(doc, model, theme, fonts, hidden = new Set()) {
  const g = svgElement(doc, "g", { class: "pt-legend", "font-size": fonts.legend });
  if (model.title) g.append(svgText(doc, model.title, { y: fonts.legend, "font-weight": "bold", "font-size": fonts.legend + 1, fill: theme.ink }));
  if (model.kind === "ramp") drawRamp(doc, g, model, theme, fonts);
  else model.items.forEach((it, i) => g.append(swatch(doc, model, it, i, theme, hidden.has(it.value))));
  return g;
}

function swatch(doc, model, it, i, theme, off) {
  const mid = model.rowH / 2;
  const g = svgElement(doc, "g", { class: "pt-key", "data-index": i, transform: `translate(${it.x},${it.y})`, opacity: off ? 0.35 : 1 });
  const hit = svgElement(doc, "rect", { width: it.w, height: model.rowH, fill: "transparent" });
  const mark =
    model.key === "line"
      ? svgElement(doc, "line", { x1: 1, x2: KEY - 1, y1: mid, y2: mid, stroke: it.color, "stroke-width": Math.max(2.5, theme.line + 1) })
      : model.key === "point"
        ? svgElement(doc, "circle", { cx: KEY / 2, cy: mid, r: Math.max(3.5, theme.point + 1), fill: it.color })
        : svgElement(doc, "rect", { x: 3, y: mid - 6, width: 12, height: 12, fill: it.color });
  const label = svgText(doc, it.label, { x: KEY + GAP, y: mid, dy: "0.35em", fill: theme.muted, "text-decoration": off ? "line-through" : null });
  g.append(hit, mark, label);
  return g;
}

function drawRamp(doc, g, model, theme, fonts) {
  const { color, horizontal, long } = model;
  const [lo, hi] = color.domain.map(Number);
  const at = (v) => (Number(v) - lo) / (hi - lo || 1); // 0..1 along the ramp
  const top = model.titleH;
  for (let i = 0; i < RAMP.slices; i++) {
    const t0 = i / RAMP.slices;
    const size = long / RAMP.slices + 0.5; // overlap a little, so no gaps show
    const fill = color.ramp(horizontal ? t0 : 1 - t0);
    const rect = horizontal ? { x: t0 * long, y: top, width: size, height: RAMP.thick } : { x: 0, y: top + t0 * long, width: RAMP.thick, height: size };
    g.append(svgElement(doc, "rect", { ...rect, fill }));
  }
  model.ticks.forEach((v, i) => {
    const p = at(v) * long;
    const attrs = horizontal
      ? { x: p, y: top + RAMP.thick + fonts.legend * 1.2, "text-anchor": "middle" }
      : { x: RAMP.thick + GAP, y: top + long - p, dy: "0.35em" };
    g.append(svgText(doc, model.labels[i], { ...attrs, fill: theme.muted }));
  });
}
