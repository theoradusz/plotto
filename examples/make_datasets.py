"""Write the made-up example datasets in data/ (CSV, long format, times as wall-clock time without offset).

A seeded generator makes them, so a new run gives the same files. Two files hold real measurements and are not
made here: sensor_day.csv (band intensities of a UV sensor over one day) and lamp_spectra.csv (one lamp spectrum
per hour).

    python examples/make_datasets.py
"""

import json
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


NAMES = [
    "Aoba",
    "Asahi",
    "Fujimi",
    "Hikari",
    "Honcho",
    "Kawabe",
    "Kita",
    "Midori",
    "Minami",
    "Mori",
    "Nagisa",
    "Nishi",
    "Oka",
    "Sakura",
    "Shin",
    "Shiro",
    "Sora",
    "Taka",
    "Tani",
    "Umi",
    "Wakaba",
    "Yama",
    "Yuki",
    "Hama",
    "Ishi",
    "Kaze",
    "Matsu",
    "Nami",
    "Tsuki",
    "Hoshi",
]


def districts():
    """30 made-up districts on a jittered 6 × 5 grid near 139.75°E 35.5°N (GeoJSON), with households and the
    households without water after a made-up earthquake near the south-west. District 15 has a lake (a hole) and
    district 6 an island (a MultiPolygon). Its own generator, so the CSV files do not change. Also writes
    district_towns.csv: one town per district, at its centre."""
    g = np.random.default_rng(11)
    nx, ny = 6, 5
    lon = np.linspace(139.0, 140.5, nx + 1)
    lat = np.linspace(35.0, 36.0, ny + 1)
    # Shared corners and edge midpoints, jittered inside the grid so that the districts tile without gaps.
    corner = {
        (i, j): (lon[i] + (g.uniform(-0.06, 0.06) if 0 < i < nx else 0), lat[j] + (g.uniform(-0.04, 0.04) if 0 < j < ny else 0))
        for i in range(nx + 1)
        for j in range(ny + 1)
    }
    mid = {}
    for (i, j), (x, y) in corner.items():
        for di, dj in ((1, 0), (0, 1)):
            if (i + di, j + dj) in corner:
                x2, y2 = corner[(i + di, j + dj)]
                edge = 0 < (i if di == 0 else j) < (nx if di == 0 else ny)
                bend = g.uniform(-0.03, 0.03) if edge else 0
                mid[(i, j, di, dj)] = ((x + x2) / 2 + bend * dj, (y + y2) / 2 + bend * di)
    features, towns = [], []
    for k, (j, i) in enumerate((j, i) for j in range(ny) for i in range(nx)):
        ring = [
            corner[(i, j)],
            mid[(i, j, 1, 0)],
            corner[(i + 1, j)],
            mid[(i + 1, j, 0, 1)],
            corner[(i + 1, j + 1)],
            mid[(i, j + 1, 1, 0)],
            corner[(i, j + 1)],
            mid[(i, j, 0, 1)],
            corner[(i, j)],
        ]
        ring = [[round(x, 4), round(y, 4)] for x, y in ring]
        cx, cy = np.mean([p[0] for p in ring[:-1]]), np.mean([p[1] for p in ring[:-1]])
        geometry = {"type": "Polygon", "coordinates": [ring]}
        if k == 14:  # a lake: a hole in the district
            lake = [[cx - 0.05, cy - 0.03], [cx + 0.06, cy - 0.04], [cx + 0.07, cy + 0.03], [cx - 0.03, cy + 0.05], [cx - 0.05, cy - 0.03]]
            geometry["coordinates"].append([[round(x, 4), round(y, 4)] for x, y in lake])
        if k == 5:  # an island off the east coast
            island = [[140.56, 35.05], [140.66, 35.08], [140.63, 35.16], [140.55, 35.13], [140.56, 35.05]]
            geometry = {"type": "MultiPolygon", "coordinates": [[ring], [island]]}
        households = int(g.integers(2_000, 60_000))
        distance = np.hypot((cx - 139.35) * np.cos(np.radians(35.5)), cy - 35.25)
        out = int(households * min(1.0, np.exp(-distance / 0.18) * g.uniform(0.3, 1.6)))
        name = NAMES[k]
        features.append(
            {"type": "Feature", "properties": {"name": name, "households": households, "without_water": out}, "geometry": geometry}
        )
        towns.append({"name": name, "lon": round(cx, 4), "lat": round(cy, 4), "households": households})
    (OUT / "districts.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"districts.geojson: {len(features)} features")
    write("district_towns", pd.DataFrame(towns))


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for make in (sensor_week, spectra, calibration, heatmap, monthly, daily_range, events, dense):
        write(make.__name__, make())
    districts()
