import json
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from plotto import plot

TESTS = Path(__file__).resolve().parents[2] / "tests"
FIXTURE = json.loads((TESTS / "fixtures" / "parity.json").read_text())


def python_spec(calls):
    (_, _, mapping), *rest = calls
    p = plot(pd.DataFrame(FIXTURE["rows"]), **mapping)
    for method, args, options in rest:
        p = getattr(p, method)(*args, **options)
    return p.spec()


def test_python_and_js_builders_make_the_same_spec():
    js = json.loads(subprocess.run(["node", str(TESTS / "parity.mjs")], capture_output=True, text=True, check=True).stdout)
    for case, js_spec in zip(FIXTURE["cases"], js, strict=True):
        assert python_spec(case["calls"]) == js_spec, case["name"]


def test_a_method_returns_a_new_plot_and_keeps_the_old_one():
    base = plot(pd.DataFrame(FIXTURE["rows"]), x="t", y="v")
    lines = base.line()
    assert base.spec()["layers"] == []
    assert len(lines.spec()["layers"]) == 1


def test_a_column_name_is_a_mapping_and_other_values_are_constants():
    p = plot(pd.DataFrame(FIXTURE["rows"]), x="t", y="v").point(color="g").hline(y=0, color="pink")
    point, hline = p.spec()["layers"]
    assert point["mapping"] == {"color": "g"}
    assert hline["set"] == {"y": 0, "color": "pink"}


def test_only_used_columns_go_into_the_spec():
    spec = plot(pd.DataFrame(FIXTURE["rows"]), x="t", y="v").line().spec()
    assert set(spec["data"][0]["columns"]) == {"t", "v"}


@pytest.mark.parametrize(
    "build, message",
    [
        (lambda p: p.line(y="vv"), '"vv" is not a column'),
        (lambda p: p.line(colour="g"), 'unknown option "colour"'),
        (lambda p: p.facet("nope"), '"nope" is not a column'),
        (lambda p: p.line(dash="wavy"), 'unknown dash "wavy"'),
        (lambda p: p.x(type="polar"), 'unknown type "polar"'),
        (lambda p: p.theme("wota", legend="left"), 'unknown legend "left"'),
        (lambda p: p.theme("fancy"), 'unknown style "fancy"'),
        (lambda p: p.theme(format="poster"), 'unknown format "poster"'),
        (lambda p: p.hist(density="yes"), "density must be True or False"),
        (lambda p: p.bar(position="beside"), 'unknown position "beside"'),
        (lambda p: p.color(palette="rainbow"), 'unknown palette "rainbow"'),
        (lambda p: p.y(limits=5), "limits must be a list"),
        (lambda p: p.info({"a": 1}, position="left"), 'unknown position "left"'),
        (lambda p: p.info({"date": pd.Timestamp("2026-10-01")}), "Format other values as a string"),
        (lambda p: p.info("hayama"), "entries must be"),
    ],
)
def test_errors_name_the_problem_and_the_valid_names(build, message):
    with pytest.raises(ValueError, match=message):
        build(plot(pd.DataFrame(FIXTURE["rows"]), x="t", y="v"))


def test_limits_accept_none_and_times():
    p = plot(pd.DataFrame(FIXTURE["rows"]), x="t", y="v").line().y(limits=[0, None]).x(limits=[pd.Timestamp("2026-10-20"), None])
    scales = p.spec()["scales"]
    assert scales["y"]["limits"] == [0, None]
    assert scales["x"]["limits"][0] == int(pd.Timestamp("2026-10-20").value // 1_000_000)


def test_labels_replaces_labs():
    p = plot(pd.DataFrame(FIXTURE["rows"]), x="t", y="v").line().labels(title="T", x=None)
    assert p.spec()["labels"] == {"title": "T", "x": None}
    assert not hasattr(p, "labs")


def test_times_are_wall_clock_ms_of_their_time_zone():
    df = pd.DataFrame({"time": pd.date_range("2026-10-20 09:00", periods=2, freq="h", tz="Asia/Tokyo"), "v": [1, 2]})
    column = plot(df, x="time", y="v").line().spec()["data"][0]["columns"]["time"]
    assert column["type"] == "time"
    assert column["values"][0] == int(pd.Timestamp("2026-10-20 09:00", tz="UTC").value // 1_000_000)


def test_categories_keep_their_order_and_missing_values_are_null():
    df = pd.DataFrame({"day": pd.Categorical(["Tue", "Mon"], ["Mon", "Tue"]), "v": [1.5, float("nan")]})
    columns = plot(df, x="day", y="v").point().spec()["data"][0]["columns"]
    assert columns["day"]["levels"] == ["Mon", "Tue"]
    assert columns["v"]["values"] == [1.5, None]


def test_info_keeps_the_order_and_numpy_values():
    p = plot(pd.DataFrame(FIXTURE["rows"]), x="t", y="v").line()
    info = p.info({"n": np.int64(3), "x": np.float64(2.0), "ok": np.bool_(True), "none": None}).spec()["info"]
    assert info == {"entries": [["n", 3], ["x", 2.0], ["ok", True], ["none", None]], "position": "right"}
    assert "info" not in p.spec()
    assert "info" not in p.info({"a": 1}).info(None).spec()
