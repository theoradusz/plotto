// Theme: a style (colors, font) and a format (size, text size, line width) from theme.json, plus overrides.
// Every style is merged over "pastel" (the default style), so a style lists only what it changes.
import * as d3 from "d3";
import THEMES from "../theme.json" with { type: "json" };

export const STYLES = Object.keys(THEMES.styles);
export const FORMATS = Object.keys(THEMES.formats);
export const PALETTES = Object.keys(THEMES.palettes);
export const SCHEMES = Object.keys(THEMES.schemes);
const ROLES = ["ink", "muted", "grid", "tick", "strip", "accent", "background"];

export function resolveTheme({ style = "pastel", format = "screen", legend = "right", ...overrides } = {}) {
  if (!THEMES.styles[style]) throw new Error(`theme(): unknown style "${style}". Valid: ${STYLES.join(", ")}`);
  if (!THEMES.formats[format]) throw new Error(`theme(): unknown format "${format}". Valid: ${FORMATS.join(", ")}`);
  const base = THEMES.styles.pastel;
  const s = THEMES.styles[style];
  const f = THEMES.formats[format];
  const fixed = overrides.width != null;
  for (const k of Object.keys(overrides)) if (overrides[k] == null) delete overrides[k];
  const theme = { ...base, ...s, colors: { ...base.colors, ...s.colors }, ...f, legend, ...overrides, style, format };
  theme.reflow = f.reflow && !fixed;
  // weight: the style's line and point scale (pastel colors need slightly thicker lines).
  theme.line = f.line * (s.weight ?? base.weight ?? 1);
  theme.point = f.point * Math.sqrt(s.weight ?? base.weight ?? 1);
  // A set width fixes the size; the height follows the format aspect ratio unless it is set too.
  // A set height alone keeps the reflow of the width and fixes the height.
  if (overrides.width != null && overrides.height == null) theme.height = Math.round((overrides.width * f.height) / f.width);
  theme.fixedHeight = overrides.height != null;
  theme.fitHeight = f.reflow && !theme.fixedHeight; // a screen plot: its height may follow the panel aspect
  theme.fixedFormat = !f.reflow; // report, slide: a picture of a fixed size, often copied without its toolbar
  theme.palette = palette(theme, theme.palette);
  return theme;
}

// The colors of a named palette (or of a list of colors), resolved against the theme tokens.
export function palette(theme, name) {
  const list = Array.isArray(name) ? name : THEMES.palettes[name];
  if (!list) throw new Error(`color(): unknown palette "${name}". Valid: ${PALETTES.join(", ")}`);
  return list.map((c) => colorOf(theme, c) ?? c);
}

// An interpolator t ∈ [0, 1] → color: a plotto scheme (theme.json), a d3 scheme name, or a list of colors.
export function interpolator(theme, scheme) {
  const resolve = (list) => d3.piecewise(d3.interpolateLab, list.map((c) => colorOf(theme, c) ?? c));
  if (Array.isArray(scheme)) return resolve(scheme);
  if (THEMES.schemes[scheme]) return resolve(THEMES.schemes[scheme]);
  const fn = typeof scheme === "string" && d3[`interpolate${scheme[0].toUpperCase()}${scheme.slice(1)}`];
  if (!fn) throw new Error(`color(): unknown scheme "${scheme}". plotto schemes: ${SCHEMES.join(", ")}; or a d3 scheme such as viridis, magma, blues`);
  return fn;
}

// A color is a theme token ("blue", "muted", ...) or any CSS color. Returns undefined for anything else.
export function colorOf(theme, value) {
  if (typeof value !== "string") return undefined;
  if (theme.colors[value]) return theme.colors[value];
  if (ROLES.includes(value)) return theme[value];
  return d3.color(value) ? value : undefined;
}

export function colorTokens(theme) {
  return [...Object.keys(theme.colors), ...ROLES];
}

// Header colors of a hover box: the series color as background, with readable text.
// Light colors get dark text; other colors get white text, on a background darkened until the contrast is at least 4.
export function headerColors(color) {
  const lum = (c) => {
    const ch = [c.r, c.g, c.b].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const rgb = d3.rgb(color);
  if (lum(rgb) > 0.42) return { bg: rgb.formatHex(), fg: "#1F2328" };
  let c = d3.hcl(rgb);
  for (let i = 0; i < 20 && 1.05 / (lum(d3.rgb(c)) + 0.05) < 4; i++) c = d3.hcl(c.h, c.c, c.l - 4);
  return { bg: d3.rgb(c).formatHex(), fg: "#FFFFFF" };
}

// Black or white text, whichever reads better on the given background color.
export function textOn(background) {
  return headerColors(background).fg;
}

// Font sizes in px, all derived from the theme base size.
export function fontSizes(theme) {
  const s = theme.size;
  return { base: s, tick: s - 1, title: Math.round(s * 1.35), subtitle: s, strip: s - 1, legend: s - 1, axisTitle: s, hover: Math.max(11, s - 1) };
}

// The first family of a CSS font stack, without quotes.
export function firstFamily(font) {
  return font.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
}
