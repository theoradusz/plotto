// Facets: splits the rows of each layer into panels and places the panels on a grid.
import { naturalOrder } from "./scales.js";

// Returns { kind, nrow, ncol, panels }. Each panel has row, col, labels and rows[layerIndex] (row numbers).
export function facetPanels(ns) {
  const f = ns.facet;
  if (!f) return { kind: "none", nrow: 1, ncol: 1, panels: [panel(ns, 0, 0, {}, {})] };
  if (f.kind === "wrap") {
    const keys = levels(ns, f.by);
    const ncol = f.ncol ?? wrapColumns(keys.length);
    const panels = keys.map((k, i) => panel(ns, Math.floor(i / ncol), i % ncol, { [f.by]: k }, { top: k }));
    return { kind: "wrap", nrow: Math.ceil(keys.length / ncol), ncol, panels };
  }
  const rowKeys = f.rows ? levels(ns, f.rows) : [null];
  const colKeys = f.cols ? levels(ns, f.cols) : [null];
  const panels = [];
  rowKeys.forEach((rk, r) =>
    colKeys.forEach((ck, c) => {
      const match = {};
      if (f.rows) match[f.rows] = rk;
      if (f.cols) match[f.cols] = ck;
      panels.push(panel(ns, r, c, match, { top: r === 0 ? ck : null, right: c === colKeys.length - 1 ? rk : null }));
    })
  );
  return { kind: "grid", nrow: rowKeys.length, ncol: colKeys.length, panels };
}

// Number of columns of a facet wrap, the same rule as ggplot (grDevices::n2mfrow).
function wrapColumns(n) {
  if (n <= 3) return n;
  if (n <= 6) return Math.ceil(n / 2);
  if (n <= 12) return Math.ceil(n / 3);
  return Math.ceil(Math.sqrt(n));
}

function levels(ns, column) {
  const col = ns.tables[0].columns[column];
  if (col.levels) return col.levels.filter((v) => col.values.includes(v));
  return [...new Set(col.values.filter((v) => v !== null).map(String))].sort(naturalOrder);
}

// A layer without columns (for example hline(y=0)) has one row in each panel.
// A layer table without the facet column repeats in each panel, as in ggplot.
function panel(ns, row, col, match, strips) {
  const rows = ns.layers.map((layer) => {
    const t = ns.tables[layer.table];
    if (!Object.values(layer.channels).some((c) => c.column)) return [0];
    const tests = Object.entries(match).filter(([name]) => name in t.columns);
    const all = Array.from({ length: t.n }, (_, i) => i);
    if (!tests.length) return all;
    return all.filter((i) => tests.every(([name, key]) => String(t.columns[name].values[i]) === key));
  });
  return { row, col, strips, rows };
}
