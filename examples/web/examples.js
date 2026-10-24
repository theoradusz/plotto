// Gallery examples in JavaScript: the same calls as examples/gallery.py, with row objects as the data.
import { plot } from "../../src/index.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const DATASETS = ["calibration", "sensor_week", "spectra", "heatmap", "monthly", "daily_range", "lamp_spectra"];

export const EXAMPLES = {
  scatter: ({ calibration }) =>
    plot(calibration, { x: "concentration", y: "absorbance", color: "batch", tooltip: "replicate" })
      .point({ size: 3.5 })
      .labels({ title: "Calibration", subtitle: "Absorbance of 4 batches, 3 replicates each", x: "concentration (mg/L)" }),

  time_series: ({ sensor_week }) =>
    plot(sensor_week.filter((r) => r.indicator === "UV254 (1/m)"), { x: "time", y: "value", color: "sensor" })
      .line()
      .labels({ title: "UV254 over one week", x: null, y: "UV254 (1/m)" }),

  facet_free_y: ({ sensor_week }) =>
    plot(sensor_week, { x: "time", y: "value", color: "sensor" })
      .line({ size: 1 })
      .facet("indicator", { free: "y", ncol: 1 })
      .labels({ title: "Three indicators, three sensors", x: null, y: null })
      .theme("pastel", { height: 620 }),

  annotations: ({ sensor_week }) => {
    const rows = sensor_week.filter((r) => r.indicator === "turbidity (NTU)" && r.sensor === "sensor B");
    const [start, end] = [new Date("2026-10-15T06:00"), new Date("2026-10-15T18:00")];
    return plot(rows, { x: "time", y: "value" })
      .band({ xmin: start, xmax: end, color: "orange", alpha: 0.15 })
      .line({ color: "teal" })
      .hline({ y: 0.75, color: "red", dash: "dashed" })
      .text({ x: start, y: 0.78, label: "limit 0.75 NTU", color: "red" })
      .labels({ title: "Turbidity with a limit and a maintenance window", x: null, y: "turbidity (NTU)" });
  },

  bars_dodged: ({ monthly }) =>
    plot(monthly, { x: "month_name", y: "volume", color: "site" })
      .bar({ position: "dodge" })
      .x({ limits: MONTHS })
      .labels({ title: "Monthly volume per site, side by side", x: null, y: "volume (m³)" }),

  histogram: ({ sensor_week }) =>
    plot(sensor_week.filter((r) => r.indicator === "turbidity (NTU)"), { x: "value", color: "sensor" })
      .hist({ bins: 40, position: "overlay" })
      .labels({ title: "Turbidity distribution", x: "turbidity (NTU)" }),

  ribbon: ({ daily_range }) =>
    plot(daily_range, { x: "day", y: "mean" })
      .ribbon({ ymin: "low", ymax: "high", color: "blue" })
      .line({ color: "blue" })
      .labels({ title: "Daily temperature: mean and min-max range", x: null, y: "temperature (°C)" }),

  smooth: ({ calibration }) =>
    plot(calibration, { x: "concentration", y: "absorbance", color: "batch" })
      .point({ alpha: 0.6 })
      .smooth({ method: "lm" })
      .labels({ title: "Linear fit per batch", x: "concentration (mg/L)" }),

  heatmap: ({ heatmap }) =>
    plot(heatmap, { x: "hour", y: "day", color: "flow" })
      .tile()
      .y({ limits: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] })
      .color({ scheme: "blues" })
      .labels({ title: "Flow by weekday and hour", x: "hour", y: null, color: "flow (m³/h)" }),

  lamp_spectra: ({ lamp_spectra }) =>
    plot(lamp_spectra, { x: "wavelength", y: "intensity", color: "hour", group: "hour" })
      .line({ size: 1 })
      .x({ limits: [230, 330] })
      .theme("wota")
      .labels({ title: "Lamp spectra by hour", x: "wavelength (nm)", y: "intensity (counts)" }),
};

// CSV rows → objects: numbers stay numbers; "YYYY-MM-DD HH:MM:SS" becomes a Date (wall-clock time).
export async function load(name) {
  const text = await (await fetch(`../data/${name}.csv`)).text();
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const names = header.split(",");
  const parse = (v) => (v === "" ? null : /^\d{4}-\d\d-\d\d( \d\d:\d\d:\d\d)?$/.test(v) ? new Date(v.replace(" ", "T")) : isNaN(v) ? v : Number(v));
  return lines.map((line) => Object.fromEntries(line.split(",").map((v, i) => [names[i], parse(v)])));
}
