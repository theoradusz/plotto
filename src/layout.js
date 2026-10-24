// Layout: the position and size of the title, panels, strips, axis titles, caption and legend, in px of the figure.
// Text sizes come from text.js, so Node and the browser get the same layout.
import * as d3 from "d3";
import { ticks } from "./scales.js";
import { fitText, textWidth, wrapText } from "./text.js";

export const TICK = { size: 4, padding: 3 };
const ROTATE = 40; // degrees of rotated category labels
const TOOLBAR = 0.22; // share of the width kept free of the title, for the toolbar

export function place({ ns, grid, kind, home, legend, fonts, W, H }) {
  const theme = ns.theme;
  const metrics = theme.metrics;
  const tw = (t, size, bold) => textWidth(t, size, bold, metrics);
  const s = fonts.base;
  const pad = Math.round(s * 0.9);
  const gap = Math.round(s * 0.8);
  const { title, subtitle, caption, x: xTitle, y: yTitle } = ns.labels;
  const headW = W - 2 * pad - Math.min(180, W * TOOLBAR);
  const titleLines = title ? wrapText(title, fonts.title, headW, true, metrics) : [];
  const subtitleLines = subtitle ? wrapText(subtitle, fonts.subtitle, headW, false, metrics) : [];
  const head = titleLines.length * fonts.title * 1.25 + subtitleLines.length * fonts.subtitle * 1.4;
  const top = pad + head + (head ? s * 0.7 : 0);
  const xt = xTitle ? fonts.axisTitle * 1.7 : 0;
  const yt = yTitle ? fonts.axisTitle * 1.7 : 0;
  const cap = caption ? fonts.tick * 1.8 : 0;
  const right = legend && !legend.horizontal ? legend.width + s * 1.5 : 0;
  const bottom = legend?.horizontal ? legend.height + s * 0.8 : 0;
  const area = { x: pad + yt, y: top, w: W - 2 * pad - yt - right, h: H - top - pad - xt - bottom - cap };

  const strip = grid.kind === "none" ? 0 : Math.round(fonts.strip * 2);
  const wrapStrip = grid.kind === "wrap" ? strip : 0;
  const topStrip = grid.kind === "grid" && ns.facet.cols ? strip + 2 : 0;
  const rightStrip = grid.kind === "grid" && ns.facet.rows ? strip + 2 : 0;
  const free = ns.facet?.free ?? { x: false, y: false };
  const n = grid.panels.length;
  const showY = (p) => free.y || p.col === 0;
  const showX = (p, i) => free.x || (grid.kind === "wrap" ? i + grid.ncol >= n : p.row === grid.nrow - 1);

  // Two passes: the tick count depends on the panel size, and the margins depend on the tick labels.
  let innerW = area.w / grid.ncol;
  let innerH = area.h / grid.nrow;
  let ml, mb, count, rotateX;
  for (let pass = 0; pass < 2; pass++) {
    count = { x: Math.max(2, innerW / (kind.x === "time" ? 110 : 75)), y: Math.max(2, innerH / 45) };
    ml = Array(grid.ncol).fill(0);
    mb = Array(grid.nrow).fill(0);
    rotateX = false;
    let xLabelW = 0;
    grid.panels.forEach((p, i) => {
      if (showY(p)) {
        const t = ticks(kind.y, home[i].y, count.y, ns.scales.y?.format);
        const w = d3.max(t.major, (v) => tw(t.format(v), fonts.tick)) ?? 0;
        ml[p.col] = Math.max(ml[p.col], Math.ceil(w + TICK.size + TICK.padding + 3));
      }
      if (kind.x === "category" && showX(p, i)) {
        const labels = home[i].x;
        const w = d3.max(labels, (v) => tw(v, fonts.tick)) ?? 0;
        xLabelW = Math.max(xLabelW, w);
        if (w > (innerW / (labels.length + 0.2)) * 0.95) rotateX = true;
      }
    });
    const xLabelH = rotateX ? Math.min(xLabelW, innerH * 0.6) * Math.sin((ROTATE * Math.PI) / 180) + fonts.tick : fonts.tick * 1.2;
    grid.panels.forEach((p, i) => {
      if (showX(p, i)) mb[p.row] = Math.max(mb[p.row], Math.ceil(xLabelH + TICK.size + TICK.padding + 3));
    });
    innerW = (area.w - d3.sum(ml) - gap * (grid.ncol - 1) - rightStrip) / grid.ncol;
    innerH = (area.h - d3.sum(mb) - grid.nrow * wrapStrip - topStrip - gap * (grid.nrow - 1)) / grid.nrow;
  }
  innerW = Math.max(20, innerW);
  innerH = Math.max(20, innerH);

  const colX = d3.cumsum([area.x, ...ml.slice(0, -1).map((m) => m + innerW + gap)]);
  const rowY = d3.cumsum([area.y + topStrip, ...mb.slice(0, -1).map((m) => wrapStrip + innerH + m + gap)]);
  const panels = grid.panels.map((p, i) => ({
    x: colX[p.col],
    y: rowY[p.row] + wrapStrip,
    w: ml[p.col] + innerW,
    h: innerH + mb[p.row],
    ml: ml[p.col],
    mb: mb[p.row],
    innerW,
    innerH,
    count,
    rotateX,
    showX: showX(p, i),
    showY: showY(p),
  }));

  const strips = [];
  grid.panels.forEach((p, i) => {
    const b = panels[i];
    const left = b.x + b.ml;
    const label = (text, width) => fitText(text, fonts.strip, width - 8, true, metrics);
    if (p.strips.top != null) strips.push({ x: left, y: b.y - wrapStrip - topStrip, w: innerW, h: strip, text: label(p.strips.top, innerW), full: p.strips.top });
    if (p.strips.right != null) strips.push({ x: left + innerW + 2, y: b.y, w: strip, h: innerH, text: label(p.strips.right, innerH), full: p.strips.right, vertical: true });
  });

  const first = panels[0];
  const lastCol = panels.find((b, i) => grid.panels[i].col === grid.ncol - 1) ?? first;
  const innerLeft = first.x + first.ml;
  const innerRight = lastCol.x + lastCol.w;
  const panelsBottom = area.y + area.h;
  const texts = [];
  let y = pad;
  for (const line of titleLines) texts.push({ text: line, attrs: { x: innerLeft, y: (y += fonts.title * 1.05), "font-size": fonts.title, "font-weight": "bold", fill: theme.ink, "text-anchor": "start" } }), (y += fonts.title * 0.2);
  for (const line of subtitleLines) texts.push({ text: line, attrs: { x: innerLeft, y: (y += fonts.subtitle * 1.3), "font-size": fonts.subtitle, fill: theme.muted, "text-anchor": "start" } });
  if (xTitle) texts.push({ text: xTitle, attrs: { x: (innerLeft + innerRight) / 2, y: panelsBottom + fonts.axisTitle * 1.35, "text-anchor": "middle", "font-size": fonts.axisTitle, fill: theme.muted } });
  if (yTitle) {
    const cy = area.y + (area.h - d3.sum(mb)) / 2;
    texts.push({ text: yTitle, attrs: { transform: `translate(${pad + fonts.axisTitle * 0.85},${cy}) rotate(-90)`, "text-anchor": "middle", "font-size": fonts.axisTitle, fill: theme.muted } });
  }
  if (caption) texts.push({ text: fitText(caption, fonts.tick, W - 2 * pad, false, metrics), attrs: { x: innerLeft, y: H - pad - (bottom ? bottom : 0) + fonts.tick * 0.2, "font-size": fonts.tick, fill: theme.muted, "text-anchor": "start" } });
  const legendAt = !legend
    ? null
    : legend.horizontal
      ? { x: Math.max(pad, (innerLeft + innerRight - legend.width) / 2), y: H - pad - legend.height }
      : { x: W - pad - legend.width, y: area.y + Math.max(0, (area.h - d3.sum(mb) - legend.height) / 2) };
  return { panels, strips, texts, legend: legendAt, area, rotateX };
}
