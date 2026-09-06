export type ThemeColors = {
  backgroundTop: string;
  backgroundMiddle: string;
  backgroundBottom: string;
  model: string;
  modelEdge: string;
  selectedModel: string;
  selection: string;
  grid: string;
  gridMajor: string;
  sketchBackground: string;
  sketchGrid: string;
  sketchGridMajor: string;
  sketch: string;
  sketchHighlight: string;
  axisX: string;
  axisY: string;
  viewText: string;
};
export type ThemeSettings = {
  preset: "tron" | "old-school";
  backgroundStyle: "radial" | "linear" | "solid";
  colors: ThemeColors;
};
export const THEME_PRESETS: Record<ThemeSettings["preset"], ThemeSettings> = {
  tron: {
    preset: "tron", backgroundStyle: "radial",
    colors: {
      backgroundTop: "#26313c", backgroundMiddle: "#141b23", backgroundBottom: "#0b1016",
      model: "#3097bd", selectedModel: "#4fb9df", modelEdge: "#9edcf2", selection: "#ff9700",
      grid: "#263644", gridMajor: "#3e5264", sketchBackground: "#0d1319", sketchGrid: "#1a2731", sketchGridMajor: "#263944", sketch: "#55b9e8", sketchHighlight: "#f6b94d",
      axisX: "#5d3337", axisY: "#315c49", viewText: "#91a6b8",
    },
  },
  "old-school": {
    preset: "old-school", backgroundStyle: "linear",
    colors: {
      backgroundTop: "#879bb7", backgroundMiddle: "#ced7e3", backgroundBottom: "#f5f5f5",
      model: "#a0a0a0", selectedModel: "#b8c8d8", modelEdge: "#414953", selection: "#ff9700",
      grid: "#b1bdcb", gridMajor: "#8b9bae", sketchBackground: "#e3e8ef", sketchGrid: "#c5cfdc", sketchGridMajor: "#9aabbe", sketch: "#126199", sketchHighlight: "#bf6500",
      axisX: "#ab555b", axisY: "#3e795a", viewText: "#364b61",
    },
  },
};
export function normalizeTheme(value: unknown): ThemeSettings {
  const input = value && typeof value === "object" ? value as Partial<ThemeSettings> : {};
  const base = THEME_PRESETS[input.preset === "old-school" ? "old-school" : "tron"];
  const colors = { ...base.colors };
  for (const key of Object.keys(colors) as (keyof ThemeColors)[]) {
    const color = input.colors?.[key];
    if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) colors[key] = color.toLowerCase();
  }
  return { preset: base.preset, backgroundStyle: ["radial", "linear", "solid"].includes(input.backgroundStyle ?? "") ? input.backgroundStyle! : base.backgroundStyle, colors };
}
export function themeCssVariables(theme: ThemeSettings): Record<string, string> {
  const c = theme.colors;
  const stops = `${c.backgroundTop} 0%, ${c.backgroundMiddle} 48%, ${c.backgroundBottom} 100%`;
  return {
    "--model-background": theme.backgroundStyle === "solid" ? c.backgroundTop : theme.backgroundStyle === "linear" ? `linear-gradient(to bottom, ${stops})` : `radial-gradient(circle at 50% 42%, ${stops})`,
    "--theme-view-text": c.viewText, "--theme-grid": c.grid, "--theme-grid-major": c.gridMajor,
    "--theme-sketch-background": c.sketchBackground, "--theme-sketch-grid": c.sketchGrid, "--theme-sketch-grid-major": c.sketchGridMajor,
    "--theme-sketch": c.sketch, "--theme-sketch-highlight": c.sketchHighlight,
    "--theme-axis-x": c.axisX, "--theme-axis-y": c.axisY,
  };
}
