// Label placement for text(repel=true): each label goes to the first place around its anchor that is inside the
// panel and clear of the labels placed before it and of the obstacles (the anchors and the points of the panel).
// The sizes come from the font metrics, so Node and the browser place the labels the same way.

const SPIRAL = { step: 0.5, max: 10 }; // em: the search goes out in rings 0.5 em apart, up to 10 em
const LEADER = 1.5; // em: a label further from its anchor than this gets a leader line

// anchors: [{x, y}] in px; sizes: [{w, h}] in px; obstacles: [{x, y, r}] in px; bounds: {x0, y0, x1, y1}; em: px;
// blocked: [{x0, y0, x1, y1}], boxes that labels keep clear of (insets, the scale bar).
// Labels are placed in order: put the important ones first. Returns [{x, y, leader}] with x, y the label centers;
// leader is the point of the label box nearest to the anchor, or null.
export function placeLabels(anchors, sizes, obstacles, bounds, em, blocked = []) {
  const placed = [...blocked];
  return anchors.map((a, i) => {
    const { w, h } = sizes[i];
    const free = (c) => {
      const box = { x0: c.x - w / 2, x1: c.x + w / 2, y0: c.y - h / 2, y1: c.y + h / 2 };
      if (box.x0 < bounds.x0 || box.x1 > bounds.x1 || box.y0 < bounds.y0 || box.y1 > bounds.y1) return null;
      if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) return null;
      if (obstacles.some((o) => circleHitsBox(o, box))) return null;
      return box;
    };
    // The first free candidate wins; when none is free, the first one (right of the anchor) is used.
    // The gap to the anchor grows by the radius of a point drawn at the anchor.
    const own = Math.max(0, ...obstacles.filter((o) => Math.abs(o.x - a.x) < 1 && Math.abs(o.y - a.y) < 1).map((o) => o.r));
    const candidates = around(a, w, h, em, own);
    let center = candidates[0];
    let box = null;
    for (const c of candidates) {
      box = free(c);
      if (box) {
        center = c;
        break;
      }
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

function circleHitsBox({ x, y, r }, box) {
  const dx = x - clamp(x, box.x0, box.x1);
  const dy = y - clamp(y, box.y0, box.y1);
  return dx * dx + dy * dy < r * r;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
