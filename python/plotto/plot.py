"""Chainable plot builder: the same methods, arguments and spec as src/builder.js.

Each method returns a new Plot and never changes the old one. A string that names a column is a mapping;
any other value is a constant.
"""

from __future__ import annotations

import json
from datetime import date, datetime

import numpy as np

from . import assets, output
from .data import to_column, to_frame, to_value

GRAMMAR = json.loads(assets.path("grammar.json").read_text())
THEMES = json.loads(assets.path("theme.json").read_text())
LAYERS = GRAMMAR["layers"]
PLOT_CHANNELS = list(dict.fromkeys(ch for layer in LAYERS.values() for ch in layer["channels"]))
NO_STACK = ("point", "segment", "errorbar")  # layers that dodge but do not stack


def plot(data, **mapping) -> Plot:
    """Start a plot: plot(df, x="time", y="W", color="device")."""
    frame = to_frame(data, "plot()")
    for ch, col in mapping.items():
        if ch not in PLOT_CHANNELS:
            _fail("plot()", "channel", ch, PLOT_CHANNELS)
        _need_column(frame, col, "plot()")
    state = {
        "data": [frame],
        "mapping": mapping,
        "layers": [],
        "facet": None,
        "scales": {},
        "labels": {},
        "info": None,
        "coord": None,
        "insets": [],
        "theme": {"style": "pastel"},
    }
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
        if layer["set"].get("position") == "stack" and type_ in NO_STACK:
            raise ValueError(f"{where}: position must be overlay or dodge")
        # A polygon takes the column named "geometry" (a GeoJSON or GeoDataFrame table) unless a mapping sets it.
        plot_geometry = self._s["mapping"].get("geometry")
        if type_ == "polygon" and "geometry" not in layer["mapping"] and plot_geometry not in columns and "geometry" in columns:
            layer["mapping"]["geometry"] = "geometry"
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

    def polygon(self, **options):
        """Filled areas from a geometry column (GeoJSON Polygon or MultiPolygon): polygon(fill="households")."""
        return self._layer("polygon", **options)

    def raster(self, **options):
        """A grid of cells as one image, colored by the fill scale: raster(x="lon", y="lat", fill="intensity").
        One row per cell center of a regular grid; missing cells are transparent."""
        return self._layer("raster", **options)

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

    def fill(self, **options):
        return self._scale("fill", options)

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
        scheme = options.get("scheme")
        d3_names = [n.lower() for n in GRAMMAR["d3Schemes"]]
        if (
            scheme is not None
            and not isinstance(scheme, (list, tuple))
            and scheme not in THEMES["schemes"]
            and str(scheme).lower() not in d3_names
        ):
            _fail(where, "scheme", scheme, [*THEMES["schemes"], *GRAMMAR["d3Schemes"]])
        scale = dict(options)
        if scale.get("limits") is not None:
            if not isinstance(scale["limits"], (list, tuple)):
                raise ValueError(f"{where}: limits must be a list, for example [0, 10] or [0, None]")
            scale["limits"] = [None if v is None else to_value(v) for v in scale["limits"]]
        if "breaks" in scale:
            breaks = scale["breaks"]
            if not isinstance(breaks, (list, tuple, np.ndarray)) or not all(_is_break(v) for v in breaks):
                raise ValueError(f"{where}: breaks must be a list of numbers or dates, for example [1, 2, 5, 10]")
            scale["breaks"] = [to_value(v) for v in breaks]
        if "labels" in scale:
            if "breaks" not in scale:
                raise ValueError(f"{where}: labels need breaks: one label per break")
            labels = scale["labels"]
            if not isinstance(labels, (list, tuple)) or len(labels) != len(scale["breaks"]) or not all(isinstance(v, str) for v in labels):
                raise ValueError(f"{where}: labels must have one entry per break, as strings")
            scale["labels"] = list(labels)
        if "breaks" in scale and name in ("color", "fill"):
            _check_classes(scale, where)
        return self._with(scales={**self._s["scales"], name: scale})

    def coord(self, type_, **options) -> Plot:
        """Map coordinates: coord("geo") makes x (longitude) and y (latitude) the same distance per px.

        scalebar, north: True (the default corner) or a corner ("bottom-left", ...), for a scale bar and a north arrow.
        """
        if type_ not in GRAMMAR["coord"]:
            _fail("coord()", "type", type_, GRAMMAR["coord"])
        _check_keys(options, GRAMMAR["coordOptions"], "coord()")
        coord = {"type": type_}
        for key, corner in (("scalebar", "bottom-left"), ("north", "top-right")):
            v = options.get(key)
            if v is None or v is False:
                continue
            if v is not True and v not in GRAMMAR["corners"]:
                _fail("coord()", key, v, ["true", *GRAMMAR["corners"]])
            coord[key] = corner if v is True else v
        return self._with(coord=coord)

    def inset(self, **options) -> Plot:
        """An inset: the panel area at (left, bottom, right, top shares of the panel) shows the extent x × y,
        for example inset(x=[122.9, 131.4], y=[24.0, 28.6], at=[0.02, None, 0.3, 0.98], title="Okinawa"). Each call
        adds one inset. A None bottom or top gives the box the shape of the extent (map coordinates)."""
        _check_keys(options, GRAMMAR["inset"], "inset()")
        x, y, at = options.get("x"), options.get("y"), options.get("at")
        for name, v in (("x", x), ("y", y)):
            if not isinstance(v, (list, tuple)) or len(v) != 2 or not all(_is_break(n) for n in v) or not to_value(v[0]) < to_value(v[1]):
                raise ValueError(f"inset(): {name} must be [low, high], for example [122.9, 131.4]")

        # bottom or top can be None: the box then takes the shape of the extent (map coordinates).
        def share(n):
            return _is_number(n) and 0 <= n <= 1

        valid = isinstance(at, (list, tuple)) and len(at) == 4 and share(at[0]) and share(at[2]) and at[0] < at[2]
        valid = valid and all(n is None or share(n) for n in (at[1], at[3])) and not (at[1] is None and at[3] is None)
        if not valid or (at[1] is not None and at[3] is not None and at[1] >= at[3]):
            raise ValueError(
                "inset(): at must be [left, bottom, right, top] as shares of the panel (0 to 1), for example [0.02, 0.6, 0.3, 0.98]; "
                "bottom or top can be None"
            )
        title = options.get("title")
        if title is not None and not isinstance(title, str):
            raise ValueError("inset(): title must be a string")
        inset = {"x": [to_value(v) for v in x], "y": [to_value(v) for v in y], "at": [None if v is None else to_value(v) for v in at]}
        if title:
            inset["title"] = title
        return self._with(insets=[*self._s["insets"], inset])

    def labels(self, **options) -> Plot:
        _check_keys(options, GRAMMAR["labels"], "labels()")
        return self._with(labels={**self._s["labels"], **options})

    def info(self, entries, **options) -> Plot:
        """A key/value table about the data or the experiment: info({"location": "hayama"}, position="right"). None removes it."""
        _check_keys(options, GRAMMAR["info"], "info()")
        position = options.get("position")
        if position is not None and position not in GRAMMAR["infoPosition"]:
            _fail("info()", "position", position, GRAMMAR["infoPosition"])
        if entries is None:
            return self._with(info=None)
        if isinstance(entries, dict):
            pairs = list(entries.items())
        elif isinstance(entries, (list, tuple)):
            pairs = list(entries)
        else:
            raise ValueError("info(): entries must be a dict or a list of (key, value) pairs")
        info = {"entries": [_info_entry(pair) for pair in pairs]}
        if position is not None:
            info["position"] = position
        return self._with(info=info)

    def theme(self, style="pastel", **options) -> Plot:
        """The look (style) and the output size (format): theme("wota", format="slide")."""
        _check_keys(options, GRAMMAR["theme"], "theme()")
        if style not in THEMES["styles"]:
            _fail("theme()", "style", style, list(THEMES["styles"]))
        if "format" in options and options["format"] not in THEMES["formats"]:
            _fail("theme()", "format", options["format"], list(THEMES["formats"]))
        if "legend" in options and options["legend"] not in GRAMMAR["legend"]:
            _fail("theme()", "legend", options["legend"], GRAMMAR["legend"])
        aspect = options.get("aspect")
        if aspect is not None and (isinstance(aspect, bool) or not isinstance(aspect, (int, float)) or aspect <= 0):
            raise ValueError("theme(): aspect must be a positive number (panel height / width), for example 1 for square panels")
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
        precise = _position_columns(s)  # 5 decimals for the positions of a raster, and of every layer in map coordinates
        data = [{"columns": {c: to_column(frame[c], precise=c in precise[i]) for c in used[i]}} for i, frame in enumerate(s["data"])]
        spec = {
            "version": 1,
            "data": data,
            "mapping": s["mapping"],
            "layers": s["layers"],
            "facet": s["facet"],
            "scales": s["scales"],
            "labels": s["labels"],
        }
        if s["info"]:
            spec["info"] = s["info"]
        if s["coord"]:
            spec["coord"] = s["coord"]
        if s["insets"]:
            spec["insets"] = s["insets"]
        spec["theme"] = s["theme"]
        return spec

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

    def _display_(self):
        """marimo output (Jupyter ignores it): a live widget with anywidget installed, with no Node call.
        Without anywidget, the notebook HTML, of which marimo shows the static SVG."""
        try:
            from .widget import PlotWidget
        except ImportError:
            import marimo as mo

            return mo.Html(output.html(self.spec(), self._interactive))
        return PlotWidget(spec=self.spec(), interactive=self._interactive)


def _constant(key, value, where, columns):
    kind = GRAMMAR["options"].get(key)
    if key in ("tooltip", "group"):
        raise ValueError(f"{where}: {key} must be a column. Columns: {', '.join(columns)}")
    if isinstance(kind, list) and not any(value is k if isinstance(k, bool) or isinstance(value, bool) else value == k for k in kind):
        _fail(where, key, value, kind)
    if kind == "number" and (not isinstance(value, (int, float)) or isinstance(value, bool)):
        raise ValueError(f"{where}: {key} must be a number")
    if kind == "boolean" and not isinstance(value, bool):
        raise ValueError(f"{where}: {key} must be True or False")
    if key in ("color", "fill", "label"):
        return value
    if isinstance(value, str) and not kind:
        raise ValueError(f'{where}: "{value}" is not a column. Columns: {", ".join(columns)}')
    return to_value(value)


POSITIONS = ("x", "y", "xend", "yend", "xmin", "xmax", "ymin", "ymax")


def _position_columns(s):
    """The columns (a set per table) that keep 5 decimals instead of 6 significant digits: the x and y of a raster,
    and every position channel in map coordinates (coord("geo")), mapped by the layer or inherited from the plot."""
    geo = (s["coord"] or {}).get("type") == "geo"
    sets = [set() for _ in s["data"]]
    for layer in s["layers"]:
        if not geo and layer["type"] != "raster":
            continue
        definition = LAYERS[layer["type"]]
        table = layer.get("data", 0)
        for ch in POSITIONS:
            if ch not in definition["channels"] or ch in layer["set"]:
                continue
            plot_column = s["mapping"].get(ch)
            inherited = plot_column if definition.get("inherit", True) and plot_column in s["data"][table].columns else None
            column = layer["mapping"].get(ch, inherited)
            if column is not None:
                sets[table].add(column)
    return sets


def _check_classes(scale, where):
    """A binned color scale: breaks that increase, colors (a list) of one per class, and no mid."""
    breaks = scale["breaks"]
    if any(b <= a for a, b in zip(breaks, breaks[1:], strict=False)):
        raise ValueError(f"{where}: breaks must increase")
    if "mid" in scale:
        raise ValueError(f"{where}: mid does not apply with breaks")
    values = scale.get("values")
    if values is not None and (not isinstance(values, (list, tuple)) or len(values) != len(breaks)):
        raise ValueError(f"{where}: with breaks, values must be a list of one color per break (class)")


def _is_number(v):
    return isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, (bool, np.bool_))


def _is_break(v):
    """A number or a time (not a bool and not a string): a valid axis break."""
    if isinstance(v, (bool, np.bool_, str)):
        return False
    return isinstance(v, (int, float, np.integer, np.floating, datetime, date, np.datetime64))


def _info_entry(pair):
    """One [key, value] entry of info(). Numbers keep 6 significant digits; the renderer writes the value as text."""
    if not isinstance(pair, (list, tuple)) or len(pair) != 2 or not isinstance(pair[0], str):
        raise ValueError("info(): each entry must be a (key, value) pair with a string key")
    key, value = pair
    if value is None or isinstance(value, (str, bool, np.bool_)):
        return [key, None if value is None else value if isinstance(value, str) else bool(value)]
    if isinstance(value, (int, float, np.integer, np.floating)):
        return [key, to_value(value)]
    raise ValueError(f'info(): the value of "{key}" must be a string, a number, a boolean or None. Format other values as a string')


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
    names = ", ".join(str(v).lower() if isinstance(v, bool) else str(v) for v in valid)  # true, false as in JS
    raise ValueError(f'{where}: unknown {what} "{value}". Valid: {names}')
