import type { FeatureRecord } from "./CadViewport";

/** Visibility-only isolation; preserve suppressed history and consumed bodies. */
export function isolateBodyFeatures(features: FeatureRecord[], bodyId: string, activeBodyIds: string[]): FeatureRecord[] {
  const active = new Set(activeBodyIds);
  if (!active.has(bodyId)) return features;
  return features.map(feature => {
    const target = feature.bodyId ?? feature.targetBodyId;
    if (!target || !active.has(target)) return feature;
    return { ...feature,
      ...(feature.combine === "new" && feature.bodyId ? { bodyVisible: target === bodyId } : {}),
      ...(target === bodyId ? { visible: true } : {}),
    };
  });
}
