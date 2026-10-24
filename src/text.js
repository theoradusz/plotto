// Text width estimate from the font tables in metrics.js. Node and the browser get the same numbers,
// so the layout (margins, legend, strips) is the same in every output.
import { METRICS } from "./metrics.js";

const CJK_START = 0x2e80; // CJK, kana and full-width forms are one em wide.

export function textWidth(text, size, bold = false, metrics = "arial") {
  const table = METRICS[metrics][bold ? "bold" : "regular"];
  let em = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code < 127) em += table[code - 32];
    else em += code >= CJK_START ? 1 : 0.6;
  }
  return em * size;
}

// The text cut with an ellipsis so that it fits in maxWidth.
export function fitText(text, size, maxWidth, bold, metrics) {
  text = String(text);
  if (textWidth(text, size, bold, metrics) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && textWidth(chars.join("") + "…", size, bold, metrics) > maxWidth) chars.pop();
  return chars.join("") + "…";
}

// Greedy word wrap into at most maxLines lines; the last line gets an ellipsis if the text is longer.
export function wrapText(text, size, maxWidth, bold, metrics, maxLines = 2) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, bold, metrics) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fitText(lines.slice(maxLines - 1).join(" "), size, maxWidth, bold, metrics);
  return kept;
}
