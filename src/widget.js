// anywidget entry of the marimo output (python/plotto/widget.py): draws the spec into the widget element.
// Built by scripts/build_assets.mjs into python/plotto/_assets/widget.js. The React wrapper (Plot.js) works the same way.
import { draw } from "./interact.js";

export default {
  render({ model, el }) {
    const ctl = draw(model.get("spec"), el, { interactive: model.get("interactive") });
    return () => ctl.destroy();
  },
};
