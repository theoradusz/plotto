// Browser output: draws the figure into an element, at the element width, with a toolbar.
// interactive adds zoom, pan, hover and the legend toggle. A zoom or a resize draws again with the same code,
// so the look does not change.
import { copyPNG, downloadPNG, downloadSVG } from "./copy.js";
import { drawPanels, figure } from "./figure.js";
import { pick } from "./hover.js";
import { svgElement } from "./svg.js";
import { headerColors } from "./theme.js";
import { installStyles, themeVars, toolbar } from "./toolbar.js";

const DRAG_MIN = 5; // px: a smaller drag is a click
const MIN_WIDTH = 320; // px
const ZOOM_STEP = 0.75; // zoom in keeps 75% of the range
const DOUBLE = 300; // ms: two legend clicks within this time are a double-click
// The pasted size of "Copy for a slide", at 96 px per inch: 6.72 × 4.2 in, 75% of the height of a 16:9 Google slide.
export const SLIDE_SIZE = { width: 645, height: 403 };
// PNG px per pasted px: 288 px per inch, and 1935 px wide, under the ~2000 px above which Slides may compress images.
const SLIDE_SCALE = 3;

// The current view (zoom and hidden series) drawn again in the slide format, for "Copy for a slide".
export function slideFigure(spec, state) {
  const s = typeof spec?.spec === "function" ? spec.spec() : spec;
  const theme = { ...s.theme, format: "slide", width: null, height: null, size: null };
  const domains = state.domains === state.home ? undefined : state.domains;
  return figure({ ...s, theme }, { document: state.doc, domains, hidden: state.hidden });
}

// Returns a controller: { state (the current figure), redraw(), destroy() }.
export function draw(spec, el, { interactive = false, width } = {}) {
  const doc = el.ownerDocument;
  installStyles(doc);
  const root = doc.createElement("div");
  root.className = "pt-root";
  const tip = Object.assign(doc.createElement("div"), { className: "pt-tip" });
  const ctl = { state: null, mode: "zoom" };
  let observer = null;

  const render = (w) => {
    const keep = ctl.state && { domains: ctl.state.domains === ctl.state.home ? undefined : ctl.state.domains, hidden: ctl.state.hidden };
    const state = figure(spec, { document: doc, width: w, ...keep });
    const old = ctl.state?.svg;
    state.overlay = state.svg.appendChild(svgElement(doc, "g", { class: "pt-overlay", "pointer-events": "none" }));
    if (!state.theme.reflow) {
      state.svg.setAttribute("width", "100%");
      state.svg.removeAttribute("height");
      root.style.maxWidth = `${state.W}px`;
    }
    old ? old.replaceWith(state.svg) : root.prepend(state.svg);
    ctl.state = state;
    themeVars(root, state.theme);
    bar.setSize(state.theme.reflow ? state.W : Math.min(state.W, el.clientWidth || state.W));
  };

  const groups = [
    [
      { name: "copy", title: "Copy as PNG", action: (b) => copyPNG(ctl.state.svg).then((how) => bar.flash("copy", how)) },
      { name: "slide", title: "Copy for a slide", action: () => copyPNG(slideFigure(spec, ctl.state).svg, SLIDE_SIZE, SLIDE_SCALE).then((how) => bar.flash("slide", how)) },
      { name: "download", title: "Download", menu: [["PNG", () => downloadPNG(ctl.state.svg)], ["SVG", () => downloadSVG(ctl.state.svg)]] },
    ],
  ];
  if (interactive) {
    groups.unshift(
      [
        { name: "zoom", title: "Zoom: drag a box", action: () => setMode("zoom") },
        { name: "pan", title: "Pan: drag the view", action: () => setMode("pan") },
      ],
      [
        { name: "zoomIn", title: "Zoom in", action: () => step(ctl, ZOOM_STEP) },
        { name: "zoomOut", title: "Zoom out", action: () => step(ctl, 1 / ZOOM_STEP) },
        { name: "home", title: "Reset view (double-click)", action: () => home(ctl) },
      ],
    );
  }
  const bar = toolbar(doc, groups);
  root.append(bar.el, tip);
  const setMode = (mode) => {
    ctl.mode = mode;
    bar.button("zoom").classList.toggle("pt-on", mode === "zoom");
    bar.button("pan").classList.toggle("pt-on", mode === "pan");
    root.style.cursor = mode === "pan" ? "grab" : "";
  };

  try {
    const first = width ?? (el.clientWidth ? Math.max(MIN_WIDTH, el.clientWidth) : undefined);
    render(first);
    el.replaceChildren(root);
  } catch (e) {
    const box = Object.assign(doc.createElement("div"), { className: "pt-error", textContent: `plotto: ${e.message}` });
    el.prepend(box);
    throw e;
  }
  if (interactive) {
    setMode("zoom");
    attach(ctl, root, tip);
  }

  // Reflow: lay out again when the element width changes (100 ms after the last change).
  if (ctl.state.theme.reflow && width === undefined && typeof ResizeObserver !== "undefined") {
    let timer;
    observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const w = Math.max(MIN_WIDTH, Math.round(el.clientWidth));
        if (w && w !== ctl.state.W) render(w);
      }, 100);
    });
    observer.observe(el);
  }
  ctl.redraw = () => drawPanels(ctl.state);
  ctl.resize = (w) => render(Math.max(MIN_WIDTH, w));
  ctl.destroy = () => observer?.disconnect();
  return ctl;
}

function attach(ctl, root, tip) {
  let drag = null;
  let frame = null;
  const svg = () => ctl.state.svg;

  // Figure px of a pointer event, and the screen px per figure px.
  const at = (e) => {
    const r = svg().getBoundingClientRect();
    const k = ctl.state.W / r.width;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k, k];
  };
  const panelAt = (x, y) => ctl.state.layout.panels.findIndex((b) => x >= b.x + b.ml && x <= b.x + b.ml + b.innerW && y >= b.y && y <= b.y + b.innerH);

  // A press in a panel starts a gesture. It becomes a drag (zoom box or pan) after DRAG_MIN px of movement;
  // a release before that is a click: it pins the hover label, or unpins it.
  let pinned = false;
  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !svg().contains(e.target)) return;
    const [x, y] = at(e);
    const i = panelAt(x, y);
    if (i < 0) return;
    e.preventDefault();
    root.focus({ preventScroll: true }); // for Esc
    drag = { i, x, y, domains: ctl.state.domains, moving: false, id: e.pointerId };
  });

  root.addEventListener("pointermove", (e) => {
    const [x, y, k] = at(e);
    if (drag && !drag.moving && Math.hypot(x - drag.x, y - drag.y) >= DRAG_MIN) {
      drag.moving = true;
      root.setPointerCapture(drag.id);
      unpin();
      hideHover();
      if (ctl.mode === "pan") root.style.cursor = "grabbing";
    }
    if (!drag?.moving) {
      if (!pinned && !frame) frame = requestAnimationFrame(() => ((frame = null), showHover(x, y, k)));
      return;
    }
    if (ctl.mode === "pan") return pan(ctl, drag, x, y);
    const b = ctl.state.layout.panels[drag.i];
    const clampX = (v) => Math.max(b.x + b.ml, Math.min(b.x + b.ml + b.innerW, v));
    const clampY = (v) => Math.max(b.y, Math.min(b.y + b.innerH, v));
    const [x0, x1] = [drag.x, clampX(x)].sort((a, c) => a - c);
    const [y0, y1] = [drag.y, clampY(y)].sort((a, c) => a - c);
    // A flat drag zooms x only (a full-height band); a narrow drag zooms y only (a full-width band).
    const flat = y1 - y0 < DRAG_MIN || ctl.state.kind.y === "category";
    const narrow = x1 - x0 < DRAG_MIN || ctl.state.kind.x === "category";
    if (flat && narrow) return ctl.state.overlay.replaceChildren();
    const rect = { x: narrow ? b.x + b.ml : x0, y: flat ? b.y : y0, width: narrow ? b.innerW : x1 - x0, height: flat ? b.innerH : y1 - y0 };
    const accent = ctl.state.theme.accent;
    ctl.state.overlay.replaceChildren(svgElement(ctl.state.doc, "rect", { ...rect, fill: accent, "fill-opacity": 0.1, stroke: accent, "stroke-opacity": 0.7, "stroke-width": 1 }));
    drag.box = { x0, x1, y0, y1 };
  });

  root.addEventListener("pointerup", (e) => {
    if (drag?.moving && ctl.mode === "zoom" && drag.box) zoom(ctl, drag.i, drag.box);
    else if (drag && !drag.moving) {
      // A click pins the label of what is under the pointer; the next click releases it.
      const [x, y, k] = at(e);
      if (pinned) {
        unpin();
        showHover(x, y, k);
      } else {
        showHover(x, y, k);
        if (tip.style.display === "block") pin();
      }
    }
    if (ctl.mode === "pan") root.style.cursor = "grab";
    if (!pinned) ctl.state.overlay.replaceChildren();
    drag = null;
  });

  root.addEventListener("pointerleave", () => !drag && !pinned && hideHover());
  root.addEventListener("keydown", (e) => e.key === "Escape" && (unpin(), hideHover()));
  root.tabIndex = -1;

  // Zoom buttons, Home and legend clicks draw the panels again: the label then goes.
  ctl.clearHover = () => (unpin(), hideHover());

  function pin() {
    pinned = true;
    tip.classList.add("pt-pinned");
  }
  function unpin() {
    pinned = false;
    tip.classList.remove("pt-pinned");
  }

  // Pointer capture retargets click events to the root, so find the element under the pointer.
  const under = (e) => ctl.state.doc.elementFromPoint(e.clientX, e.clientY);
  const keyAt = (e) => under(e)?.closest?.(".pt-key");

  root.addEventListener("dblclick", (e) => {
    const [x, y] = at(e);
    if (panelAt(x, y) < 0) return;
    unpin();
    hideHover();
    home(ctl);
  });

  // Legend: a click hides or shows a value at once. Two clicks on the same entry within DOUBLE ms
  // (a quick double-click) show only that value instead; a slower second click just toggles it back.
  let last = { value: undefined, time: 0, before: null };
  root.addEventListener("click", (e) => {
    const key = keyAt(e);
    if (!key) return;
    const value = ctl.state.legend.items[Number(key.dataset.index)].value;
    ctl.clearHover();
    const now = performance.now();
    if (value === last.value && now - last.time < DOUBLE) {
      ctl.state.hidden = last.before;
      last = { value: undefined, time: 0, before: null };
      return isolate(ctl, value);
    }
    last = { value, time: now, before: ctl.state.hidden };
    const hidden = new Set(ctl.state.hidden);
    hidden.has(value) ? hidden.delete(value) : hidden.add(value);
    ctl.state.hidden = hidden;
    drawPanels(ctl.state);
  });

  let previous = null;
  function showHover(x, y, k) {
    const state = ctl.state;
    const i = panelAt(x, y);
    const b = i < 0 ? null : state.layout.panels[i];
    const hit = b ? pick(state, i, x - b.x, y - b.y, previous) : null;
    previous = hit;
    if (!hit) return hideHover();
    const doc = state.doc;
    const marks = [];
    if (hit.crosshair !== undefined) {
      const cx = b.x + hit.crosshair;
      marks.push(svgElement(doc, "line", { x1: cx, x2: cx, y1: b.y, y2: b.y + b.innerH, stroke: state.theme.muted, "stroke-opacity": 0.55, "stroke-width": 1 }));
    }
    for (const m of hit.marks) {
      if (m.rect) marks.push(svgElement(doc, "rect", { x: b.x + m.rect.x, y: b.y + m.rect.y, width: m.rect.width, height: m.rect.height, fill: "none", stroke: m.color, "stroke-width": 1.5 }));
      else marks.push(svgElement(doc, "circle", { cx: b.x + m.x, cy: b.y + m.y, r: state.theme.point + 1.5, fill: m.color, stroke: state.theme.background, "stroke-width": 1.5 }));
    }
    state.overlay.replaceChildren(...marks);
    const head = headerColors(hit.color);
    tip.style.setProperty("--pt-c", head.bg);
    tip.style.setProperty("--pt-on-c", head.fg);
    tip.style.font = `${state.fonts.hover}px ${state.theme.font}`;
    tip.replaceChildren(...tipContent(doc, hit));
    tip.style.display = "block";
    // The box follows the pointer (not the noisy data): right of the anchor, or left of it near the right edge.
    const ax = (b.x + hit.anchor.x) / k;
    const ay = y / k;
    const width = root.clientWidth;
    const height = root.clientHeight;
    const left = ax + 16 + tip.offsetWidth > width ? ax - 16 - tip.offsetWidth : ax + 16;
    const top = Math.min(Math.max(0, ay - 18), Math.max(0, height - tip.offsetHeight));
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${top}px`;
  }

  function hideHover() {
    tip.style.display = "none";
    if (!drag) ctl.state.overlay.replaceChildren();
  }
}

function tipContent(doc, hit) {
  const el = (tag, className, text) => Object.assign(doc.createElement(tag), { className, textContent: text ?? "" });
  const nodes = [];
  if (hit.header) nodes.push(el("div", "pt-head", hit.header));
  const rows = el("div", "pt-rows");
  for (const r of hit.rows) {
    const swatch = el("span", "pt-sw");
    if (r.swatch) swatch.style.background = r.swatch;
    const cells = [swatch, el("span", "pt-k", r.label), el("span", "pt-v", r.value)];
    if (r.strong) cells.forEach((c) => c.classList.add("pt-b"));
    if (r.total) cells.forEach((c) => c.classList.add("pt-t"));
    rows.append(...cells);
  }
  if (hit.note) rows.append(el("span", "pt-more", hit.note));
  nodes.push(rows);
  return nodes;
}

function home(ctl) {
  ctl.clearHover?.();
  ctl.state.domains = ctl.state.home;
  drawPanels(ctl.state);
}

// Legend double-click: show only this value; when it is already the only one, show all.
function isolate(ctl, value) {
  const all = ctl.state.legend.items.map((it) => it.value);
  const alone = ctl.state.hidden.size === all.length - 1 && !ctl.state.hidden.has(value);
  ctl.state.hidden = alone ? new Set() : new Set(all.filter((v) => v !== value));
  drawPanels(ctl.state);
}

// Zoom on panel i to the dragged box (figure px). A shared axis zooms in every panel that shares it.
function zoom(ctl, i, { x0, x1, y0, y1 }) {
  const state = ctl.state;
  const b = state.layout.panels[i];
  const plot = state.panels[i].plot;
  const next = state.domains.map((d) => ({ ...d }));
  const apply = (axis, lo, hi) => {
    if (state.kind[axis] === "category" || hi - lo < DRAG_MIN) return;
    const scale = plot.scale(axis);
    const offset = axis === "x" ? b.x : b.y;
    const d = [scale.invert(lo - offset), scale.invert(hi - offset)].map(Number).sort((a, c) => a - c);
    shared(state, axis, i).forEach((j) => (next[j][axis] = d));
  };
  apply("x", x0, x1);
  apply("y", y0, y1);
  state.domains = next;
  drawPanels(state);
}

// Zoom in or out around the center of each panel: factor < 1 zooms in.
function step(ctl, factor) {
  ctl.clearHover?.();
  const state = ctl.state;
  state.domains = state.domains.map((d) => {
    const out = { ...d };
    for (const axis of ["x", "y"]) {
      const k = state.kind[axis];
      if (k === "category") continue;
      const f = k === "log" ? Math.log10 : (v) => v;
      const g = k === "log" ? (v) => 10 ** v : (v) => v;
      const [lo, hi] = d[axis].map((v) => f(+v));
      const mid = (lo + hi) / 2;
      out[axis] = [g(mid - ((hi - lo) / 2) * factor), g(mid + ((hi - lo) / 2) * factor)];
    }
    return out;
  });
  drawPanels(state);
}

function pan(ctl, drag, x, y) {
  const state = ctl.state;
  const b = state.layout.panels[drag.i];
  const plot = state.panels[drag.i].plot;
  const next = drag.domains.map((d) => ({ ...d }));
  for (const [axis, from, to, offset] of [["x", drag.x, x, b.x], ["y", drag.y, y, b.y]]) {
    if (state.kind[axis] === "category") continue;
    const scale = plot.scale(axis);
    const log = state.kind[axis] === "log";
    const f = (v) => (log ? Math.log10(v) : v);
    const delta = f(+scale.invert(from - offset)) - f(+scale.invert(to - offset));
    const d = drag.domains[drag.i][axis].map((v) => (log ? 10 ** (f(v) + delta) : +v + delta));
    shared(state, axis, drag.i).forEach((j) => (next[j][axis] = d));
  }
  state.domains = next;
  if (!state.frame) state.frame = requestAnimationFrame(() => ((state.frame = null), drawPanels(state)));
}

// The panels that share the axis of panel i (all panels, unless the axis is free).
function shared(state, axis, i) {
  const free = state.ns.facet?.free?.[axis];
  const p = state.grid.panels[i];
  return state.grid.panels.flatMap((q, j) => {
    if (!free) return [j];
    if (state.grid.kind !== "grid") return j === i ? [j] : [];
    return (axis === "x" ? q.col === p.col : q.row === p.row) ? [j] : [];
  });
}
