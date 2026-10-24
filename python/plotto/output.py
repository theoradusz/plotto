"""Outputs: static SVG, PNG and interactive HTML.

The notebook HTML uses the browser bundle (plotto.js) and needs no Node. The static SVG and PNG come from one Node
process (plotto-render --serve) that starts on the first use and stays for the life of the kernel:
- in a checkout of the repo (with node_modules), node src/render.mjs;
- else the npm package plotto of the same version, through npx (downloaded once, then cached).
Without Node, a notebook plot is live only (no static copy for GitHub), and save() raises an error.
"""

import atexit
import base64
import json
import os
import re
import shutil
import subprocess
import threading
import uuid
from pathlib import Path

from . import __version__, assets

# The npm package that npx runs outside a checkout. PLOTTO_NPM overrides it (for example a local .tgz, for tests).
NPM_PACKAGE = os.environ.get("PLOTTO_NPM", f"plotto@{__version__}")
_lock = threading.Lock()
_process = None
_bundle = None


def _request(op, **params):
    global _process
    with _lock:
        if _process is None or _process.poll() is not None:
            _process = _start()
        _process.stdin.write(json.dumps({"op": op, **params}, allow_nan=False) + "\n")
        _process.stdin.flush()
        reply = json.loads(_process.stdout.readline() or '{"error": "the render process stopped"}')
    if "error" in reply:
        raise RuntimeError(f"plotto render: {reply['error']}")
    return reply


class NodeMissing(RuntimeError):
    pass


def _start():
    node = shutil.which("node")
    if node is None:
        raise NodeMissing("plotto needs Node.js 20 or later on the PATH for static SVG and PNG files (https://nodejs.org)")
    repo = assets.checkout()
    if repo is not None:
        command, cwd = [node, str(repo / "src" / "render.mjs"), "--serve"], repo
    else:
        npx = shutil.which("npx") or str(Path(node).with_name("npx"))
        command, cwd = [npx, "--yes", "--package", NPM_PACKAGE, "plotto-render", "--serve"], None
    process = subprocess.Popen(command, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    atexit.register(process.kill)
    return process


def svg(spec) -> str:
    return _request("svg", spec=spec)["svg"]


def png(spec, scale=2) -> bytes:
    return base64.b64decode(_request("png", spec=spec, scale=scale)["png"])


def save(spec, path, scale=2):
    path = Path(path)
    if path.suffix == ".svg":
        path.write_text(svg(spec))
    elif path.suffix == ".png":
        path.write_bytes(png(spec, scale))
    else:
        raise ValueError(f"save(): use a .svg or .png file name, not {path.name}")


def html(spec, interactive=False) -> str:
    """Notebook output: the static SVG, then a script that draws the same plot at the cell width, with a toolbar.

    interactive adds zoom, pan, hover and the legend toggle. Without the script (GitHub, nbviewer) or without
    network access (the script loads d3 and Observable Plot from the CDN), the static SVG stays.
    """
    global _bundle
    if _bundle is None:
        # A checkout bundles the current src/; an installed package uses its packaged bundle.
        packaged = assets.ASSETS / "plotto.js"
        _bundle = _request("bundle")["js"] if assets.checkout() or not packaged.exists() else packaged.read_text()
    key = f"pt-{uuid.uuid4().hex[:12]}"
    try:
        static = re.sub(r'width="\d+(\.\d+)?" height="\d+(\.\d+)?"', 'width="100%"', svg(spec), count=1)
    except RuntimeError:
        static = ""  # no Node, or the renderer could not start: the live plot only
    data = json.dumps(spec, allow_nan=False, separators=(",", ":")).replace("</", "<\\/")
    script = _bundle.replace("</script", "<\\/script")
    return (
        f'<div id="{key}">{static}</div>'
        f'<script type="application/json" id="{key}-spec">{data}</script>'
        f'<script type="module">{script}\n'
        f'plotto.draw(JSON.parse(document.getElementById("{key}-spec").textContent), '
        f'document.getElementById("{key}"), {{interactive: {"true" if interactive else "false"}}});</script>'
    )
