"""DataFrame to columnar spec data. The rules are the same as toTable() and toValue() in src/builder.js."""

import math
from datetime import date, datetime

import numpy as np
import pandas as pd


def to_frame(data, where):
    if isinstance(data, pd.DataFrame):
        return data
    if isinstance(data, list):
        return pd.DataFrame(data)
    if isinstance(data, dict) and data.get("type") == "FeatureCollection":
        # One row per feature: its properties and its geometry (column "geometry").
        return pd.DataFrame([{**(f.get("properties") or {}), "geometry": f.get("geometry")} for f in data.get("features", [])])
    raise TypeError(f"{where}: data must be a pandas DataFrame, a list of row dicts or a GeoJSON FeatureCollection")


def to_column(series: pd.Series, precise=False) -> dict:
    """One spec column: {"type": "number" | "time" | "string" | "geometry", "values": [...], "levels": [...]}.

    precise: numbers keep 5 decimals (positions in map coordinates and of a raster) instead of 6 significant digits."""
    if _is_geometry(_first(series)):
        return {"type": "geometry", "values": [None if _missing(v) else to_geometry(v) for v in series]}
    if isinstance(series.dtype, pd.CategoricalDtype):
        levels = [str(c) for c in series.cat.categories]
        return {"type": "string", "values": [None if pd.isna(v) else str(v) for v in series], "levels": levels}
    if pd.api.types.is_datetime64_any_dtype(series):
        if series.dt.tz is not None:
            series = series.dt.tz_localize(None)  # wall-clock time of the data's time zone
        ms = series.astype("datetime64[ms]").astype("int64")
        return {"type": "time", "values": [None if na else int(v) for v, na in zip(ms, series.isna(), strict=True)]}
    if pd.api.types.is_bool_dtype(series):
        return {"type": "string", "values": ["true" if v else "false" for v in series]}
    if pd.api.types.is_numeric_dtype(series):
        convert = to_coordinate if precise else to_value
        return {"type": "number", "values": [convert(v) for v in series.to_numpy()]}
    return {"type": "string", "values": [None if v is None or (isinstance(v, float) and math.isnan(v)) else str(v) for v in series]}


def _missing(v):
    return v is None or (isinstance(v, float) and math.isnan(v)) or getattr(v, "is_empty", False) is True


def _first(series: pd.Series):
    """The first value that is not missing, or None. Only object columns can hold geometries."""
    if series.dtype != object and type(series.dtype).__name__ != "GeometryDtype":
        return None
    return next((v for v in series if not _missing(v)), None)


def _is_geometry(v) -> bool:
    """A shapely geometry (or any object with __geo_interface__) or a GeoJSON geometry dict."""
    if hasattr(v, "__geo_interface__"):
        return True
    return isinstance(v, dict) and isinstance(v.get("type"), str) and "coordinates" in v


def to_geometry(v) -> dict:
    """A GeoJSON geometry with lists (not tuples) and coordinates rounded to 5 decimals (about 1 m in degrees)."""
    g = v.__geo_interface__ if hasattr(v, "__geo_interface__") else v

    def rounded(c):
        if not len(c) or _number(c[0]) or _number(c[0][0]):  # a position, or a ring of positions: one array call
            return (np.floor(np.asarray(c, dtype=float) * 1e5 + 0.5) / 1e5).tolist()  # as Math.round in JS
        return [rounded(part) for part in c]

    return {"type": g["type"], "coordinates": rounded(g["coordinates"])}


def _number(v) -> bool:
    return isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, bool)


def to_coordinate(v):
    """A number with 5 decimals (about 1 m in degrees), rounded as Math.round in JS; None for NaN."""
    if isinstance(v, (np.integer, int)) and not isinstance(v, bool):
        return int(v)
    v = float(v)
    if math.isnan(v):
        return None
    return v if v.is_integer() else math.floor(v * 1e5 + 0.5) / 1e5


def to_value(v):
    """Wall-clock epoch ms for times; 6 significant digits for floats; None for NaN."""
    if isinstance(v, (pd.Timestamp, datetime, np.datetime64, date)):
        ts = pd.Timestamp(v)
        if ts.tzinfo is not None:
            ts = ts.tz_localize(None)
        return int(ts.value // 1_000_000)
    if isinstance(v, (np.integer, int)) and not isinstance(v, bool):
        return int(v)
    if isinstance(v, (np.floating, float)):
        v = float(v)
        if math.isnan(v):
            return None
        return v if v.is_integer() else float(f"{v:.6g}")
    return v
