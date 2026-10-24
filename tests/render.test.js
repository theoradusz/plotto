// Node tests of the builder, the scales and the static SVG. Run: npm test (UPDATE_SNAPSHOTS=1 npm test writes new snapshots).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { plot } from "../src/builder.js";
import { figure } from "../src/figure.js";
import { renderSVG } from "../src/render.mjs";
import { FORMATS, STYLES } from "../src/theme.js";

const { document } = new JSDOM("").window;
const rows = [];
for (const g of ["a", "b", "c"]) for (let i = 0; i < 20; i++) rows.push({ t: i, v: (g === "c" ? 100 : 1) * Math.sin(i / 3), g, k: i % 2 ? "odd" : "even" });
const base = plot(rows, { x: "t", y: "v", color: "g" });

const LAYERS = {
  line: base.line(),
  path: base.path(),
  point: base.point(),
  hline: base.hline({ y: 0 }),
  vline: base.vline({ x: 5 }),
  abline: base.abline({ slope: 0.1, intercept: 0 }),
  segment: base.segment({ xend: "t", yend: 0 }),
  rect: plot(rows, { xmin: "t", ymin: "v", color: "g" }).rect({ xmax: 1, ymax: 0 }),
  band: base.line().band({ xmin: 2, xmax: 4 }),
  tile: plot(rows, { x: "t", y: "g", color: "v" }).tile(),
  text: base.text({ label: "g" }),
  errorbar: plot(rows, { x: "t", ymin: "v" }).errorbar({ ymax: 2 }),
  box: plot(rows, { x: "g", y: "v" }).box(),
  step: base.step(),
  bar: plot(rows.filter((r) => r.t < 3), { x: "k", y: "t", color: "g" }).bar(),
  bar_dodge: plot(rows.filter((r) => r.t < 3), { x: "k", y: "t", color: "g" }).bar({ position: "dodge" }),
  bar_time: plot(rows, { x: "t", y: "t", color: "g" }).bar(),
  hist: plot(rows, { x: "v", color: "g" }).hist({ bins: 10 }),
  density: plot(rows, { x: "v", color: "k" }).density(),
  area: plot(rows, { x: "t", y: "t", color: "g" }).area(),
  ribbon: plot(rows, { x: "t", ymin: "v", color: "g" }).ribbon({ ymax: 1 }),
  smooth: base.smooth(),
  smooth_loess: base.smooth({ method: "loess" }),
};

const ARIA = {
  line: "line", path: "line", point: "dot", hline: "rule", vline: "rule", abline: "line", segment: "link", rect: "rect", band: "rect",
  tile: "bar", text: "text", errorbar: "rule", box: "bar", step: "line", bar: "bar", bar_dodge: "bar", bar_time: "rect", hist: "rect",
  density: "area", area: "area", ribbon: "area", smooth: "line", smooth_loess: "line",
};

for (const [name, p] of Object.entries(LAYERS)) {
  test(`layer ${name} draws its mark and matches the snapshot`, () => {
    const svg = renderSVG(p.spec());
    assert.match(svg, new RegExp(`aria-label="${ARIA[name]}"`));
    snapshot(`layer_${name}`, svg);
  });
}

for (const style of STYLES) {
  test(`style ${style} matches the snapshot`, () => snapshot(`style_${style}`, renderSVG(base.line().facet("k").theme(style).spec())));
}
for (const format of FORMATS) {
  test(`format ${format} has its size`, () => {
    const f = figure(base.line().theme("pastel", { format }), { document });
    const svg = f.svg;
    assert.equal(`${svg.getAttribute("width")}x${svg.getAttribute("height")}`, `${f.theme.width}x${f.theme.height}`);
  });
}

test("stacked bars put each color on top of the previous one", () => {
  const p = plot([{ x: "a", y: 1, g: "u" }, { x: "a", y: 2, g: "v" }], { x: "x", y: "y", color: "g" }).bar();
  const view = figure(p, { document }).grid.panels[0].views[0];
  assert.deepEqual([view.cols.ymin, view.cols.ymax], [[0, 1], [1, 3]]);
});

test("dodged bars get one slot per color", () => {
  const p = plot([{ x: "a", y: 1, g: "u" }, { x: "a", y: 2, g: "v" }, { x: "b", y: 3, g: "v" }], { x: "x", y: "y", color: "g" }).bar({ position: "dodge" });
  const view = figure(p, { document }).grid.panels[0].views[0];
  assert.deepEqual([view.cols.slot, view.cols.slots], [[0, 1, 1], [2, 2, 2]]);
});

test("hist counts every row once, in shared bins", () => {
  const view = figure(LAYERS.hist, { document }).grid.panels[0].views[0];
  assert.equal(view.cols.value.reduce((a, b) => a + b, 0), rows.length);
  assert.ok(view.cols.ymin.every((v) => v >= 0));
});

test("a linear smooth fits a straight line exactly", () => {
  const p = plot([0, 1, 2, 3].map((x) => ({ x, y: 2 * x + 1 })), { x: "x", y: "y" }).smooth();
  const view = figure(p, { document }).grid.panels[0].views[0];
  assert.ok(view.cols.x.every((x, i) => Math.abs(view.cols.y[i] - (2 * x + 1)) < 1e-9));
});

test("a reflowed figure keeps the text size and changes the width", () => {
  const a = figure(base.line().labels({ title: "T" }), { document, width: 500 });
  const b = figure(base.line().labels({ title: "T" }), { document, width: 1200 });
  assert.equal(a.svg.getAttribute("width"), "500");
  assert.equal(b.svg.getAttribute("width"), "1200");
  const size = (f) => f.svg.querySelector("text[font-weight=bold]").getAttribute("font-size");
  assert.equal(size(a), size(b));
});

test("a narrow figure moves the legend to the bottom", () => {
  assert.equal(figure(base.line(), { document, width: 400 }).legend.horizontal, true);
  assert.equal(figure(base.line(), { document, width: 900 }).legend.horizontal, false);
});

test("long category labels rotate", () => {
  const long = ["a very long category name", "another long category name", "a third long category name"].map((x, i) => ({ x, y: i }));
  assert.equal(figure(plot(long, { x: "x", y: "y" }).bar(), { document, width: 400 }).layout.rotateX, true);
});

test("free y gives each panel its own y domain; a shared axis gives one domain", () => {
  const free = figure(base.line().facet("g", { free: "y" }), { document });
  assert.notDeepEqual(free.home[0].y, free.home[2].y);
  const shared = figure(base.line().facet("g"), { document });
  assert.deepEqual(shared.home[0].y, shared.home[2].y);
  assert.deepEqual(free.home[0].x, free.home[2].x);
});

test("facet panels have equal inner sizes and align on rows", () => {
  const f = figure(base.line().facet("g", { free: "y", ncol: 2 }), { document });
  const [a, b, c] = f.layout.panels;
  assert.equal(a.innerW, c.innerW);
  assert.equal(a.innerH, c.innerH);
  assert.equal(a.y, b.y);
  assert.equal(a.x + a.ml, c.x + c.ml);
});

test("a shared y axis shows on the first column only", () => {
  const f = figure(base.line().facet("g"), { document });
  assert.deepEqual(f.layout.panels.map((p) => p.showY), [true, false, false]);
});

test("the legend has one entry per category, in order", () => {
  const f = figure(base.line(), { document });
  assert.deepEqual(f.legend.items.map((i) => i.value), ["a", "b", "c"]);
  assert.equal(f.legend.items[0].color, "#7AA6DA");
});

test("a continuous color gives a ramp legend", () => {
  assert.equal(figure(LAYERS.tile, { document }).legend.kind, "ramp");
});

test("a set domain is the first view, without expansion", () => {
  const f = figure(base.line().x({ limits: [2, 8] }), { document });
  assert.deepEqual(f.home[0].x, [2, 8]);
});

test("limits set the first view; a null bound keeps the data bound", () => {
  const both = figure(base.line().y({ limits: [-5, 5] }), { document });
  assert.deepEqual(both.home[0].y, [-5, 5]);
  const low = figure(base.line().y({ limits: [0, null] }), { document });
  assert.equal(low.home[0].y[0], 0);
  assert.ok(low.home[0].y[1] > 100);
  const order = figure(plot(rows, { x: "g", y: "v" }).bar().x({ limits: ["c", "a", "b"] }), { document });
  assert.deepEqual(order.home[0].x, ["c", "a", "b"]);
});

test("a named palette and a plotto scheme color the data", () => {
  const sakura = figure(base.line().color({ palette: "sakura" }), { document });
  assert.equal(sakura.legend.items[0].color, "#E16B8C");
  const ramp = figure(LAYERS.tile.color({ scheme: "aiaka", mid: 0 }), { document });
  assert.equal(ramp.color.apply(0), ramp.color.interpolate(0.5));
  assert.throws(() => base.color({ palette: "rainbow" }), /unknown palette "rainbow"/);
});

test("jitter is the same in each render", () => {
  const p = plot(rows, { x: "g", y: "v" }).point({ jitter: 0.5 });
  assert.equal(stable(renderSVG(p.spec())), stable(renderSVG(p.spec())));
});

test("the builder gives specific errors", () => {
  assert.throws(() => base.line({ y: "vv" }), /"vv" is not a column/);
  assert.throws(() => base.line({ colour: "g" }), /unknown option "colour"/);
  assert.throws(() => base.facet("nope"), /"nope" is not a column/);
  assert.throws(() => renderSVG(base.line({ color: "notacolor" }).spec()), /not a column or a color/);
  assert.throws(() => base.theme("fancy"), /unknown style "fancy"/);
  assert.throws(() => base.hist({ density: "yes" }), /density must be true or false/);
});

test("a method returns a new builder and keeps the old one", () => {
  const lines = base.line();
  assert.equal(base.spec().layers.length, 0);
  assert.equal(lines.spec().layers.length, 1);
});

function snapshot(name, svg) {
  const dir = new URL("./snapshots/", import.meta.url);
  const file = new URL(`${name}.svg`, dir);
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, svg);
    return;
  }
  assert.equal(stable(svg), stable(readFileSync(file, "utf8")), `snapshot ${name} changed`);
}

// Observable Plot numbers its clip paths in order of creation; the number is not part of the look.
function stable(svg) {
  return svg.replace(/plot-clip-\d+/g, "clip");
}
