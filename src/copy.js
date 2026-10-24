// Copy and download the figure as PNG or SVG. The image is the current view, without the hover marks.
// The SVG loads from a data URL: some hosts (VS Code notebooks) block blob: images.
const SCALE = 2; // PNG px per figure px

// Copies a PNG to the clipboard; if the browser refuses, downloads it. Returns "Copied" or "Downloaded".
export async function copyPNG(svg) {
  const png = rasterize(svg);
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png.then(toBlob) })]);
    return "Copied";
  } catch {
    save((await png).toDataURL("image/png"), "plot.png");
    return "Downloaded";
  }
}

export async function downloadPNG(svg) {
  save((await rasterize(svg)).toDataURL("image/png"), "plot.png");
}

export function downloadSVG(svg) {
  save(dataURL(svg), "plot.svg");
}

async function rasterize(svg) {
  const img = new Image();
  img.src = dataURL(svg);
  await img.decode();
  const { width, height } = svg.viewBox.baseVal;
  const canvas = document.createElement("canvas");
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function dataURL(svg) {
  const clone = svg.cloneNode(true);
  clone.querySelector(".pt-overlay")?.remove();
  const { width, height } = svg.viewBox.baseVal;
  clone.setAttribute("width", width);
  clone.setAttribute("height", height);
  const bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(clone));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

function save(href, name) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}
