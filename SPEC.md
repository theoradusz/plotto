# plotto spec

This document is the contract of plotto: the spec format, the builder rules, the layers, the scales, the facets, the themes, the display, the interaction and the outputs. The README tells how to install and use the package.

## 1. Model

A plot is a JSON spec.
- The Python builder (`python/plotto/plot.py`) and the JS builder (`src/builder.js`) write the same spec for the same calls.
- One JS renderer (`src/figure.js`) draws the spec as SVG, with Observable Plot for the panels.
- The renderer runs in the browser and in Node (jsdom), so every output has the same look.

```
builder → spec → normalize (spec.js) → views (views.js, stats.js) → scales and layout → figure → panels (Observable Plot) → SVG
```

`grammar.json` lists the layers, channels, options and scale keys. Both builders and `src/spec.js` read it. `theme.json` holds the styles and the formats.

## 2. Spec format (version 1)

```json
{
  "version": 1,
  "data": [{ "columns": { "time": { "type": "time", "values": [1792454400000] }, "W": { "type": "number", "values": [0.25] } } }],
  "mapping": { "x": "time", "y": "W", "color": "sensor" },
  "layers": [{ "type": "line", "mapping": {}, "set": { "size": 1 } }, { "type": "hline", "mapping": {}, "set": { "y": 0 }, "data": 1 }],
  "facet": { "wrap": "sensor", "free": "y", "ncol": null },
  "scales": { "x": { "type": "time" }, "color": { "values": { "sensor A": "blue" } } },
  "labels": { "title": "Water quality", "x": null, "y": "W (a.u.)" },
  "info": { "entries": [["data point", 15], ["location", "hayama"]], "position": "right" },
  "theme": { "style": "pastel", "format": "screen", "legend": "right" }
}
```

| Key | Content |
|---|---|
| `data` | A list of tables. Table 0 is the plot data. A layer with its own data has `"data": <index>`. |
| `columns` | `{name: {type, values, levels?}}`, with values in row order. `null` is a missing value. |
| `mapping` | Plot channels → column names. They apply to every layer that accepts the channel (rule 4). |
| `layers[].mapping` | Layer channels → column names |
| `layers[].set` | Constants: channel values and options |
| `facet` | `{wrap, free, ncol}`, `{rows, cols, free}` or `null` |
| `scales` | `x`, `y`: `type`, `limits`, `format`. `color`: `values`, `palette`, `scheme`, `limits`, `mid`, `clamp`. |
| `labels` | `title`, `subtitle`, `caption`, `x`, `y`, `color`. `null` removes a title. A missing key uses the first mapped column name. |
| `info` | Optional. `entries`: `[key, value]` pairs in order; a value is a string, a number, a boolean or `null`. `position`: `right` (the default) or `bottom`. |
| `theme` | `style`, `format`, and the overrides `width`, `height`, `size`, `legend` |

### Column types

| Type | Values | From Python | From JS |
|---|---|---|---|
| `number` | numbers | numeric dtypes | `number` |
| `time` | wall-clock epoch ms | `datetime64`. A time-zone-aware column keeps its local clock time. | `Date` (local clock time) |
| `string` | strings | object, string, bool (`"true"`, `"false"`), categorical (with `levels`) | any other value |

- Times are wall-clock times. The axis shows the clock time of the data, in every output and every time zone.
- A float that is not an integer keeps 6 significant digits.
- The builders send only the columns that a mapping or a facet uses.

## 3. Builder rules

1. Each method returns a new plot. The old plot does not change.
2. A string that is a column name of the layer data is a mapping. Any other value is a constant.
3. A constant color is a theme color or a CSS color.
   - The theme colors are `blue`, `orange`, `red`, `teal`, `green`, `yellow`, `purple`, `pink`, `brown` and `gray`.
   - The theme roles are `ink`, `muted`, `grid`, `tick`, `strip`, `accent` and `background`.
   - Any other value is an error.
4. A layer inherits the plot mappings for its channels. `hline`, `vline`, `abline` and `band` do not inherit.
5. `tooltip` and `group` accept columns only.
6. An unknown column, method, option, style, format or value is an error at the call. The message lists the valid names.
7. Python keyword arguments and JS option objects have the same names and values: `facet("g", free="y")` is `facet("g", { free: "y" })`.

## 4. Layers

| Method | Channels | Options | Statistic | Observable Plot mark |
|---|---|---|---|---|
| `line` | x, y, color, group, tooltip | size, alpha, dash, summary | `summary` | `line`, sorted by x |
| `path` | x, y, color, group, tooltip | size, alpha, dash | – | `line`, in row order |
| `step` | x, y, color, group, tooltip | size, alpha, dash | – | `line`, step after each point |
| `point` | x, y, color, tooltip | size, alpha, jitter, summary | `summary` | `dot` |
| `bar` | x, y, color, tooltip | alpha, position | stack or dodge | `barY` (category x), `rect` (number or time x, 90% of the data step) |
| `hist` | x, color | alpha, bins, density, position | bins | `rect` |
| `density` | x, color | size, alpha, dash | Gaussian kernel density | `areaY` + `line` |
| `area` | x, y, color, group | alpha, position | stack | `areaY` |
| `ribbon` | x, ymin, ymax, color, group | alpha | – | `areaY` |
| `smooth` | x, y, color | size, alpha, dash, method, span, band | linear fit or loess | `areaY` (band) + `line` |
| `hline`, `vline` | y or x, color | size, alpha, dash | – | `ruleY`, `ruleX` |
| `abline` | color | slope, intercept, size, alpha, dash | – | `line` across the x domain |
| `segment` | x, y, xend, yend, color | size, alpha, dash | – | `link` |
| `rect` | xmin, xmax, ymin, ymax, color, tooltip | alpha | – | `rect` |
| `band` | xmin, xmax, ymin, ymax, color | alpha | – | `rect`. A missing bound is the panel edge. |
| `tile` | x, y, color, tooltip | alpha | – | `cell` (two categories), `barX`/`barY` (one category), `rect` (two numbers) |
| `text` | x, y, label, color | size, alpha | – | `text` |
| `errorbar` | x, ymin, ymax, color | size, alpha | – | `ruleX` and two caps |
| `box` | x, y, color | alpha | quartiles (Observable Plot) | `boxY` |

| Option | Values | Meaning |
|---|---|---|
| `size` | number | Line width or point radius, in px; text size, in px |
| `alpha` | 0–1 | Opacity |
| `dash` | `solid`, `dashed`, `dotted`, `dashdot` | Line pattern |
| `jitter` | number | Random horizontal offset, as a share of the category width or of the x step. The seed is fixed, so each output is the same. |
| `summary` | `mean`, `median`, `min`, `max`, `sum` | One row per (x, color, group), with the summary of y |
| `position` | `stack` (default), `dodge` (bar only), `overlay` | Stack: the colors add up at each x, in the legend order. Dodge: one bar per color, side by side. Overlay: each color starts at 0; fills are see-through. |
| `bins` | number | About this number of bins on round values (default 30). All panels and colors use the same bins. |
| `density` | `true`, `false` | `hist` counts divided by (rows × bin width), so the area is 1 |
| `method` | `lm` (default), `loess` | `lm`: least squares with a 95% confidence band (Student t). `loess`: local linear fit with tricube weights, without a band. |
| `span` | 0–1 | The share of the points in each local fit of `loess` (default 0.75) |
| `band` | `true` (default), `false` | The confidence band of `lm` |

- `color` maps the stroke of lines and the fill of points, bars, areas, rects, tiles and text.
- A line, path or step without `group` has one line per color value. A missing value (`null`) makes a gap.
- A layer without columns, for example `hline(y=0)`, draws once in each panel.
- A layer table without the facet column draws in each panel.
- A statistic runs on the rows of each panel, after the legend filter. Bin edges do not depend on the panel.

## 5. Scales

### Position (`x`, `y`)

- The axis type is `type`, or else the type of the first mapped column: `time` → time, `string` → category, `number` → linear. `log` is a log10 axis.
- The axis domain trains on the layer views, which include the statistics. For example, it includes the 0 of a bar and the top of a stack.
- The first view is `limits` when it is set. A `null` bound keeps the data bound on that side, with its 5% space. Without limits, the first view is the data range plus 5% on each side.
- A category axis shows the categories in the `limits` order, then in the `levels` order, then in natural sort order. Labels that are too wide for their band rotate by 40°.
- Continuous axes have major ticks and minor grid lines at the midpoints. A log axis has ticks at the powers of ten, with minor lines at 2–9 times each power.
- Time labels are on one line. The pattern follows the tick step: `%Y-%m`, `%m-%d`, `%m-%d %H:%M` (more than one day in view), `%H:%M` or `%H:%M:%S`. `format`, a d3-format or d3-time-format string, replaces it.

### Color

| Column type | Scale | Legend |
|---|---|---|
| `string` | One color per category: `values` (a list, or a map category → color), else `palette`, else the style palette, in order | Swatches: a square for fills, a line for lines, a point for points |
| `number`, `time` | `values` (a list of colors), else `scheme`, else the style scheme | A color ramp |

- `limits` sets the categories (and their order) or the range of the color scale. A `null` bound keeps the data bound.
- `mid` makes a diverging scale: `mid` takes the center color of the scheme, and each side stretches to its limit.
- A list of colors and a plotto scheme interpolate in Lab space. A d3 scheme name (such as `viridis` or `blues`) uses the d3 interpolator.
- A continuous value outside the domain is `muted`. `clamp: true` gives it the end color.
- All color mappings of one plot must use the same column.
- A long legend wraps into columns. A label that is too long ends with an ellipsis.

## 6. Facets

| Call | Panels | Strips |
|---|---|---|
| `facet(by, free=, ncol=)` | One panel per value of `by`. The default column count is the ggplot rule (`n2mfrow`). | Above each panel |
| `grid(rows=, cols=, free=)` | One panel per (row value, column value) | Column values above the top row; row values on the right of the last column |

- `free` is `x`, `y` or `both`. A free axis has one domain per panel (`facet`), or per column for x and per row for y (`grid`).
- A shared y axis shows on the first column only. A shared x axis shows below the last panel of each column. A free axis shows on each panel.
- All panels have the same inner size, so they align.
- A strip label that is too long ends with an ellipsis. The full label is its SVG title.

### Palettes and schemes (`theme.json`)

| Palette | Colors |
|---|---|
| `pastel` | The pastel style: soft blue, coral, sage, lavender, rose, mustard, aqua, brick, mocha, slate |
| `sakura`, `aizome`, `momiji` | Spring, indigo-dye and autumn sets, inspired by traditional Japanese colors |
| `wota`, `tableau` | The wota brand; Tableau 10 |

A style can also list theme color names as its palette: the `paper` and `dark` styles use their own colors this way.

| Scheme | Gradient |
|---|---|
| `ai` | Light to deep indigo (the pastel style) |
| `sakura` | Light to deep cherry (the wota style) |
| `matcha` | Cream to deep green |
| `yuhi` | Sunset: yellow, orange, red, plum (the dark style) |
| `sumi` | Ink grays |
| `aiaka` | Diverging: indigo, white, vermilion. Use it with `mid`. |

## 7. Themes

`theme(style, format=, width=, height=, size=, legend=)`.

| Style | Look |
|---|---|
| `pastel` (default) | Warm white paper, warm gray ink and grid, the `pastel` palette, the `ai` scheme, Helvetica or Arial, lines 25% thicker |
| `wota` | WOTA brand: pink and blue first, tinted strips, M PLUS 1p |
| `paper` | Black ink, color-blind-safe palette (Okabe–Ito) |
| `dark` | Dark background, bright palette |

| Format | Size (px) | Base text (px) | Width |
|---|---|---|---|
| `screen` (default) | 900 × 450 | 12 | Follows the element or cell width (reflow) |
| `report` | 640 × 400 | 10 | Fixed |
| `slide` | 1280 × 720 | 20 | Fixed |

- A style in `theme.json` lists only what differs from `pastel`. `weight` scales the line width (and the point radius by its square root).
- `width` fixes the size. The height then follows the aspect ratio of the format, unless `height` is set too.
- `height` alone fixes the height and keeps the reflow of the width.
- In reflow, the text keeps its px size, and the height follows the aspect ratio (at least 240 px).
- Below 560 px of width, a right legend moves to the bottom.
- The title and the subtitle align left with the panels. They wrap to two lines at most and keep space for the toolbar on the right. The caption is at the bottom left.
- `src/metrics.js` holds the glyph widths of each style font for the layout. CJK characters are one em wide.

### Info table

`info(entries, position=)` draws facts about the data or the experiment as a key/value table: keys in `muted`, values in `ink`.

| Position | Place | Look |
|---|---|---|
| `right` | The right column, above the legend | A card in the `strip` color |
| `bottom` | Below the panels, above a bottom legend and the caption. The entries flow into 1 to 3 columns. | The same card |

- `right` is the default. Below 560 px of width, it moves to the `bottom`, as the legend does.
- A value wraps to 3 lines at most. A key takes at most 45% of the table width; a longer key ends with an ellipsis, and its full text is its SVG title.
- The table takes at most 60% of the figure height (`right`) or 30% (`bottom`). The entries that do not fit become one last row, `+N more`.
- A number keeps 6 significant digits, as in the data. `null` shows as `–`.
- Zoom and legend clicks do not change the table.

## 8. Display and interaction

`draw(spec, element, { interactive, width })` draws the plot into the element.

| Item | Behavior |
|---|---|
| Width | A `screen` plot lays out at the element width, and again 100 ms after a width change (minimum 320 px). A fixed size scales down to fit. |
| Toolbar | A flat, square bar of icon buttons at the top right. It shows when the pointer is on the plot, and always on touch screens. The button size is 1/34 of the figure width, from 22 to 30 px. The active mode has the accent color. |
| Static buttons | Copy as PNG; Download (PNG or SVG) |
| Interactive buttons | Also zoom box and pan (the active mode is highlighted), zoom in, zoom out, reset |

With `interactive: true`:

| Action | Result |
|---|---|
| Click in a panel | Pins the hover label: it stays when the pointer moves. The next click, or Esc, releases it. A press that moves less than 5 px is a click. |
| Drag in a panel (zoom mode) | After 5 px of movement, draws the zoom box; the release zooms to it. A flat drag (less than 5 px high) zooms x only. A narrow drag zooms y only. |
| Drag in a panel (pan mode) | Moves the view |
| Zoom in, zoom out | Keeps 75% of the range (or 133%) around the center of each panel |
| Reset, double-click in a panel | Restores the first view |
| Hover | Shows the label of the row under the pointer (see below) |
| Legend click | Hides or shows that value in all panels at once. Stacks and statistics compute again; the domains do not change. |
| Two legend clicks within 300 ms | Show only that value; two more show all. A slower second click only shows the value again. |

Hover:

| Layers | What the label shows | Marks |
|---|---|---|
| line, step, area, density, smooth, ribbon | Up to 6 series at the nearest x: every series, in the legend order, with the series nearest the pointer in bold (crosshair and a dot on each series). More than 6 series: only the series nearest the pointer, and the count of the others (crosshair and one dot). The picked series stays until another one is at least 4 px nearer. | – |
| bar, hist | The column nearest the pointer: one row per color, the segment under the pointer in bold, and the total of a stack | Outline of the segment |
| box | The box under the pointer: whiskers, quartiles, median, count and outliers. It wins over the points drawn with it. | – |
| tile | The value of the cell, and its x and y | Outline of the cell |
| point, path, errorbar | The nearest point within 40 px. It stays picked until another point is at least 4 px nearer. | Dot |

- The label box is flat and square. Its header has the color of the hovered series. A light color gets dark text; any other color gets white text, on the color darkened until the contrast is at least 4:1. On several series, the header is dark and each row has a color swatch.
- With several series, the rows keep the legend order (or the order of the color values), so they do not jump.
- The box follows the pointer, not the data, so noisy data does not make it jump.
- Numbers have 4 significant digits, with thousands separators. Times follow the data: `%Y-%m` (months), `%Y-%m-%d` (days), `%m-%d %H:%M` or `%m-%d %H:%M:%S`.

- A zoom on a shared axis applies to every panel that shares it. A category axis does not zoom.
- A zoom, a legend click or a resize draws again with the same code, so the look does not change. A resize keeps the zoom and the hidden values.

## 9. Outputs

| Output | Function | Notes |
|---|---|---|
| Static SVG | `toSVG(spec)` (JS), `p.save("f.svg")` (Python) | At the size of the theme |
| PNG | `p.save("f.png", scale=2, width=, height=)` | resvg draws the Node SVG. `width` and `height` lay out again at that size. |
| Notebook | `p`, `p.interactive()` | `text/html`: the static SVG, the spec and the browser bundle, which calls `draw()`. The bundle loads d3 and Observable Plot from `cdn.jsdelivr.net`. Without the script, the static SVG stays. |
| Browser | `draw(spec, el, options)` | Returns `{ state, redraw(), resize(width), destroy() }` |
| React | `<Plot spec={...} interactive />` (`plotto/react`) | Calls `draw()`; it follows the container width |

The Node SVG and the browser SVG are the same, except for the numbers of the clip paths. On a screen with a device pixel ratio of 1, Observable Plot also adds a half-pixel offset to lines.

## 10. Limits

- Themes are styles and formats with four overrides. There is no `element_*` theming.
- There is one color scale per plot. Size and shape are constants, not mappings.
- There is no plot composition.
- More than about 20 000 points make a large SVG: the SVG of 20 000 points is about 1.7 MB.
- A saved SVG uses the fonts of the viewer. Without the style font, the text has other widths.
