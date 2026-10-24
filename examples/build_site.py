"""Build the site in docs/ (GitHub Pages: branch main, folder /docs).

    python examples/build_site.py

- docs/index.html, types.html, colors.html, scales.html: the gallery pages (gallery.PAGES), with a style switch,
  a width slider and an interactive switch.
- docs/grammar.html: the grammar of plots, step by step (grammar.py).
- docs/reference.html: the API of the Python and JS modules (reference.py).
- docs/img/: the PNG and SVG of each gallery plot, as save() writes them.

Each page holds the plotto script inline, because some browsers (Arc) do not load a second file from a file:// page.
The plots draw soon after the page loads, top to bottom; until then, the saved SVG shows.
"""

import html
import inspect
import json
import re
import shutil
import textwrap
from pathlib import Path

import grammar
import pandas as pd
import reference

import gallery
from plotto import Plot, output

DOCS = Path(__file__).resolve().parents[1] / "docs"
KEYWORDS = r"\b(from|import|for|in|return|None|True|False|def|lambda)\b"


def build():
    shutil.rmtree(DOCS / "img", ignore_errors=True)
    (DOCS / "img").mkdir(parents=True)
    (DOCS / ".nojekyll").write_text("")
    (DOCS / "plotto.js").unlink(missing_ok=True)
    script = output._request("bundle", cdn=False, format="iife")["js"].replace("</script", "<\\/script")
    number = 0
    for key, page in gallery.PAGES.items():
        content, number = gallery_page(page, number)
        write(page["file"], key, content, script)
    write("grammar.html", "grammar", grammar_page(), script)
    write("reference.html", "reference", reference_page(), script)


def write(name, active, content, script):
    links = "".join(f'<a href="{href}"{" aria-current=page" if key == active else ""}>{label}</a>' for key, href, label in PAGES)
    toc = re.search(r'<nav class="toc">.*?</nav>', content, re.S)
    side = toc.group(0) if toc else ""
    content = content.replace(side, "")
    page = TEMPLATE.replace("{pages}", links).replace("{side}", side).replace("{content}", content).replace("{script}", script)
    (DOCS / name).write_text(page)
    print(f"wrote {DOCS / name}")


PAGES = [
    *((key, page["file"], page["title"]) for key, page in gallery.PAGES.items()),
    ("grammar", "grammar.html", "Grammar"),
    ("reference", "reference.html", "Reference"),
]


# --- Gallery pages --------------------------------------------------------------------------


def gallery_page(page, number):
    toc, sections = [], []
    for title, fns in page["sections"].items():
        key = slug(title)
        toc.append(f'<a href="#{key}">{html.escape(title)}</a>')
        cards = []
        for fn in fns:
            number += 1
            toc.append(f'<a class="sub" href="#{fn.__name__}">{fn.__name__}</a>')
            cards.append(card(fn, number))
            print(f"{number:02d} {fn.__name__}")
        sections.append(f'<section id="{key}"><h2>{html.escape(title)}</h2>{"".join(cards)}</section>')
    if page["file"] == "index.html":
        hero = f'<section class="hero"><h1>{html.escape(TAGLINE)}</h1><pre>{highlight(HERO_CODE)}</pre></section>'
    else:
        hero = f'<section class="hero"><h1>{html.escape(page["title"])}</h1></section>'
    return hero + f'<nav class="toc">{"".join(toc)}</nav>' + "\n".join(sections), number


TAGLINE = "Grammar-of-graphics plots for notebooks, web pages and slides with one renderer."
HERO_CODE = 'from plotto import plot\n\nplot(df, x="time", y="value", color="sensor").line().facet("indicator", free="y").interactive()'


def card(fn, number):
    figures = []
    for name, p in gallery.plots_of(fn):
        p.save(DOCS / "img" / f"{name}.png")
        p.save(DOCS / "img" / f"{name}.svg")
        files = f'<figcaption><a href="img/{name}.png">PNG</a><a href="img/{name}.svg">SVG</a></figcaption>'
        figures.append(live(p, fixed=fn.__name__ in gallery.FIXED_STYLE, fallback=f"img/{name}.svg") + files)
    return (
        f'<article id="{fn.__name__}"><header><span class="num">{number:02d}</span><h3>{fn.__name__}</h3><p>{html.escape(fn.__doc__)}</p>'
        f'<button class="code-toggle" type="button">code</button></header><pre class="code" hidden>{highlight(inspect.getsource(fn))}</pre>'
        f'<div class="figures">{"".join(figures)}</div></article>'
    )


# --- Grammar --------------------------------------------------------------------------------


def grammar_page():
    toc, steps = [], []
    for number, (title, fn) in enumerate(grammar.STEPS, 1):
        key = slug(title)
        toc.append(f'<a href="#{key}"><span class="n">{number}</span>{html.escape(title)}</a>')
        text = "".join(f"<p>{html.escape(' '.join(par.split()))}</p>" for par in fn.__doc__.split("\n\n"))
        result = fn()
        code = body(fn) if not isinstance(result, str) else result
        steps.append(
            f'<article class="step" id="{key}"><header><span class="num">{number:02d}</span><h3>{html.escape(title)}</h3></header>'
            f'<div class="explain">{text}</div><pre>{highlight(code)}</pre><div class="figures">{render(result)}</div></article>'
        )
        print(f"grammar {number:02d} {title}")
    intro = (
        '<section class="hero"><h1>The grammar of plots</h1>'
        "<p class=lead>A plot is a sentence with a few parts: the <b>data</b>, the <b>mappings</b> from columns to channels, "
        "the <b>layers</b> that draw them, the <b>scales</b> that turn data into positions and colors, the <b>facets</b> "
        "that split it into panels, and the <b>theme</b>. Each part is one method. Each method returns a new plot.</p></section>"
    )
    return intro + f'<nav class="toc">{"".join(toc)}</nav>' + "".join(steps)


def body(fn):
    """The code of a step: the function body without its docstring and without a final `return p`."""
    lines = inspect.getsource(fn).split("\n")
    code = textwrap.dedent("\n".join(lines[1:]))
    code = re.sub(r'^"""(.|\n)*?"""\n', "", code)
    return re.sub(r"\n?return p\s*$", "", code.strip()).strip()


def render(result):
    if isinstance(result, Plot):
        return live(result)
    if isinstance(result, list):
        return f'<div class="row">{"".join(live(p) for p in result)}</div>'
    if isinstance(result, pd.DataFrame):
        return result.to_html(index=False, classes="table", border=0)
    if isinstance(result, dict):
        return f'<pre class="spec">{html.escape(json.dumps(result, indent=1)[:3000])}</pre>'
    return ""


# --- Reference ------------------------------------------------------------------------------


def reference_page():
    def entries(items):
        out = []
        for signature, text, params in items:
            rows = "".join(
                f"<tr><td><code>{html.escape(n)}</code></td><td>{html.escape(t)}</td><td>{html.escape(d)}</td></tr>" for n, t, d in params
            )
            table = f'<table class="table params"><tr><th>parameter</th><th>type</th><th>meaning</th></tr>{rows}</table>' if rows else ""
            anchor = slug(signature.split("(")[0])
            out.append(
                f'<div class="api" id="{anchor}"><code class="sig">{html.escape(signature)}</code><p>{html.escape(text)}</p>{table}</div>'
            )
        return "".join(out)

    blocks = [
        (
            "Python: the plot",
            "<p>Every method returns a new <code>Plot</code>; the old one does not change. "
            "A string that names a column of the layer data is a mapping; any other value is a setting.</p>" + entries(reference.PLOT),
        ),
        ("Python: layers", entries(reference.layer_methods())),
        ("Python: scales, facets, labels, theme and output", entries(reference.METHODS)),
        (
            "JavaScript",
            "<p>The JS builder has the same methods and options: <code>.line({ size: 2 })</code> for <code>.line(size=2)</code>, "
            "<code>null</code> for <code>None</code>.</p>" + entries(reference.JS),
        ),
    ]
    toc = "".join(f'<a href="#{slug(t)}">{html.escape(t)}</a>' for t, _ in blocks)
    body = "".join(f'<section id="{slug(t)}"><h2>{html.escape(t)}</h2><article class="ref">{b}</article></section>' for t, b in blocks)
    intro = '<section class="hero"><h1>Reference</h1></section>'
    return intro + f'<nav class="toc">{toc}</nav>' + body


# --- Shared ---------------------------------------------------------------------------------


def live(p, fixed=False, fallback=None):
    spec = json.dumps(p.spec(), allow_nan=False, separators=(",", ":")).replace("</", "<\\/")
    # The image size reserves the plot's space before it loads, so the page does not shift while scrolling.
    size = re.search(r'width="(\d+)" height="(\d+)"', (DOCS / fallback).read_text()[:400]) if fallback else None
    dims = f' width="{size[1]}" height="{size[2]}"' if size else ""
    image = f'<img class="fallback" src="{fallback}"{dims} alt="" loading="lazy">' if fallback else ""
    return (
        f'<figure><div class="live"{" data-fixed" if fixed else ""}>{image}<script type="application/json">{spec}</script></div></figure>'
    )


def highlight(code):
    out = []
    for line in html.escape(code).split("\n"):
        text, _, comment = line.partition("# ") if " # " in line or line.lstrip().startswith("# ") else (line, "", "")
        text = text.replace("//", "<span class=c>//", 1) + "</span>" if text.lstrip().startswith("//") else text
        text = re.sub(r"(&quot;.*?&quot;|&#x27;.*?&#x27;)", r'<span class="s">\1</span>', text)
        text = re.sub(KEYWORDS, r'<span class="k">\1</span>', text)
        out.append(text + (f'<span class="c"># {comment}</span>' if comment else ""))
    return "\n".join(out)


def slug(text):
    return re.sub(r"[^a-z]+", "-", text.lower()).strip("-")


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>plotto</title>
<meta name="description" content="plotto: grammar-of-graphics plots for notebooks, web pages and slides, with one renderer.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#FBFAF6;--card:#FFFEFB;--ink:#23262B;--muted:#6B717B;--line:#E4E2DA;--accent:#3E8A99;--w:960px;
  --sans:Inter,Helvetica,Arial,sans-serif;--mono:"JetBrains Mono",ui-monospace,monospace}
*{box-sizing:border-box}
html{scroll-padding-top:84px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit}
code{font-family:var(--mono);font-size:.9em}
.bar{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line)}
.bar-in{max-width:1400px;margin:0 auto;padding:12px 28px;display:flex;flex-wrap:wrap;gap:10px 28px;align-items:center}
.mark{font-weight:600;font-size:24px;letter-spacing:-.02em;text-decoration:none;color:var(--accent)}
.pages{display:flex;flex-wrap:wrap}
.pages a{text-decoration:none;color:var(--muted);font-size:16px;font-weight:500;padding:6px 14px;border-bottom:2px solid transparent}
.pages a:hover{color:var(--ink)} .pages a[aria-current]{color:var(--ink);border-bottom-color:var(--accent)}
.controls{margin-left:auto;display:flex;gap:18px;align-items:center;font-size:13px;color:var(--muted);font-weight:500;flex-wrap:wrap}
.seg{display:flex;border:1px solid var(--line)}
.seg button{all:unset;cursor:pointer;padding:5px 11px;font:600 13px var(--sans);color:var(--muted)}
.seg button+button{border-left:1px solid var(--line)}
.seg button:hover{color:var(--ink)}
.seg button[aria-pressed=true]{background:var(--ink);color:#fff}
input[type=range]{accent-color:var(--accent);width:120px}
.switch{display:flex;gap:6px;align-items:center;cursor:pointer}
.switch input{appearance:none;width:32px;height:18px;background:var(--line);position:relative;cursor:pointer;margin:0}
.switch input::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;background:#fff;transition:left .12s}
.switch input:checked{background:var(--accent)} .switch input:checked::after{left:16px}
output{font:600 13px var(--mono);color:var(--ink);min-width:56px}
.layout{max-width:1400px;margin:0 auto;padding:0 28px;display:grid;grid-template-columns:230px minmax(0,1fr);gap:44px}
.side{position:sticky;top:78px;align-self:start;max-height:calc(100vh - 96px);overflow:auto;padding:36px 0 24px}
.toc{display:flex;flex-direction:column}
.toc a{display:block;text-decoration:none;color:var(--ink);font-weight:600;font-size:15px;padding:5px 10px;border-left:2px solid var(--line);margin-top:10px}
.toc a.sub{font:500 14px var(--mono);color:var(--muted);padding:3px 10px 3px 20px;margin-top:0}
.toc a:hover{color:var(--accent)}
.toc a.on{color:var(--accent);border-left-color:var(--accent)}
.toc .n{display:inline-block;width:22px;color:var(--muted);font:500 13px var(--mono)}
main{min-width:0;padding:0 0 96px}
.hero{padding:40px 0 8px;max-width:var(--w)}
.hero h1{margin:0 0 18px;font-size:32px;line-height:1.2;letter-spacing:-.025em;font-weight:600}
.lead{margin:0;color:var(--muted);font-size:18px;line-height:1.6;max-width:68ch} .lead b{color:var(--ink);font-weight:600}
pre{margin:0;padding:14px 18px;background:#24272C;color:#E8EAED;font:14px/1.6 var(--mono);overflow-x:auto}
pre .k{color:#F4A7B9} pre .s{color:#A5DEE4} pre .c{color:#8B929C}
pre.spec{background:#F4F0E9;color:var(--ink);max-height:360px}
h2{margin:52px 0 16px;font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600;
  display:flex;gap:12px;align-items:center;max-width:var(--w)}
h2::after{content:"";flex:1;height:1px;background:var(--line)}
article{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--ink);width:var(--w);max-width:100%;margin:0 0 24px}
article>header{display:grid;grid-template-columns:auto 1fr auto;gap:4px 14px;padding:16px 20px 12px;align-items:baseline}
.num{font:600 13px var(--mono);color:var(--muted)}
article h3{margin:0;font:600 18px var(--mono)}
.step h3{font:600 21px var(--sans);letter-spacing:-.01em}
.step{margin-top:32px}
article header p{grid-column:2;margin:0;color:var(--muted);font-size:16px}
.explain{padding:0 20px 14px;max-width:72ch;font-size:17px} .explain p{margin:0 0 8px}
.code-toggle{all:unset;cursor:pointer;grid-row:1;grid-column:3;font:600 12px var(--mono);letter-spacing:.06em;text-transform:uppercase;
  color:var(--muted);border:1px solid var(--line);padding:4px 10px}
.code-toggle:hover,.code-toggle[aria-expanded=true]{color:#fff;background:var(--ink);border-color:var(--ink)}
.figures{padding:12px 20px 8px}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
figure{margin:0 0 10px;min-width:0}
.live{min-height:100px}
.fallback{display:block;width:100%;height:auto}
figcaption{display:flex;gap:14px;justify-content:flex-end;font:500 12px var(--mono);margin-top:4px}
figcaption a{color:var(--muted);text-decoration:none} figcaption a:hover{color:var(--accent)}
.table{border-collapse:collapse;font:14px var(--mono);margin-bottom:10px}
.table th{text-align:left;color:var(--muted);font-weight:600;border-bottom:1px solid var(--ink);padding:5px 16px 5px 0}
.table td{border-bottom:1px solid var(--line);padding:5px 16px 5px 0}
.ref{padding:6px 20px 12px}
.api{padding:16px 0;border-bottom:1px solid var(--line)} .api:last-child{border-bottom:0}
.sig{display:block;font:600 15px/1.5 var(--mono);color:var(--accent);white-space:pre-wrap}
.api p{margin:6px 0 10px}
.params{width:100%;font-family:var(--sans);font-size:14px} .params td:first-child{white-space:nowrap} .params td:nth-child(2){color:var(--muted);font-family:var(--mono);font-size:13px}
.error{display:none;margin:16px 0;padding:10px 14px;border-left:3px solid #CB4042;background:#FDECEA;color:#5C1A1B;font:14px/1.5 var(--mono)}
footer{max-width:1400px;margin:0 auto;padding:24px 28px;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}
@media (max-width:1100px){.layout{grid-template-columns:1fr;gap:0}.side{position:static;max-height:none;padding:20px 0 0}
  .toc{flex-direction:row;flex-wrap:wrap;gap:4px 14px}.toc a{border:0;margin:0;padding:2px 0}.toc a.sub{display:none}.controls{margin-left:0}}
</style></head>
<body>
<div class="bar"><div class="bar-in">
  <a class="mark" href="index.html">plotto</a>
  <div class="pages">{pages}</div>
  <div class="controls">
    <div class="seg" id="style" role="group" aria-label="style">
      <button aria-pressed="true" data-style="">as written</button><button data-style="pastel">pastel</button><button data-style="wota">wota</button><button data-style="paper">paper</button><button data-style="dark">dark</button>
    </div>
    <label>width <input id="width" type="range" min="360" max="1132" step="4" value="960"> <output id="wout">960 px</output></label>
    <label class="switch"><input id="interactive" type="checkbox" checked> interactive</label>
  </div>
</div></div>
<div class="layout">
<aside class="side">{side}</aside>
<main>
<div class="error" id="error"></div>
{content}
</main>
</div>
<footer>plotto · MIT licence · <a href="https://github.com/theoradusz/plotto">github.com/theoradusz/plotto</a></footer>
<script>
// Show any script error on the page; the saved images stay in place.
window.addEventListener("error", (e) => { const box = document.getElementById("error"); box.style.display = "block"; box.textContent = "The live plots could not start: " + e.message; });
</script>
<script>{script}</script>
<script type="module">
const lives = [...document.querySelectorAll(".live")].map((el) => ({ el, spec: JSON.parse(el.querySelector("script").textContent), ctl: null, fixed: el.hasAttribute("data-fixed") }));
let style = "";
const interactive = () => document.getElementById("interactive").checked;
function draw(item) {
  item.ctl?.destroy();
  const spec = style && !item.fixed ? { ...item.spec, theme: { ...item.spec.theme, style } } : item.spec;
  try {
    item.ctl = plotto.draw(spec, item.el, { interactive: interactive() });
  } catch (e) {
    item.ctl = { destroy() {} };
    reportError(e);
  }
}
// Draw every plot soon after load, top to bottom, a few per frame: the page reaches its final layout quickly,
// and the browser's scroll anchoring keeps the view steady while the plots below draw.
let next = 0;
(function drawSome() {
  const end = performance.now() + 12;
  while (next < lives.length && performance.now() < end) { const item = lives[next++]; if (!item.ctl) draw(item); }
  if (next < lives.length) requestAnimationFrame(drawSome);
})();
const redrawAll = () => lives.forEach((l) => l.ctl && draw(l));
document.getElementById("interactive").addEventListener("change", redrawAll);
document.querySelectorAll("#style button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#style button").forEach((o) => o.setAttribute("aria-pressed", o === b));
  style = b.dataset.style;
  redrawAll();
}));
const slider = document.getElementById("width");
const setWidth = () => { document.documentElement.style.setProperty("--w", `${slider.value}px`); document.getElementById("wout").textContent = `${slider.value} px`; };
slider.addEventListener("input", setWidth);
setWidth();
document.querySelectorAll(".code-toggle").forEach((b) => b.addEventListener("click", () => {
  const pre = b.closest("article").querySelector(".code");
  pre.hidden = !pre.hidden;
  b.setAttribute("aria-expanded", !pre.hidden);
}));
// Sidebar: mark the link of the card or section in view.
const links = [...document.querySelectorAll(".toc a")];
const targets = links.map((a) => document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean);
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) {
    links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id));
    // Keep the active link visible by scrolling the sidebar only (scrollIntoView would also scroll the page).
    const on = links.find((a) => a.classList.contains("on"));
    const side = document.querySelector(".side");
    if (on && side.scrollHeight > side.clientHeight) {
      const top = on.offsetTop - side.offsetTop;
      if (top < side.scrollTop || top > side.scrollTop + side.clientHeight - 40) side.scrollTop = top - side.clientHeight / 3;
    }
  }
}, { rootMargin: "-90px 0px -65% 0px" });
targets.forEach((t) => spy.observe(t));
window.items = lives;
window.ready = true;
</script>
</body></html>
"""


if __name__ == "__main__":
    build()
