"""Write the made-up example datasets in data/ (CSV, long format, times as wall-clock time without offset).

A seeded generator makes them, so a new run gives the same files. Two files hold real measurements and are not
made here: sensor_day.csv (band intensities of a UV sensor over one day) and lamp_spectra.csv (one lamp spectrum
per hour).

    python examples/make_datasets.py
"""

from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).parent / "data"
SENSORS = ["sensor A", "sensor B", "sensor C"]
rng = np.random.default_rng(7)


def write(name, df):
    df.to_csv(OUT / f"{name}.csv", index=False, float_format="%.5g", date_format="%Y-%m-%d %H:%M:%S")
    print(f"{name}.csv: {len(df)} rows")


def sensor_week():
    """15-min indicators of 3 sensors over 7 days: a daily cycle, noise, a slow drift and one outage."""
    time = pd.date_range("2026-10-13", periods=7 * 96, freq="15min")
    hours = np.asarray(time.hour + time.minute / 60)
    frames = []
    for k, sensor in enumerate(SENSORS):
        day = np.sin((hours - 9 - k) / 24 * 2 * np.pi)
        values = {
            "UV254 (1/m)": 4 + k + 0.6 * day + np.linspace(0, 0.8, len(time)) + rng.normal(0, 0.08, len(time)),
            "turbidity (NTU)": 0.4 + 0.15 * k + 0.1 * day + np.abs(rng.normal(0, 0.03, len(time))),
            "temperature (°C)": 18 + 2.5 * day + k * 0.3 + rng.normal(0, 0.1, len(time)),
        }
        for indicator, v in values.items():
            v = v.copy()
            if sensor == "sensor A":
                v[300:330] = np.nan  # an outage of 7.5 hours
            frames.append(pd.DataFrame({"time": time, "sensor": sensor, "indicator": indicator, "value": v}))
    return pd.concat(frames)


def spectra():
    """24 hourly absorbance spectra, 220-420 nm: a peak at 260 nm that grows during the day."""
    wl = np.linspace(220, 420, 145)
    frames = []
    for hour in range(24):
        a = 0.35 * np.exp(-(((wl - 260) / 22) ** 2)) * (1 + 0.5 * np.sin(hour / 24 * np.pi)) + 0.08 * np.exp(-(wl - 220) / 40)
        a += rng.normal(0, 0.002, wl.size)
        time = pd.Timestamp("2026-10-20") + pd.Timedelta(hours=hour)
        frames.append(pd.DataFrame({"time": time, "hour": hour, "wavelength": wl, "absorbance": a}))
    return pd.concat(frames)


def calibration():
    """Absorbance against concentration: 4 batches, 3 replicates, one slope per batch."""
    rows = []
    for b, batch in enumerate("ABCD"):
        for rep in (1, 2, 3):
            for c in (0, 0.5, 1, 2, 5, 10):
                rows.append((f"batch {batch}", f"rep {rep}", c, 0.002 + (0.045 + 0.003 * b) * c + rng.normal(0, 0.004 + 0.002 * c)))
    return pd.DataFrame(rows, columns=["batch", "replicate", "concentration", "absorbance"])


def heatmap():
    """Mean flow by weekday and hour."""
    rows = []
    for d, day in enumerate(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]):
        busy = 1.0 if d < 5 else 0.6
        for hour in range(24):
            flow = busy * (30 + 25 * np.exp(-(((hour - 8) / 2) ** 2)) + 20 * np.exp(-(((hour - 19) / 2.5) ** 2))) + rng.normal(0, 2)
            rows.append((day, hour, round(flow, 1)))
    return pd.DataFrame(rows, columns=["day", "hour", "flow"])


def monthly():
    """Monthly volume per site over one year: a seasonal cycle, and one site that grows."""
    months = pd.date_range("2026-01-01", periods=12, freq="MS")
    rows = []
    for s, site in enumerate(["north", "south", "east"]):
        for m, month in enumerate(months):
            volume = (120 + 30 * s) * (1 + 0.25 * np.sin((m - 3) / 12 * 2 * np.pi)) * (1 + 0.04 * m * (site == "east")) + rng.normal(0, 6)
            rows.append((month, month.strftime("%b"), site, round(volume, 1)))
    return pd.DataFrame(rows, columns=["month", "month_name", "site", "volume"])


def daily_range():
    """Daily min, mean and max of one indicator over 60 days."""
    days = pd.date_range("2026-08-01", periods=60, freq="D")
    mean = 20 + 4 * np.sin(np.arange(60) / 60 * 2 * np.pi) + rng.normal(0, 0.4, 60)
    spread = 2 + np.abs(rng.normal(0, 0.6, 60))
    return pd.DataFrame({"day": days, "low": mean - spread, "mean": mean, "high": mean + spread})


def events():
    """A pump state (0/1) and a cumulative counter, at irregular times over one day."""
    time = pd.Timestamp("2026-10-20") + pd.to_timedelta(np.sort(rng.uniform(0, 24, 40)), unit="h")
    state = (np.arange(40) % 4 < 2).astype(int)
    return pd.DataFrame({"time": time, "pump": state, "starts": np.cumsum(np.r_[0, np.diff(state) > 0])})


def dense():
    """20 000 points in 3 clusters."""
    n = 20_000
    cluster = rng.integers(0, 3, n)
    centre = np.array([[0, 0], [3, 1], [1, 3]])[cluster]
    xy = centre + rng.normal(0, 0.6, (n, 2))
    return pd.DataFrame({"x": xy[:, 0], "y": xy[:, 1], "cluster": [f"cluster {c + 1}" for c in cluster]})


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for make in (sensor_week, spectra, calibration, heatmap, monthly, daily_range, events, dense):
        write(make.__name__, make())
