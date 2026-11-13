// Copy what the Python package needs into python/plotto/_assets/: the grammar, the themes, the notebook bundle,
// the marimo widget and the docs (README.md, SPEC.md of this version, for readers of the installed package).
// The wheel ships these files, so an installed Python package needs no clone of the repo.
//   npm run build:python
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { bundle } from "../src/render.mjs";

const out = new URL("../python/plotto/_assets/", import.meta.url);
mkdirSync(out, { recursive: true });
for (const name of ["grammar.json", "theme.json", "README.md", "SPEC.md"]) copyFileSync(new URL(`../${name}`, import.meta.url), new URL(name, out));
copyFileSync(new URL("../LICENSE", import.meta.url), new URL("../python/LICENSE", import.meta.url)); // the wheel's licence file
writeFileSync(new URL("plotto.js", out), await bundle({ cdn: true }));
writeFileSync(new URL("widget.js", out), await bundle({ cdn: true, entry: "widget.js" }));
console.log(`wrote ${out.pathname}`);
