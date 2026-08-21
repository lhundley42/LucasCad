import { distance, midpoint, type Point, type SketchEntity } from "./sketchGeometry.ts";

export type LinearOrientation = "horizontal" | "vertical" | "aligned";
export type SketchReference =
  | { kind: "node"; entityId: string; handle: string }
  | { kind: "line"; entityId: string }
  | { kind: "external-point"; referenceId: string; point: Point; source: "body-edge" }
  | { kind: "external-line"; referenceId: string; a: Point; b: Point; source: "plane-intersection" | "sketch-axis" };

export type ExternalSketchReference = {
  id: string;
  kind: "body-edge" | "plane-intersection";
  label: string;
  points: Point[];
};

export type LinearDimensionConstraint = {
  id: string;
  type: "linear";
  first: SketchReference;
  second: SketchReference;
  orientation: LinearOrientation;
  position: Point;
  value: number;
  conflicted?: boolean;
};

export type DimensionLayout = {
  first: Point;
  second: Point;
  dimensionFirst: Point;
  dimensionSecond: Point;
  label: Point;
  value: number;
};

export function controlPointsForEntity(entity: SketchEntity): { handle: string; point: Point }[] {
  if (entity.type === "line") return [{ handle: "a", point: entity.a }, { handle: "midpoint", point: midpoint(entity.a, entity.b) }, { handle: "b", point: entity.b }];
  if (entity.type === "circle") return [
    { handle: "center", point: entity.c },
    { handle: "radius", point: { x: entity.c.x + entity.r, y: entity.c.y } },
    { handle: "left", point: { x: entity.c.x - entity.r, y: entity.c.y } },
    { handle: "top", point: { x: entity.c.x, y: entity.c.y - entity.r } },
    { handle: "bottom", point: { x: entity.c.x, y: entity.c.y + entity.r } },
  ];
  if (entity.type === "ellipse") return [{ handle: "center", point: entity.c }, { handle: "major", point: { x: entity.c.x + entity.rx, y: entity.c.y } }, { handle: "minor", point: { x: entity.c.x, y: entity.c.y + entity.ry } }];
  if (entity.type === "arc") return [{ handle: "a", point: entity.a }, { handle: "b", point: entity.b }, { handle: "through", point: entity.through }];
  return entity.points.map((point, index) => ({ handle: `point-${index}`, point }));
}

export function nonOverlappingReferenceHitRadius(point: Point, otherPoints: Point[], preferredRadius: number, separationRatio = 0.45): number {
  const nearestDistance = otherPoints.reduce((nearest, candidate) => {
    const candidateDistance = distance(point, candidate);
    return candidateDistance > 1e-6 ? Math.min(nearest, candidateDistance) : nearest;
  }, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(nearestDistance)) return preferredRadius;
  // Keep neighboring targets separated so SVG render order can never turn a
  // visibly highlighted center point into a quadrant click.
  return Math.max(0.001, Math.min(preferredRadius, nearestDistance * separationRatio));
}

export function referencePoint(reference: SketchReference, entities: SketchEntity[]): Point {
  if (reference.kind === "external-point") return reference.point;
  if (reference.kind === "external-line") return midpoint(reference.a, reference.b);
  const entity = entities.find((candidate) => candidate.id === reference.entityId);
  if (!entity) return { x: 0, y: 0 };
  if (reference.kind === "line") return entity.type === "line" ? midpoint(entity.a, entity.b) : controlPointsForEntity(entity)[0]?.point ?? { x: 0, y: 0 };
  return controlPointsForEntity(entity).find((control) => control.handle === reference.handle)?.point ?? controlPointsForEntity(entity)[0]?.point ?? { x: 0, y: 0 };
}

function lineFor(reference: SketchReference, entities: SketchEntity[]) {
  if (reference.kind === "external-line") return { a: reference.a, b: reference.b };
  if (reference.kind !== "line") return null;
  const entity = entities.find((candidate) => candidate.id === reference.entityId);
  return entity?.type === "line" ? entity : null;
}

function projectToLine(point: Point, line: { a: Point; b: Point }): Point {
  const dx = line.b.x - line.a.x; const dy = line.b.y - line.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-10) return line.a;
  const amount = ((point.x - line.a.x) * dx + (point.y - line.a.y) * dy) / lengthSquared;
  return { x: line.a.x + dx * amount, y: line.a.y + dy * amount };
}

export function dimensionReferencePoints(first: SketchReference, second: SketchReference, entities: SketchEntity[]): [Point, Point] {
  let firstPoint = referencePoint(first, entities); let secondPoint = referencePoint(second, entities);
  const firstLine = lineFor(first, entities); const secondLine = lineFor(second, entities);
  if (firstLine && secondLine) firstPoint = projectToLine(secondPoint, firstLine);
  else if (firstLine && !secondLine) firstPoint = projectToLine(secondPoint, firstLine);
  else if (secondLine && !firstLine) secondPoint = projectToLine(firstPoint, secondLine);
  return [firstPoint, secondPoint];
}

export function validLinearDimensionPair(first: SketchReference, second: SketchReference, entities: SketchEntity[]): boolean {
  const firstLine = lineFor(first, entities); const secondLine = lineFor(second, entities);
  if (!firstLine || !secondLine) return true;
  if (first.kind !== "line" && second.kind !== "line") return true;
  const firstVector = { x: firstLine.b.x - firstLine.a.x, y: firstLine.b.y - firstLine.a.y };
  const secondVector = { x: secondLine.b.x - secondLine.a.x, y: secondLine.b.y - secondLine.a.y };
  const scale = Math.max(Math.hypot(firstVector.x, firstVector.y) * Math.hypot(secondVector.x, secondVector.y), 1e-9);
  return Math.abs(firstVector.x * secondVector.y - firstVector.y * secondVector.x) / scale < 0.001;
}

export function constraintSupersedesSegmentDimension(constraint: LinearDimensionConstraint, entity: SketchEntity): boolean {
  if (entity.type !== "line" || constraint.first.kind !== "node" || constraint.second.kind !== "node") return false;
  if (constraint.first.entityId !== entity.id || constraint.second.entityId !== entity.id) return false;
  const handles = new Set([constraint.first.handle, constraint.second.handle]);
  if (!handles.has("a") || !handles.has("b")) return false;
  if (constraint.orientation === "aligned") return true;
  if (constraint.orientation === "horizontal") return Math.abs(entity.a.y - entity.b.y) < 0.001;
  return Math.abs(entity.a.x - entity.b.x) < 0.001;
}

function nodesShareLine(first: SketchReference, second: SketchReference, entities: SketchEntity[]) {
  if (first.kind !== "node" || second.kind !== "node") return false;
  const firstPoint = referencePoint(first, entities); const secondPoint = referencePoint(second, entities);
  return entities.some((entity) => entity.type === "line" && (
    (distance(entity.a, firstPoint) < 0.05 && distance(entity.b, secondPoint) < 0.05)
    || (distance(entity.b, firstPoint) < 0.05 && distance(entity.a, secondPoint) < 0.05)
  ));
}

export function linearOrientationOptions(first: SketchReference, second: SketchReference, entities: SketchEntity[]): LinearOrientation[] {
  if (first.kind === "line" || second.kind === "line") return ["aligned"];
  const options: LinearOrientation[] = ["horizontal", "vertical"];
  const firstIsPoint = first.kind === "node" || first.kind === "external-point";
  const secondIsPoint = second.kind === "node" || second.kind === "external-point";
  if ((firstIsPoint && secondIsPoint) || first.kind === "line" || second.kind === "line" || first.kind === "external-line" || second.kind === "external-line" || nodesShareLine(first, second, entities)) options.push("aligned");
  return options;
}

export function defaultLinearOrientation(first: SketchReference, second: SketchReference, entities: SketchEntity[]): LinearOrientation {
  if (first.kind === "line" || second.kind === "line") return "aligned";
  const selectedLine = lineFor(first, entities) ?? lineFor(second, entities);
  if (selectedLine) return Math.abs(selectedLine.b.x - selectedLine.a.x) >= Math.abs(selectedLine.b.y - selectedLine.a.y) ? "vertical" : "horizontal";
  const [firstPoint, secondPoint] = dimensionReferencePoints(first, second, entities);
  return Math.abs(secondPoint.x - firstPoint.x) >= Math.abs(secondPoint.y - firstPoint.y) ? "horizontal" : "vertical";
}

export function cycleLinearOrientation(current: LinearOrientation, options: LinearOrientation[]): LinearOrientation {
  const index = Math.max(0, options.indexOf(current));
  return options[(index + 1) % options.length];
}

export function linearDimensionValue(first: SketchReference, second: SketchReference, orientation: LinearOrientation, entities: SketchEntity[]): number {
  const [firstPoint, secondPoint] = dimensionReferencePoints(first, second, entities);
  if (orientation === "horizontal") return Math.abs(secondPoint.x - firstPoint.x);
  if (orientation === "vertical") return Math.abs(secondPoint.y - firstPoint.y);
  return distance(firstPoint, secondPoint);
}

export function targetPointForLinearValue(firstPoint: Point, secondPoint: Point, orientation: LinearOrientation, value: number): Point {
  if (orientation === "horizontal") return { x: firstPoint.x + (secondPoint.x < firstPoint.x ? -value : value), y: secondPoint.y };
  if (orientation === "vertical") return { x: secondPoint.x, y: firstPoint.y + (secondPoint.y < firstPoint.y ? -value : value) };
  const length = Math.max(distance(firstPoint, secondPoint), 1e-9);
  return { x: firstPoint.x + (secondPoint.x - firstPoint.x) * value / length, y: firstPoint.y + (secondPoint.y - firstPoint.y) * value / length };
}

export function linearDimensionLayout(first: SketchReference, second: SketchReference, orientation: LinearOrientation, position: Point, entities: SketchEntity[]): DimensionLayout {
  const [firstPoint, secondPoint] = dimensionReferencePoints(first, second, entities);
  if (orientation === "horizontal") {
    return { first: firstPoint, second: secondPoint, dimensionFirst: { x: firstPoint.x, y: position.y }, dimensionSecond: { x: secondPoint.x, y: position.y }, label: { x: (firstPoint.x + secondPoint.x) / 2, y: position.y }, value: Math.abs(secondPoint.x - firstPoint.x) };
  }
  if (orientation === "vertical") {
    return { first: firstPoint, second: secondPoint, dimensionFirst: { x: position.x, y: firstPoint.y }, dimensionSecond: { x: position.x, y: secondPoint.y }, label: { x: position.x, y: (firstPoint.y + secondPoint.y) / 2 }, value: Math.abs(secondPoint.y - firstPoint.y) };
  }
  const dx = secondPoint.x - firstPoint.x; const dy = secondPoint.y - firstPoint.y; const length = Math.max(Math.hypot(dx, dy), 1e-9);
  const normal = { x: -dy / length, y: dx / length }; const center = midpoint(firstPoint, secondPoint);
  const offset = (position.x - center.x) * normal.x + (position.y - center.y) * normal.y;
  const dimensionFirst = { x: firstPoint.x + normal.x * offset, y: firstPoint.y + normal.y * offset };
  const dimensionSecond = { x: secondPoint.x + normal.x * offset, y: secondPoint.y + normal.y * offset };
  return { first: firstPoint, second: secondPoint, dimensionFirst, dimensionSecond, label: midpoint(dimensionFirst, dimensionSecond), value: length };
}

export function defaultLinearDimensionPosition(first: SketchReference, second: SketchReference, orientation: LinearOrientation, entities: SketchEntity[], offset: number): Point {
  const [firstPoint, secondPoint] = dimensionReferencePoints(first, second, entities);
  const firstIsAxis = first.kind === "external-line" && first.source === "sketch-axis";
  const referencePointAwayFromAxis = firstIsAxis ? secondPoint : firstPoint;
  const center = midpoint(firstPoint, secondPoint);
  if (orientation === "horizontal") {
    return { x: center.x, y: referencePointAwayFromAxis.y + (referencePointAwayFromAxis.y > 0 ? offset : -offset) };
  }
  if (orientation === "vertical") {
    return { x: referencePointAwayFromAxis.x + (referencePointAwayFromAxis.x > 0 ? offset : -offset), y: center.y };
  }
  const dx = secondPoint.x - firstPoint.x; const dy = secondPoint.y - firstPoint.y;
  const length = Math.max(Math.hypot(dx, dy), 1e-9);
  return { x: center.x - dy / length * offset, y: center.y + dx / length * offset };
}
