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
    assert (int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")) == (1600, 800)


def test_repr_names_the_layers():
    assert repr(P) == "<plotto.Plot line, 4 rows>"
    assert repr(P.interactive().facet("g")) == "<plotto.Plot line, facet g, 4 rows, interactive>"


def test_python_and_npm_versions_agree():
    import json
    from pathlib import Path

    import plotto

    package = json.loads((Path(__file__).resolve().parents[2] / "package.json").read_text())
    assert plotto.__version__ == package["version"]
