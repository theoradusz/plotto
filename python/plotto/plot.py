"""Chainable plot builder: the same methods, arguments and spec as src/builder.js.

Each method returns a new Plot and never changes the old one. A string that names a column is a mapping;
any other value is a constant.
"""

from __future__ import annotations

import json

from . import assets, output
from .data import to_column, to_frame, to_value

GRAMMAR = json.loads(assets.path("grammar.json").read_text())
THEMES = json.loads(assets.path("theme.json").read_text())
LAYERS = GRAMMAR["layers"]
PLOT_CHANNELS = list(dict.fromkeys(ch for layer in LAYERS.values() for ch in layer["channels"]))


def plot(data, **mapping) -> Plot:
    """Start a plot: plot(df, x="time", y="W", color="device")."""
    frame = to_frame(data, "plot()")
    for ch, col in mapping.items():
        if ch not in PLOT_CHANNELS:
            _fail("plot()", "channel", ch, PLOT_CHANNELS)
        _need_column(frame, col, "plot()")
    state = {"data": [frame], "mapping": mapping, "layers": [], "facet": None, "scales": {}, "labels": {}, "theme": {"style": "pastel"}}
    return Plot(state)


class Plot:
    def __init__(self, state, interactive=False):
        self._s = state
        self._interactive = interactive

    def _with(self, **changes) -> Plot:
        return Plot({**self._s, **changes}, self._interactive)

    def _layer(self, type_, data=None, **options) -> Plot:
        definition = LAYERS[type_]
        where = f"{type_}()"
        tables = self._s["data"]
        index = 0
        if data is not None:
            tables = [*tables, to_frame(data, where)]
            index = len(tables) - 1
        columns = tables[index].columns
        layer = {"type": type_, "mapping": {}, "set": {}}
        if index:
            layer["data"] = index
        for key, value in options.items():
            if key in definition["channels"] and isinstance(value, str) and value in columns:
                layer["mapping"][key] = value
            elif key in definition["channels"] or key in definition["options"]:
                layer["set"][key] = _constant(key, value, where, columns)
            else:
                _fail(where, "option", key, ["data", *definition["channels"], *definition["options"]])
        return self._with(data=tables, layers=[*self._s["layers"], layer])

    def line(self, **options):
        return self._layer("line", **options)

    def step(self, **options):
        return self._layer("step", **options)

    def bar(self, **options):
        return self._layer("bar", **options)

    def hist(self, **options):
        return self._layer("hist", **options)

    def density(self, **options):
        return self._layer("density", **options)

    def area(self, **options):
        return self._layer("area", **options)

    def ribbon(self, **options):
        return self._layer("ribbon", **options)

    def smooth(self, **options):
        return self._layer("smooth", **options)

    def path(self, **options):
        return self._layer("path", **options)

    def point(self, **options):
        return self._layer("point", **options)

    def hline(self, **options):
        return self._layer("hline", **options)

    def vline(self, **options):
        return self._layer("vline", **options)

    def abline(self, **options):
        return self._layer("abline", **options)

    def segment(self, **options):
        return self._layer("segment", **options)

    def rect(self, **options):
        return self._layer("rect", **options)

    def band(self, **options):
        return self._layer("band", **options)

    def tile(self, **options):
        return self._layer("tile", **options)

    def text(self, **options):
        return self._layer("text", **options)

    def errorbar(self, **options):
        return self._layer("errorbar", **options)

    def box(self, **options):
        return self._layer("box", **options)

    def facet(self, by, **options) -> Plot:
        _need_column(self._s["data"][0], by, "facet()")
        _check_keys(options, GRAMMAR["facet"], "facet()")
        _check_free(options.get("free"), "facet()")
        return self._with(facet={"wrap": by, "free": options.get("free"), "ncol": options.get("ncol")})

    def grid(self, rows=None, cols=None, **options) -> Plot:
        if rows is None and cols is None:
            raise ValueError("grid(): set rows, cols or both")
        for col in (rows, cols):
            if col is not None:
                _need_column(self._s["data"][0], col, "grid()")
        _check_keys(options, GRAMMAR["grid"], "grid()")
        _check_free(options.get("free"), "grid()")
        return self._with(facet={"rows": rows, "cols": cols, "free": options.get("free")})

    def x(self, **options):
        return self._scale("x", options)

    def y(self, **options):
        return self._scale("y", options)

    def color(self, **options):
        return self._scale("color", options)

    def _scale(self, name, options) -> Plot:
        where = f"{name}()"
        _check_keys(options, GRAMMAR["scales"][name], where)
        if "type" in options and options["type"] not in GRAMMAR["scaleTypes"]:
            _fail(where, "type", options["type"], GRAMMAR["scaleTypes"])
        palette = options.get("palette")
        if palette is not None and not isinstance(palette, (list, tuple)) and palette not in THEMES["palettes"]:
            _fail(where, "palette", palette, list(THEMES["palettes"]))
        if "mid" in options and not isinstance(options["mid"], (int, float)):
            raise ValueError(f"{where}: mid must be a number")
        scale = dict(options)
        if scale.get("limits") is not None:
            if not isinstance(scale["limits"], (list, tuple)):
                raise ValueError(f"{where}: limits must be a list, for example [0, 10] or [0, None]")
            scale["limits"] = [None if v is None else to_value(v) for v in scale["limits"]]
        return self._with(scales={**self._s["scales"], name: scale})

    def labels(self, **options) -> Plot:
        _check_keys(options, GRAMMAR["labels"], "labels()")
        return self._with(labels={**self._s["labels"], **options})

    def theme(self, style="pastel", **options) -> Plot:
        """The look (style) and the output size (format): theme("wota", format="slide")."""
        _check_keys(options, GRAMMAR["theme"], "theme()")
        if style not in THEMES["styles"]:
            _fail("theme()", "style", style, list(THEMES["styles"]))
        if "format" in options and options["format"] not in THEMES["formats"]:
            _fail("theme()", "format", options["format"], list(THEMES["formats"]))
        if "legend" in options and options["legend"] not in GRAMMAR["legend"]:
            _fail("theme()", "legend", options["legend"], GRAMMAR["legend"])
        return self._with(theme={"style": style, **options})

    def interactive(self) -> Plot:
        """The same plot with zoom, pan, hover, legend toggle and copy in the notebook."""
        return Plot(self._s, interactive=True)

    def spec(self) -> dict:
        """The JSON spec (SPEC.md). Each table keeps only the columns that a mapping or a facet uses."""
        s = self._s
        used = [[] for _ in s["data"]]

        def use(i, col):
            if col in s["data"][i].columns and col not in used[i]:
                used[i].append(col)

        for col in s["mapping"].values():
            for i in range(len(s["data"])):
                use(i, col)
        for layer in s["layers"]:
            for col in layer["mapping"].values():
                use(layer.get("data", 0), col)
        facet = s["facet"] or {}
        for col in (facet.get("wrap"), facet.get("rows"), facet.get("cols")):
            if col:
                for i in range(len(s["data"])):
                    use(i, col)
        data = [{"columns": {c: to_column(frame[c]) for c in used[i]}} for i, frame in enumerate(s["data"])]
        return {
            "version": 1,
            "data": data,
            "mapping": s["mapping"],
            "layers": s["layers"],
            "facet": s["facet"],
            "scales": s["scales"],
            "labels": s["labels"],
            "theme": s["theme"],
        }

    def save(self, path, scale=2, width=None, height=None):
        """Write the plot as .svg or .png. scale: PNG px per figure px. width, height: the figure size in px."""
        spec = self.spec()
        if width is not None or height is not None:
            spec["theme"] = {**spec["theme"], **{k: v for k, v in {"width": width, "height": height}.items() if v is not None}}
        output.save(spec, path, scale)

    def __repr__(self):
        s = self._s
        layers = "+".join(layer["type"] for layer in s["layers"]) or "no layers"
        facet = s["facet"] or {}
        by = facet.get("wrap") or " x ".join(c for c in (facet.get("rows"), facet.get("cols")) if c)
        extra = f", facet {by}" if by else ""
        mode = ", interactive" if self._interactive else ""
        return f"<plotto.Plot {layers}{extra}, {len(s['data'][0])} rows{mode}>"

    def _repr_mimebundle_(self, include=None, exclude=None):
        return {"text/html": output.html(self.spec(), self._interactive), "text/plain": repr(self)}


def _constant(key, value, where, columns):
    kind = GRAMMAR["options"].get(key)
    if key in ("tooltip", "group"):
        raise ValueError(f"{where}: {key} must be a column. Columns: {', '.join(columns)}")
    if isinstance(kind, list) and value not in kind:
        _fail(where, key, value, kind)
    if kind == "number" and (not isinstance(value, (int, float)) or isinstance(value, bool)):
        raise ValueError(f"{where}: {key} must be a number")
    if kind == "boolean" and not isinstance(value, bool):
        raise ValueError(f"{where}: {key} must be True or False")
    if key in ("color", "label"):
        return value
    if isinstance(value, str) and not kind:
        raise ValueError(f'{where}: "{value}" is not a column. Columns: {", ".join(columns)}')
    return to_value(value)


def _need_column(frame, col, where):
    if col not in frame.columns:
        raise ValueError(f'{where}: "{col}" is not a column. Columns: {", ".join(map(str, frame.columns))}')


def _check_keys(options, valid, where):
    for key in options:
        if key not in valid:
            _fail(where, "option", key, valid)


def _check_free(free, where):
    if free is not None and free not in GRAMMAR["free"]:
        _fail(where, "free", free, GRAMMAR["free"])


def _fail(where, what, value, valid):
    raise ValueError(f'{where}: unknown {what} "{value}". Valid: {", ".join(valid)}')
