# Changelog

This file lists the changes of `plotto` (npm) and `python-plotto` (PyPI). The two packages have the same version number.

Write each change under "Unreleased". `scripts/release.sh` moves them to the new version.

## Unreleased

### Changed

- In a fixed size (`slide`, `report`), plotto puts the legend and the info table on the right or at the bottom. It also makes their text smaller in the `slide` format. It keeps the layout that gives the plot more room. When you set the place, it stays.
- In the `slide` format, long facet labels get smaller text before they are cut.
- In a fixed size, the title and the subtitle use the full width.
- An info table at the bottom uses up to 3 columns when the entries fit.
- `info()` keeps `position` out of the spec when you do not set it.

## 0.4.1 – 2026-10-25

### Changed

- In the `slide` format, a long legend or info table gets smaller text. The text gets smaller until it fits, to 70% of its size at most.

## 0.4.0 – 2026-10-25

### Added

- The "Copy for a slide" button copies the current view for Google Slides. The pasted image is 6.72 × 4.2 in and sharp.
- `theme(aspect=)` sets the shape of the panels. Use `aspect=1` for square panels.

### Changed

- The `slide` format is 960 × 600 px. It was 1280 × 720 px.
- Box plots use the series color. The median line is bold. The whiskers have caps. Outliers are small dots.
- A long category label goes on 2 or 3 lines. The labels turn 40° only when one word is too long.
- A legend on the right is narrower. A long label goes on 2 or 3 lines.
- When a tick is at the top edge of the panel, the panels move down. The tick label does not touch the subtitle.

## 0.3.1 – 2026-10-25

### Fixed

- Box plots stay in the panel when `limits` are smaller than the data.

### Changed

- The default `screen` size is 900 × 500 px. It was 900 × 450 px.

## 0.3.0 – 2026-10-25

### Added

- `scripts/release.sh` prepares a release and tags it. The README shows the steps.

## 0.2.0 – 2026-10-24

### Added

- `info()` shows facts about the data or the experiment in a table. The table is on the right of the plot or below it.

The npm package `plotto` 0.2.0 is not available. Thus `python-plotto` 0.2.0 cannot save SVG or PNG files. Use 0.3.0 or a later version.

## 0.1.0 – 2026-10-24

- First release on PyPI and npm.
