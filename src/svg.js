// SVG element helpers. All elements come from the given document (the browser or jsdom).
export const SVG_NS = "http://www.w3.org/2000/svg";

export function svgElement(doc, tag, attrs = {}) {
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  return el;
}

export function svgText(doc, text, attrs, tag = "text") {
  const el = svgElement(doc, tag, attrs);
  el.textContent = text;
  return el;
}
