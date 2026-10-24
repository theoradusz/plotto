// Prints the JS builder spec of each case in fixtures/parity.json (python/tests/test_builder.py compares them).
import { readFileSync } from "node:fs";
import { plot } from "../src/builder.js";

const { rows, cases } = JSON.parse(readFileSync(new URL("./fixtures/parity.json", import.meta.url)));
const specs = cases.map(({ calls }) => {
  const [[, , mapping], ...rest] = calls;
  let p = plot(rows, mapping);
  for (const [method, args, options] of rest) p = Object.keys(options).length ? p[method](...args, options) : p[method](...args);
  return p.spec();
});
process.stdout.write(JSON.stringify(specs));
