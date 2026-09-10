import { circumcircle, distance, midpoint, type Point, type SketchEntity } from "./sketchGeometry.ts";

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

export type AngularDimensionConstraint = {
  id: string;
  type: "angular";
  first: Extract<SketchReference, { kind: "line" | "external-line" }>;
  second: Extract<SketchReference, { kind: "line" | "external-line" }>;
  position: Point;
  value: number;
  conflicted?: boolean;
};

export type DiameterDimensionConstraint = {
  id: string;
  type: "diameter";
  entityId: string;
  position: Point;
  value: number;
  conflicted?: boolean;
};

export type RadialDimensionConstraint = {
  id: string;
  type: "radial";
  entityId: string;
  position: Point;
  value: number;
  conflicted?: boolean;
};

export type MirrorConstraint = {
  id: string;
  type: "mirror";
  axisEntityId: string;
  pairs: { sourceId: string; mirroredId: string }[];
};

export type PatternDirectionReference =
  | { kind: "entity"; entityId: string; fallback: Point }
  | { kind: "external"; referenceId: string; fallback: Point };

export type PatternCenterReference =
  | { kind: "origin" }
  | { kind: "fixed"; point: Point }
  | { kind: "entity-node"; entityId: string; handle: string; fallback: Point }
  | { kind: "external-point"; referenceId: string; fallback: Point };

type LinearPatternConstraintBase = {
  id: string;
  direction1: PatternDirectionReference;
  spacing1: number;
  count1: number;
  flip1: boolean;
  direction2?: PatternDirectionReference;
  spacing2?: number;
  count2?: number;
  flip2?: boolean;
  skipped: { column: number; row: number }[];
  pairs: { sourceId: string; instances: { entityId: string; column: number; row: number }[] }[];
  conflicted?: boolean;
};

export type LinearPatternConstraint = LinearPatternConstraintBase & (
  | { type: "linear-pattern" }
  | { type: "rectangular-pattern"; direction2: PatternDirectionReference }
);

export type CircularPatternConstraint = {
  id: string;
  type: "circular-pattern";
  center: PatternCenterReference;
  count: number;
  span: number;
  equalSpacing: boolean;
  reverse: boolean;
  rotateInstances: boolean;
  skipped: number[];
  pairs: { sourceId: string; instances: { entityId: string; index: number }[] }[];
  conflicted?: boolean;
};

export type PatternConstraint = LinearPatternConstraint | CircularPatternConstraint;

export type TangentConstraint = {
  id: string;
  type: "tangent";
  first: { kind: "node"; entityId: string; handle: "center" };
  second: { kind: "line"; entityId: string };
  side: 1 | -1;
  conflicted?: boolean;
};

export type SketchConstraint = LinearDimensionConstraint | AngularDimensionConstraint | DiameterDimensionConstraint | RadialDimensionConstraint | MirrorConstraint | PatternConstraint | TangentConstraint;

export type DimensionLayout = {
  first: Point;
  second: Point;
  dimensionFirst: Point;
  dimensionSecond: Point;
  label: Point;
  value: number;
};

export type AngularDimensionLayout = {
  vertex: Point;
  firstRay: Point;
  secondRay: Point;
  label: Point;
  radius: number;
  largeArc: boolean;
  sweep: boolean;
  value: number;
};

export type DiameterDimensionLayout = {
  center: Point;
  first: Point;
  second: Point;
  label: Point;
  value: number;
};

export function diameterDimensionValue(entityId: string, entities: SketchEntity[]): number {
  const entity = entities.find((candidate) => candidate.id === entityId);
  return entity?.type === "circle" ? entity.r * 2 : 0;
}

export function diameterDimensionLayout(entityId: string, position: Point, entities: SketchEntity[]): DiameterDimensionLayout {
  const entity = entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== "circle") return { center: position, first: position, second: position, label: position, value: 0 };
  const dx = position.x - entity.c.x; const dy = position.y - entity.c.y; const length = Math.hypot(dx, dy);
  const direction = length > 1e-8 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  return {
    center: entity.c,
    first: { x: entity.c.x - direction.x * entity.r, y: entity.c.y - direction.y * entity.r },
    second: { x: entity.c.x + direction.x * entity.r, y: entity.c.y + direction.y * entity.r },
    label: position,
    value: entity.r * 2,
  };
}

export function radialDimensionValue(entityId: string, entities: SketchEntity[]): number {
  const entity = entities.find((candidate) => candidate.id === entityId);
  if (entity?.type === "circle") return entity.r;
  if (entity?.type === "arc") return circumcircle(entity.a, entity.b, entity.through).r;
  return 0;
}

export function radialDimensionLayout(entityId: string, position: Point, entities: SketchEntity[]): DiameterDimensionLayout {
  const entity = entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== "circle" && entity.type !== "arc") return { center: position, first: position, second: position, label: position, value: 0 };
  const circle = entity.type === "circle" ? { c: entity.c, r: entity.r } : circumcircle(entity.a, entity.b, entity.through);
  let dx = position.x - circle.c.x; let dy = position.y - circle.c.y;
  if (entity.type === "arc") { dx = entity.through.x - circle.c.x; dy = entity.through.y - circle.c.y; }
  const length = Math.hypot(dx, dy);
  const direction = length > 1e-8 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  return {
    center: circle.c,
    first: circle.c,
    second: { x: circle.c.x + direction.x * circle.r, y: circle.c.y + direction.y * circle.r },
    label: position,
    value: circle.r,
  };
}

export type AxisOrSketchLineTarget = { kind: "axis"; axis: "x" | "y" } | { kind: "line"; entityId: string };

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x; const dy = b.y - a.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return distance(point, a);
  const amount = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return distance(point, { x: a.x + dx * amount, y: a.y + dy * amount });
}

export function preferredAxisOrSketchLineTarget(point: Point, axis: "x" | "y", entities: SketchEntity[], lineHitTolerance: number, project: (point: Point) => Point = (point) => point): AxisOrSketchLineTarget {
  point = project(point);
  const origin = project({ x: 0, y: 0 }), along = project(axis === "x" ? { x: 1, y: 0 } : { x: 0, y: 1 });
  const dx = along.x - origin.x, dy = along.y - origin.y;
  const axisDistance = Math.abs(dx * (point.y - origin.y) - dy * (point.x - origin.x)) / Math.max(Math.hypot(dx, dy), 1e-12);
  const nearestLine = entities
    .filter((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.type === "line")
    .map((entity) => ({ entityId: entity.id, distance: pointToSegmentDistance(point, project(entity.a), project(entity.b)) }))
    .filter((candidate) => candidate.distance <= lineHitTolerance)
    .sort((first, second) => first.distance - second.distance)[0];
  return nearestLine && nearestLine.distance <= axisDistance + 1e-6 ? { kind: "line", entityId: nearestLine.entityId } : { kind: "axis", axis };
}

export function controlPointsForEntity(entity: SketchEntity): { handle: string; point: Point }[] {
  if (entity.type === "line") return [{ handle: "a", point: entity.a }, { handle: "midpoint", point: midpoint(entity.a, entity.b) }, { handle: "b", point: entity.b }];
  if (entity.type === "circle") return [
    { handle: "center", point: entity.c },
    { handle: "radius", point: { x: entity.c.x + entity.r, y: entity.c.y } },
    { handle: "left", point: { x: entity.c.x - entity.r, y: entity.c.y } },
    { handle: "top", point: { x: entity.c.x, y: entity.c.y - entity.r } },
    { handle: "bottom", point: { x: entity.c.x, y: entity.c.y + entity.r } },
  ];
  if (entity.type === "ellipse") { const angle = entity.rotation ?? 0; return [{ handle: "center", point: entity.c }, { handle: "major", point: { x: entity.c.x + entity.rx * Math.cos(angle), y: entity.c.y + entity.rx * Math.sin(angle) } }, { handle: "minor", point: { x: entity.c.x - entity.ry * Math.sin(angle), y: entity.c.y + entity.ry * Math.cos(angle) } }]; }
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

export function lineFor(reference: SketchReference, entities: SketchEntity[]) {
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

function infiniteLineIntersection(first: { a: Point; b: Point }, second: { a: Point; b: Point }): Point | null {
  const denominator = (first.b.x - first.a.x) * (second.b.y - second.a.y) - (first.b.y - first.a.y) * (second.b.x - second.a.x);
  if (Math.abs(denominator) < 1e-10) return null;
  const amount = ((second.a.x - first.a.x) * (second.b.y - second.a.y) - (second.a.y - first.a.y) * (second.b.x - second.a.x)) / denominator;
  return { x: first.a.x + (first.b.x - first.a.x) * amount, y: first.a.y + (first.b.y - first.a.y) * amount };
}

const normalizedAngle = (angle: number) => ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
const degrees = (radians: number) => radians * 180 / Math.PI;
const radians = (degreesValue: number) => degreesValue * Math.PI / 180;

function vectorAngle(vector: Point): number {
  return Math.atan2(vector.y, vector.x);
}

function lineDirectionAwayFromVertex(line: { a: Point; b: Point }, vertex: Point, placement: Point): Point {
  const aDistance = distance(line.a, vertex);
  const bDistance = distance(line.b, vertex);
  let direction = aDistance >= bDistance ? { x: line.a.x - vertex.x, y: line.a.y - vertex.y } : { x: line.b.x - vertex.x, y: line.b.y - vertex.y };
  if (Math.hypot(direction.x, direction.y) < 1e-9) direction = { x: line.b.x - line.a.x, y: line.b.y - line.a.y };
  const opposite = { x: -direction.x, y: -direction.y };
  const placementVector = { x: placement.x - vertex.x, y: placement.y - vertex.y };
  return direction.x * placementVector.x + direction.y * placementVector.y >= opposite.x * placementVector.x + opposite.y * placementVector.y ? direction : opposite;
}

export function angularDimensionValue(first: SketchReference, second: SketchReference, placement: Point, entities: SketchEntity[]): number {
  const firstLine = lineFor(first, entities); const secondLine = lineFor(second, entities);
  if (!firstLine || !secondLine) return 0;
  const vertex = infiniteLineIntersection(firstLine, secondLine) ?? midpoint(referencePoint(first, entities), referencePoint(second, entities));
  const firstDirection = lineDirectionAwayFromVertex(firstLine, vertex, placement);
  const secondDirection = lineDirectionAwayFromVertex(secondLine, vertex, placement);
  const start = vectorAngle(firstDirection); const end = vectorAngle(secondDirection);
  const ccw = normalizedAngle(end - start);
  const cw = normalizedAngle(start - end);
  const placementAngle = normalizedAngle(vectorAngle({ x: placement.x - vertex.x, y: placement.y - vertex.y }) - start);
  return placementAngle <= ccw ? degrees(ccw) : degrees(cw);
}

export function angularDimensionLayout(first: SketchReference, second: SketchReference, position: Point, entities: SketchEntity[]): AngularDimensionLayout {
  const firstLine = lineFor(first, entities); const secondLine = lineFor(second, entities);
  if (!firstLine || !secondLine) return { vertex: position, firstRay: position, secondRay: position, label: position, radius: 0, largeArc: false, sweep: true, value: 0 };
  const vertex = infiniteLineIntersection(firstLine, secondLine) ?? midpoint(referencePoint(first, entities), referencePoint(second, entities));
  const radius = Math.max(10, distance(vertex, position));
  const firstDirection = lineDirectionAwayFromVertex(firstLine, vertex, position);
  const secondDirection = lineDirectionAwayFromVertex(secondLine, vertex, position);
  const start = vectorAngle(firstDirection); const end = vectorAngle(secondDirection);
  const ccw = normalizedAngle(end - start);
  const cw = normalizedAngle(start - end);
  const placementAngle = normalizedAngle(vectorAngle({ x: position.x - vertex.x, y: position.y - vertex.y }) - start);
  const useCcw = placementAngle <= ccw;
  const span = useCcw ? ccw : cw;
  const firstAngle = useCcw ? start : end;
  const secondAngle = useCcw ? end : start;
  return {
    vertex,
    firstRay: { x: vertex.x + Math.cos(firstAngle) * radius, y: vertex.y + Math.sin(firstAngle) * radius },
    secondRay: { x: vertex.x + Math.cos(secondAngle) * radius, y: vertex.y + Math.sin(secondAngle) * radius },
    label: position,
    radius,
    largeArc: span > Math.PI,
    sweep: useCcw,
    value: degrees(span),
  };
}

export function targetPointForAngularValue(firstLine: { a: Point; b: Point }, secondLine: { a: Point; b: Point }, placement: Point, valueDegrees: number): { pivot: Point; target: Point; movingHandle: "a" | "b" } | null {
  const vertex = infiniteLineIntersection(firstLine, secondLine) ?? midpoint(firstLine.a, secondLine.a);
  const firstDirection = lineDirectionAwayFromVertex(firstLine, vertex, placement);
  const secondDirection = lineDirectionAwayFromVertex(secondLine, vertex, placement);
  const firstAngle = vectorAngle(firstDirection);
  const secondAngle = vectorAngle(secondDirection);
  const currentCcw = normalizedAngle(secondAngle - firstAngle);
  const currentCw = normalizedAngle(firstAngle - secondAngle);
  const placementAngle = normalizedAngle(vectorAngle({ x: placement.x - vertex.x, y: placement.y - vertex.y }) - firstAngle);
  const sign = placementAngle <= currentCcw ? 1 : -1;
  const targetAngle = firstAngle + sign * radians(valueDegrees);
  const pivot = distance(secondLine.a, vertex) <= distance(secondLine.b, vertex) ? secondLine.a : secondLine.b;
  const movingHandle = pivot === secondLine.a ? "b" : "a";
  const moving = movingHandle === "a" ? secondLine.a : secondLine.b;
  const length = Math.max(distance(pivot, moving), 1e-9);
  return { pivot, movingHandle, target: { x: pivot.x + Math.cos(targetAngle) * length, y: pivot.y + Math.sin(targetAngle) * length } };
}

export function constraintSupersedesOrthogonalProfileDimension(constraint: LinearDimensionConstraint, entity: SketchEntity, entities: SketchEntity[]): boolean {
  if (constraintSupersedesSegmentDimension(constraint, entity)) return true;
  if (entity.type !== "line" || !entity.axisConstraint) return false;
  const driven = entities.find((candidate) => constraintSupersedesSegmentDimension(constraint, candidate));
  if (!driven || driven.type !== "line" || driven.axisConstraint !== entity.axisConstraint) return false;
  const perpendicular = entity.axisConstraint === "Horizontal" ? "Vertical" : "Horizontal";
  const connectors = entities.filter((candidate): candidate is Extract<SketchEntity, { type: "line" }> => candidate.type === "line" && candidate.id !== entity.id && candidate.id !== driven.id && candidate.axisConstraint === perpendicular);
  const joins = (connector: Extract<SketchEntity, { type: "line" }>, first: Point, second: Point) => (
    (distance(connector.a, first) < 0.001 && distance(connector.b, second) < 0.001)
    || (distance(connector.b, first) < 0.001 && distance(connector.a, second) < 0.001)
  );
  const directPair = connectors.some((first) => joins(first, driven.a, entity.a)) && connectors.some((second) => joins(second, driven.b, entity.b));
  const crossedPair = connectors.some((first) => joins(first, driven.a, entity.b)) && connectors.some((second) => joins(second, driven.b, entity.a));
  return directPair || crossedPair;
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
