import type { FeatureRecord } from "./CadViewport";

export function normalizeBodyColor(value: unknown): string | undefined {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : undefined;
}

/** Appearance belongs to the stable body creator, not its latest modifier. */
export function bodyColorMap(features: FeatureRecord[]): Record<string, string> {
  const colors: Record<string, string> = Object.create(null);
  for (const feature of features) {
    const color = normalizeBodyColor(feature.bodyColor);
    if (feature.combine === "new" && feature.bodyId && color) colors[feature.bodyId] = color;
  }
  return colors;
}

export function setBodyColor(features: FeatureRecord[], bodyId: string, value?: string): FeatureRecord[] {
  const color = normalizeBodyColor(value);
  if (value !== undefined && !color) return features;
  return features.map(feature => {
    if (feature.combine !== "new" || feature.bodyId !== bodyId) return feature;
    const { bodyColor: previous, ...rest } = feature;
    return color ? { ...rest, bodyColor: color } : rest;
  });
}
