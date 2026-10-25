// Info table: the key/value entries of info(), as a card in the right column or below the plot.
import * as d3 from "d3";
import { svgElement, svgText } from "./svg.js";
import { fitText, textWidth, wrapText } from "./text.js";

const VALUE_LINES = 3; // a long value wraps to this many lines
const KEY_SHARE = 0.45; // the key column takes at most this share of the table width
const MAX_WIDTH = { right: 0.3, bottom: 0.9 }; // share of the figure width
const MAX_HEIGHT = { right: 0.6, bottom: 0.3 }; // share of the figure height; the rest of the entries become "+N more"
const MAX_COLUMNS = 3; // columns of entries in a bottom card

// The info model with its position and size. narrow: a right placement moves to the bottom.
export function infoModel(ns, fonts, { W, H, narrow }) {
  if (!ns.info) return null;
  const position = narrow ? "bottom" : ns.info.position;
  return model(ns, fonts, ns.info.entries, position, W, H * MAX_HEIGHT[position]);
}

function model(ns, fonts, entries, position, W, maxHeight) {
  const metrics = ns.theme.metrics;
  const size = fonts.legend;
  const pad = Math.round(size * 0.8);
  const lineH = size * 1.35;
  const keyGap = size;
  const colGap = size * 2;
  const all = entries.map(([key, value]) => ({ key: String(key), value: value === null ? "–" : String(value) }));
  const width = (t) => textWidth(t, size, false, metrics);

  // One column of rows, at most maxWidth wide: the keys on the left, the values wrapped on the right.
  const column = (items, maxWidth) => {
    const keyW = Math.min(d3.max(items, (r) => width(r.key)) ?? 0, maxWidth * KEY_SHARE);
    const valueMax = Math.max(size * 3, maxWidth - keyW - keyGap);
    let y = 0;
    const laid = items.map((r) => {
      const lines = wrapText(r.value, size, valueMax, false, metrics, VALUE_LINES);
      const row = { key: fitText(r.key, size, keyW, false, metrics), full: r.key, lines, y };
      y += lines.length * lineH;
      return row;
    });
    const valueW = d3.max(laid, (r) => d3.max(r.lines, width)) ?? 0;
    return { rows: laid, keyW, width: keyW + keyGap + valueW, height: y };
  };

  const inner = W * MAX_WIDTH[position] - 2 * pad;
  const table = (rows) => {
    let columns;
    if (position === "bottom") {
      const natural = d3.max(rows, (r) => width(r.key) + keyGap + width(r.value)) ?? 0;
      const k = Math.max(1, Math.min(MAX_COLUMNS, rows.length, Math.floor((inner + colGap) / (natural + colGap))));
      const perColumn = Math.ceil(rows.length / k);
      const colW = (inner - colGap * (k - 1)) / k;
      columns = d3.range(k).map((j) => column(rows.slice(j * perColumn, (j + 1) * perColumn), colW));
    } else columns = [column(rows, inner)];
    let x = pad;
    for (const c of columns) (c.x = x), (x += c.width + colGap);
    return { columns, width: x - colGap + pad, height: (d3.max(columns, (c) => c.height) ?? 0) + 2 * pad };
  };
  // Drop entries from the end until the table fits; the last row tells how many are not shown.
  let kept = all.length;
  let t = table(all);
  while (t.height > maxHeight && kept > 1) {
    kept--;
    t = table([...all.slice(0, kept), { key: `+${all.length - kept} more`, value: "" }]);
  }
  // cut: the entries that do not show, plus the keys that end with an ellipsis.
  const keys = t.columns.flatMap((c) => c.rows).filter((r) => r.key !== r.full).length;
  return { position, size, pad, lineH, keyGap, cut: all.length - kept + keys, ...t };
}

// The table as an SVG group at (x, y): keys in the muted color, values in the ink color, on a strip-colored card.
export function drawInfo(doc, model, theme, { x, y }) {
  const g = svgElement(doc, "g", { class: "pt-info", transform: `translate(${x},${y})`, "font-size": model.size });
  g.append(svgElement(doc, "rect", { width: model.width, height: model.height, fill: theme.strip }));
  const baseline = model.lineH * 0.75;
  for (const c of model.columns) {
    for (const r of c.rows) {
      const top = model.pad + r.y + baseline;
      const key = svgText(doc, r.key, { x: c.x, y: top, fill: theme.muted, "text-anchor": "start" });
      if (r.key !== r.full) key.append(svgText(doc, r.full, {}, "title"));
      g.append(key);
      r.lines.forEach((line, i) => g.append(svgText(doc, line, { x: c.x + c.keyW + model.keyGap, y: top + i * model.lineH, fill: theme.ink, "text-anchor": "start" })));
    }
  }
  return g;
}
