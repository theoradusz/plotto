// Label placement for text(repel=true): each label goes to the first place around its anchor that is inside the
// panel and clear of the labels placed before it and of the obstacles (the anchors and the points of the panel).
// The sizes come from the font metrics, so Node and the browser place the labels the same way.

const SPIRAL = { step: 0.5, max: 10 }; // em: the search goes out in rings 0.5 em apart, up to 10 em
const LEADER = 1.5; // em: a label further from its anchor than this gets a leader line

// anchors: [{x, y}] in px; sizes: [{w, h}] in px; obstacles: [{x, y, r}] in px; bounds: {x0, y0, x1, y1}; em: px;
// blocked: [{x0, y0, x1, y1}], boxes that labels keep clear of (insets, the scale bar); cost: a function of a box,
// the share of areas it covers (areaCost), which labels avoid when they can.
// Labels are placed in order: put the important ones first. Returns [{x, y, leader}] with x, y the label centers;
// leader is the point of the label box nearest to the anchor, or null. A label whose anchor is outside the bounds (its
// point is not in view) gets null: it is not drawn.
export function placeLabels(anchors, sizes, obstacles, bounds, em, blocked = [], cost = null) {
  const placed = [...blocked];
  return anchors.map((a, i) => {
    if (!(a.x >= bounds.x0 && a.x <= bounds.x1 && a.y >= bounds.y0 && a.y <= bounds.y1)) return null;
    const { w, h } = sizes[i];
    const free = (c) => {
      const box = { x0: c.x - w / 2, x1: c.x + w / 2, y0: c.y - h / 2, y1: c.y + h / 2 };
      if (box.x0 < bounds.x0 || box.x1 > bounds.x1 || box.y0 < bounds.y0 || box.y1 > bounds.y1) return null;
      if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) return null;
      if (obstacles.some((o) => circleHitsBox(o, box))) return null;
      return box;
    };
    // The first free candidate wins; with a cost, the first free one that covers no area, else the free one that
    // covers the least. When none is free, the first one (right of the anchor) is used.
    // The gap to the anchor grows by the radius of a point drawn at the anchor.
    const own = Math.max(0, ...obstacles.filter((o) => Math.abs(o.x - a.x) < 1 && Math.abs(o.y - a.y) < 1).map((o) => o.r));
    const candidates = around(a, w, h, em, own);
    let center = candidates[0];
    let box = null;
    let least = Infinity;
    for (const c of candidates) {
      const b = free(c);
      if (!b) continue;
      const covered = cost ? cost(b) : 0;
      if (covered < least) [center, box, least] = [c, b, covered];
      if (covered === 0) break;
    }
    box ??= { x0: center.x - w / 2, x1: center.x + w / 2, y0: center.y - h / 2, y1: center.y + h / 2 };
    placed.push(box);
    const near = { x: clamp(a.x, box.x0, box.x1), y: clamp(a.y, box.y0, box.y1) };
    const far = Math.hypot(near.x - a.x, near.y - a.y) > LEADER * em;
    return { x: center.x, y: center.y, leader: far ? near : null };
  });
}

// Label centers around an anchor: 8 places, 0.4 em beside it or 0.2 em above or below it, beyond its point
// (right, upper right, lower right, left, upper left, lower left, above, below), then a spiral outward.
function around(a, w, h, em, own) {
  const [dx, dy] = [w / 2 + 0.4 * em + own, h / 2 + 0.2 * em + own];
  const out = [
    [dx, 0],
    [dx, -dy],
    [dx, dy],
    [-dx, 0],
    [-dx, -dy],
    [-dx, dy],
    [0, -dy],
    [0, dy],
  ].map(([x, y]) => ({ x: a.x + x, y: a.y + y }));
  for (let r = SPIRAL.step; r <= SPIRAL.max; r += SPIRAL.step) {
    // About one label height between the places of a ring, so that a far ring is as dense as a near one.
    const n = Math.max(16, Math.ceil((2 * Math.PI * (r * em + Math.max(w, h) / 2)) / h));
    for (let k = 0; k < n; k++) {
      const t = (k / n) * 2 * Math.PI;
      out.push({ x: a.x + Math.cos(t) * (w / 2 + r * em), y: a.y + Math.sin(t) * (h / 2 + r * em) });
    }
  }
  return out;
}

// The cost of a label box for text(repel="areas"): the share of the box on areas. shapes, in px: {rings, filled}
// (one polygon; filled with the even-odd rule, or its outlines) and {rect: {x0, y0, x1, y1}} (a raster cell). The
// areas are drawn on a grid of `size` px, with a summed-area table, so each box costs four reads.
export function areaCost(shapes, bounds, size = 3) {
  const [nx, ny] = [Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / size)), Math.max(1, Math.ceil((bounds.y1 - bounds.y0) / size))];
  const grid = new Uint8Array(nx * ny);
  const col = (x) => Math.floor((x - bounds.x0) / size);
  const row = (y) => Math.floor((y - bounds.y0) / size);
  const fillSpan = (j, xa, xb) => {
    for (let i = Math.max(0, col(xa)); i <= Math.min(nx - 1, col(xb)); i++) grid[j * nx + i] = 1;
  };
  for (const s of shapes) {
    if (s.rect) {
      for (let j = Math.max(0, row(s.rect.y0)); j <= Math.min(ny - 1, row(s.rect.y1)); j++) fillSpan(j, s.rect.x0, s.rect.x1);
    } else if (s.filled) {
      // Scanlines at the cell centers: the crossings of the edges of all rings, filled in pairs (even-odd).
      const cross = new Map();
      for (const ring of s.rings) {
        for (let k = 1; k < ring.length; k++) {
          const [[xa, ya], [xb, yb]] = [ring[k - 1], ring[k]];
          if (ya === yb) continue;
          const [lo, hi] = ya < yb ? [ya, yb] : [yb, ya];
          for (let j = Math.max(0, Math.ceil((lo - bounds.y0) / size - 0.5)); j < ny; j++) {
            const yc = bounds.y0 + (j + 0.5) * size;
            if (yc >= hi) break;
            if (yc < lo) continue;
            if (!cross.has(j)) cross.set(j, []);
            cross.get(j).push(xa + ((yc - ya) * (xb - xa)) / (yb - ya));
          }
        }
      }
      for (const [j, xs] of cross) {
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) fillSpan(j, xs[k], xs[k + 1]);
      }
    } else {
      // Outlines: the cells under each edge, sampled every half cell.
      for (const ring of s.rings) {
        for (let k = 1; k < ring.length; k++) {
          const [[xa, ya], [xb, yb]] = [ring[k - 1], ring[k]];
          const steps = Math.ceil(Math.hypot(xb - xa, yb - ya) / (size / 2)) || 1;
          for (let t = 0; t <= steps; t++) {
            const [i, j] = [col(xa + ((xb - xa) * t) / steps), row(ya + ((yb - ya) * t) / steps)];
            if (i >= 0 && i < nx && j >= 0 && j < ny) grid[j * nx + i] = 1;
          }
        }
      }
    }
  }
  const sat = new Int32Array((nx + 1) * (ny + 1)); // sat[j][i]: the cells above and left of (i, j)
  for (let j = 0; j < ny; j++) {
    let line = 0;
    for (let i = 0; i < nx; i++) {
      line += grid[j * nx + i];
      sat[(j + 1) * (nx + 1) + i + 1] = sat[j * (nx + 1) + i + 1] + line;
    }
  }
  return (box) => {
    const [i0, i1] = [Math.max(0, col(box.x0)), Math.min(nx, col(box.x1) + 1)];
    const [j0, j1] = [Math.max(0, row(box.y0)), Math.min(ny, row(box.y1) + 1)];
    if (i1 <= i0 || j1 <= j0) return 0;
    const at = (i, j) => sat[j * (nx + 1) + i];
    return (at(i1, j1) - at(i0, j1) - at(i1, j0) + at(i0, j0)) / ((i1 - i0) * (j1 - j0));
  };
}

function circleHitsBox({ x, y, r }, box) {
  const dx = x - clamp(x, box.x0, box.x1);
  const dy = y - clamp(y, box.y0, box.y1);
  return dx * dx + dy * dy < r * r;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
