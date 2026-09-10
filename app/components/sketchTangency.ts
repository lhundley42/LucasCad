import type { Point, SketchEntity } from "./sketchGeometry.ts";
import type { SketchConstraint, TangentConstraint } from "./sketchConstraints.ts";

export const isTangentConstraint = (c: SketchConstraint): c is TangentConstraint => c.type === "tangent";

function tangentData(c: TangentConstraint, entities: SketchEntity[]) {
  const circle = entities.find(e => e.id === c.first.entityId);
  const line = entities.find(e => e.id === c.second.entityId);
  if (circle?.type !== "circle" || line?.type !== "line") return null;
  const dx = line.b.x - line.a.x, dy = line.b.y - line.a.y, length = Math.hypot(dx, dy);
  if (length < 1e-9 || !Number.isFinite(circle.r) || circle.r <= 0) return null;
  const n = { x: -dy / length, y: dx / length };
  return { circle, line, n, target: n.x * line.a.x + n.y * line.a.y + c.side * circle.r };
}

export function makeTangentConstraint(first: SketchEntity, second: SketchEntity, id: string): TangentConstraint | null {
  const circle = first.type === "circle" ? first : second.type === "circle" ? second : null;
  const line = first.type === "line" ? first : second.type === "line" ? second : null;
  if (!circle || !line || Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) < 1e-9 || circle.r <= 0) return null;
  const cross = (line.b.x - line.a.x) * (circle.c.y - line.a.y) - (line.b.y - line.a.y) * (circle.c.x - line.a.x);
  return { id, type: "tangent", first: { kind: "node", entityId: circle.id, handle: "center" }, second: { kind: "line", entityId: line.id }, side: cross < 0 ? -1 : 1 };
}

export function tangentSatisfied(c: TangentConstraint, entities: SketchEntity[]): boolean {
  const d = tangentData(c, entities);
  return !!d && Math.abs(d.n.x * d.circle.c.x + d.n.y * d.circle.c.y - d.target) < 1e-6;
}

export function tangentContact(c: TangentConstraint, entities: SketchEntity[]): Point | null {
  const d = tangentData(c, entities);
  if (!d) return null;
  return { x: d.circle.c.x - d.n.x * c.side * d.circle.r, y: d.circle.c.y - d.n.y * c.side * d.circle.r };
}

// A line is an infinite supporting line, as in CAD tangent relations. Retain
// radius and side; one relation leaves translation along the line free. Two
// independent normals determine the center. Extra inconsistent relations are
// reported by tangentSatisfied rather than silently discarded.
export function synchronizeTangencies(entities: SketchEntity[], constraints: SketchConstraint[]): SketchEntity[] {
  const tangents = constraints.filter(isTangentConstraint);
  return entities.map(entity => {
    if (entity.type !== "circle") return entity;
    const equations = tangents.filter(c => c.first.entityId === entity.id).map(c => tangentData(c, entities)).filter(d => d !== null);
    if (!equations.length) return entity;
    const first = equations[0];
    const error = first.target - first.n.x * entity.c.x - first.n.y * entity.c.y;
    let center = { x: entity.c.x + first.n.x * error, y: entity.c.y + first.n.y * error };
    const second = equations.find(d => Math.abs(first.n.x * d.n.y - first.n.y * d.n.x) > 1e-8);
    if (second) {
      const det = first.n.x * second.n.y - first.n.y * second.n.x;
      center = { x: (first.target * second.n.y - first.n.y * second.target) / det, y: (first.n.x * second.target - first.target * second.n.x) / det };
    }
    return Number.isFinite(center.x) && Number.isFinite(center.y) ? { ...entity, c: center } : entity;
  });
}
