// Node tests of the builder, the scales and the static SVG. Run: npm test (UPDATE_SNAPSHOTS=1 npm test writes new snapshots).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { plot } from "../src/builder.js";
import { drawPanels, figure } from "../src/figure.js";
import { pick } from "../src/hover.js";
import { placeLabels } from "../src/repel.js";
import { slideFigure } from "../src/interact.js";
import { renderSVG } from "../src/render.mjs";
import { equalize, geoAspect, ticks } from "../src/scales.js";
import { textWidth } from "../src/text.js";
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

test("long category labels wrap at spaces, and rotate only when a word is too long", () => {
  const long = ["a very long category name", "another long category name", "a third long category name"].map((x, i) => ({ x, y: i }));
  const wrapped = figure(plot(long, { x: "x", y: "y" }).bar(), { document, width: 400 }).layout;
  assert.equal(wrapped.rotateX, false);
  assert.ok(wrapped.panels[0].wrapX.get("a very long category name").length > 1);
  const words = ["a_very_long_category_name", "another_long_category_name"].map((x, i) => ({ x, y: i }));
  const rotated = figure(plot(words, { x: "x", y: "y" }).bar(), { document, width: 300 }).layout;
  assert.equal(rotated.rotateX, true);
  assert.ok(rotated.panels[0].x >= 0, "the first rotated label stays in the figure");
});

test("aspect 1 gives square panels; a screen plot changes its height for them", () => {
  const sq = (p, opts) => {
    const b = figure(p.spec(), { document, ...opts }).layout.panels[0];
    return Math.abs(b.innerW - b.innerH) < 0.5;
  };
  const p = base.point().facet("k").theme("pastel", { aspect: 1 });
  assert.ok(sq(p, { width: 900 }));
  const f = figure(p.spec(), { document, width: 900 });
  assert.notEqual(f.H, 500);
  assert.ok(sq(base.point().theme("pastel", { format: "slide", aspect: 1 })), "a fixed size keeps its height and narrows the panels");
  assert.equal(figure(base.point().theme("pastel", { format: "slide", aspect: 1 }).spec(), { document }).H, 403);
  assert.throws(() => base.theme("pastel", { aspect: 0 }), /aspect must be a positive number/);
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

const SMALL_INFO = { "data point": 15, location: "hayama", experiment: "cleaning with chlorine" };
const LARGE_INFO = { ...SMALL_INFO, operator: "T. R.", reactor: "R2", dose: 2.5, date: "2026-10-01", notes: "membrane replaced the day before", calibrated: true, batch: null };

for (const position of ["right", "bottom"]) {
  test(`info ${position} matches the snapshot`, () => {
    const svg = renderSVG(base.line().labels({ title: "Water quality" }).info(LARGE_INFO, { position }).spec());
    assert.match(svg, /class="pt-info"/);
    snapshot(`info_${position}`, svg);
  });
}

test("info goes on the right by default, and at the bottom of a narrow figure", () => {
  const at = (p, width) => figure(p, { document, width }).info.position;
  assert.equal(at(base.line().info(SMALL_INFO), 900), "right");
  assert.equal(at(base.line().info(SMALL_INFO), 480), "bottom");
  assert.equal(at(base.line().info(SMALL_INFO, { position: "bottom" }), 900), "bottom");
});

test("a right legend starts below the info card", () => {
  const f = figure(base.line().info(LARGE_INFO, { position: "right" }), { document });
  assert.ok(f.layout.legend.y >= f.layout.info.y + f.info.height);
});

test("info values become text, and entries that do not fit become one more row", () => {
  const f = figure(base.line().info({ n: 0.1234567, ok: false, none: null }), { document });
  assert.deepEqual(f.info.columns[0].rows.map((r) => r.lines[0]), ["0.123457", "false", "–"]);
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`key ${i}`, i]));
  const rows = figure(base.line().info(many, { position: "right" }), { document }).info.columns[0].rows;
  assert.match(rows.at(-1).key, /^\+\d+ more$/);
});

test("info() checks its entries and keeps the old builder", () => {
  assert.throws(() => base.info(SMALL_INFO, { position: "left" }), /unknown position "left"/);
  assert.throws(() => base.info({ date: new Date() }), /Format other values as a string/);
  assert.throws(() => base.info("hayama"), /entries must be/);
  const withInfo = base.info([["15", "first"], ["a", 1]]);
  assert.equal(base.spec().info, undefined);
  assert.deepEqual(withInfo.spec().info, { entries: [["15", "first"], ["a", 1]] });
  assert.equal(base.info({ a: 1 }, { position: "bottom" }).spec().info.position, "bottom");
  assert.equal(withInfo.info(null).spec().info, undefined);
});

test("every mark of a box plot is clipped to the panel", () => {
  const svg = renderSVG(plot(rows, { x: "g", y: "v" }).box().y({ limits: [-0.5, 0.5] }).spec());
  const marks = svg.match(/<g aria-label="(rule|bar|tick|dot)"[^>]*>/g);
  assert.ok(marks.length >= 3, marks.join("\n"));
  for (const g of marks) assert.match(g, /clip-path=/, g);
});

test("copy for a slide draws the current view at the slide size", () => {
  const spec = base.line().theme("wota", { width: 500 }).spec();
  const state = figure(spec, { document });
  const zoomed = state.home.map((d) => ({ ...d, x: [2, 8] }));
  const slide = slideFigure(spec, { ...state, domains: zoomed, hidden: new Set(["b"]) });
  assert.equal(`${slide.W}x${slide.H}`, "691x403");
  assert.equal(slide.theme.style, "wota");
  assert.deepEqual(slide.domains[0].x, [2, 8]);
  assert.ok(slide.hidden.has("b"));
});

test("a tick at the top edge moves the panels down, off the subtitle", () => {
  const p = base.line().labels({ title: "T", subtitle: "S" });
  const free = figure(p.spec(), { document }).layout;
  const edge = figure(p.y({ limits: [-100, 100] }).spec(), { document }).layout;
  assert.equal(free.panels[0].y, free.area.y);
  assert.ok(edge.panels[0].y > edge.area.y);
});

test("a slide fits a long legend and info table without cuts; a screen plot keeps the size", () => {
  const names = ["bk04, not compensated", "bk04, air-shape model", "bk04, air-shape and tap residual model", "bk02, steady runs (no fouling)"];
  const long = names.flatMap((g, k) => Array.from({ length: 10 }, (_, i) => ({ t: i, v: i * k, g })));
  const p = plot(long, { x: "t", y: "v", color: "g" }).line().info({ site: "Hayama", "chlorine dose": "2.5 mg/L", "contact time": "30 min" });
  const slide = figure(p.theme("pastel", { format: "slide" }).spec(), { document });
  // It fits by smaller text or by the footer band: nothing is cut, and the text stays at 80% at least.
  assert.ok(slide.fonts.legend >= 12 * 0.8, `slide legend text: ${slide.fonts.legend}`);
  assert.ok(slide.legend.items.every((it) => !it.lines.at(-1).endsWith("…")));
  assert.equal(slide.info.cut, 0);
  const screen = figure(p.spec(), { document, width: 900 });
  assert.equal(screen.fonts.legend, 11);
  const short = figure(base.line().theme("pastel", { format: "slide" }).spec(), { document });
  assert.equal(short.fonts.legend, 12, "a short legend keeps the slide size");
});

test("a fixed size puts the legend where the panels get the most room, unless the spec sets it", () => {
  const p = base.line().labels({ title: "T" });
  const area = (f) => f.layout.panels[0].innerW * f.layout.panels[0].innerH;
  const auto = figure(p.theme("pastel", { format: "slide" }).spec(), { document });
  const right = figure(p.theme("pastel", { format: "slide", legend: "right" }).spec(), { document });
  const bottom = figure(p.theme("pastel", { format: "slide", legend: "bottom" }).spec(), { document });
  assert.equal(right.legend.horizontal, false, "a set place stays");
  assert.ok(area(auto) >= 0.9 * Math.max(area(right), area(bottom)), "within 10% of the most room");
  assert.equal(figure(p.spec(), { document, width: 900 }).legend.horizontal, false, "a screen plot keeps the legend on the right");
});

test("a slide makes long strip text smaller before it cuts it", () => {
  const strips = ["a rather long facet label number one", "a rather long facet label number two", "short"];
  const rows3 = strips.flatMap((k) => [{ t: 0, v: 0, k }, { t: 1, v: 1, k }]);
  const slide = figure(plot(rows3, { x: "t", y: "v" }).line().facet("k", { ncol: 3 }).theme("pastel", { format: "slide" }).spec(), { document });
  const sizes = slide.layout.strips.map((s) => s.size);
  assert.ok(sizes[0] < slide.fonts.strip && sizes[0] >= slide.fonts.strip * 0.7, `strip text ${sizes[0]}`);
  assert.equal(new Set(sizes).size, 1, "all strips have the same size");
  const screen = figure(plot(rows3, { x: "t", y: "v" }).line().facet("k", { ncol: 3 }).spec(), { document, width: 900 });
  assert.equal(screen.layout.strips[0].size, screen.fonts.strip);
});

test("a slide keeps one panel at most 0.55 times as tall as it is wide; facets and screen plots are not limited", () => {
  const shape = (f) => f.layout.panels[0].innerH / f.layout.panels[0].innerW;
  const one = figure(base.line().theme("pastel", { format: "slide" }).spec(), { document });
  assert.ok(shape(one) <= 0.55 + 1e-9, `one panel: ${shape(one)}`);
  assert.equal(one.H, 403, "the picture keeps its size");
  const tall = figure(base.line().theme("pastel", { format: "slide", legend: "right" }).spec(), { document });
  assert.ok(Math.abs(shape(tall) - 0.55) < 1e-9, "a panel that would be taller gets the limit");
  const facets = figure(plot(rows, { x: "t", y: "v" }).line().facet("k", { ncol: 1 }).theme("pastel", { format: "slide" }).spec(), { document });
  assert.ok(facets.layout.panels.every((b) => b.innerH < b.innerW * 0.55), "stacked facets are flat anyway");
  const screen = figure(base.line().spec(), { document, width: 600 });
  assert.ok(shape(screen) > 0.55, "a screen plot is not limited");
});

test("a slide puts the long legend of stacked panels on the right; a single panel keeps it at the bottom", () => {
  const names = ["bk04, not compensated", "bk04, air-shape model", "bk04, air-shape and tap residual model", "bk02, steady runs (no fouling)"];
  const long = names.flatMap((g, i) => ["uv", "vis"].flatMap((band) => Array.from({ length: 10 }, (_, t) => ({ t, v: t * i, g, band }))));
  const slide = { format: "slide" };
  const stacked = figure(plot(long, { x: "t", y: "v", color: "g" }).line().facet("band", { ncol: 1 }).labels({ title: "T", subtitle: "S" }).theme("pastel", slide).spec(), { document });
  assert.equal(stacked.legend.horizontal, false, "stacked panels: right");
  const single = figure(plot(long.filter((r) => r.band === "uv"), { x: "t", y: "v", color: "g" }).line().labels({ title: "T" }).theme("pastel", slide).spec(), { document });
  assert.equal(single.legend.horizontal, true, "one panel: bottom");
});

test("a long slide title gets smaller text to stay on one line; a screen title keeps its size", () => {
  const title = "Water absorbance per cm of bk04, compensated: high load against the other hours";
  const sizes = (f) => f.layout.texts.filter((t) => t.attrs["font-weight"] === "bold").map((t) => t.attrs["font-size"]); // one per title line
  const slide = figure(base.line().labels({ title }).theme("pastel", { format: "slide" }).spec(), { document });
  assert.equal(sizes(slide).length, 1);
  assert.ok(sizes(slide)[0] < slide.fonts.title && sizes(slide)[0] >= slide.fonts.title * 0.8, `title ${sizes(slide)[0]}`);
  const screen = figure(base.line().labels({ title }).spec(), { document, width: 500 });
  assert.equal(sizes(screen)[0], screen.fonts.title);
  const longer = figure(base.line().labels({ title: `${title}, ${title}` }).theme("pastel", { format: "slide" }).spec(), { document });
  assert.ok(sizes(longer).length > 1 && sizes(longer)[0] === longer.fonts.title, "a title that wraps keeps its size");
});

// --- captions, breaks, dodge, direct labels -------------------------------------------------

const CAPTION = "Dot: value; line: 90% interval. Earthquakes per row, development/test: all earthquakes 120/31, recorded 0 64/12, recorded 1 to 999 30/9, recorded 1,000 to 99,999 22/8, recorded 100,000 or more 4/2.";

test("a long caption wraps at the plot width and keeps its full text", () => {
  const f = figure(base.line().labels({ caption: CAPTION }).spec(), { document, width: 700 });
  const lines = f.layout.texts.filter((t) => t.attrs.class === "pt-caption");
  assert.ok(lines.length >= 2, `caption lines: ${lines.length}`);
  assert.equal(lines.map((t) => t.text).join(" "), CAPTION);
  for (const t of lines) assert.ok(t.attrs.x + textWidth(t.text, f.fonts.tick, false, f.theme.metrics) <= f.W, t.text);
  assert.ok(lines.every((t, i) => i === 0 || t.attrs.y > lines[i - 1].attrs.y), "lines go down");
  const one = figure(base.line().labels({ caption: "Short" }).spec(), { document, width: 700 });
  const drop = one.layout.panels[0].innerH - f.layout.panels[0].innerH;
  assert.ok(Math.abs(drop - (lines.length - 1) * f.fonts.tick * 1.3) < 1, `panels shrink by the extra lines: ${drop}`);
});

test("breaks set the ticks, and labels name them", () => {
  const t = ticks("linear", [0, 12], 5, { breaks: [1, 1.5, 10], labels: ["one", "one and a half", "ten"] });
  assert.deepEqual(t.major, [1, 1.5, 10]);
  assert.deepEqual(t.major.map(t.format), ["one", "one and a half", "ten"]);
  assert.deepEqual(t.minor, []);
  assert.deepEqual(ticks("log", [0.9, 30], 5).major, [1, 2, 5, 10, 20], "fewer than 3 powers of ten: 1-2-5 ticks");
  assert.deepEqual(ticks("log", [0.5, 2000], 5).major, [1, 10, 100, 1000]);
  const svg = renderSVG(base.line().x({ type: "log", breaks: [1, 1.5, 2, 3, 5, 10] }).spec());
  for (const v of ["1.5", "3"]) assert.match(svg, new RegExp(`>${v}</text>`));
  // Observable Plot thins the labels of a log axis with many ticks (it blanked 5 here): every break keeps its label.
  const wide = [0.97, 1.6, 3.3, 10.4, 1.05, 11].map((v, i) => ({ v, g: `p${i % 2}`, r: `recorded ${i % 3} to 100,000 or more` }));
  const logSvg = renderSVG(plot(wide, { x: "v", y: "r" }).point().facet("g").x({ type: "log", limits: [0.89, 11.75], breaks: [1, 1.5, 2, 3, 5, 10] }).theme("paper", { width: 1000, height: 440 }).spec());
  for (const label of logSvg.matchAll(/<g aria-label="x-axis tick label".*?<\/g>/gs)) assert.deepEqual([...label[0].matchAll(/>([^<]*)<\/text>/g)].map((m) => m[1]), ["1", "1.5", "2", "3", "5", "10"]);
  assert.throws(() => base.x({ labels: ["a"] }), /labels need breaks/);
  assert.throws(() => base.x({ breaks: [1, 2], labels: ["a"] }), /labels must have one entry per break/);
  assert.throws(() => base.x({ breaks: 5 }), /breaks must be a list/);
  assert.throws(() => renderSVG(plot(rows, { x: "g", y: "v" }).bar().x({ breaks: [1] }).spec()), /breaks apply to number, log and time axes/);
});

const forest = [];
for (const [r, row] of ["small", "medium", "large"].entries()) {
  for (const [m, model] of ["severity", "reference"].entries()) forest.push({ row, model, v: 1 + r + m, lo: 0.5 + r, hi: 2 + r + m });
}
const forestPlot = (o = {}) =>
  plot(forest, { x: "v", y: "row", color: "model" }).segment({ x: "lo", xend: "hi", yend: "row", position: "dodge", ...o }).point({ position: "dodge", ...o });

// The center of each dot in panel px, in data row order.
function dots(state) {
  const g = state.panels[0].g.querySelector('g[aria-label="dot"]');
  const [dx, dy] = (g.querySelector("g[transform]")?.getAttribute("transform").match(/-?[\d.]+/g) ?? [0, 0]).map(Number); // band centering
  return [...g.querySelectorAll("circle")].map((c) => [+c.getAttribute("cx") + dx, +c.getAttribute("cy") + dy]);
}

test("dodge puts the colors side by side in each category of y, the same in every row", () => {
  const f = figure(forestPlot().spec(), { document });
  const bw = (f.layout.panels[0].innerH / (3 + 0.2)) * 0.8;
  const d = dots(f);
  // The legend order is reference, severity: reference takes the upper slot of each row.
  for (let r = 0; r < 3; r++) assert.ok(Math.abs(d[2 * r][1] - d[2 * r + 1][1] - bw / 2) < 0.01, `row ${r}: ${d[2 * r][1]} ${d[2 * r + 1][1]}`);
  const links = [...f.panels[0].g.querySelectorAll('g[aria-label="link"] path')].map((p) => +p.getAttribute("d").match(/-?[\d.]+/g)[1]);
  const ly = f.panels[0].g.querySelector('g[aria-label="link"] g[transform], g[aria-label="link"][transform]')?.getAttribute("transform").match(/-?[\d.]+/g).map(Number)[1] ?? 0;
  links.forEach((y, i) => assert.ok(Math.abs(y + ly - d[i][1]) < 0.01, "each segment is at the height of its point"));
  const hit = pick(f, 0, d[3][0], d[3][1]);
  assert.equal(hit.header, "reference");
  const hidden = dots(figure(forestPlot().spec(), { document, hidden: new Set(["reference"]) }));
  assert.ok(Math.abs(hidden[0][1] - d[0][1]) < 0.01, "a hidden color keeps its slot");
});

test("dodge needs a category axis and a category color; errorbar dodges on x only", () => {
  assert.throws(() => base.point({ position: "stack" }), /position must be overlay or dodge/);
  assert.throws(() => renderSVG(base.point({ position: "dodge" }).spec()), /dodge needs a category x or y axis/);
  assert.throws(() => renderSVG(plot(rows, { x: "g", y: "v", color: "t" }).point({ position: "dodge" }).spec()), /dodge needs color mapped to a category column/);
  assert.throws(() => renderSVG(plot(rows, { x: "t", ymin: "v", color: "g" }).errorbar({ ymax: 2, position: "dodge" }).spec()), /dodge needs a category x axis/);
  const svg = renderSVG(plot(rows.filter((r) => r.t < 3), { x: "k", ymin: "v", color: "g" }).errorbar({ ymax: 2, position: "dodge" }).spec());
  assert.match(svg, /aria-label="rule"/);
});

test("direct labels name each line at its end, apart from each other", () => {
  const ends = [];
  for (const g of ["first model", "second model", "a third, much longer model name"]) for (let t = 0; t <= 10; t++) ends.push({ t, v: t + (g === "first model" ? 0 : 0.02), g });
  const f = figure(plot(ends, { x: "t", y: "v", color: "g" }).line({ direct: true }).spec(), { document });
  const texts = [...f.panels[0].g.querySelectorAll('g[aria-label="text"] text')];
  assert.equal(texts.length, 3);
  const ys = texts.map((t) => +t.getAttribute("transform").match(/-?[\d.]+/g)[1]).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= f.fonts.tick * 1.1, `labels apart: ${ys}`);
  assert.ok(f.layout.panels[0].mr > 0);
  const short = figure(plot(ends.map((r) => ({ ...r, g: r.g.slice(0, 3) })), { x: "t", y: "v", color: "g" }).line({ direct: true }).spec(), { document });
  assert.ok(short.layout.panels[0].mr < f.layout.panels[0].mr, "the margin follows the longest name");
  assert.equal(figure(base.line().spec(), { document }).layout.panels[0].mr, 0);
});

// --- maps: polygons, fill scale, binned scale, coord("geo") ----------------------------------

const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
const districts = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "A", hh: 10 }, geometry: { type: "Polygon", coordinates: [square(135, 35, 1), square(135.25, 35.25, 0.5)] } },
    { type: "Feature", properties: { name: "B", hh: 2000 }, geometry: { type: "MultiPolygon", coordinates: [[square(136, 35, 1)], [square(137.2, 35.2, 0.3)]] } },
    { type: "Feature", properties: { name: "C", hh: null }, geometry: { type: "Polygon", coordinates: [square(135, 36, 1.123456789)] } },
  ],
};
const towns = [
  { lon: 135.6, lat: 36.4, size: "small" },
  { lon: 136.5, lat: 35.5, size: "large" },
];
const HH_BREAKS = [0, 50, 1000, 10000, 100000];

test("a FeatureCollection gives a geometry column, and polygon() draws it with holes", () => {
  const spec = plot(districts).polygon({ fill: "hh", tooltip: "name" }).spec();
  assert.equal(spec.layers[0].mapping.geometry, "geometry", "the geometry column is the default");
  const geometry = spec.data[0].columns.geometry;
  assert.equal(geometry.type, "geometry");
  assert.equal(geometry.values[2].coordinates[0][1][0], 136.12346, "coordinates keep 5 decimals");
  const f = figure(spec, { document });
  const g = f.panels[0].g.querySelector('g[aria-label="geo"]');
  assert.equal(g.getAttribute("fill-rule"), "evenodd");
  assert.equal(g.querySelectorAll("path").length, 3);
  assert.deepEqual(f.home[0].x, [134.875, 137.625], "the domain covers every polygon (135 to 137.5), with 5% space");
  const at = (lon, lat) => [f.panels[0].plot.scale("x").apply(lon), f.panels[0].plot.scale("y").apply(lat)];
  assert.equal(pick(f, 0, ...at(135.1, 35.1)).header, "A");
  assert.equal(pick(f, 0, ...at(135.5, 35.5)), null, "a hole is not part of the polygon");
  assert.equal(pick(f, 0, ...at(137.3, 35.3)).header, "B", "every part of a multipolygon");
  assert.match(pick(f, 0, ...at(135.1, 35.1)).rows[0].value, /^10$/);
});

test("polygon checks its geometry", () => {
  const line = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }] };
  assert.throws(() => renderSVG(plot(line).polygon().spec()), /geometry must be Polygon or MultiPolygon, not LineString/);
  assert.throws(() => renderSVG(plot(districts).polygon({ fill: "geometry" }).spec()), /is a geometry column; use it as geometry/);
  assert.throws(() => renderSVG(plot(districts).polygon({ geometry: "name" }).spec()), /geometry must be a geometry column/);
  const outline = renderSVG(plot(districts).polygon({ color: "gray", size: 1 }).spec());
  assert.match(outline, /fill="none"/, "without fill: outlines only");
});

test("fill and color are two scales with two legends; only the color legend toggles", () => {
  const p = plot(districts).polygon({ fill: "hh" }).point({ data: towns, x: "lon", y: "lat", color: "size" }).fill({ breaks: HH_BREAKS });
  const f = figure(p.spec(), { document });
  assert.equal(f.legend.kind, "stack");
  assert.deepEqual(f.legend.parts.map((part) => part.model.kind), ["swatches", "steps"]);
  assert.deepEqual(f.legend.items.map((it) => it.value), ["large", "small"], "the items are the color keys");
  assert.equal(f.svg.querySelectorAll(".pt-key").length, 2);
  assert.ok(f.legend.parts[1].y >= f.legend.parts[0].model.height, "the second legend is below the first");
  const constant = plot(districts).polygon({ fill: "#DDDDDD" }).spec();
  assert.match(renderSVG(constant), /fill="#DDDDDD"/);
  assert.throws(() => renderSVG(plot(districts).polygon({ fill: "nocolor" }).spec()), /not a column or a color/);
});

test("breaks make a binned scale: classes closed on the left, colors set by the breaks", () => {
  const f = figure(plot(districts).polygon({ fill: "hh" }).fill({ breaks: HH_BREAKS, scheme: "matcha" }).spec(), { document });
  const { fill } = f;
  assert.equal(fill.kind, "binned");
  assert.equal(fill.colors.length, 5);
  assert.equal(fill.apply(10), fill.colors[0]);
  assert.equal(fill.apply(50), fill.colors[1], "a value at a break is in the class above");
  assert.equal(fill.apply(250000), fill.colors[4], "the last class is open");
  assert.equal(fill.apply(-1), f.theme.muted);
  assert.equal(fill.apply(null), f.theme.muted);
  const steps = f.legend;
  assert.equal(steps.kind, "steps");
  assert.deepEqual(steps.texts, ["0", "50", "1,000", "10,000", "100,000"]);
  assert.equal(f.svg.querySelectorAll(".pt-legend rect").length, 5);
  const named = figure(plot(districts).polygon({ fill: "hh" }).fill({ breaks: [0, 50], labels: ["under 50", "50 or more"], values: ["yellow", "red"] }).spec(), { document });
  assert.deepEqual(named.legend.texts, ["under 50", "50 or more"]);
  assert.equal(named.fill.apply(60), named.theme.colors.red);
  const clamped = figure(plot(districts).polygon({ fill: "hh" }).fill({ breaks: [20, 50], clamp: true }).spec(), { document });
  assert.equal(clamped.fill.apply(10), clamped.fill.colors[0]);
  assert.throws(() => base.color({ breaks: [1, 1] }), /breaks must increase/);
  assert.throws(() => base.color({ breaks: [0, 1], mid: 0.5 }), /mid does not apply with breaks/);
  assert.throws(() => base.color({ breaks: [0, 1], values: ["red"] }), /one color per break/);
  assert.throws(() => renderSVG(base.line().color({ breaks: [0, 1] }).spec()), /breaks apply to a number or time column/);
});

test('coord("geo") gives equal distance per px in x and y, also after a zoom', () => {
  const p = plot(districts).polygon({ fill: "hh" }).point({ data: towns, x: "lon", y: "lat" }).coord("geo");
  const f = figure(p.spec(), { document });
  const box = f.layout.panels[0];
  assert.ok(Math.abs(box.innerH / box.innerW - geoAspect(f.home[0])) < 0.01, "the panel has the shape of the map");
  const kmPerPx = (d, b) => [((d.x[1] - d.x[0]) * Math.cos((((d.y[0] + d.y[1]) / 2) * Math.PI) / 180)) / b.innerW, (d.y[1] - d.y[0]) / b.innerH];
  const zoomed = f.home.map((d) => ({ ...d, x: [135.2, 135.4] })); // a narrow box: the drawn y grows
  const z = figure(p.spec(), { document, domains: zoomed });
  const drawn = equalize(z.domains[0], box.innerW, box.innerH);
  const [ex, ey] = kmPerPx(drawn, box);
  assert.ok(Math.abs(ex - ey) / ey < 1e-9, `equal scale: ${ex} ${ey}`);
  assert.deepEqual(z.domains[0], zoomed[0], "the stored domain does not change");
  const svg = renderSVG(p.spec());
  assert.match(svg, />136.0°E</);
  assert.match(svg, />36.0°N</);
  assert.equal(f.ns.labels.x, null, "no axis titles by default");
  assert.throws(() => renderSVG(p.facet("hh", { free: "y" }).spec()), /facet free must be "both" or unset/);
  assert.throws(() => renderSVG(plot(rows, { x: "t", y: "v" }).line().x({ type: "log" }).coord("geo").spec()), /x and y must be number axes/);
  assert.throws(() => base.coord("mercator"), /unknown type "mercator"/);
});

// --- insets, scale bar, north arrow, repel ---------------------------------------------------

const islands = [
  { lon: 135.2, lat: 35.2, name: "main 1", panel: "a" },
  { lon: 135.8, lat: 35.7, name: "main 2", panel: "a" },
  { lon: 135.4, lat: 35.5, name: "main 3", panel: "b" },
  { lon: 127.7, lat: 26.2, name: "far", panel: "a" },
];
const islandMap = () => plot(islands, { x: "lon", y: "lat" }).point().x({ limits: [135, 136] }).y({ limits: [35, 36] }).coord("geo");

test("an inset shows its own extent in each panel, keeps it on zoom, and stays after a redraw", () => {
  const p = islandMap().inset({ x: [127, 128.5], y: [25.8, 26.8], at: [0.02, 0.62, 0.32, 0.98] });
  const f = figure(p.spec(), { document });
  assert.equal(f.mainCount, 1);
  assert.equal(f.panels.length, 2);
  const [main, inset] = f.layout.panels;
  assert.ok(inset.inset && Math.abs(inset.x - (main.x + main.ml + 0.02 * main.innerW)) < 1e-9 && Math.abs(inset.innerW - 0.3 * main.innerW) < 1e-9);
  const circles = (k) => f.panels[k].g.querySelectorAll('g[aria-label="dot"] circle').length;
  assert.equal(circles(1), 4, "the inset draws every point of its panel; the far one is inside its extent");
  const sx = f.panels[1].plot.scale("x");
  const sy = f.panels[1].plot.scale("y");
  assert.equal(pick(f, 1, sx.apply(127.7), sy.apply(26.2)).k, 3, "hover works in the inset");
  assert.deepEqual(f.home[1], { x: [127, 128.5], y: [25.8, 26.8] });
  f.hidden = new Set(["x"]);
  drawPanels(f);
  assert.equal(f.panels.length, 2, "a redraw (legend click, zoom) draws the inset again");
  assert.equal(f.svg.querySelectorAll(".pt-panel").length, 2);
  const faceted = figure(p.facet("panel").spec(), { document });
  assert.equal(faceted.panels.length, 4, "two panels, each with its inset");
  assert.throws(() => base.inset({ x: [1, 0], y: [0, 1], at: [0, 0, 0.5, 0.5] }), /x must be \[low, high\]/);
  assert.throws(() => base.inset({ x: [0, 1], y: [0, 1], at: [0, 0, 1.5, 0.5] }), /at must be \[left, bottom, right, top\]/);
  assert.throws(() => renderSVG(plot(rows, { x: "g", y: "v" }).bar().inset({ x: [0, 1], y: [0, 1], at: [0, 0, 0.5, 0.5] }).spec()), /x and y must be number or time axes/);
});

test("the scale bar has a round length that matches the map scale; the north arrow points up", () => {
  const f = figure(islandMap().coord("geo", { scalebar: true, north: true }).spec(), { document });
  assert.deepEqual([f.ns.coord.scalebar, f.ns.coord.north], ["bottom-left", "top-right"]);
  const bar = f.svg.querySelector(".pt-scalebar");
  const [km, px] = [+bar.getAttribute("data-km"), +bar.getAttribute("data-px")];
  const box = f.layout.panels[0];
  const drawn = equalize(f.domains[0], box.innerW, box.innerH);
  const kmPerPx = ((drawn.x[1] - drawn.x[0]) * 111.32 * Math.cos((((drawn.y[0] + drawn.y[1]) / 2) * Math.PI) / 180)) / box.innerW;
  assert.ok(Math.abs(px * kmPerPx - km) < 1e-6, `${px} px is ${km} km`);
  assert.ok([1, 2, 5].includes(km / 10 ** Math.floor(Math.log10(km))), `a round length: ${km}`);
  assert.ok(px <= box.innerW * 0.2 && px > box.innerW * 0.07);
  assert.match(bar.textContent, /^\d[\d,]* km$/);
  assert.equal(f.svg.querySelector(".pt-north text").textContent, "N");
  assert.equal(figure(islandMap().spec(), { document }).svg.querySelector(".pt-scalebar"), null);
  assert.throws(() => base.coord("geo", { scalebar: "middle" }), /unknown scalebar "middle"/);
});

test("repel places dense labels without overlaps and clear of the points", () => {
  const anchors = Array.from({ length: 30 }, (_, i) => ({ x: 300 + (i % 6) * 6, y: 200 + Math.floor(i / 6) * 5 }));
  const sizes = anchors.map(() => ({ w: 40, h: 12 }));
  const points = anchors.map((a) => ({ ...a, r: 3 }));
  const spots = placeLabels(anchors, sizes, points, { x0: 0, y0: 0, x1: 700, y1: 500 }, 11);
  const boxes = spots.map((s, i) => ({ x0: s.x - 20, x1: s.x + 20, y0: s.y - 6, y1: s.y + 6, i }));
  for (const a of boxes) for (const b of boxes) if (a.i < b.i) assert.ok(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0, `labels ${a.i} and ${b.i} overlap`);
  for (const b of boxes) for (const pt of points) assert.ok(Math.hypot(pt.x - Math.max(b.x0, Math.min(b.x1, pt.x)), pt.y - Math.max(b.y0, Math.min(b.y1, pt.y))) >= pt.r - 1e-9, "a label covers a point");
  assert.ok(spots.some((s) => s.leader), "far labels get a leader line");
  assert.equal(placeLabels([{ x: 50, y: 50 }], [{ w: 20, h: 10 }], [], { x0: 0, y0: 0, x1: 100, y1: 100 }, 10)[0].x, 50 + 10 + 4, "a free label sits right of its anchor");
  const blocked = placeLabels([{ x: 50, y: 50 }], [{ w: 20, h: 10 }], [], { x0: 0, y0: 0, x1: 100, y1: 100 }, 10, [{ x0: 52, y0: 40, x1: 100, y1: 60 }])[0];
  assert.ok(blocked.x + 10 <= 52 || blocked.y + 5 <= 40 || blocked.y - 5 >= 60, "a label keeps clear of a blocked box (an inset, the scale bar)");
  const svg = renderSVG(plot(islands, { x: "lon", y: "lat" }).point().text({ label: "name", repel: true }).spec());
  assert.match(svg, />main 1</);
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
