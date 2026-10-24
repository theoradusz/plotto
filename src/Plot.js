// React wrapper: <Plot spec={plot(rows, {...}).line()} interactive />. draw() follows the container width.
import { createElement, useEffect, useRef } from "react";
import { draw } from "./interact.js";

export function Plot({ spec, interactive = false, className, style }) {
  const ref = useRef(null);
  useEffect(() => {
    const ctl = draw(spec, ref.current, { interactive });
    return () => ctl.destroy();
  }, [spec, interactive]);
  return createElement("div", { ref, className, style });
}
