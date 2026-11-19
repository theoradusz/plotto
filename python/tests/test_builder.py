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
        (lambda p: p.theme(aspect=0), "aspect must be a positive number"),
        (lambda p: p.theme("fancy"), 'unknown style "fancy"'),
        (lambda p: p.theme(format="poster"), 'unknown format "poster"'),
        (lambda p: p.hist(density="yes"), "density must be True or False"),
        (lambda p: p.bar(position="beside"), 'unknown position "beside"'),
        (lambda p: p.color(palette="rainbow"), 'unknown palette "rainbow"'),
        (lambda p: p.y(limits=5), "limits must be a list"),
        (lambda p: p.info({"a": 1}, position="left"), 'unknown position "left"'),
        (lambda p: p.info({"date": pd.Timestamp("2026-10-01")}), "Format other values as a string"),
        (lambda p: p.info("hayama"), "entries must be"),
        (lambda p: p.point(position="stack"), "position must be overlay or dodge"),
        (lambda p: p.x(breaks=5), "breaks must be a list"),
        (lambda p: p.x(breaks=["a"]), "breaks must be a list of numbers or dates"),
        (lambda p: p.x(labels=["a"]), "labels need breaks"),
        (lambda p: p.x(breaks=[1, 2], labels=["a"]), "labels must have one entry per break"),
        (lambda p: p.line(direct="yes"), "direct must be True or False"),
        (lambda p: p.color(breaks=[1, 1]), "breaks must increase"),
        (lambda p: p.color(breaks=[0, 1], mid=0.5), "mid does not apply with breaks"),
        (lambda p: p.fill(breaks=[0, 1], values=["red"]), "one color per break"),
        (lambda p: p.coord("mercator"), 'unknown type "mercator"'),
        (lambda p: p.coord("geo", scalebar="middle"), 'unknown scalebar "middle"'),
        (lambda p: p.coord("geo", grid=True), 'unknown option "grid"'),
        (lambda p: p.inset(x=[1, 0], y=[0, 1], at=[0, 0, 0.5, 0.5]), "x must be \\[low, high\\]"),
        (lambda p: p.inset(x=[0, 1], y=[0, 1], at=[0, 0, 1.5, 0.5]), "at must be \\[left, bottom, right, top\\]"),
        (lambda p: p.text(label="g", repel="yes"), 'unknown repel "yes". Valid: true, false, areas'),
        (lambda p: p.text(label="g", repel=1), 'unknown repel "1"'),
        (lambda p: p.inset(x=[0, 1], y=[0, 1], at=[0, None, 0.5, None]), "bottom or top can be None"),
        (lambda p: p.inset(x=[0, 1], y=[0, 1], at=[0, 0, 0.5, 0.5], title=3), "title must be a string"),
        (lambda p: p.fill(scheme="nope"), 'fill\\(\\): unknown scheme "nope"'),
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
    assert info == {"entries": [["n", 3], ["x", 2.0], ["ok", True], ["none", None]]}
    assert "info" not in p.spec()
    assert "info" not in p.info({"a": 1}).info(None).spec()


def test_breaks_accept_numpy_values_and_times():
    p = plot(pd.DataFrame(FIXTURE["rows"]), x="t", y="v").line()
    assert p.y(breaks=np.array([1, 2.5])).spec()["scales"]["y"]["breaks"] == [1, 2.5]
    breaks = p.x(breaks=[pd.Timestamp("2026-10-20")], labels=["start"]).spec()["scales"]["x"]
    assert breaks == {"breaks": [int(pd.Timestamp("2026-10-20").value // 1_000_000)], "labels": ["start"]}


class _Shape:
    """A shapely-like geometry: only __geo_interface__, with tuples, as shapely gives."""

    def __init__(self, x):
        self.__geo_interface__ = {"type": "Polygon", "coordinates": (((x, 0.0), (x + 1.0, 0.0), (x + 1.0, 1.0), (x, 0.0)),)}


def test_geometries_from_geo_interface_and_dicts_become_a_geometry_column():
    df = pd.DataFrame(
        {"geometry": [_Shape(0.123456789), None, {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [0, 1], [0, 0]]]}], "v": [1, 2, 3]}
    )
    spec = plot(df).polygon(fill="v").spec()
    assert spec["layers"][0]["mapping"] == {"fill": "v", "geometry": "geometry"}
    column = spec["data"][0]["columns"]["geometry"]
    assert column["type"] == "geometry"
    assert column["values"][0]["coordinates"][0][0] == [0.12346, 0.0]
    assert column["values"][1] is None


def test_a_feature_collection_is_one_row_per_feature():
    fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "A"},
                "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [0, 1], [0, 0]]]},
            }
        ],
    }
    spec = plot(fc).polygon(tooltip="name").spec()
    assert spec["data"][0]["columns"]["name"] == {"type": "string", "values": ["A"]}


def test_positions_of_a_raster_and_of_a_map_keep_5_decimals():
    cell = pd.DataFrame({"lon": [153.98125], "lat": [24.2875], "v": [0.123456789]})
    raster = plot(cell, x="lon", y="lat").raster(fill="v").spec()["data"][0]["columns"]
    assert raster["lon"]["values"] == [153.98125]
    assert raster["v"]["values"] == [0.123457]
    assert plot(cell, x="lon", y="lat").point().coord("geo").spec()["data"][0]["columns"]["lon"]["values"] == [153.98125]
    assert plot(cell, x="lon", y="lat").point().spec()["data"][0]["columns"]["lon"]["values"] == [153.981]


def test_d3_schemes_take_any_case():
    assert plot(pd.DataFrame(FIXTURE["rows"]), x="t", y="v").fill(scheme="ylorrd").spec()["scales"]["fill"] == {"scheme": "ylorrd"}
