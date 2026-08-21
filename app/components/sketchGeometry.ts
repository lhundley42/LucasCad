export type Point = { x: number; y: number };
export type SelectionBox = { left: number; right: number; top: number; bottom: number };
type BaseEntity = { id: string; construction?: boolean; relations?: string[] };
export type SketchEntity =
  | (BaseEntity & { type: "line"; a: Point; b: Point })
  | (BaseEntity & { type: "circle"; c: Point; r: number })
  | (BaseEntity & { type: "ellipse"; c: Point; rx: number; ry: number })
  | (BaseEntity & { type: "arc"; a: Point; b: Point; through: Point })
  | (BaseEntity & { type: "spline"; points: Point[] });

const TAU = Math.PI * 2;
const EPSILON = 1e-6;
let trimSequence = 0;

export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
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
  return { ...entity, points: entity.points.map(move) };
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
  if (entity.type === "ellipse") return Array.from({ length: 97 }, (_, index) => ({ x: entity.c.x + Math.cos(TAU * index / 96) * entity.rx, y: entity.c.y + Math.sin(TAU * index / 96) * entity.ry }));
  if (entity.type === "arc") return sampleArc(entity);
  return entity.points;
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

function uniquePoints(points: Point[], tolerance = 0.04): Point[] {
  return points.filter((point, index) => points.findIndex((candidate) => distance(point, candidate) < tolerance) === index);
}

function intersectionsWithCircle(circle: Extract<SketchEntity, { type: "circle" }>, other: SketchEntity): Point[] {
  if (other.type === "line") return lineCircleIntersections(other.a, other.b, circle.c, circle.r);
  const samples = sampleSketchEntity(other);
  return uniquePoints(samples.slice(1).flatMap((point, index) => lineCircleIntersections(samples[index], point, circle.c, circle.r)));
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
  if (target.type === "line") return trimLine(target, click, others);
  return [];
}
