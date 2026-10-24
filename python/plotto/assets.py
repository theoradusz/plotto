"""Where the package finds its files: python/plotto/_assets/ in an installed package (npm run build:python makes it),
or the repo root in a checkout."""

from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "_assets"
REPO = HERE.parents[1]


def path(name):
    """A shared file (grammar.json, theme.json): the repo file in a checkout (always current), else the packaged copy."""
    repo = REPO / name
    return repo if repo.exists() else ASSETS / name


def checkout():
    """The repo root when the package runs from a checkout with its JS dependencies, else None."""
    return REPO if (REPO / "src" / "render.mjs").exists() and (REPO / "node_modules").exists() else None
