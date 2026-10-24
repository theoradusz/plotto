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
    raise TypeError(f"{where}: data must be a pandas DataFrame or a list of row dicts")


def to_column(series: pd.Series) -> dict:
    """One spec column: {"type": "number" | "time" | "string", "values": [...], "levels": [...]}."""
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
        return {"type": "number", "values": [to_value(v) for v in series.to_numpy()]}
    return {"type": "string", "values": [None if v is None or (isinstance(v, float) and math.isnan(v)) else str(v) for v in series]}


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
