import type { SweepParameters } from "./CadViewport";

/** The two slots are always profile, then path. Clearing a slot explicitly reopens it. */
export function selectSweepSketch(value: SweepParameters, id: string): SweepParameters {
  if (!id || value.sketchIds.includes(id)) return value;
  const slot = !value.sketchIds[0] ? 0 : !value.sketchIds[1] ? 1 : -1;
  if (slot < 0) return value;
  const sketchIds = [...value.sketchIds]; sketchIds[slot] = id;
  return { ...value, sketchIds };
}
