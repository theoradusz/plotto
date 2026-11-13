# python-plotto

Grammar-of-graphics plots for notebooks, web pages and slides with one renderer.

```
pip install python-plotto
```

```python
from plotto import plot

p = plot(df, x="time", y="value", color="sensor").line().facet("indicator", free="y")
p                  # in a notebook: drawn at the cell width, with copy and download buttons
p.interactive()    # zoom, pan, hover, legend toggle
p.save("fig.png")  # needs Node.js 20 or later
```

- Gallery, grammar tutorial and reference: https://theoradusz.github.io/plotto/
- Source and full documentation: https://github.com/theoradusz/plotto
- The JavaScript package for web pages and React: `npm install plotto`
- marimo: `pip install "python-plotto[marimo]"` draws `p` as a live widget.
- The installed package holds the full `README.md` and `SPEC.md` of its version in `plotto/_assets/`.
