// Entry of the notebook bundle (render.mjs bundle()): puts the API on window.plotto.
import { plot } from "./builder.js";
import { toSVG } from "./figure.js";
import { draw } from "./interact.js";

globalThis.plotto = { plot, draw, toSVG };
