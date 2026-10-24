"""The API reference: the Python module `plotto` and the JS module `plotto`. build_site.py makes reference.html.

The layer methods come from grammar.json, so the reference lists every layer, channel and option that the code accepts.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRAMMAR = json.loads((ROOT / "grammar.json").read_text())
THEMES = json.loads((ROOT / "theme.json").read_text())

LAYER_DOC = {
    "line": "Lines through the points, sorted by x. One line per color (or group). A missing value makes a gap.",
    "path": "Lines through the points in row order.",
    "step": "Steps: the value holds until the next point.",
    "point": "Points (dots).",
    "bar": "Bars from 0 to y, stacked by color by default. On a continuous x, a bar is 90% of the data step wide.",
    "hist": "A histogram: counts of x in bins. All panels and colors share the bins.",
    "density": "A Gaussian kernel density of x, per color.",
    "area": "Areas from 0 to y, stacked by color by default.",
    "ribbon": "A band from ymin to ymax along x.",
    "smooth": "A trend: a linear fit with its 95% band, or a loess curve.",
    "hline": "Horizontal lines at y. Does not use the plot mappings.",
    "vline": "Vertical lines at x. Does not use the plot mappings.",
    "abline": "A straight line y = intercept + slope · x across the panel. Does not use the plot mappings.",
    "segment": "Segments from (x, y) to (xend, yend).",
    "rect": "Rectangles from (xmin, ymin) to (xmax, ymax).",
    "band": "A shaded band. A missing bound is the panel edge. Does not use the plot mappings.",
    "tile": "Cells of a heatmap: one per (x, y) pair, colored by a value.",
    "text": "Text labels at (x, y).",
    "errorbar": "Vertical error bars from ymin to ymax, with caps.",
    "box": "Box plots of y per x: quartiles, whiskers at 1.5 IQR, outliers.",
}

CHANNEL_DOC = {
    "x": "Horizontal position",
    "y": "Vertical position",
    "color": "Stroke of lines; fill of points, bars, areas and cells",
    "group": "Splits lines and areas without a color",
    "tooltip": "An extra column in the hover label",
    "label": "The text of a text layer",
    "xend": "End of a segment",
    "yend": "End of a segment",
    "xmin": "Left edge",
    "xmax": "Right edge",
    "ymin": "Lower edge",
    "ymax": "Upper edge",
}

OPTION_DOC = {
    "size": ("number", "Line width or point radius, px; text size, px"),
    "alpha": ("0–1", "Opacity"),
    "dash": ('"solid" | "dashed" | "dotted" | "dashdot"', "Line pattern"),
    "jitter": ("number", "Random horizontal offset, as a share of the category width or of the x step (fixed seed)"),
    "summary": ('"mean" | "median" | "min" | "max" | "sum"', "One row per (x, color, group), with the summary of y"),
    "slope": ("number", "Slope (default 1)"),
    "intercept": ("number", "Intercept (default 0)"),
    "position": ('"stack" | "dodge" | "overlay"', "How the bars or areas of one x share the space (default stack; dodge for bars only)"),
    "bins": ("number", "About this number of bins, on round values (default 30)"),
    "density": ("bool", "Counts divided by (rows × bin width)"),
    "method": ('"lm" | "loess"', "Linear fit (default) or local regression"),
    "span": ("0–1", "Share of the points in each loess fit (default 0.75)"),
    "band": ("bool", "The 95% band of a linear fit (default True)"),
}

# (signature, description, [(parameter, type, description)])
PLOT = [
    (
        "plot(data, **mapping) → Plot",
        "Starts a plot. The mappings apply to every layer that accepts the channel.",
        [
            ("data", "DataFrame | list[dict]", "Long-format data. JS: an array of row objects."),
            (
                "**mapping",
                "channel=column",
                "Channels: " + ", ".join(dict.fromkeys(ch for layer in GRAMMAR["layers"].values() for ch in layer["channels"])),
            ),
        ],
    ),
]

METHODS = [
    (
        "facet(by, free=None, ncol=None)",
        "One panel per value of a column, wrapped in rows.",
        [
            ("by", "column", "The column"),
            ("free", '"x" | "y" | "both"', "Axes with their own range per panel"),
            ("ncol", "int", "Number of columns (default: the ggplot rule)"),
        ],
    ),
    (
        "grid(rows=None, cols=None, free=None)",
        "Panels in rows and columns, from one or two columns.",
        [
            ("rows", "column", "Row panels; labels on the right"),
            ("cols", "column", "Column panels; labels on top"),
            ("free", '"x" | "y" | "both"', "x per column, y per row"),
        ],
    ),
    (
        "x(type=None, limits=None, format=None)  ·  y(...)",
        "The position scales.",
        [
            ("type", '"linear" | "log" | "time" | "category"', "Default: from the column type"),
            (
                "limits",
                "[low, high] | list of categories",
                "The first view. None keeps the data bound on that side. On a category axis: the categories and their order.",
            ),
            ("format", "str", 'A d3-format (numbers, for example ".1f") or d3-time-format (times, for example "%H:%M") pattern'),
        ],
    ),
    (
        "color(values=None, palette=None, scheme=None, limits=None, mid=None, clamp=False)",
        "The color scale.",
        [
            ("values", "list | dict", "Colors in order, or category → color. Theme color names or CSS colors."),
            ("palette", "str", "Category colors: " + ", ".join(THEMES["palettes"])),
            ("scheme", "str | list", "Number colors: " + ", ".join(THEMES["schemes"]) + ", or a d3 scheme (viridis, magma, …)"),
            ("limits", "[low, high] | list", "The range of a number scale (None keeps the data bound), or the categories and their order"),
            ("mid", "number", "Diverging: the value at the center color"),
            ("clamp", "bool", "Values outside the limits take the end color (default: muted gray)"),
        ],
    ),
    (
        "labels(title=, subtitle=, caption=, x=, y=, color=)",
        "The titles. None removes one. A missing axis title is the column name.",
        [],
    ),
    (
        'info(entries, position="right")',
        "A key/value table about the data or the experiment. None removes it.",
        [
            ("entries", "dict | list of pairs", "Key → value, in order. Values: str, number, bool or None (shown as –)."),
            (
                "position",
                " | ".join(f'"{p}"' for p in GRAMMAR["infoPosition"]),
                "A card on the right of the panels, or below them. A plot narrower than 560 px puts it below.",
            ),
        ],
    ),
    (
        'theme(style="pastel", format=None, width=None, height=None, size=None, legend=None)',
        "The look and the size.",
        [
            ("style", "str", " | ".join(THEMES["styles"])),
            (
                "format",
                "str",
                " | ".join(f'{k} ({v["width"]}×{v["height"]})' for k, v in THEMES["formats"].items()) + ". screen follows the page width.",
            ),
            ("width", "px", "A fixed width; the height follows the format ratio"),
            ("height", "px", "A fixed height; the width still follows the page"),
            ("size", "px", "Base text size"),
            ("legend", '"right" | "bottom" | "none"', "Legend position"),
        ],
    ),
    ("interactive() → Plot", "The same plot with zoom, pan, hover and legend toggle in the notebook.", []),
    (
        "save(path, scale=2, width=None, height=None)",
        "Writes .png or .svg with the same look as the screen.",
        [("scale", "number", "PNG px per figure px"), ("width, height", "px", "Lay out again at this size")],
    ),
    ("spec() → dict", "The JSON spec (SPEC.md §2).", []),
]

JS = [
    ('import { plot, draw, toSVG } from "plotto"', "The same builder as Python; option objects replace keyword arguments.", []),
    (
        "draw(spec, element, { interactive = false, width }) → controller",
        "Draws into an element at its width, and again when the width changes.",
        [
            ("spec", "builder | spec", "A builder or its spec()"),
            ("interactive", "bool", "Zoom, pan, hover and legend toggle"),
            ("width", "px", "A fixed width (no reflow)"),
            ("controller", "{ state, redraw(), resize(w), destroy() }", "Call destroy() before removing the element"),
        ],
    ),
    ("toSVG(spec, { document, width }) → string", "The static SVG. In Node, pass a jsdom document.", []),
    ('import { Plot } from "plotto/react"', "<Plot spec={...} interactive /> — follows the container width.", []),
    (
        "node src/render.mjs spec.json out.svg|out.png [scale]",
        "Static export from the command line. --serve reads JSON lines (Python uses it).",
        [],
    ),
]


def layer_methods():
    """[(signature, description, params)] of every layer method, from grammar.json."""
    out = []
    for name, layer in GRAMMAR["layers"].items():
        args = ", ".join([*layer["channels"], *layer["options"], "data"])
        params = [
            (
                ch,
                "column | value" if ch not in ("tooltip", "group") else "column",
                CHANNEL_DOC[ch] + (" (required)" if ch in layer["requires"] else ""),
            )
            for ch in layer["channels"]
        ]
        params += [(opt, *OPTION_DOC[opt]) for opt in layer["options"]]
        params.append(("data", "DataFrame | rows", "Own data for this layer"))
        out.append((f"{name}({args})", LAYER_DOC[name], params))
    return out
