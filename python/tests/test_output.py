import pandas as pd

from plotto import plot

DF = pd.DataFrame({"t": [1, 2, 3, 4], "v": [1.0, 3.0, 2.0, 4.0], "g": ["a", "a", "b", "b"]})
P = plot(DF, x="t", y="v", color="g").line().labels(title="Test")


def test_save_writes_svg_and_png(tmp_path):
    P.save(tmp_path / "fig.svg")
    P.save(tmp_path / "fig.png", scale=1)
    svg = (tmp_path / "fig.svg").read_text()
    assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg"') and "Test" in svg
    png = (tmp_path / "fig.png").read_bytes()
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert int.from_bytes(png[16:20], "big") == 900  # theme width at scale 1


def test_notebook_output_is_html_with_the_static_svg_inside():
    for p, interactive in ((P, "false"), (P.interactive(), "true")):
        bundle = p._repr_mimebundle_()
        assert set(bundle) == {"text/html", "text/plain"}
        html = bundle["text/html"]
        assert '<svg xmlns="http://www.w3.org/2000/svg" width="100%"' in html
        assert f"{{interactive: {interactive}}}" in html and "cdn.jsdelivr.net" in html


def test_save_width_lays_out_at_that_width(tmp_path):
    P.save(tmp_path / "wide.png", scale=1, width=1600)
    png = (tmp_path / "wide.png").read_bytes()
    assert (int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")) == (1600, 889)  # the screen ratio, 900 × 500


def test_repr_names_the_layers():
    assert repr(P) == "<plotto.Plot line, 4 rows>"
    assert repr(P.interactive().facet("g")) == "<plotto.Plot line, facet g, 4 rows, interactive>"


def test_python_and_npm_versions_agree():
    import json
    from pathlib import Path

    import plotto

    package = json.loads((Path(__file__).resolve().parents[2] / "package.json").read_text())
    assert plotto.__version__ == package["version"]


def test_marimo_display_is_a_widget_with_the_spec():
    from plotto.widget import PlotWidget

    for p, interactive in ((P, False), (P.interactive(), True)):
        widget = p._display_()
        assert isinstance(widget, PlotWidget)
        assert widget.spec == p.spec()
        assert widget.interactive is interactive


def test_the_wheel_ships_the_widget_and_the_docs(tmp_path):
    import shutil
    import subprocess
    import sys
    import zipfile
    from pathlib import Path

    # Build from a copy, so the build leaves nothing in the checkout.
    source = Path(__file__).resolve().parents[1]
    copy = shutil.copytree(source, tmp_path / "python", ignore=shutil.ignore_patterns("__pycache__", "*.egg-info", "build", "tests"))
    subprocess.run([sys.executable, "-m", "pip", "wheel", "--no-deps", "-q", "-w", tmp_path / "dist", copy], check=True)
    (wheel,) = (tmp_path / "dist").glob("*.whl")
    names = zipfile.ZipFile(wheel).namelist()
    for name in ("widget.js", "plotto.js", "README.md", "SPEC.md"):
        assert f"plotto/_assets/{name}" in names, f"{name} is not in the wheel: run npm run build:python"
