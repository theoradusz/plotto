#!/usr/bin/env node
// Static export in Node: spec → SVG (jsdom) → PNG (resvg). The same figure code runs in the browser.
//   node src/render.mjs spec.json out.svg|out.png [scale]   one file
//   plotto-render --serve                                     (the npm bin)
//   node src/render.mjs --serve                              JSON lines on stdin/stdout (python/plotto/output.py)
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { toSVG } from "./figure.js";
import { firstFamily, resolveTheme } from "./theme.js";

const { document } = new JSDOM("").window;

export function renderSVG(spec) {
  return toSVG(spec, { document });
}

export function renderPNG(spec, scale = 2) {
  const svg = renderSVG(spec);
  const font = firstFamily(resolveTheme(spec.theme).font);
  const resvg = new Resvg(svg, { fitTo: { mode: "zoom", value: scale }, font: { loadSystemFonts: true, defaultFontFamily: font } });
  return resvg.render().asPng();
}

// The browser bundle: src/ as one ES module that sets window.plotto.
// cdn = true loads d3 and Plot from the CDN (notebook outputs); cdn = false puts them in the bundle (offline pages, tests).
// format "iife" gives a classic script, which also loads from a file:// page.
const bundleCache = {};
export async function bundle({ cdn = true, format = "esm" } = {}) {
  const key = `${cdn}-${format}`;
  if (bundleCache[key]) return bundleCache[key];
  const esbuild = await import("esbuild");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  const urls = {
    d3: `https://cdn.jsdelivr.net/npm/d3@${pkg.dependencies.d3}/+esm`,
    "@observablehq/plot": `https://cdn.jsdelivr.net/npm/@observablehq/plot@${pkg.dependencies["@observablehq/plot"]}/+esm`,
  };
  const fromCDN = {
    name: "cdn",
    setup(build) {
      build.onResolve({ filter: /^(d3|@observablehq\/plot)$/ }, (args) => ({ path: urls[args.path], external: true }));
    },
  };
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("./browser.js", import.meta.url))],
    bundle: true,
    write: false,
    format: cdn ? "esm" : format,
    minify: true,
    plugins: cdn ? [fromCDN] : [],
  });
  return (bundleCache[key] = result.outputFiles[0].text);
}

async function handle(request) {
  if (request.op === "svg") return { svg: renderSVG(request.spec) };
  if (request.op === "png") return { png: Buffer.from(renderPNG(request.spec, request.scale)).toString("base64") };
  if (request.op === "bundle") return { js: await bundle({ cdn: request.cdn ?? true, format: request.format }) };
  throw new Error(`unknown op "${request.op}"`);
}

// Run as a command (directly, or through the npm bin link, which is a symlink to this file).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [arg, out, scale] = process.argv.slice(2);
  if (arg === "--serve") {
    for await (const line of createInterface({ input: process.stdin })) {
      const request = JSON.parse(line);
      try {
        process.stdout.write(JSON.stringify({ id: request.id, ...(await handle(request)) }) + "\n");
      } catch (e) {
        process.stdout.write(JSON.stringify({ id: request.id, error: e.message }) + "\n");
      }
    }
  } else {
    const spec = JSON.parse(readFileSync(arg, "utf8"));
    writeFileSync(out, out.endsWith(".png") ? renderPNG(spec, Number(scale ?? 2)) : renderSVG(spec));
  }
}
