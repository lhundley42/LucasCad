import { normalizeTheme, THEME_PRESETS, type ThemeSettings } from "./themes.ts";

export type GlobalAppSettings = {
  theme: ThemeSettings;
  selectedEdgeWidthPx: number;
  meshQuality: number;
  sketchDimensionTextScale: number;
  sketchNodeDiameterPx: number;
  sketchHighlightWidthPx: number;
  sketchGridSizeMm: number;
  unitSystem: "metric" | "imperial";
};

export const GLOBAL_SETTINGS_STORAGE_KEY = "lucascad:global-settings";

export const DEFAULT_GLOBAL_SETTINGS: GlobalAppSettings = {
  theme: normalizeTheme(THEME_PRESETS.tron),
  selectedEdgeWidthPx: 4,
  meshQuality: 40,
  sketchDimensionTextScale: 0.5,
  sketchNodeDiameterPx: 4,
  sketchHighlightWidthPx: 1.2,
  sketchGridSizeMm: 8,
  unitSystem: "metric",
};

export function normalizeGlobalSettings(value: unknown): GlobalAppSettings {
  const candidate = typeof value === "object" && value !== null
    ? Number((value as Partial<GlobalAppSettings>).sketchDimensionTextScale)
    : Number.NaN;
  const nodeDiameter = typeof value === "object" && value !== null ? Number((value as Partial<GlobalAppSettings>).sketchNodeDiameterPx) : Number.NaN;
  const highlightWidth = typeof value === "object" && value !== null ? Number((value as Partial<GlobalAppSettings>).sketchHighlightWidthPx) : Number.NaN;
  const gridSize = typeof value === "object" && value !== null ? Number((value as Partial<GlobalAppSettings>).sketchGridSizeMm) : Number.NaN;
  const unitSystem = typeof value === "object" && value !== null && (value as Partial<GlobalAppSettings>).unitSystem === "imperial" ? "imperial" : "metric";
  const quality = typeof value === "object" && value !== null ? (value as Partial<GlobalAppSettings>).meshQuality : undefined;
  const edgeWidth = typeof value === "object" && value !== null ? (value as Partial<GlobalAppSettings>).selectedEdgeWidthPx : undefined;
  return {
    theme: normalizeTheme(typeof value === "object" && value !== null ? (value as Partial<GlobalAppSettings>).theme : undefined),
    selectedEdgeWidthPx: typeof edgeWidth === "number" && Number.isFinite(edgeWidth) ? Math.max(1, Math.min(10, edgeWidth)) : DEFAULT_GLOBAL_SETTINGS.selectedEdgeWidthPx,
    meshQuality: typeof quality === "number" && Number.isFinite(quality) ? Math.round(Math.max(0, Math.min(100, quality))) : DEFAULT_GLOBAL_SETTINGS.meshQuality,
    sketchDimensionTextScale: Number.isFinite(candidate)
      ? Math.max(0.25, Math.min(1.5, candidate))
      : DEFAULT_GLOBAL_SETTINGS.sketchDimensionTextScale,
    sketchNodeDiameterPx: Number.isFinite(nodeDiameter) ? Math.max(2, Math.min(12, nodeDiameter)) : DEFAULT_GLOBAL_SETTINGS.sketchNodeDiameterPx,
    sketchHighlightWidthPx: Number.isFinite(highlightWidth) ? Math.max(0.5, Math.min(4, highlightWidth)) : DEFAULT_GLOBAL_SETTINGS.sketchHighlightWidthPx,
    sketchGridSizeMm: Number.isFinite(gridSize) ? Math.max(0.1, Math.min(1000, gridSize)) : DEFAULT_GLOBAL_SETTINGS.sketchGridSizeMm,
    unitSystem,
  };
}

export function parseGlobalSettings(serialized: string | null): GlobalAppSettings {
  if (!serialized) return DEFAULT_GLOBAL_SETTINGS;
  try { return normalizeGlobalSettings(JSON.parse(serialized)); }
  catch { return DEFAULT_GLOBAL_SETTINGS; }
}
