// Browser test in headless Chrome: the browser draws the same SVG as Node, and the toolbar, zoom, Home, hover,
// legend and reflow work. Run: npm run browser-test (needs Google Chrome; set CHROME to its path on Linux).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plot } from "../src/builder.js";
import { bundle, renderSVG } from "../src/render.mjs";
import { launch } from "./chrome.mjs";

const rows = [];
for (const sensor of ["sensor A", "sensor B", "sensor C"]) {
  for (let i = 0; i < 300; i++) {
    for (const series of ["raw", "clean"]) {
      const v = (series === "raw" ? 1.2 : 1) * (sensor === "sensor B" ? 10 : 1) * Math.sin(i / 20);
      rows.push({ time: new Date(Date.UTC(2026, 9, 20) + i * 3e5), v, sensor, series });
    }
  }
}
const spectra = [];
for (let h = 0; h < 24; h++) for (let w = 220; w <= 420; w += 1.4) spectra.push({ wl: w, a: Math.exp(-(((w - 260) / 22) ** 2)) * (1 + h / 24), hour: h });

const specs = [
  plot(rows, { x: "time", y: "v", color: "series" }).line().hline({ y: 0 }).facet("sensor", { free: "y" }).labels({ title: "Test" }).info({ site: "hayama", run: 15 }).spec(),
  plot(spectra, { x: "wl", y: "a", color: "hour", group: "hour" }).line().spec(),
  plot(rows.slice(0, 60), { x: "time", y: "v", color: "series" }).line().spec(),
];
const modes = [true, true, false]; // plot 2 is static

const dir = mkdtempSync(join(tmpdir(), "plotto-test-"));
const js = (await bundle({ cdn: false })).replace(/<\/script/gi, "<\\/script");
const page = `<!doctype html><meta charset="utf-8"><body style="margin:0">
${specs.map((_, i) => `<div id="p${i}" style="width:900px"></div>`).join("")}
<script type="application/json" id="specs">${JSON.stringify(specs).replace(/<\//g, "<\\/")}</script>
<script type="module">${js}
const specs = JSON.parse(document.getElementById("specs").textContent);
const modes = ${JSON.stringify(modes)};
window.ctl = specs.map((s, i) => plotto.draw(s, document.getElementById("p" + i), { interactive: modes[i] }));
window.ready = true;</script>`;
writeFileSync(join(dir, "test.html"), page);

// Observable Plot numbers its clip paths in order of creation; the number is not part of the look.
const stable = (svg) => svg.replace(/plot-clip-\d+/g, "clip");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed++;
};

const b = await launch();
try {
  await b.open(`file://${join(dir, "test.html")}`);
  for (const [i, spec] of specs.entries()) {
    const browser = await b.evaluate(`plotto.toSVG(JSON.parse(document.getElementById("specs").textContent)[${i}])`);
    const node = renderSVG(spec);
    check(`plot ${i}: browser SVG equals Node SVG`, stable(browser) === stable(node), firstDifference(stable(browser), stable(node)));
  }
  const drawn = await b.evaluate("(() => { const s = ctl[0].state.svg.cloneNode(true); s.querySelector('.pt-overlay').remove(); return s.outerHTML; })()");
  check("the drawn plot at the theme width equals the Node SVG", stable(drawn) === stable(renderSVG(specs[0])), firstDifference(stable(drawn), stable(renderSVG(specs[0]))));

  // Figure px of plot i → page px.
  const at = async (i, x, y) => JSON.parse(await b.evaluate(`(() => { const r = ctl[${i}].state.svg.getBoundingClientRect(); const k = r.width / ctl[${i}].state.W; return JSON.stringify([r.left + ${x} * k, r.top + ${y} * k]); })()`));
  const panel = JSON.parse(await b.evaluate("JSON.stringify(ctl[0].state.layout.panels[0])"));
  const left = panel.x + panel.ml;
  const drag = async (i, [x0, y0], [x1, y1]) => {
    const [a, c] = [await at(i, x0, y0), await at(i, x1, y1)];
    await b.mouse("mouseMoved", ...a, { buttons: 0 });
    await b.mouse("mousePressed", ...a);
    await b.mouse("mouseMoved", ...c);
    await b.mouse("mouseReleased", ...c);
  };
  const click = async ([x, y], count = 1) => {
    for (let k = 1; k <= count; k++) {
      await b.mouse("mousePressed", x, y, { clickCount: k });
      await b.mouse("mouseReleased", x, y, { clickCount: k });
    }
  };
  const center = (selector) => b.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`).then(JSON.parse);

  const infoSvg = () => b.evaluate("ctl[0].state.svg.querySelector('.pt-info').outerHTML");
  const infoBefore = await infoSvg();
  await drag(0, [left + 60, panel.y + 30], [left + 200, panel.y + 32]);
  const zoomed = JSON.parse(await b.evaluate("JSON.stringify(ctl[0].state.domains)"));
  const home = JSON.parse(await b.evaluate("JSON.stringify(ctl[0].state.home)"));
  check("a flat drag zooms x in all panels (shared x)", zoomed.every((d) => d.x[0] > home[0].x[0] && d.x[1] < home[0].x[1] && d.x[0] === zoomed[0].x[0]));
  check("a flat drag keeps y", JSON.stringify(zoomed.map((d) => d.y)) === JSON.stringify(home.map((d) => d.y)));

  await click(await at(0, left + 100, panel.y + 30), 2);
  check("double-click restores the first view", await b.evaluate("ctl[0].state.domains === ctl[0].state.home"));
  check("zoom and Home leave the info table as it was", (await infoSvg()) === infoBefore);
  const homeSvg = await b.evaluate("ctl[0].state.svg.querySelector('.pt-panels').outerHTML");
  const firstSvg = stable(renderSVG(specs[0])).match(/<g class="pt-panels">.*<\/g><g class="pt-legend"/s)?.[0]?.replace(/<g class="pt-legend"$/, "");
  check("Home draws the same panels as the first view", stable(homeSvg) === firstSvg);

  await click(await center("#p0 .pt-btn[title='Zoom in']"));
  const inX = JSON.parse(await b.evaluate("JSON.stringify(ctl[0].state.domains[0].x)"));
  const ratio = (inX[1] - inX[0]) / (home[0].x[1] - home[0].x[0]);
  check("the zoom-in button keeps 75% of the range", Math.abs(ratio - 0.75) < 1e-9, ratio.toFixed(3));
  await click(await center("#p0 .pt-btn[title^='Reset view']"));
  check("the Home button restores the first view", await b.evaluate("ctl[0].state.domains === ctl[0].state.home"));

  const anchor = JSON.parse(await b.evaluate("JSON.stringify((() => { const p = ctl[0].state.panels[0]; const v = p.layers[0].view; return [p.plot.scale('x').apply(v.cols.x[40]), p.plot.scale('y').apply(v.cols.y[40]), v.cols.color[40]]; })())"));
  await b.mouse("mouseMoved", ...(await at(0, panel.x + anchor[0], panel.y + anchor[1])), { buttons: 0 });
  await sleep(100);
  const tip = await b.evaluate("document.querySelector('#p0 .pt-tip').textContent");
  check("a line hover shows every series at the nearest x", /^time {2}10-20 \d\d:\d\d/.test(tip) && tip.includes("raw") && tip.includes("clean"), tip);
  const strong = await b.evaluate("(() => { const cells = [...document.querySelectorAll('#p0 .pt-tip .pt-b')]; return JSON.stringify([cells[0]?.style.background, cells[1]?.textContent]); })()").then(JSON.parse);
  const seriesColor = await b.evaluate(`ctl[0].state.legend.items.find((it) => it.value === ${JSON.stringify(anchor[2])}).color`);
  const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
  check("the series under the pointer is bold, with its color", strong[1] === anchor[2] && strong[0] === rgb(seriesColor), JSON.stringify(strong));
  check("a line hover shows a crosshair", await b.evaluate("!!ctl[0].state.overlay.querySelector('line')"));

  // A click pins the label: it stays when the pointer moves away; the next click releases it.
  const tipShown = () => b.evaluate("document.querySelector('#p0 .pt-tip').style.display === 'block'");
  const onLine = await at(0, panel.x + anchor[0], panel.y + anchor[1]);
  await b.mouse("mousePressed", ...onLine, { buttons: 1 });
  await b.mouse("mouseMoved", onLine[0] + 2, onLine[1] + 1); // a small jitter is still a click
  await b.mouse("mouseReleased", onLine[0] + 2, onLine[1] + 1);
  const notZoomed = await b.evaluate("ctl[0].state.domains === ctl[0].state.home");
  await b.mouse("mouseMoved", ...(await at(0, panel.x + 5, panel.y + 5)), { buttons: 0 });
  await sleep(100);
  check("a click (with 2 px of jitter) pins the label and does not zoom", notZoomed && (await tipShown()) && (await b.evaluate("document.querySelector('#p0 .pt-tip').classList.contains('pt-pinned')")));
  const empty = await at(0, left + 3, panel.y + panel.innerH - 3);
  await sleep(400);
  await click(empty);
  await sleep(100);
  check("the next click releases the label", !(await b.evaluate("document.querySelector('#p0 .pt-tip').classList.contains('pt-pinned')")));
  await sleep(400);

  const count = () => b.evaluate("ctl[0].state.svg.querySelectorAll('.pt-panel [aria-label=line] path').length");
  const before = await count();
  const key = await center("#p0 .pt-key");
  await click(key);
  const hidden = await count();
  await sleep(400); // not a double-click
  await click(key);
  check("a legend click hides a series and a second click shows it", hidden < before && (await count()) === before, `${before} → ${hidden}`);
  await sleep(400);
  await click(key);
  await sleep(120);
  await click(key);
  const isolated = await b.evaluate("ctl[0].state.hidden.size");
  await sleep(400);
  await click(key);
  await sleep(120);
  await click(key);
  check("two quick legend clicks show only that series; two more show all", isolated === 1 && (await b.evaluate("ctl[0].state.hidden.size")) === 0, `${isolated}`);
  await sleep(400);
  await click(key);
  await sleep(450);
  await click(key);
  check("a slower second legend click shows the series again", (await b.evaluate("ctl[0].state.hidden.size")) === 0);

  const size = () => b.evaluate("getComputedStyle(document.querySelector('#p0 .pt-root')).getPropertyValue('--pt-size')");
  const titleSize = () => b.evaluate("ctl[0].state.svg.querySelector('text[font-weight=bold]').getAttribute('font-size')");
  const [wide, wideTitle] = [await size(), await titleSize()];
  await b.evaluate("document.getElementById('p0').style.width = '500px'");
  await sleep(400);
  const narrowW = await b.evaluate("ctl[0].state.svg.getAttribute('width')");
  check("a resize lays the plot out again at the new width", narrowW === "500", narrowW);
  check("the text keeps its size after a resize", (await titleSize()) === wideTitle);
  check("the toolbar is smaller on a narrow plot", parseInt(await size()) < parseInt(wide), `${wide} → ${await size()}`);

  check("a static plot has the copy-for-a-slide button", await b.evaluate("!!document.querySelector('#p2 .pt-btn[title=\"Copy for a slide\"]')"));
  check("a static plot has the copy and download buttons", await b.evaluate("!!document.querySelector('#p2 .pt-btn[title=\"Copy as PNG\"]') && !!document.querySelector('#p2 .pt-btn[title=\"Download\"]')"));
  check("a static plot has no zoom buttons", await b.evaluate("!document.querySelector('#p2 .pt-btn[title^=\"Zoom\"]')"));
  // The clipboard is stubbed: the test reads the size of the PNG that the button writes.
  const slidePNG = await b.evaluate(`(async () => {
    let item;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: async ([i]) => { item = i; } } });
    document.querySelector("#p2 .pt-btn[title='Copy for a slide']").click();
    for (let k = 0; k < 50 && !item; k++) await new Promise((r) => setTimeout(r, 100));
    const bitmap = await createImageBitmap(await item.getType("image/png"));
    const html = await (await item.getType("text/html")).text();
    return bitmap.width + "x" + bitmap.height + " " + html.match(/width="\\d+" height="\\d+"/)?.[0];
  })()`);
  check("copy for a slide writes a 2.8× PNG and an <img> at the slide size (691 px = 7.2 in in Google Slides)", /^1935x1128 width="691" height="403"$/.test(slidePNG), slidePNG);
  const panel2 = JSON.parse(await b.evaluate("JSON.stringify(ctl[2].state.layout.panels[0])"));
  await drag(2, [panel2.x + panel2.ml + 50, panel2.y + 30], [panel2.x + panel2.ml + 250, panel2.y + 200]);
  check("a drag on a static plot does not zoom", await b.evaluate("ctl[2].state.domains === ctl[2].state.home"));

  // Many series (24 spectra): the label shows only the series under the pointer, and counts the others.
  await b.evaluate("document.getElementById('p1').scrollIntoView()");
  const p1 = JSON.parse(await b.evaluate("(() => { const st = ctl[1].state; const b = st.layout.panels[0]; const r = st.svg.getBoundingClientRect(); return JSON.stringify([r.left + b.x + b.ml + b.innerW * 0.3, r.top + b.y + b.innerH * 0.3]); })()"));
  await b.mouse("mouseMoved", p1[0] - 2, p1[1], { buttons: 0 });
  await b.mouse("mouseMoved", ...p1, { buttons: 0 });
  await sleep(150);
  const many = await b.evaluate("(() => { const t = document.querySelector('#p1 .pt-tip'); return JSON.stringify([t.querySelectorAll('.pt-k').length, t.querySelector('.pt-more')?.textContent ?? '', ctl[1].state.overlay.querySelectorAll('circle').length]); })()").then(JSON.parse);
  check("with 24 series, the label shows one series and counts the others", many[0] === 2 && many[1] === "23 other series at this x" && many[2] === 1, JSON.stringify(many));

  const ms = await b.evaluate("(() => { const c = ctl[1]; const t = performance.now(); for (let k = 0; k < 10; k++) c.redraw(); return (performance.now() - t) / 10; })()");
  check("a spectra plot (24 × 143 points) draws again in less than 50 ms", ms < 50, `${ms.toFixed(1)} ms`);
  check("no page errors", b.errors.length === 0, b.errors.join("; "));
} finally {
  b.close();
}
process.exit(failed ? 1 : 0);

function firstDifference(a, c) {
  if (a === c) return "";
  let i = 0;
  while (a[i] === c[i]) i++;
  return `browser …${a.slice(i - 60, i + 60)}… node …${c.slice(i - 60, i + 60)}…`;
}
