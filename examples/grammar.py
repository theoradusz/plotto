"""The grammar of plots, step by step. Each step is a function: its docstring explains, its body is the code shown,
and its result (a plot, a list of plots, a DataFrame, or a string of code) is drawn below. build_site.py makes the page.
"""

import pandas as pd

from gallery import load
from plotto import plot

week = load("sensor_week")
uv = week[week.indicator == "UV254 (1/m)"]
day = uv[(uv.time >= "2026-10-15") & (uv.time < "2026-10-16")]
one = day[day.sensor == "sensor A"]
monthly = load("monthly")


def data():
    """A plot starts with a table in long format: one row per observation, one column per variable.
    Here each row is one value of one indicator, measured by one sensor at one time. Wide tables
    (one column per sensor) become long with pandas melt()."""
    return week.head(6)


def mapping():
    """plot() takes the data and maps columns to channels: x, y, color, group, tooltip, label, ...
    A mapping alone draws nothing. A layer draws it: here, point()."""
    p = plot(one, x="time", y="value").point()
    return p


def layers():
    """Layers stack in the order you add them. Each layer uses the plot mappings for its channels.
    Here: a line, then the points on top, then a reference line."""
    p = plot(one, x="time", y="value").line().point(size=2.5).hline(y=4)
    return p


def mapping_or_setting():
    """A string that names a column is a mapping: the color then changes with the data, and a legend shows.
    Any other value is a setting: one color (a theme color or a CSS color), one size, one line pattern."""
    mapped = plot(day, x="time", y="value", color="sensor").line()
    setting = plot(one, x="time", y="value").line(color="red", size=3, dash="dashed")
    return [mapped, setting]


def layer_data():
    """A layer can have its own data with data=. hline, vline, abline and band do not use the plot mappings,
    so a reference line needs only its own value."""
    events = pd.DataFrame({"time": pd.to_datetime(["2026-10-15 06:00", "2026-10-15 18:30"]), "event": ["filter", "cleaning"]})
    p = (
        plot(day, x="time", y="value", color="sensor")
        .line()
        .vline(data=events, x="time", color="gray", dash="dotted")
        .text(data=events, x="time", y=7.4, label="event")
    )
    return p


def statistics():
    """Some layers compute before they draw: hist counts in bins, density smooths a distribution,
    smooth fits a trend, box computes quartiles, and summary= reduces the rows at each x."""
    hist = plot(week[week.indicator == "turbidity (NTU)"], x="value", color="sensor").hist(bins=30, position="overlay")
    trend = plot(uv, x="time", y="value", color="sensor").point(size=1, alpha=0.3).smooth(method="loess", span=0.3)
    return [hist, trend]


def position():
    """position= says how the bars of one x share the space: stack (the default) adds them up,
    dodge puts them side by side, overlay draws them over each other."""
    spring = monthly[monthly.month_name.isin(["Mar", "Apr", "May"])]
    return [
        plot(spring, x="month_name", y="volume", color="site").bar(position=pos).labels(title=f'position="{pos}"').theme(height=240)
        for pos in ("stack", "dodge", "overlay")
    ]


def position_scales():
    """Scales turn data into positions and colors. x() and y() set the type (linear, log, time, category),
    the limits of the first view (None keeps the data bound) and the label format."""
    p = (
        plot(uv, x="time", y="value", color="sensor")
        .line()
        .x(limits=[pd.Timestamp("2026-10-14"), pd.Timestamp("2026-10-16")], format="%a %H:%M")
        .y(limits=[0, None])
    )
    return p


def color_scales():
    """color() sets the color scale. Categories use a palette (or values=); numbers use a scheme,
    and a diverging scheme with mid= centers a reference value."""
    spectra = load("spectra")
    categories = plot(uv, x="time", y="value", color="sensor").line().color(palette="momiji")
    numbers = plot(spectra, x="wavelength", y="absorbance", color="hour", group="hour").line().color(scheme="ai")
    return [categories, numbers]


def facets():
    """Facets split the data into panels: facet() by one column, grid() by two.
    free="y" gives each panel its own y range; shared axes stay aligned."""
    p = plot(week, x="time", y="value", color="sensor").line(size=1).facet("indicator", free="y", ncol=1).theme(height=520)
    return p


def labels_and_themes():
    """labels() sets the titles; None removes one. theme() sets the style (the colors and the font)
    and the format (the size): screen follows the page width, report and slide have a fixed size."""
    p = (
        plot(uv, x="time", y="value", color="sensor")
        .line()
        .labels(title="UV254 over one week", subtitle="15-min values", x=None, y="UV254 (1/m)", caption="Made-up data")
        .theme("wota")
    )
    return p


def interaction_and_output():
    """The same plot is static (with copy and download buttons) or interactive. save() writes a PNG or an SVG
    with the same look; width= lays the plot out again at that size."""
    return """p = plot(uv, x="time", y="value", color="sensor").line()

p                                  # static, at the width of the cell
p.interactive()                    # zoom, pan, hover, legend toggle
p.save("uv.png", width=1600)       # a PNG for slides
p.theme("pastel", format="slide").save("uv_slide.svg")"""


def the_spec():
    """Under the hood, a plot is a small JSON spec. The Python and the JavaScript builders write the same spec,
    and one renderer draws it everywhere: in a notebook, on a web page, in a file."""
    p = plot(day.head(3), x="time", y="value", color="sensor").line().hline(y=5).labels(title="UV254")
    return p.spec()


def python_and_javascript():
    """The JavaScript builder has the same methods. Keyword arguments become option objects."""
    return """# Python
plot(df, x="time", y="value", color="sensor").line().facet("indicator", free="y")

// JavaScript
plot(rows, { x: "time", y: "value", color: "sensor" }).line().facet("indicator", { free: "y" })

// React
<Plot spec={plot(rows, { x: "time", y: "value" }).line()} interactive />"""


STEPS = [
    ("Data", data),
    ("Mappings", mapping),
    ("Layers", layers),
    ("Mapping or setting", mapping_or_setting),
    ("Layer data", layer_data),
    ("Statistics", statistics),
    ("Position", position),
    ("Position scales", position_scales),
    ("Color scales", color_scales),
    ("Facets", facets),
    ("Labels and themes", labels_and_themes),
    ("Interaction and output", interaction_and_output),
    ("The spec", the_spec),
    ("Python and JavaScript", python_and_javascript),
]
