import type { FeatureRecord } from "./CadViewport";

export type UnionParameters = { type: "union"; bodyIds: string[]; targetBodyId: string };

export function activeBodyIds(features: FeatureRecord[]): string[] {
  const bodies = new Set<string>();
  for (const feature of features) {
    if (feature.combine === "new" && feature.bodyId) bodies.add(feature.bodyId);
    if (feature.type === "union") {
      const target = feature.targetBodyId ?? feature.bodyIds?.[0];
      for (const id of feature.bodyIds ?? []) if (id !== target) bodies.delete(id);
    }
  }
  return [...bodies];
}

export function toggleUnionBody(value: UnionParameters, id: string): UnionParameters {
  const bodyIds = value.bodyIds.includes(id) ? value.bodyIds.filter((item) => item !== id) : [...value.bodyIds, id];
  return { ...value, bodyIds, targetBodyId: bodyIds[0] ?? "" };
}
