"""Example gallery: each function returns one plot, or a list of plots. Together they use every feature of plotto.

build_site.py draws them into docs/ (the GitHub Pages site); showcase.ipynb shows them in a notebook.
"""

from pathlib import Path

import numpy as np
import pandas as pd

from plotto import plot

DATA = Path(__file__).parent / "data"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def load(name):
    df = pd.read_csv(DATA / f"{name}.csv")
    for col in ("time", "day", "month"):
        if col in df and pd.api.types.is_string_dtype(df[col]) and df[col].str.match(r"\d{4}-").all():
            df[col] = pd.to_datetime(df[col])
    return df


def uv254():
    df = load("sensor_week")
    return df[df.indicator == "UV254 (1/m)"]


def turbidity():
    df = load("sensor_week")
    return df[df.indicator == "turbidity (NTU)"]


# --- Lines and points -----------------------------------------------------------------------


def lines():
    """Lines on a time axis. A missing value (an outage) makes a gap. A horizontal line marks a target."""
    return (
        plot(uv254(), x="time", y="value", color="sensor")
        .line()
        .hline(y=5, color="red", dash="dashed")
        .labels(title="UV254 over one week", subtitle="Three sensors, 15-min values", x=None, y="UV254 (1/m)", caption="Made-up data")
    )


def points():
    """Points with a color per group. tooltip adds a column to the hover label. palette picks other colors."""
    return (
        plot(load("calibration"), x="concentration", y="absorbance", color="batch", tooltip="replicate")
        .point(size=4, alpha=0.85)
        .color(palette="sakura")
        .labels(title="Calibration", x="concentration (mg/L)")
    )


def limits():
    """limits sets the first view of an axis. None keeps the data bound on that side; format sets the labels."""
    return (
        plot(uv254(), x="time", y="value", color="sensor")
        .line(size=2)
        .x(limits=[pd.Timestamp("2026-10-15"), pd.Timestamp("2026-10-16 12:00")], format="%a %H:%M")
        .y(limits=[0, None])
        .labels(title="A 36-hour window, y from 0", x=None, y="UV254 (1/m)")
    )


def facets():
    """One panel per value of a column. free="y" gives each panel its own y range."""
    return (
        plot(load("sensor_week"), x="time", y="value", color="sensor")
        .line(size=1)
        .facet("indicator", free="y", ncol=1)
        .labels(title="Three indicators, three sensors", x=None, y=None)
        .theme(height=600)
    )


def grid():
    """Rows and columns of panels from two columns."""
    return (
        plot(load("calibration"), x="concentration", y="absorbance")
        .line(color="gray", size=1)
        .point(color="blue")
        .grid(rows="replicate", cols="batch")
        .labels(title="Calibration by batch and replicate", x="concentration (mg/L)")
        .theme(height=500)
    )


def annotations():
    """Bands, vertical lines, segments and text. A layer can have its own data (here, a table of events)."""
    df = turbidity()
    df = df[df.sensor == "sensor B"]
    events = pd.DataFrame({"time": pd.to_datetime(["2026-10-14 03:00", "2026-10-17 15:00"]), "event": ["filter change", "calibration"]})
    start, end = pd.Timestamp("2026-10-15 06:00"), pd.Timestamp("2026-10-15 18:00")
    return (
        plot(df, x="time", y="value")
        .band(xmin=start, xmax=end, color="yellow", alpha=0.25)
        .line(color="teal")
        .hline(y=0.75, color="red", dash="dashed")
        .vline(data=events, x="time", color="purple", dash="dotted")
        .text(data=events, x="time", y=0.78, label="event", color="purple")
        .text(x=start, y=0.42, label="maintenance", color="brown")
        .labels(title="Turbidity with a limit, events and a maintenance window", x=None, y="turbidity (NTU)")
    )


# --- Distributions --------------------------------------------------------------------------


def histogram():
    """Bins with density=True, and a kernel density line on top, per group."""
    return (
        plot(turbidity(), x="value", color="sensor")
        .hist(bins=40, position="overlay", density=True)
        .density(size=2)
        .labels(title="Turbidity distribution", x="turbidity (NTU)")
    )


def box():
    """A box per category, with the raw points (jitter) behind it."""
    return (
        plot(turbidity(), x="sensor", y="value")
        .point(color="sensor", jitter=0.6, size=1.5, alpha=0.3)
        .box(alpha=0.6)
        .labels(title="Turbidity by sensor", x=None, y="turbidity (NTU)")
        .theme(legend="none")
    )


def summary():
    """A summary computed by the plot (median line) and error bars from a summary table (its own data)."""
    df = load("calibration")
    stats = df.groupby("concentration", as_index=False)["absorbance"].agg(["mean", "std"])
    stats["low"], stats["high"] = stats["mean"] - stats["std"], stats["mean"] + stats["std"]
    return (
        plot(df, x="concentration", y="absorbance")
        .point(color="gray", alpha=0.5)
        .line(summary="median", color="blue", size=2)
        .errorbar(data=stats, x="concentration", ymin="low", ymax="high", color="red")
        .labels(title="Median line and mean ± 1 sd", x="concentration (mg/L)")
    )


# --- Bars and areas -------------------------------------------------------------------------


def stacked_bars():
    """Bars on a time axis, stacked by color. Hover shows the whole stack and its total."""
    return plot(load("monthly"), x="month", y="volume", color="site").bar().labels(title="Monthly volume per site", x=None, y="volume (m³)")


def dodged_bars():
    """Bars side by side. On a category axis, limits sets the order of the categories."""
    return (
        plot(load("monthly"), x="month_name", y="volume", color="site")
        .bar(position="dodge")
        .x(limits=MONTHS)
        .labels(title="Monthly volume per site, side by side", x=None, y="volume (m³)")
    )


def area():
    """Stacked areas over time."""
    return (
        plot(load("monthly"), x="month", y="volume", color="site")
        .area()
        .labels(title="Total monthly volume, by site", x=None, y="volume (m³)")
    )


def ribbon():
    """A min–max range around a mean line."""
    return (
        plot(load("daily_range"), x="day", y="mean")
        .ribbon(ymin="low", ymax="high", color="orange")
        .line(color="orange", size=2)
        .labels(title="Daily temperature: mean and min–max", x=None, y="temperature (°C)")
    )


def step():
    """Steps for states and counters."""
    df = load("events").melt(id_vars="time", value_vars=["pump", "starts"], var_name="series", value_name="value")
    return (
        plot(df, x="time", y="value", color="series")
        .step(size=2)
        .facet("series", free="y", ncol=1)
        .labels(title="Pump state and number of starts", x=None, y=None)
        .theme(legend="none", height=380)
    )


def smooth():
    """Trends: a linear fit with its 95% band per group, and a loess curve through noisy data."""
    linear = (
        plot(load("calibration"), x="concentration", y="absorbance", color="batch")
        .point(alpha=0.6)
        .smooth(method="lm")
        .labels(title='smooth(method="lm")', x="concentration (mg/L)")
    )
    df = uv254()
    loess = (
        plot(df[df.sensor == "sensor C"], x="time", y="value")
        .point(color="gray", size=1.5, alpha=0.4)
        .smooth(method="loess", span=0.3, size=2.5)
        .labels(title='smooth(method="loess", span=0.3)', x=None, y="UV254 (1/m)")
    )
    return [linear, loess]


# --- Color ----------------------------------------------------------------------------------


def continuous():
    """A number mapped to color gives a color ramp. scheme picks the gradient."""
    return (
        plot(load("spectra"), x="wavelength", y="absorbance", color="hour", group="hour")
        .line(size=1.2)
        .color(scheme="yuhi")
        .labels(title="Absorbance spectra by hour", x="wavelength (nm)")
    )


def diverging():
    """A diverging scheme centered on mid=0, for values above and below a reference."""
    df = load("heatmap")
    df["anomaly"] = df["flow"] - df.groupby("hour")["flow"].transform("mean")
    return (
        plot(df, x="hour", y="day", color="anomaly")
        .tile()
        .y(limits=DAYS)
        .color(scheme="aiaka", mid=0)
        .labels(title="Flow anomaly by weekday and hour", y=None, color="Δ flow (m³/h)")
    )


def palettes():
    """The color palettes for categories: color(palette=...). Inspired by traditional Japanese colors."""
    cats = pd.DataFrame({"name": list("ABCDEFGHIJ"), "value": np.linspace(10, 4, 10)})
    out = []
    for name in ("pastel", "sakura", "aizome", "momiji", "wota", "tableau"):
        out.append(
            plot(cats, x="name", y="value", color="name")
            .bar()
            .color(palette=name)
            .labels(title=f'palette="{name}"', x=None, y=None)
            .theme(legend="none", height=170)
        )
    return out


def schemes():
    """The gradients for numbers: color(scheme=...). aiaka is diverging; any d3 scheme also works."""
    df = load("heatmap")
    out = []
    for name in ("ai", "sakura", "matcha", "yuhi", "sumi", "aiaka", "viridis"):
        out.append(
            plot(df, x="hour", y="day", color="flow")
            .tile()
            .y(limits=DAYS)
            .color(scheme=name)
            .labels(title=f'scheme="{name}"', x=None, y=None, color=None)
            .theme(height=210)
        )
    return out


def log_axes():
    """Log axes: x(type="log"), y(type="log")."""
    df = load("calibration")
    return (
        plot(df[df.concentration > 0], x="concentration", y="absorbance", color="batch")
        .point(size=3)
        .x(type="log")
        .y(type="log")
        .labels(title="Log-log calibration", x="concentration (mg/L)")
    )


# --- Styles and output ----------------------------------------------------------------------


def styles():
    """The same plot in each style, and the slide format (1280 × 720 px, large text) with the wota style."""
    base = lines().labels(subtitle=None, caption=None)
    out = [base.theme(name).labels(title=f'theme("{name}")') for name in ("pastel", "wota", "paper", "dark")]
    out.append(facets().theme("wota", format="slide").labels(title='theme("wota", format="slide")'))
    return out


def dense():
    """20 000 points: the SVG stays responsive."""
    return plot(load("dense"), x="x", y="y", color="cluster").point(size=1.2, alpha=0.35).labels(title="20 000 points")


def measurements():
    """Real measurements of a UV sensor: band intensity over one day, and one lamp spectrum per hour."""
    day = (
        plot(load("sensor_day"), x="time", y="intensity", color="mode")
        .point(size=1.5)
        .facet("band", free="y", ncol=1)
        .labels(title="UV sensor, one day: band intensity", x=None, y="intensity (counts)")
        .theme(height=560)
    )
    spectra = (
        plot(load("lamp_spectra"), x="wavelength", y="intensity", color="hour", group="hour")
        .line(size=1)
        .x(limits=[230, 330])
        .color(scheme="ai")
        .labels(title="Lamp spectra by hour", x="wavelength (nm)", y="intensity (counts)")
    )
    return [day, spectra]


# --- More plot types, scales and legends --------------------------------------------------


def heatmap():
    """Tiles: one cell per (x, y) pair, colored by a value."""
    return (
        plot(load("heatmap"), x="hour", y="day", color="flow")
        .tile()
        .y(limits=DAYS)
        .labels(title="Flow by weekday and hour", y=None, color="flow (m³/h)")
    )


def category_order():
    """On a category axis, limits sets the categories and their order. Labels too wide for their space rotate."""
    df = turbidity()
    names = {"sensor A": "inlet sensor (A)", "sensor B": "middle sensor (B)", "sensor C": "outlet sensor (C)"}
    df = df.assign(position=df.sensor.map(names))
    return (
        plot(df, x="position", y="value")
        .box()
        .x(limits=["outlet sensor (C)", "middle sensor (B)", "inlet sensor (A)"])
        .labels(title="Turbidity, outlet first", x=None, y="turbidity (NTU)")
    )


def titles():
    """labels() sets the title, subtitle, caption, axis titles and legend title. None removes a title."""
    return (
        plot(uv254(), x="time", y="value", color="sensor")
        .line()
        .labels(
            title="UV254 over one week",
            subtitle="15-min values of three sensors",
            caption="Source: made-up data",
            x=None,
            y="UV254 (1/m)",
            color="Sensor",
        )
    )


def info():
    """info() shows facts about the data or the experiment as a key/value table, instead of a long subtitle.
    The card goes on the right (default) or, with position="bottom", below the plot. A narrow plot puts it below."""
    base = plot(uv254(), x="time", y="value", color="sensor").line().labels(title="UV254 after cleaning", x=None, y="UV254 (1/m)")
    entries = {
        "site": "Hayama",
        "experiment": "cleaning with chlorine",
        "run": 15,
        "chlorine dose": "2.5 mg/L",
        "contact time": "30 min",
        "flow rate": "1.2 L/min",
        "operator": "T. R.",
        "notes": "membrane replaced the day before; sensor B recalibrated at noon",
    }
    return [base.info(entries).theme(height=360), base.info(entries, position="bottom").theme(height=420)]


def legends():
    """theme(legend=...) puts the legend on the right (default), at the bottom, or removes it.
    Click an entry to hide it; two quick clicks show only that entry. A narrow plot moves the legend to the bottom."""
    base = plot(load("monthly"), x="month", y="volume", color="site").area().labels(x=None, y="volume (m³)")
    return [base.theme(legend=where, height=260).labels(title=f'legend="{where}"') for where in ("right", "bottom", "none")]


def interaction():
    """Interaction: drag to zoom (a flat drag zooms x only), pan with the pan button, double-click to reset.
    Click to pin the hover label; the next click releases it. Esc also releases it."""
    return (
        plot(load("sensor_week"), x="time", y="value", color="sensor").line(size=1).facet("indicator", free="y", ncol=1).theme(height=520)
    )


PAGES = {
    "basics": {
        "file": "index.html",
        "title": "Basics",
        "sections": {
            "First plots": [lines, points, facets, grid],
            "Annotations": [annotations],
            "Real measurements": [measurements],
        },
    },
    "types": {
        "file": "types.html",
        "title": "Plot types",
        "sections": {
            "Lines and areas": [step, area, ribbon, smooth],
            "Bars and distributions": [stacked_bars, dodged_bars, histogram, box, summary],
            "Cells and many points": [heatmap, dense],
        },
    },
    "colors": {
        "file": "colors.html",
        "title": "Colors",
        "sections": {
            "Palettes": [palettes],
            "Gradients": [continuous, schemes, diverging],
            "Styles and formats": [styles],
        },
    },
    "scales": {
        "file": "scales.html",
        "title": "Scales and legends",
        "sections": {
            "Axes": [limits, log_axes, category_order],
            "Titles and legends": [titles, info, legends],
            "Interaction": [interaction],
        },
    },
}
EXAMPLES = [fn for page in PAGES.values() for fns in page["sections"].values() for fn in fns]
FIXED_STYLE = {"styles", "palettes"}  # examples that show a style on purpose


def plots_of(fn):
    """[(file name, plot)] of one example."""
    result = fn()
    plots = result if isinstance(result, list) else [result]
    names = [fn.__name__ + (f"_{i + 1}" if len(plots) > 1 else "") for i in range(len(plots))]
    return list(zip(names, plots, strict=True))
