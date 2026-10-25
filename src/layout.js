// Layout: the position and size of the title, info table, panels, strips, axis titles, caption and legend, in px of the figure.
// Text sizes come from text.js, so Node and the browser get the same layout.
import * as d3 from "d3";
import { ticks } from "./scales.js";
import { fitText, textWidth, wrapText } from "./text.js";

export const TICK = { size: 4, padding: 3 };
const ROTATE = 40; // degrees of rotated category labels
const WRAP_LINES = 3; // a category label wider than its band wraps to this many lines, before any rotation
export const LINE = 1.15; // line height of wrapped category labels, in em
const TOOLBAR = 0.22; // share of the width kept free of the title, for the toolbar

export function place({ ns, grid, kind, home, legend, info, fonts, W, H }) {
  const theme = ns.theme;
  const metrics = theme.metrics;
  const tw = (t, size, bold) => textWidth(t, size, bold, metrics);
  const s = fonts.base;
  const pad = Math.round(s * 0.9);
  const gap = Math.round(s * 0.8);
  const { title, subtitle, caption, x: xTitle, y: yTitle } = ns.labels;
  const at = (position) => (info?.position === position ? info : null);
  const headW = W - 2 * pad - Math.min(180, W * TOOLBAR);
  const titleLines = title ? wrapText(title, fonts.title, headW, true, metrics) : [];
  const subtitleLines = subtitle ? wrapText(subtitle, fonts.subtitle, headW, false, metrics) : [];
  const head = titleLines.length * fonts.title * 1.25 + subtitleLines.length * fonts.subtitle * 1.4;
  const top = pad + head + (head ? s * 0.7 : 0);
  const xt = xTitle ? fonts.axisTitle * 1.7 : 0;
  const yt = yTitle ? fonts.axisTitle * 1.7 : 0;
  const cap = caption ? fonts.tick * 1.8 : 0;
  const rightW = Math.max(legend && !legend.horizontal ? legend.width : 0, at("right")?.width ?? 0);
  const right = rightW ? rightW + s * 1.5 : 0;
  const bottom = legend?.horizontal ? legend.height + s * 0.8 : 0;
  const below = at("bottom") ? at("bottom").height + gap : 0;
  const area = { x: pad + yt, y: top, w: W - 2 * pad - yt - right, h: H - top - pad - xt - bottom - cap - below };

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
  let ml, mb, mt, count, rotateX, wrapX;
  for (let pass = 0; pass < 2; pass++) {
    count = { x: Math.max(2, innerW / (kind.x === "time" ? 110 : 75)), y: Math.max(2, innerH / 45) };
    ml = Array(grid.ncol).fill(0);
    mb = Array(grid.nrow).fill(0);
    rotateX = false;
    wrapX = new Map();
    mt = 0;
    let xLabelW = 0;
    grid.panels.forEach((p, i) => {
      if (showY(p)) {
        const t = ticks(kind.y, home[i].y, count.y, ns.scales.y?.format);
        const w = d3.max(t.major, (v) => tw(t.format(v), fonts.tick)) ?? 0;
        ml[p.col] = Math.max(ml[p.col], Math.ceil(w + TICK.size + TICK.padding + 3));
        // A tick at the top edge has half its label above the panel: move the panels down to keep it off the subtitle.
        if (p.row === 0 && !wrapStrip && !topStrip && kind.y !== "category") {
          const [lo, hi] = home[i].y;
          const y = (kind.y === "log" ? d3.scaleLog() : d3.scaleLinear()).domain([lo, hi]).range([innerH, 0]);
          const top = d3.max(t.major.filter((v) => +v >= +lo && +v <= +hi));
          if (top !== undefined) mt = Math.max(mt, Math.ceil(fonts.tick * 0.6 - y(top)));
        }
      }
      if (kind.x === "category" && showX(p, i)) {
        const labels = home[i].x;
        const room = (innerW / (labels.length + 0.2)) * 0.95;
        for (const v of labels) {
          const w = tw(v, fonts.tick);
          xLabelW = Math.max(xLabelW, w);
          if (w <= room) continue;
          // Wrap at spaces first; a word that is still too wide, or a label that needs more lines, rotates them all.
          const lines = wrapText(v, fonts.tick, room, false, metrics, WRAP_LINES);
          if (lines.at(-1).endsWith("…") || d3.max(lines, (l) => tw(l, fonts.tick)) > room) rotateX = true;
          else wrapX.set(String(v), lines);
        }
      }
    });
    // Rotated labels get 60% of the panel height (at least 10 em); a longer one ends with an ellipsis.
    const rotated = Math.min(xLabelW, Math.max(innerH * 0.6, fonts.tick * 10));
    if (rotateX) {
      wrapX.clear();
      grid.panels.forEach((p, i) => {
        if (kind.x !== "category" || !showX(p, i)) return;
        for (const v of home[i].x) if (tw(v, fonts.tick) > rotated) wrapX.set(String(v), [fitText(v, fonts.tick, rotated, false, metrics)]);
      });
    }
    const xLines = rotateX ? 1 : (d3.max(wrapX.values(), (l) => l.length) ?? 1);
    const xLabelH = rotateX ? rotated * Math.sin((ROTATE * Math.PI) / 180) + fonts.tick : fonts.tick * (1.2 + LINE * (xLines - 1));
    // A rotated label reaches left of its tick: widen the left margin so that the first one is not cut off.
    if (rotateX) {
      grid.panels.forEach((p, i) => {
        if (p.col !== 0 || !showX(p, i)) return;
        const step = innerW / (home[i].x.length + 0.2);
        const first = Math.min(tw(home[i].x[0], fonts.tick), rotated);
        const reach = first * Math.cos((ROTATE * Math.PI) / 180) + fonts.tick * 0.5;
        ml[0] = Math.max(ml[0], Math.ceil(reach - 0.6 * step));
      });
    }
    grid.panels.forEach((p, i) => {
      if (showX(p, i)) mb[p.row] = Math.max(mb[p.row], Math.ceil(xLabelH + TICK.size + TICK.padding + 3));
    });
    innerW = (area.w - d3.sum(ml) - gap * (grid.ncol - 1) - rightStrip) / grid.ncol;
    innerH = (area.h - mt - d3.sum(mb) - grid.nrow * wrapStrip - topStrip - gap * (grid.nrow - 1)) / grid.nrow;
  }
  innerW = Math.max(20, innerW);
  innerH = Math.max(20, innerH);
  // theme aspect (panel height / width): the panels shrink in one direction to get that shape.
  const room = { w: innerW, h: innerH }; // the panel size before the aspect
  if (theme.aspect) {
    if (innerH > innerW * theme.aspect) innerH = innerW * theme.aspect;
    else innerW = innerH / theme.aspect;
  }
  // The space the aspect leaves free goes half on each side, so the panels stay centered.
  const slackY = ((room.h - innerH) * grid.nrow) / 2;
  const slackX = ((room.w - innerW) * grid.ncol) / 2;

  const colX = d3.cumsum([area.x + slackX, ...ml.slice(0, -1).map((m) => m + innerW + gap)]);
  const rowY = d3.cumsum([area.y + mt + topStrip + slackY, ...mb.slice(0, -1).map((m) => wrapStrip + innerH + m + gap)]);
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
    wrapX,
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
  const panelsBottom = d3.max(panels, (b) => b.y + b.h);
  const texts = [];
  let y = pad;
  for (const line of titleLines) texts.push({ text: line, attrs: { x: innerLeft, y: (y += fonts.title * 1.05), "font-size": fonts.title, "font-weight": "bold", fill: theme.ink, "text-anchor": "start" } }), (y += fonts.title * 0.2);
  for (const line of subtitleLines) texts.push({ text: line, attrs: { x: innerLeft, y: (y += fonts.subtitle * 1.3), "font-size": fonts.subtitle, fill: theme.muted, "text-anchor": "start" } });
  if (xTitle) texts.push({ text: xTitle, attrs: { x: (innerLeft + innerRight) / 2, y: panelsBottom + fonts.axisTitle * 1.35, "text-anchor": "middle", "font-size": fonts.axisTitle, fill: theme.muted } });
  if (yTitle) {
    const cy = area.y + (area.h - d3.sum(mb)) / 2;
    texts.push({ text: yTitle, attrs: { transform: `translate(${pad + slackX + fonts.axisTitle * 0.85},${cy}) rotate(-90)`, "text-anchor": "middle", "font-size": fonts.axisTitle, fill: theme.muted } });
  }
  if (caption) texts.push({ text: fitText(caption, fonts.tick, W - 2 * pad, false, metrics), attrs: { x: innerLeft, y: H - pad - (bottom ? bottom : 0) + fonts.tick * 0.2, "font-size": fonts.tick, fill: theme.muted, "text-anchor": "start" } });
  // The right column is at the right edge, or next to the panels when the aspect makes them narrower.
  const beside = innerRight + rightStrip + s * 1.5;
  const rightX = beside < W - pad - rightW - 1 ? beside : W - pad - rightW;
  const infoAt = !info
    ? null
    : info.position === "right"
      ? { x: rightX, y: area.y }
      : { x: Math.max(pad, Math.min(innerLeft, W - pad - info.width)), y: panelsBottom + xt + gap / 2 };
  const above = at("right") ? info.height + s : 0;
  const legendAt = !legend
    ? null
    : legend.horizontal
      ? { x: Math.max(pad, (innerLeft + innerRight - legend.width) / 2), y: H - pad - legend.height }
      : { x: rightX, y: area.y + above + Math.max(0, (area.h - d3.sum(mb) - above - legend.height) / 2) };
  return { panels, strips, texts, legend: legendAt, info: infoAt, area, room, rotateX };
}
