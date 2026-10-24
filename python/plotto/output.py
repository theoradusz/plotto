"""Outputs: static SVG, PNG and interactive HTML. One Node process (src/render.mjs --serve) draws them.

The process starts on the first plot and stays for the life of the kernel, so each plot costs milliseconds.
"""

import atexit
import base64
import json
import re
import shutil
import subprocess
import threading
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # tools/plotto
RENDER = ROOT / "src" / "render.mjs"
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


def _start():
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("plotto needs Node.js 20 or later on the PATH")
    if not (ROOT / "node_modules").exists():
        raise RuntimeError(f"plotto: run `npm install` in {ROOT}")
    process = subprocess.Popen([node, str(RENDER), "--serve"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
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
        _bundle = _request("bundle")["js"]
    key = f"pt-{uuid.uuid4().hex[:12]}"
    static = re.sub(r'width="\d+(\.\d+)?" height="\d+(\.\d+)?"', 'width="100%"', svg(spec), count=1)
    data = json.dumps(spec, allow_nan=False, separators=(",", ":")).replace("</", "<\\/")
    script = _bundle.replace("</script", "<\\/script")
    return (
        f'<div id="{key}">{static}</div>'
        f'<script type="application/json" id="{key}-spec">{data}</script>'
        f'<script type="module">{script}\n'
        f'plotto.draw(JSON.parse(document.getElementById("{key}-spec").textContent), '
        f'document.getElementById("{key}"), {{interactive: {"true" if interactive else "false"}}});</script>'
    )
