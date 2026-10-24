import { textOn } from "./theme.js";

// Toolbar and page styles: a floating pill of icon buttons at the top right of the figure.
// The button size follows the figure width. The styles go into the document once, as one <style> element.

const ICONS = {
  zoom: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="9" y="9" width="6" height="6"/>',
  pan: '<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
  zoomIn: '<path d="M12 5v14M5 12h14"/>',
  zoomOut: '<path d="M5 12h14"/>',
  home: '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11"/><path d="M15.5 8.5V4.5h-11v11h4"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};

const CSS = `
.pt-root{position:relative;--pt-size:24px}
.pt-root svg{display:block;user-select:none;-webkit-user-select:none}
.pt-root .pt-key{cursor:pointer}
.pt-root:focus{outline:none}
.pt-bar{position:absolute;top:6px;right:6px;display:flex;align-items:stretch;z-index:3;background:var(--pt-bg);
  border:1px solid var(--pt-line);opacity:0;transition:opacity .12s ease}
.pt-root:hover .pt-bar,.pt-root:focus-within .pt-bar,.pt-bar.pt-open{opacity:1}
@media (hover:none){.pt-bar{opacity:1}}
.pt-btn{all:unset;box-sizing:border-box;display:grid;place-items:center;width:var(--pt-size);height:var(--pt-size);
  color:var(--pt-muted);cursor:pointer}
.pt-btn svg{width:58%;height:58%;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:square;stroke-linejoin:miter}
.pt-btn:hover{color:var(--pt-ink);background:var(--pt-soft)}
.pt-btn:focus-visible{outline:2px solid var(--pt-accent);outline-offset:-2px}
.pt-btn.pt-on{color:var(--pt-on-accent);background:var(--pt-accent)}
.pt-sep{width:1px;background:var(--pt-line)}
.pt-menu{position:absolute;top:100%;right:-1px;display:none;flex-direction:column;min-width:72px;margin-top:-1px;
  background:var(--pt-bg);border:1px solid var(--pt-line)}
.pt-menu.pt-open{display:flex}
.pt-menu button{all:unset;padding:5px 12px;font:600 11px/1.4 system-ui,sans-serif;letter-spacing:.04em;color:var(--pt-ink);cursor:pointer}
.pt-menu button:hover{color:var(--pt-on-accent);background:var(--pt-accent)}
.pt-tip{position:absolute;display:none;pointer-events:none;z-index:4;min-width:110px;max-width:280px;background:var(--pt-bg);
  color:var(--pt-ink);border:1px solid var(--pt-c);line-height:1.3;font-variant-numeric:tabular-nums}
.pt-tip.pt-pinned{border-width:2px;box-shadow:3px 3px 0 color-mix(in srgb,var(--pt-c) 35%,transparent)}
.pt-tip .pt-head{padding:3px 7px;background:var(--pt-c);color:var(--pt-on-c);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pt-tip .pt-rows{display:grid;grid-template-columns:auto minmax(0,1fr) auto;column-gap:7px;row-gap:0;padding:4px 7px 5px}
.pt-tip .pt-sw{width:8px;height:8px;align-self:center}
.pt-tip .pt-k{color:var(--pt-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pt-tip .pt-v{text-align:right;white-space:nowrap}
.pt-tip .pt-b{color:var(--pt-ink);font-weight:700}
.pt-tip .pt-t{border-top:1px solid var(--pt-line);padding-top:2px;margin-top:1px}
.pt-tip .pt-more{grid-column:1/-1;color:var(--pt-muted);font-size:.9em}
.pt-error{padding:8px 10px;border-left:3px solid #d93025;background:#fdecea;color:#5f2120;font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap}
`;

export function installStyles(doc) {
  if (doc.getElementById("plotto-style")) return;
  const style = doc.createElement("style");
  style.id = "plotto-style";
  style.textContent = CSS;
  doc.head.append(style);
}

// The theme colors as CSS variables of the root element.
export function themeVars(root, theme) {
  const vars = { bg: theme.background, ink: theme.ink, muted: theme.muted, line: theme.grid, soft: theme.strip, accent: theme.accent, "on-accent": textOn(theme.accent) };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--pt-${k}`, v);
}

// groups: [[{ name, title, action, menu? }]]. Returns { el, button(name), setSize(width), flash(name) }.
export function toolbar(doc, groups) {
  const el = doc.createElement("div");
  el.className = "pt-bar";
  const buttons = {};
  let menu = null;
  groups.forEach((group, g) => {
    if (g) el.append(Object.assign(doc.createElement("div"), { className: "pt-sep" }));
    for (const spec of group) {
      const b = doc.createElement("button");
      b.className = "pt-btn";
      b.type = "button";
      b.title = spec.title;
      b.setAttribute("aria-label", spec.title);
      b.innerHTML = icon(spec.name);
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => (e.stopPropagation(), spec.menu ? toggleMenu() : spec.action(b)));
      el.append(b);
      buttons[spec.name] = b;
      if (spec.menu) menu = addMenu(doc, el, spec.menu);
    }
  });
  function toggleMenu() {
    const open = !menu.classList.contains("pt-open");
    menu.classList.toggle("pt-open", open);
    el.classList.toggle("pt-open", open);
  }
  if (menu) doc.addEventListener("click", () => menu.classList.contains("pt-open") && toggleMenu());
  return {
    el,
    button: (name) => buttons[name],
    // Button size: 1/34 of the figure width, from 22 to 30 px.
    setSize: (width) => el.parentElement?.style.setProperty("--pt-size", `${Math.round(Math.min(30, Math.max(22, width / 34)))}px`),
    flash(name, title) {
      const b = buttons[name];
      const [html, old] = [b.innerHTML, b.title];
      b.innerHTML = icon("check");
      b.title = title;
      b.classList.add("pt-on");
      setTimeout(() => ((b.innerHTML = html), (b.title = old), b.classList.remove("pt-on")), 1100);
    },
  };
}

function addMenu(doc, bar, items) {
  const menu = doc.createElement("div");
  menu.className = "pt-menu";
  for (const [label, action] of items) {
    const item = doc.createElement("button");
    item.type = "button";
    item.textContent = label;
    item.addEventListener("click", (e) => (e.stopPropagation(), menu.classList.remove("pt-open"), bar.classList.remove("pt-open"), action()));
    menu.append(item);
  }
  bar.append(menu);
  return menu;
}

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}
