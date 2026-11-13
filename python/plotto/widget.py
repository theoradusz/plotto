"""marimo output: an anywidget that draws the plot in the browser with _assets/widget.js (npm run build:python makes it).

Needs anywidget (pip install "python-plotto[marimo]"); without it, importing this module raises ImportError.
"""

import anywidget
import traitlets

from . import assets

ESM = assets.ASSETS / "widget.js"
if not ESM.exists():
    raise FileNotFoundError(f"{ESM} is missing: run npm run build:python")


class PlotWidget(anywidget.AnyWidget):
    _esm = ESM
    spec = traitlets.Dict().tag(sync=True)
    interactive = traitlets.Bool(False).tag(sync=True)
