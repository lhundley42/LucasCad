export type Point = { x: number; y: number };
export type SplineHandlePair = { in: Point; out: Point };
export type SelectionBox = { left: number; right: number; top: number; bottom: number };
type BaseEntity = { id: string; construction?: boolean; relations?: string[]; axisConstraint?: "Horizontal" | "Vertical" };
export type SketchEntity =
  | (BaseEntity & { type: "line"; a: Point; b: Point })
  | (BaseEntity & { type: "circle"; c: Point; r: number })
  | (BaseEntity & { type: "ellipse"; c: Point; rx: number; ry: number; rotation?: number })
  | (BaseEntity & { type: "arc"; a: Point; b: Point; through: Point })
  | (BaseEntity & { type: "spline"; points: Point[]; handles?: SplineHandlePair[] });

const TAU = Math.PI * 2;
const EPSILON = 1e-6;
let trimSequence = 0;

export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const rotateVector = (point: Point, angle: number): Point => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
const ellipsePoint = (entity: Extract<SketchEntity, { type: "ellipse" }>, angle: number): Point => {
  const local = rotateVector({ x: Math.cos(angle) * entity.rx, y: Math.sin(angle) * entity.ry }, entity.rotation ?? 0);
  return { x: entity.c.x + local.x, y: entity.c.y + local.y };
};
export function sketchRelationIsSatisfied(entity: SketchEntity, relation: string): boolean {
  if (relation !== "Horizontal" && relation !== "Vertical") return true;
  if (entity.type !== "line") return false;
  return relation === "Horizontal"
    ? Math.abs(entity.a.y - entity.b.y) <= EPSILON
    : Math.abs(entity.a.x - entity.b.x) <= EPSILON;
}
export const normalizedSelectionBox = (start: Point, end: Point): SelectionBox => ({
  left: Math.min(start.x, end.x), right: Math.max(start.x, end.x),
  top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y),
});
export const pointInSelectionBox = (point: Point, box: SelectionBox): boolean => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
export const nearestGridVertex = (point: Point, spacing: number): Point => {
  const snapAxis = (value: number) => {
    const snapped = Math.round(value / spacing) * spacing;
    return Object.is(snapped, -0) ? 0 : snapped;
  };
  return { x: snapAxis(point.x), y: snapAxis(point.y) };
};
export function translateSketchEntity(entity: SketchEntity, delta: Point): SketchEntity {
  const move = (point: Point): Point => ({ x: point.x + delta.x, y: point.y + delta.y });
  if (entity.type === "line") return { ...entity, a: move(entity.a), b: move(entity.b) };
  if (entity.type === "circle" || entity.type === "ellipse") return { ...entity, c: move(entity.c) };
  if (entity.type === "arc") return { ...entity, a: move(entity.a), b: move(entity.b), through: move(entity.through) };
  return { ...entity, points: entity.points.map(move), handles: entity.handles?.map((handle) => ({ in: move(handle.in), out: move(handle.out) })) };
}
const normalizedAngle = (angle: number) => ((angle % TAU) + TAU) % TAU;
const pointAt = (center: Point, radius: number, angle: number): Point => ({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
const trimId = (source: string) => `${source}-trim-${++trimSequence}`;

export function circumcircle(a: Point, b: Point, c: Point) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 0.001) return { c: midpoint(a, b), r: distance(a, b) / 2 };
  const aa = a.x * a.x + a.y * a.y;
  const bb = b.x * b.x + b.y * b.y;
  const cc = c.x * c.x + c.y * c.y;
  const center = {
    x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d,
    y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d,
  };
  return { c: center, r: distance(center, a) };
}

function sampleArc(entity: Extract<SketchEntity, { type: "arc" }>, count = 72): Point[] {
  const circle = circumcircle(entity.a, entity.b, entity.through);
  const start = normalizedAngle(Math.atan2(entity.a.y - circle.c.y, entity.a.x - circle.c.x));
  const end = normalizedAngle(Math.atan2(entity.b.y - circle.c.y, entity.b.x - circle.c.x));
  const through = normalizedAngle(Math.atan2(entity.through.y - circle.c.y, entity.through.x - circle.c.x));
  const positiveEnd = normalizedAngle(end - start);
  const positiveThrough = normalizedAngle(through - start);
  const span = positiveThrough <= positiveEnd ? positiveEnd : -(TAU - positiveEnd);
  return Array.from({ length: count + 1 }, (_, index) => pointAt(circle.c, circle.r, start + span * index / count));
}

export function sampleSketchEntity(entity: SketchEntity): Point[] {
  if (entity.type === "line") return [entity.a, entity.b];
  if (entity.type === "circle") return Array.from({ length: 97 }, (_, index) => pointAt(entity.c, entity.r, TAU * index / 96));
  if (entity.type === "ellipse") return Array.from({ length: 97 }, (_, index) => ellipsePoint(entity, TAU * index / 96));
  if (entity.type === "arc") return sampleArc(entity);
  return sampleSplineEntity(entity);
}

export function automaticSplineHandles(points: Point[]): SplineHandlePair[] {
  const closed = points.length > 2 && distance(points[0], points.at(-1)!) < 0.001; const uniqueCount = closed ? points.length - 1 : points.length;
  return points.map((point, index) => {
    const normalizedIndex = closed && index === points.length - 1 ? 0 : index;
    const previous = closed ? points[(normalizedIndex - 1 + uniqueCount) % uniqueCount] : points[Math.max(0, index - 1)];
    const next = closed ? points[(normalizedIndex + 1) % uniqueCount] : points[Math.min(points.length - 1, index + 1)];
    const scale = 1 / 6;
    return {
      in: { x: point.x - (next.x - previous.x) * scale, y: point.y - (next.y - previous.y) * scale },
      out: { x: point.x + (next.x - previous.x) * scale, y: point.y + (next.y - previous.y) * scale },
    };
  });
}

function cubicPoint(a: Point, b: Point, c: Point, d: Point, amount: number): Point {
  const inverse = 1 - amount;
  return {
    x: inverse ** 3 * a.x + 3 * inverse ** 2 * amount * b.x + 3 * inverse * amount ** 2 * c.x + amount ** 3 * d.x,
    y: inverse ** 3 * a.y + 3 * inverse ** 2 * amount * b.y + 3 * inverse * amount ** 2 * c.y + amount ** 3 * d.y,
  };
}

const lerpPoint = (a: Point, b: Point, amount: number): Point => ({ x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount });

function nearestSplineSpan(entity: Extract<SketchEntity, { type: "spline" }>, target: Point) {
  const handles = entity.handles?.length === entity.points.length ? entity.handles : automaticSplineHandles(entity.points);
  let best = { span: 0, amount: 0, distance: Number.POSITIVE_INFINITY };
  for (let span = 0; span < entity.points.length - 1; span++) {
    for (let sample = 0; sample <= 40; sample++) {
      const amount = sample / 40;
      const candidate = cubicPoint(entity.points[span], handles[span].out, handles[span + 1].in, entity.points[span + 1], amount);
      const separation = distance(target, candidate);
      if (separation < best.distance) best = { span, amount, distance: separation };
    }
  }
  let low = Math.max(0, best.amount - 1 / 40); let high = Math.min(1, best.amount + 1 / 40);
  for (let step = 0; step < 14; step++) {
    const first = low + (high - low) / 3; const second = high - (high - low) / 3;
    const firstDistance = distance(target, cubicPoint(entity.points[best.span], handles[best.span].out, handles[best.span + 1].in, entity.points[best.span + 1], first));
    const secondDistance = distance(target, cubicPoint(entity.points[best.span], handles[best.span].out, handles[best.span + 1].in, entity.points[best.span + 1], second));
    if (firstDistance <= secondDistance) high = second; else low = first;
  }
  return { span: best.span, amount: (low + high) / 2, handles };
}

export function insertSplinePoint(entity: Extract<SketchEntity, { type: "spline" }>, target: Point): { entity: Extract<SketchEntity, { type: "spline" }>; pointIndex: number } {
  const { span, amount, handles } = nearestSplineSpan(entity, target);
  const start = entity.points[span]; const firstControl = handles[span].out; const secondControl = handles[span + 1].in; const end = entity.points[span + 1];
  const firstSplit = lerpPoint(start, firstControl, amount); const middleSplit = lerpPoint(firstControl, secondControl, amount); const lastSplit = lerpPoint(secondControl, end, amount);
  const newIncoming = lerpPoint(firstSplit, middleSplit, amount); const newOutgoing = lerpPoint(middleSplit, lastSplit, amount); const insertedPoint = lerpPoint(newIncoming, newOutgoing, amount);
  const nextHandles = handles.map((pair) => ({ in: { ...pair.in }, out: { ...pair.out } }));
  nextHandles[span].out = firstSplit; nextHandles[span + 1].in = lastSplit;
  nextHandles.splice(span + 1, 0, { in: newIncoming, out: newOutgoing });
  const points = [...entity.points]; points.splice(span + 1, 0, insertedPoint);
  return { entity: { ...entity, points, handles: nextHandles }, pointIndex: span + 1 };
}

export function deleteSplinePoint(entity: Extract<SketchEntity, { type: "spline" }>, pointIndex: number): Extract<SketchEntity, { type: "spline" }> | null {
  const closed = entity.points.length > 2 && distance(entity.points[0], entity.points.at(-1)!) < 0.001;
  if (!closed) {
    if (entity.points.length <= 2 || pointIndex < 0 || pointIndex >= entity.points.length) return null;
    return { ...entity, points: entity.points.filter((_, index) => index !== pointIndex), handles: entity.handles?.filter((_, index) => index !== pointIndex) };
  }
  const uniqueCount = entity.points.length - 1; const normalizedIndex = pointIndex === uniqueCount ? 0 : pointIndex;
  if (uniqueCount <= 3 || normalizedIndex < 0 || normalizedIndex >= uniqueCount) return null;
  const uniquePoints = entity.points.slice(0, -1).filter((_, index) => index !== normalizedIndex);
  const points = [...uniquePoints, { ...uniquePoints[0] }];
  if (entity.handles?.length !== entity.points.length) return { ...entity, points, handles: undefined };
  const uniqueHandles = entity.handles.slice(0, -1).filter((_, index) => index !== normalizedIndex).map((pair) => ({ in: { ...pair.in }, out: { ...pair.out } }));
  return { ...entity, points, handles: [...uniqueHandles, { in: { ...uniqueHandles[0].in }, out: { ...uniqueHandles[0].out } }] };
}

export function sampleSplineEntity(entity: Extract<SketchEntity, { type: "spline" }>, samplesPerSpan = 16): Point[] {
  if (entity.points.length < 2) return entity.points;
  const handles = entity.handles?.length === entity.points.length ? entity.handles : automaticSplineHandles(entity.points);
  return entity.points.slice(0, -1).flatMap((point, index) => Array.from({ length: samplesPerSpan }, (_, sample) => cubicPoint(point, handles[index].out, handles[index + 1].in, entity.points[index + 1], sample / samplesPerSpan))).concat(entity.points.at(-1)!);
}

function lineIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denominator) < EPSILON) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function entityInSelectionBox(entity: SketchEntity, start: Point, end: Point): boolean {
  const box = normalizedSelectionBox(start, end);
  const points = sampleSketchEntity(entity);
  if (!points.length) return false;
  // CAD convention: left-to-right selects fully enclosed geometry, while a
  // right-to-left box also selects geometry crossed by the box boundary.
  if (end.x >= start.x) return points.every((point) => pointInSelectionBox(point, box));
  if (points.some((point) => pointInSelectionBox(point, box))) return true;
  const corners = [
    { x: box.left, y: box.top }, { x: box.right, y: box.top },
    { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom },
  ];
  return points.slice(1).some((point, index) => corners.some((corner, cornerIndex) => lineIntersection(points[index], point, corner, corners[(cornerIndex + 1) % corners.length])));
}

function lineCircleIntersections(a: Point, b: Point, center: Point, radius: number): Point[] {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const fx = a.x - center.x; const fy = a.y - center.y;
  const aa = dx * dx + dy * dy;
  if (aa < EPSILON) return [];
  const bb = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - radius * radius;
  const discriminant = bb * bb - 4 * aa * cc;
  if (discriminant < -EPSILON) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return [(-bb - root) / (2 * aa), (-bb + root) / (2 * aa)]
    .filter((t, index, values) => t >= -EPSILON && t <= 1 + EPSILON && (index === 0 || Math.abs(t - values[0]) > EPSILON))
    .map((t) => ({ x: a.x + dx * t, y: a.y + dy * t }));
}

function lineEllipseIntersections(a: Point, b: Point, center: Point, rx: number, ry: number): Point[] {
  const ax = (a.x - center.x) / rx; const ay = (a.y - center.y) / ry;
  const dx = (b.x - a.x) / rx; const dy = (b.y - a.y) / ry;
  const aa = dx * dx + dy * dy;
  if (aa < EPSILON) return [];
  const bb = 2 * (ax * dx + ay * dy); const cc = ax * ax + ay * ay - 1;
  const discriminant = bb * bb - 4 * aa * cc;
  if (discriminant < -EPSILON) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return [(-bb - root) / (2 * aa), (-bb + root) / (2 * aa)]
    .filter((t, index, values) => t >= -EPSILON && t <= 1 + EPSILON && (index === 0 || Math.abs(t - values[0]) > EPSILON))
    .map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
}

function lineRotatedEllipseIntersections(a: Point, b: Point, ellipse: Extract<SketchEntity, { type: "ellipse" }>): Point[] {
  const angle = -(ellipse.rotation ?? 0);
  const toLocal = (point: Point) => rotateVector({ x: point.x - ellipse.c.x, y: point.y - ellipse.c.y }, angle);
  const localA = toLocal(a); const localB = toLocal(b);
  return lineEllipseIntersections(localA, localB, { x: 0, y: 0 }, ellipse.rx, ellipse.ry).map((point) => {
    const world = rotateVector(point, -angle);
    return { x: world.x + ellipse.c.x, y: world.y + ellipse.c.y };
  });
}

function uniquePoints(points: Point[], tolerance = 0.04): Point[] {
  return points.filter((point, index) => points.findIndex((candidate) => distance(point, candidate) < tolerance) === index);
}

function intersectionsWithCircle(circle: Extract<SketchEntity, { type: "circle" }>, other: SketchEntity): Point[] {
  if (other.type === "line") return lineCircleIntersections(other.a, other.b, circle.c, circle.r);
  const samples = sampleSketchEntity(other);
  return uniquePoints(samples.slice(1).flatMap((point, index) => lineCircleIntersections(samples[index], point, circle.c, circle.r)));
}

function closestPointOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x; const dy = b.y - a.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return a;
  const amount = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return { x: a.x + dx * amount, y: a.y + dy * amount };
}

function raySegmentIntersection(origin: Point, direction: Point, a: Point, b: Point): { point: Point; distance: number } | null {
  const sx = b.x - a.x; const sy = b.y - a.y;
  const denominator = direction.x * sy - direction.y * sx;
  if (Math.abs(denominator) < EPSILON) return null;
  const ax = a.x - origin.x; const ay = a.y - origin.y;
  const amount = (ax * sy - ay * sx) / denominator;
  const segmentAmount = (ax * direction.y - ay * direction.x) / denominator;
  if (amount <= 1e-5 || segmentAmount < -EPSILON || segmentAmount > 1 + EPSILON) return null;
  return { point: { x: origin.x + direction.x * amount, y: origin.y + direction.y * amount }, distance: amount * Math.hypot(direction.x, direction.y) };
}

export function extendEntityToTarget(source: SketchEntity, sourceClick: Point, target: SketchEntity): SketchEntity | null {
  if (source.id === target.id) return null;
  const targetPoints = sampleSketchEntity(target);
  if (targetPoints.length < 2) return null;
  if (source.type === "line") {
    const extendA = distance(sourceClick, source.a) <= distance(sourceClick, source.b);
    const origin = extendA ? source.a : source.b; const fixed = extendA ? source.b : source.a;
    const direction = { x: origin.x - fixed.x, y: origin.y - fixed.y };
    const intersections = targetPoints.slice(1).map((point, index) => raySegmentIntersection(origin, direction, targetPoints[index], point)).filter((candidate): candidate is { point: Point; distance: number } => candidate !== null).sort((first, second) => first.distance - second.distance);
    if (!intersections.length) return null;
    return extendA ? { ...source, a: intersections[0].point } : { ...source, b: intersections[0].point };
  }
  if (source.type === "arc") {
    const circle = circumcircle(source.a, source.b, source.through);
    const samples = sampleArc(source, 32); const extendA = distance(sourceClick, source.a) <= distance(sourceClick, source.b);
    const current = extendA ? source.a : source.b;
    const tangentNeighbor = extendA ? samples[1] : samples.at(-2)!;
    const cross = (current.x - circle.c.x) * (tangentNeighbor.y - current.y) - (current.y - circle.c.y) * (tangentNeighbor.x - current.x);
    const direction = -Math.sign(cross || 1);
    const currentAngle = normalizedAngle(Math.atan2(current.y - circle.c.y, current.x - circle.c.x));
    const candidates = uniquePoints(targetPoints.slice(1).flatMap((point, index) => lineCircleIntersections(targetPoints[index], point, circle.c, circle.r)))
      .map((point) => { const angle = normalizedAngle(Math.atan2(point.y - circle.c.y, point.x - circle.c.x)); const amount = direction > 0 ? normalizedAngle(angle - currentAngle) : normalizedAngle(currentAngle - angle); return { point, amount }; })
      .filter((candidate) => candidate.amount > 1e-5 && candidate.amount < TAU - 1e-5)
      .sort((first, second) => first.amount - second.amount);
    if (!candidates.length) return null;
    return extendA ? { ...source, a: candidates[0].point } : { ...source, b: candidates[0].point };
  }
  if (source.type === "circle") {
    let mate: Point;
    if (target.type === "line") mate = closestPointOnSegment(source.c, target.a, target.b);
    else mate = targetPoints.reduce((closest, point) => distance(source.c, point) < distance(source.c, closest) ? point : closest, targetPoints[0]);
    const radius = distance(source.c, mate);
    return radius > 1e-5 ? { ...source, r: radius } : null;
  }
  return null;
}

function lineParameter(line: Extract<SketchEntity, { type: "line" }>, point: Point) {
  const dx = line.b.x - line.a.x; const dy = line.b.y - line.a.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return 0;
  return ((point.x - line.a.x) * dx + (point.y - line.a.y) * dy) / lengthSquared;
}

function infiniteLineIntersection(first: Extract<SketchEntity, { type: "line" }>, second: Extract<SketchEntity, { type: "line" }>): Point | null {
  const denominator = (first.b.x - first.a.x) * (second.b.y - second.a.y) - (first.b.y - first.a.y) * (second.b.x - second.a.x);
  if (Math.abs(denominator) < EPSILON) return null;
  const amount = ((second.a.x - first.a.x) * (second.b.y - second.a.y) - (second.a.y - first.a.y) * (second.b.x - second.a.x)) / denominator;
  return { x: first.a.x + (first.b.x - first.a.x) * amount, y: first.a.y + (first.b.y - first.a.y) * amount };
}

function lineToCorner(line: Extract<SketchEntity, { type: "line" }>, click: Point, corner: Point): Extract<SketchEntity, { type: "line" }> {
  const cornerParameter = lineParameter(line, corner);
  const clickParameter = lineParameter(line, click);
  return clickParameter <= cornerParameter
    ? { ...line, b: corner, relations: [...new Set([...(line.relations ?? []), "Corner"])] }
    : { ...line, a: corner, relations: [...new Set([...(line.relations ?? []), "Corner"])] };
}

export function cornerLines(
  first: Extract<SketchEntity, { type: "line" }>,
  firstClick: Point,
  second: Extract<SketchEntity, { type: "line" }>,
  secondClick: Point,
): [Extract<SketchEntity, { type: "line" }>, Extract<SketchEntity, { type: "line" }>] | null {
  if (first.id === second.id) return null;
  const corner = infiniteLineIntersection(first, second);
  if (!corner) return null;
  const nextFirst = lineToCorner(first, firstClick, corner);
  const nextSecond = lineToCorner(second, secondClick, corner);
  if (distance(nextFirst.a, nextFirst.b) < EPSILON || distance(nextSecond.a, nextSecond.b) < EPSILON) return null;
  return [nextFirst, nextSecond];
}

export function perpendicularLineToReference(
  reference: Extract<SketchEntity, { type: "line" }>,
  target: Extract<SketchEntity, { type: "line" }>,
  targetClick: Point,
): Extract<SketchEntity, { type: "line" }> | null {
  if (reference.id === target.id) return null;
  const referenceLength = distance(reference.a, reference.b);
  const targetLength = distance(target.a, target.b);
  if (referenceLength < EPSILON || targetLength < EPSILON) return null;
  const keepA = distance(targetClick, target.a) <= distance(targetClick, target.b);
  const pivot = keepA ? target.a : target.b;
  const moving = keepA ? target.b : target.a;
  const ux = (reference.b.x - reference.a.x) / referenceLength;
  const uy = (reference.b.y - reference.a.y) / referenceLength;
  const candidates = [
    { x: pivot.x - uy * targetLength, y: pivot.y + ux * targetLength },
    { x: pivot.x + uy * targetLength, y: pivot.y - ux * targetLength },
  ];
  const nextMoving = distance(candidates[0], moving) <= distance(candidates[1], moving) ? candidates[0] : candidates[1];
  const relations = [...new Set([...(target.relations ?? []), "Perpendicular"])];
  return keepA ? { ...target, b: nextMoving, relations } : { ...target, a: nextMoving, relations };
}

function intersectionsWithEllipse(ellipse: Extract<SketchEntity, { type: "ellipse" }>, other: SketchEntity): Point[] {
  if (other.type === "line") return lineRotatedEllipseIntersections(other.a, other.b, ellipse);
  const samples = sampleSketchEntity(other);
  return uniquePoints(samples.slice(1).flatMap((point, index) => lineRotatedEllipseIntersections(samples[index], point, ellipse)));
}

function intersectionsWithLine(line: Extract<SketchEntity, { type: "line" }>, other: SketchEntity): Point[] {
  if (other.type === "circle") return lineCircleIntersections(line.a, line.b, other.c, other.r);
  const samples = sampleSketchEntity(other);
  return uniquePoints(samples.slice(1).map((point, index) => lineIntersection(line.a, line.b, samples[index], point)).filter((point): point is Point => point !== null));
}

function trimCircle(target: Extract<SketchEntity, { type: "circle" }>, click: Point, others: SketchEntity[]): SketchEntity[] {
  const intersections = uniquePoints(others.flatMap((entity) => intersectionsWithCircle(target, entity)))
    .map((point) => normalizedAngle(Math.atan2(point.y - target.c.y, point.x - target.c.x)))
    .sort((a, b) => a - b);
  if (intersections.length < 2) return [];
  const clickAngle = normalizedAngle(Math.atan2(click.y - target.c.y, click.x - target.c.x));
  const intervals = intersections.map((start, index) => ({ start, end: index === intersections.length - 1 ? intersections[0] + TAU : intersections[index + 1] }));
  const removed = intervals.findIndex(({ start, end }) => {
    const adjusted = clickAngle < start ? clickAngle + TAU : clickAngle;
    return adjusted >= start - EPSILON && adjusted <= end + EPSILON;
  });
  return intervals.filter((_, index) => index !== removed).map(({ start, end }) => ({
    id: trimId(target.id), type: "arc" as const, construction: target.construction,
    a: pointAt(target.c, target.r, start), b: pointAt(target.c, target.r, end), through: pointAt(target.c, target.r, (start + end) / 2), relations: ["Trimmed"],
  }));
}

function trimEllipse(target: Extract<SketchEntity, { type: "ellipse" }>, click: Point, others: SketchEntity[]): SketchEntity[] {
  const toLocal = (point: Point) => rotateVector({ x: point.x - target.c.x, y: point.y - target.c.y }, -(target.rotation ?? 0));
  const intersections = uniquePoints(others.flatMap((entity) => intersectionsWithEllipse(target, entity)))
    .map((point) => { const local = toLocal(point); return normalizedAngle(Math.atan2(local.y / target.ry, local.x / target.rx)); })
    .sort((a, b) => a - b);
  if (intersections.length < 2) return [target];
  const localClick = toLocal(click); const clickAngle = normalizedAngle(Math.atan2(localClick.y / target.ry, localClick.x / target.rx));
  const intervals = intersections.map((start, index) => ({ start, end: index === intersections.length - 1 ? intersections[0] + TAU : intersections[index + 1] }));
  const removed = intervals.findIndex(({ start, end }) => {
    const adjusted = clickAngle < start ? clickAngle + TAU : clickAngle;
    return adjusted >= start - EPSILON && adjusted <= end + EPSILON;
  });
  return intervals.filter((_, index) => index !== removed).map(({ start, end }) => {
    const count = Math.max(8, Math.ceil((end - start) / TAU * 96));
    const points = Array.from({ length: count + 1 }, (_, index) => {
      const angle = start + (end - start) * index / count;
       return ellipsePoint(target, angle);
    });
    return { id: trimId(target.id), type: "spline" as const, construction: target.construction, points, relations: ["Trimmed"] };
  });
}

export type MirrorLink = { axisEntityId: string; pairs: { sourceId: string; mirroredId: string }[] };

export function reflectPointAcrossLine(point: Point, axis: Extract<SketchEntity, { type: "line" }>): Point {
  const dx = axis.b.x - axis.a.x; const dy = axis.b.y - axis.a.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return { ...point };
  const amount = ((point.x - axis.a.x) * dx + (point.y - axis.a.y) * dy) / lengthSquared;
  const projection = { x: axis.a.x + amount * dx, y: axis.a.y + amount * dy };
  return { x: projection.x * 2 - point.x, y: projection.y * 2 - point.y };
}

export function mirrorSketchEntity(entity: SketchEntity, axis: Extract<SketchEntity, { type: "line" }>, id: string): SketchEntity {
  const reflect = (point: Point) => reflectPointAcrossLine(point, axis);
  const base = { id, construction: entity.construction, relations: entity.relations?.filter((relation) => relation !== "Horizontal" && relation !== "Vertical"), axisConstraint: undefined };
  if (entity.type === "line") return { ...base, type: "line", a: reflect(entity.a), b: reflect(entity.b) };
  if (entity.type === "circle") return { ...base, type: "circle", c: reflect(entity.c), r: entity.r };
  if (entity.type === "ellipse") {
    const center = reflect(entity.c); const major = reflect(ellipsePoint(entity, 0));
    return { ...base, type: "ellipse", c: center, rx: entity.rx, ry: entity.ry, rotation: Math.atan2(major.y - center.y, major.x - center.x) };
  }
  if (entity.type === "arc") return { ...base, type: "arc", a: reflect(entity.a), b: reflect(entity.b), through: reflect(entity.through) };
  return { ...base, type: "spline", points: entity.points.map(reflect), handles: entity.handles?.map((handle) => ({ in: reflect(handle.in), out: reflect(handle.out) })) };
}

function geometryOnto(target: SketchEntity, reflected: SketchEntity): SketchEntity {
  if (target.type !== reflected.type) return reflected;
  if (target.type === "line" && reflected.type === "line") return { ...target, a: reflected.a, b: reflected.b };
  if (target.type === "circle" && reflected.type === "circle") return { ...target, c: reflected.c, r: reflected.r };
  if (target.type === "ellipse" && reflected.type === "ellipse") return { ...target, c: reflected.c, rx: reflected.rx, ry: reflected.ry, rotation: reflected.rotation };
  if (target.type === "arc" && reflected.type === "arc") return { ...target, a: reflected.a, b: reflected.b, through: reflected.through };
  if (target.type === "spline" && reflected.type === "spline") return { ...target, points: reflected.points, handles: reflected.handles };
  return reflected;
}

export function synchronizeMirrorLinks(entities: SketchEntity[], links: MirrorLink[], changedEntityIds: Set<string>): SketchEntity[] {
  let next = entities;
  for (const link of links) {
    const axis = next.find((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.id === link.axisEntityId && entity.type === "line");
    if (!axis) continue;
    for (const pair of link.pairs) {
      const source = next.find((entity) => entity.id === pair.sourceId); const mirrored = next.find((entity) => entity.id === pair.mirroredId);
      if (!source || !mirrored) continue;
      const mirrorDrives = changedEntityIds.has(pair.mirroredId) && !changedEntityIds.has(pair.sourceId) && !changedEntityIds.has(link.axisEntityId);
      const driver = mirrorDrives ? mirrored : source; const target = mirrorDrives ? source : mirrored;
      const reflected = mirrorSketchEntity(driver, axis, target.id); const replacement = geometryOnto(target, reflected);
      next = next.map((entity) => entity.id === target.id ? replacement : entity);
    }
  }
  return next;
}

export function entityBadgePoint(entity: SketchEntity): Point {
  if (entity.type === "line") return midpoint(entity.a, entity.b);
  if (entity.type === "circle" || entity.type === "ellipse") return entity.c;
  if (entity.type === "arc") return entity.through;
  return entity.points[Math.floor(entity.points.length / 2)] ?? { x: 0, y: 0 };
}

function trimLine(target: Extract<SketchEntity, { type: "line" }>, click: Point, others: SketchEntity[]): SketchEntity[] {
  const dx = target.b.x - target.a.x; const dy = target.b.y - target.a.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return [];
  const parameter = (point: Point) => ((point.x - target.a.x) * dx + (point.y - target.a.y) * dy) / lengthSquared;
  const cuts = uniquePoints(others.flatMap((entity) => intersectionsWithLine(target, entity)))
    .map(parameter).filter((value) => value > EPSILON && value < 1 - EPSILON).sort((a, b) => a - b);
  if (!cuts.length) return [];
  const bounds = [0, ...cuts, 1];
  const clicked = Math.max(0, Math.min(1, parameter(click)));
  const removed = Math.min(bounds.length - 2, bounds.findIndex((value, index) => index < bounds.length - 1 && clicked >= value - EPSILON && clicked <= bounds[index + 1] + EPSILON));
  return bounds.slice(0, -1).flatMap((start, index) => index === removed ? [] : [{
    id: trimId(target.id), type: "line" as const, construction: target.construction,
    a: { x: target.a.x + dx * start, y: target.a.y + dy * start },
    b: { x: target.a.x + dx * bounds[index + 1], y: target.a.y + dy * bounds[index + 1] }, relations: ["Trimmed"],
  }]);
}

export function trimEntityAtPoint(target: SketchEntity, click: Point, entities: SketchEntity[]): SketchEntity[] {
  const others = entities.filter((entity) => entity.id !== target.id);
  if (target.type === "circle") return trimCircle(target, click, others);
  if (target.type === "ellipse") return trimEllipse(target, click, others);
  if (target.type === "line") return trimLine(target, click, others);
  return [target];
}
