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
| `scales` | `x`, `y`: `type`, `limits`, `format`, `breaks`, `labels`. `color`, `fill`: `values`, `palette`, `scheme`, `limits`, `mid`, `clamp`, `breaks`, `labels`. |
| `labels` | `title`, `subtitle`, `caption`, `x`, `y`, `color`, `fill`. `null` removes a title. A missing key uses the first mapped column name. |
| `info` | Optional. `entries`: `[key, value]` pairs in order; a value is a string, a number, a boolean or `null`. `position`: `right` or `bottom`; without it, `right`, or the place with the most room in a fixed size. |
| `coord` | Optional. `{type: "geo", scalebar?, north?}`: map coordinates, with the corners of the scale bar and the north arrow (§5) |
| `insets` | Optional. `[{x: [low, high], y: [low, high], at: [left, bottom, right, top]}]`: inset panels (§6) |
| `theme` | `style`, `format`, and the overrides `width`, `height`, `size`, `legend` |

### Column types

| Type | Values | From Python | From JS |
|---|---|---|---|
| `number` | numbers | numeric dtypes | `number` |
| `time` | wall-clock epoch ms | `datetime64`. A time-zone-aware column keeps its local clock time. | `Date` (local clock time) |
| `string` | strings | object, string, bool (`"true"`, `"false"`), categorical (with `levels`) | any other value |
| `geometry` | GeoJSON geometries (`{type, coordinates}`) | values with `__geo_interface__` (a GeoDataFrame geometry column, shapely) or GeoJSON dicts | GeoJSON geometry objects |

- Times are wall-clock times. The axis shows the clock time of the data, in every output and every time zone.
- A float that is not an integer keeps 6 significant digits.
- The builders send only the columns that a mapping or a facet uses.
- Geometry coordinates keep 5 decimals (about 1 m in degrees).
- `plot()` and the `data` of a layer also take a GeoJSON FeatureCollection: one row per feature, with its properties as columns and its geometry in the column `geometry`.

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
| `line` | x, y, color, group, tooltip | size, alpha, dash, summary, direct | `summary` | `line`, sorted by x; `text` for the direct labels |
| `path` | x, y, color, group, tooltip | size, alpha, dash | – | `line`, in row order |
| `step` | x, y, color, group, tooltip | size, alpha, dash | – | `line`, step after each point |
| `point` | x, y, color, tooltip | size, alpha, jitter, summary, position | `summary`, dodge | `dot` |
| `bar` | x, y, color, tooltip | alpha, position | stack or dodge | `barY` (category x), `rect` (number or time x, 90% of the data step) |
| `hist` | x, color | alpha, bins, density, position | bins | `rect` |
| `density` | x, color | size, alpha, dash | Gaussian kernel density | `areaY` + `line` |
| `area` | x, y, color, group | alpha, position | stack | `areaY` |
| `ribbon` | x, ymin, ymax, color, group | alpha | – | `areaY` |
| `smooth` | x, y, color | size, alpha, dash, method, span, band | linear fit or loess | `areaY` (band) + `line` |
| `hline`, `vline` | y or x, color | size, alpha, dash | – | `ruleY`, `ruleX` |
| `abline` | color | slope, intercept, size, alpha, dash | – | `line` across the x domain |
| `segment` | x, y, xend, yend, color | size, alpha, dash, position | dodge | `link` |
| `rect` | xmin, xmax, ymin, ymax, color, tooltip | alpha | – | `rect` |
| `band` | xmin, xmax, ymin, ymax, color | alpha | – | `rect`. A missing bound is the panel edge. |
| `tile` | x, y, color, tooltip | alpha | – | `cell` (two categories), `barX`/`barY` (one category), `rect` (two numbers) |
| `text` | x, y, label, color | size, alpha, repel | – | `text`; with `repel`, leader lines (`path`) |
| `errorbar` | x, ymin, ymax, color | size, alpha, position | dodge | `ruleX` and two caps |
| `polygon` | geometry, fill, color, tooltip | size, alpha | – | `geo`, through the x and y scales |
| `raster` | x, y, fill | alpha | the grid of the cells | one `image` (a PNG) in an `svg` clipped to the frame |
| `box` | x, y, color | alpha (of the box fill, default 0.3) | Tukey box per category (`boxStats` in `stats.js`): quartiles, whiskers to the last values within 1.5 IQR, outliers | `barY` (q1 to q3, outlined in the series color), `tickY` (bold median and whisker caps), `ruleX` (whiskers), `dot` (outliers, in the series color) |

| Option | Values | Meaning |
|---|---|---|
| `size` | number | Line width or point radius, in px; text size, in px |
| `alpha` | 0–1 | Opacity |
| `dash` | `solid`, `dashed`, `dotted`, `dashdot` | Line pattern |
| `jitter` | number | Random horizontal offset, as a share of the category width or of the x step. The seed is fixed, so each output is the same. |
| `summary` | `mean`, `median`, `min`, `max`, `sum` | One row per (x, color, group), with the summary of y |
| `position` | `stack`, `dodge`, `overlay` | Bars and areas (default `stack`): the colors add up at each x, in the legend order. Dodge (bars): one bar per color, side by side. Overlay: each color starts at 0; fills are see-through. Points, segments and error bars (default `overlay`; `stack` is an error): dodge puts each color in its own slot of the category band (below). |
| `bins` | number | About this number of bins on round values (default 30). All panels and colors use the same bins. |
| `density` | `true`, `false` | `hist` counts divided by (rows × bin width), so the area is 1 |
| `method` | `lm` (default), `loess` | `lm`: least squares with a 95% confidence band (Student t). `loess`: local linear fit with tricube weights, without a band. |
| `span` | 0–1 | The share of the points in each local fit of `loess` (default 0.75) |
| `band` | `true` (default), `false` | The confidence band of `lm` |
| `direct` | `true`, `false` (default) | The name of each line at its end (below) |
| `repel` | `true`, `false` (default) | Text labels move to a free place near their point (below) |

- `color` maps the stroke of lines and the fill of points, bars, areas, rects, tiles and text, and the outline of polygons. `fill` maps the fill of polygons and rasters.
- A line, path or step without `group` has one line per color value. A missing value (`null`) makes a gap.
- A layer without columns, for example `hline(y=0)`, draws once in each panel.
- A layer table without the facet column draws in each panel.
- A statistic runs on the rows of each panel, after the legend filter. Bin edges do not depend on the panel.
- Dodge of `point`, `segment` and `errorbar`: the band of each category has one slot per color of the plot, in the legend order, so a color has the same place in every category, panel and layer, and the segments of a color meet its points. A color that the legend hides leaves its slot empty. The slots are along the category axis: x, else y (`errorbar` draws vertical bars, so it needs a category x). Dodge needs a category axis and a color mapped to a string column; a constant color takes the center. The caps of an error bar are 30% of the band, or 60% of a slot.
- `polygon` draws the GeoJSON `Polygon` and `MultiPolygon` geometries of a geometry column, with x as the first coordinate (longitude) and y as the second (latitude). Holes stay empty (even-odd rule). Without `geometry`, it takes the column named `geometry`. `fill` fills the areas (a column, through the fill scale, or a color); `color` is the outline. Without `fill`, it draws outlines in `muted`, 0.6 px; with `fill`, thin outlines (0.5 px) in the `background` color separate the areas. `size` is the outline width; `alpha` the opacity of the fill (or of the outline without fill). The bounding boxes of the geometries train the axis domains. A geometry column goes to `geometry` only.
- `raster` draws a regular grid of cells (one row per cell center, for example a 1 km mesh of seismic intensity) as one image of one pixel per cell, colored by the fill scale, without smoothing, under the layers after it. The grid step in x and y is the mean of the gaps between neighbouring distinct values over the number of steps that each gap spans (refined three times), so values with 6 significant digits keep their columns; a missing cell, or a `null` fill, is transparent. A value more than a quarter of a step off the grid is an error. The cell edges train the axis domains. x and y must be number or time axes. The PNG is made once per figure and a zoom moves it; Node and the browser write the same bytes.
- `text(repel=true)` places each label, in row order (put the important ones first), at the first free place around its anchor: right, upper right, lower right, left, upper left, lower left, above, below (0.4 em beside, 0.2 em above or below, beyond a point drawn there), then on rings 0.5 em apart, up to 10 em. A place is free when the label is inside the panel and clear of the labels placed before, of the anchors, of the points of the `point` layers of the panel, of the insets and of the scale bar and north arrow. When no place is free, the label goes to the right of its anchor anyway. A label further than 1.5 em from its anchor gets a thin leader line in `muted`. The placement uses the font metrics (the same in Node and the browser) and runs again at each zoom.
- Direct labels (`line(direct=true)`): each series (the `group` value, else the `color` value) gets its name right of its last point in view, in its color, darkened (or lightened on a dark background) to a contrast of 3:1 at least. A long name wraps to 2 lines, at most 160 px or 20% of the figure width. Labels that would overlap move apart vertically, and stay in the panel when there is room. Each panel gets a right margin for the longest name; the legend stays unless `theme(legend="none")`.

## 5. Scales

### Position (`x`, `y`)

- The axis type is `type`, or else the type of the first mapped column: `time` → time, `string` → category, `number` → linear. `log` is a log10 axis.
- The axis domain trains on the layer views, which include the statistics. For example, it includes the 0 of a bar and the top of a stack.
- The first view is `limits` when it is set. A `null` bound keeps the data bound on that side, with its 5% space. Without limits, the first view is the data range plus 5% on each side.
- A category axis shows the categories in the `limits` order, then in the `levels` order, then in natural sort order. A label that is too wide for its band wraps at its spaces, to 3 lines at most. If a word is still too wide, all labels rotate by 40°; a rotated label gets 60% of the panel height (at least 10 em) and ends with an ellipsis beyond it, and the left margin grows so that the first one is not cut off.
- Continuous axes have major ticks and minor grid lines at the midpoints. A log axis has ticks at the powers of ten, with minor lines at 2–9 times each power; with fewer than three powers of ten in view, it has ticks at 1, 2 and 5 times each power.
- `breaks` (a list of numbers or times) sets the major ticks of a number, log or time axis, with no minor grid lines; a zoom keeps them, and a break outside the view does not show. `labels` (strings, one per break) are the tick labels; without them, the label is `format`, or `~g` (log), `,~r` (linear) or the time pattern. Breaks on a category axis are an error.
- Time labels are on one line. The pattern follows the tick step: `%Y-%m`, `%m-%d`, `%m-%d %H:%M` (more than one day in view), `%H:%M` or `%H:%M:%S`. `format`, a d3-format or d3-time-format string, replaces it.

### Color

| Column type | Scale | Legend |
|---|---|---|
| `string` | One color per category: `values` (a list, or a map category → color), else `palette`, else the style palette, in order | Swatches: a square for fills, a line for lines, a point for points |
| `number`, `time` | `values` (a list of colors), else `scheme`, else the style scheme | A color ramp |
| `number`, `time`, with `breaks` | One color per class: `values` (a list of one color per break), else the scheme at the middle of each class | Steps: one box per class |

There are two color scales: `color` (`color()`, the `color` channel) and `fill` (`fill()`, the `fill` channel of `polygon` and `raster`). They have the same options, each its own legend, and they can map different columns: for example the outage of each area (`fill`) and the class of each town (`color`).

- `breaks` (numbers or times that increase) make a binned scale. The classes are `[b0, b1)`, …, `[b(n-1), bn)` and `[bn, ∞)`: one class per break, closed on the left. They depend on the breaks only, so two plots with the same breaks have the same colors. A value below `b0` is `muted` (with `clamp: true`, the first class) and has no legend entry; `null` is `muted`. `labels` (one per break) names the classes. `mid` and a map of `values` do not apply. Breaks on a string column are an error.
- The steps legend has one box per class, low to high: left to right at the bottom, bottom to top on the right. The break values (format `,~r`, or the time pattern) are at the lower edge of each box; class names (`labels`) are on the boxes.
- `limits` sets the categories (and their order) or the range of the color scale. A `null` bound keeps the data bound.
- `mid` makes a diverging scale: `mid` takes the center color of the scheme, and each side stretches to its limit.
- A list of colors and a plotto scheme interpolate in Lab space. A d3 scheme name (such as `viridis` or `blues`) uses the d3 interpolator.
- A continuous value outside the domain is `muted`. `clamp: true` gives it the end color.
- All the color mappings of one scale must use the same column.
- A plot with mappings on both scales stacks the two legends (color first), at the right or at the bottom. The fill legend does not toggle values.
- A long legend wraps into columns.
- A horizontal color ramp has fewer ticks when their labels would touch.
- A right legend keeps a narrow column (20% of the width, 110 to 200 px): a long label wraps to 3 lines at most, then ends with an ellipsis, and its full text is its SVG title. A bottom legend has one line per label.

### Map coordinates

`coord("geo")` makes x the longitude and y the latitude, in degrees, at the same distance per px in x and y.

- One degree of longitude is `cos φ` degrees of latitude, at the center latitude φ of the view. This is exact for a region and about 10% off east-west at the edges of a map of all Japan (no projection).
- The panels take the shape of the map (the median shape when the panels have their own extent), unless `theme(aspect=)` sets it. Each panel then grows its extent in x or in y, around its center, to fill its box. `limits` is the area that must show; one side can grow.
- The stored view does not change: zoom, pan, reset, a resize and "Copy for a slide" draw it at equal scale again.
- Tick labels are in degrees: `135°E`, `35°N` (W and S for negative values), unless `format` is set. There are no axis titles unless `labels()` sets them.
- x and y must be number axes (not log, time or category), and `facet(free=)` must be `both` or unset.
- `coord("geo", scalebar=, north=)`: `true` or a corner (`bottom-left`, `bottom-right`, `top-left`, `top-right`). `scalebar=true` is at the bottom left, `north=true` at the top right, 0.8 em inside the frame of each main panel (not the insets). The scale bar is a round length (1, 2 or 5 × 10^k km) near a fifth of the panel width, at 111.32 km × cos φ per degree of longitude, with its length as text above it; it follows the zoom. The north arrow points up.

### Insets

`inset(x=[low, high], y=[low, high], at=[left, bottom, right, top])` draws the extent x × y in a box of each panel; `at` is in shares of the panel, from its bottom left. For example the Okinawa islands, the Izu and Ogasawara islands, or eastern Hokkaido on a map of Japan, so that no point is left out of the main extent. Each call adds one inset.

- An inset draws the layers of its panel (with the rows of that panel), on the `background` color, with a frame in `tick` and without axes and grid lines. It covers the panel under it.
- In map coordinates, the extent grows on one side to fill the box at the same distance per px in x and y.
- An inset keeps its extent: zoom, pan and the zoom buttons apply to the main panels only. Hover and pinned labels work in insets.
- Insets need number or time axes.

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

`theme(style, format=, width=, height=, size=, legend=, aspect=)`.

| Style | Look |
|---|---|
| `pastel` (default) | Warm white paper, warm gray ink and grid, the `pastel` palette, the `ai` scheme, Helvetica or Arial, lines 25% thicker |
| `wota` | WOTA brand: pink and blue first, tinted strips, M PLUS 1p |
| `paper` | Black ink, color-blind-safe palette (Okabe–Ito) |
| `dark` | Dark background, bright palette |

| Format | Size (px) | Base text (px) | Width |
|---|---|---|---|
| `screen` (default) | 900 × 500 | 12 | Follows the element or cell width (reflow) |
| `report` | 640 × 400 | 10 | Fixed |
| `slide` | 691 × 403 | 13 | Fixed, in slide pixels (96 per inch): 7.2 × 4.2 in for the body of a 16:9 slide, between its title and its footer, with room for comments on the right. The outer margin is 0.3 em. A plot with one panel is at most 0.55 times as tall as it is wide (`flat`); the height that is left goes half above and half below it. |

- A style in `theme.json` lists only what differs from `pastel`. `weight` scales the line width (and the point radius by its square root).
- `width` fixes the size. The height then follows the aspect ratio of the format, unless `height` is set too.
- `height` alone fixes the height and keeps the reflow of the width.
- In reflow, the text keeps its px size, and the height follows the aspect ratio (at least 240 px).
- Below 560 px of width, a right legend moves to the bottom.
- A fixed size (`report`, `slide`, or a set `height`) chooses the layout of the legend and the info table:
  1. It tries each on the right and at the bottom. A place that the spec sets (`theme(legend=)`, `info(position=)`) stays.
  2. A format with `shrink` in `theme.json` (`slide`: 0.7) also tries their text smaller, in steps of 5%, down to that share of its size.
  3. It keeps the layouts that cut the least: legend labels and info keys with an ellipsis, a second legend column, "+N more" info rows.
  4. Of these, it keeps the layouts whose useful panel area is at most 20% below the largest one. The useful area counts the width of a panel only up to its height / 0.3: a flatter panel gets nothing from more width. It takes the largest text, then the usual places, then the largest area. The usual places are the legend of the theme (default: `right`; the `slide` format: `bottom`) and the info table on the right.
- A `screen` plot keeps the places and the text size.
- A bottom legend has its title on its first row, before the items.
- A format with `shrink` makes the facet strip text smaller (the same size for all strips) before it cuts a label, down to that share of its size.
- `aspect` is the shape of each panel, height / width: `1` gives square panels (for observed-against-predicted plots, with the same `limits` on x and y). The panels shrink in one direction to get that shape. A `screen` plot without `height` changes its height instead (at most 1.2 times its usual height), so the panels fill it. The space that is left goes half on each side of the panels.
- The title and the subtitle align left with the panels and wrap to two lines at most. A format with `shrink` first makes a long title or subtitle smaller, down to that share of its size, so that it stays on one line; one that does not fit even then keeps its size and wraps. A `screen` plot keeps room on the right for the toolbar; a fixed size uses the full width. The caption is at the bottom left, aligned with the panels: it wraps at the width of the figure less the y axis, to 4 lines at most (a longer one ends with an ellipsis), and starts further left only when it would run off the figure.
- A bottom info table puts its entries in up to 3 columns, as many as fit on one line each; else one column whose values wrap.
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

`draw(spec, element, { interactive, width })` draws the plot into the element. The element can be in a shadow root (marimo widgets): the styles then go into that shadow root.

| Item | Behavior |
|---|---|
| Width | A `screen` plot lays out at the element width, and again 100 ms after a width change (minimum 320 px). A fixed size scales down to fit. |
| Toolbar | A flat, square bar of icon buttons at the top right. It shows when the pointer is on the plot, and always on touch screens. The button size is 1/34 of the figure width, from 22 to 30 px. The active mode has the accent color. |
| Static buttons | Copy as PNG; Copy for a slide; Download (PNG or SVG) |
| Copy for a slide | Draws the current view (zoom, hidden series) again in the `slide` format, with the plot's style. The clipboard gets a PNG with 4 times the pixels (2764 px wide) and an HTML `<img>` at the figure size (691 × 403 px). Google Slides pastes the HTML at 96 px per inch: 7.2 in wide. |
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
| polygon | The area under the pointer (the top one): its tooltip value as the header, and its fill and color values. A point near the pointer wins. | – |
| raster | The cell under the pointer: its fill value as the header, and its x and y | – |
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
| marimo | `p`, `p.interactive()` | `_display_()` (Jupyter ignores it). With anywidget: a widget with the traits `spec` and `interactive`, whose module (`widget.js`) calls `draw()`. It loads d3 and Observable Plot from `cdn.jsdelivr.net`. No Node call and no static SVG. Without anywidget: the notebook HTML through `mo.Html`, of which marimo shows the static SVG. |
| Browser | `draw(spec, el, options)` | Returns `{ state, redraw(), resize(width), destroy() }` |
| React | `<Plot spec={...} interactive />` (`plotto/react`) | Calls `draw()`; it follows the container width |

The Node SVG and the browser SVG are the same, except for the numbers of the clip paths. On a screen with a device pixel ratio of 1, Observable Plot also adds a half-pixel offset to lines.

## 10. Limits

- Themes are styles and formats with four overrides. There is no `element_*` theming.
- There are two color scales per plot: `color` and `fill`. Size and shape are constants, not mappings.
- A raster has one row per cell in the spec (about 30 bytes per cell) and an image of 4 bytes per cell, without compression: crop the grid to the map (90 000 cells make a spec of about 3 MB).
- A geometry column is JSON in the spec and in the notebook HTML: simplify the geometries first (for example `GeoSeries.simplify` or mapshaper). Each zoom and pan draws every area again.
- There is no plot composition.
- More than about 20 000 points make a large SVG: the SVG of 20 000 points is about 1.7 MB.
- A saved SVG uses the fonts of the viewer. Without the style font, the text has other widths.
