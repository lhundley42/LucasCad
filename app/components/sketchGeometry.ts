import type { CircularPatternConstraint, LinearPatternConstraint, PatternCenterReference, PatternDirectionReference } from "./sketchConstraints.ts";

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
export type SketchCheckEndpoint = { point: Point; entityIds: string[] };
export type SketchCheckResult = {
  viable: boolean;
  openEndpoints: SketchCheckEndpoint[];
  affectedEntityIds: string[];
  removalEntityIds: string[];
  isolatedEntityIds: string[];
};

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

/**
 * Visible sketch geometry takes precedence over the background grid whenever
 * it is inside the snap aperture. This keeps a nearby grid vertex from stealing
 * an endpoint drop that the cursor is clearly indicating.
 */
export function preferredSketchSnap<T extends { point: Point }>(raw: Point, geometryCandidates: T[], snapTolerance: number, gridFallback: T, project: (point: Point) => Point = (point) => point): T {
  let best: T | null = null;
  let bestDistance = snapTolerance;
  for (const candidate of geometryCandidates) {
    const candidateDistance = distance(project(raw), project(candidate.point));
    if (candidateDistance <= bestDistance) { best = candidate; bestDistance = candidateDistance; }
  }
  return best ?? gridFallback;
}

/**
 * Finds the same unpaired sketch endpoints that prevent the modeling kernel
 * from creating a wire. The repair set is the graph's non-cyclic fringe: it
 * trims dangling branches but preserves every closed contour core.
 */
export function analyzeSketchContours(entities: SketchEntity[], tolerance = 0.05): SketchCheckResult {
  type OpenEntity = { entity: SketchEntity; points: [Point, Point]; nodes: [number, number] };
  type EndpointGroup = { point: Point; samples: Point[]; entityIds: string[] };

  const drawable = entities.filter((entity) => !entity.construction);
  const candidates = drawable.flatMap((entity): { entity: SketchEntity; points: [Point, Point] }[] => {
    if (entity.type === "line" || entity.type === "arc") return [{ entity, points: [entity.a, entity.b] }];
    if (entity.type === "spline" && entity.points.length > 1 && distance(entity.points[0], entity.points.at(-1)!) >= tolerance) {
      return [{ entity, points: [entity.points[0], entity.points.at(-1)!] }];
    }
    return [];
  });
  const groups: EndpointGroup[] = [];
  const groupFor = (point: Point, entityId: string) => {
    const index = groups.findIndex((group) => Math.abs(group.point.x - point.x) < tolerance && Math.abs(group.point.y - point.y) < tolerance);
    if (index < 0) {
      groups.push({ point: { ...point }, samples: [{ ...point }], entityIds: [entityId] });
      return groups.length - 1;
    }
    const group = groups[index];
    group.samples.push({ ...point });
    if (!group.entityIds.includes(entityId)) group.entityIds.push(entityId);
    group.point = {
      x: group.samples.reduce((sum, sample) => sum + sample.x, 0) / group.samples.length,
      y: group.samples.reduce((sum, sample) => sum + sample.y, 0) / group.samples.length,
    };
    return index;
  };
  const openEntities: OpenEntity[] = candidates.map(({ entity, points }) => ({
    entity,
    points,
    nodes: [groupFor(points[0], entity.id), groupFor(points[1], entity.id)],
  }));
  const active = new Set(openEntities.map((_, index) => index));
  const removalEntityIds = new Set<string>();

  // Repeated leaf removal isolates the dangling fringe (the graph outside its
  // 2-core). A fully open component naturally disappears in this pass.
  while (active.size) {
    const degrees = Array(groups.length).fill(0) as number[];
    active.forEach((edgeIndex) => {
      const [first, second] = openEntities[edgeIndex].nodes;
      degrees[first] += 1; degrees[second] += 1;
    });
    const leaves = [...active].filter((edgeIndex) => {
      const [first, second] = openEntities[edgeIndex].nodes;
      return degrees[first] <= 1 || degrees[second] <= 1;
    });
    if (!leaves.length) break;
    leaves.forEach((edgeIndex) => { active.delete(edgeIndex); removalEntityIds.add(openEntities[edgeIndex].entity.id); });
  }

  const degree = Array(groups.length).fill(0) as number[];
  openEntities.forEach(({ nodes }) => { degree[nodes[0]] += 1; degree[nodes[1]] += 1; });
  const openEndpoints = groups
    .map((group, index) => ({ group, degree: degree[index] }))
    .filter(({ degree: endpointDegree }) => endpointDegree % 2 === 1)
    .map(({ group }) => ({ point: group.point, entityIds: group.entityIds }));
  const affectedEntityIds = new Set(openEndpoints.flatMap((endpoint) => endpoint.entityIds));
  removalEntityIds.forEach((entityId) => affectedEntityIds.add(entityId));
  const edgesAtNode = groups.map(() => [] as number[]);
  openEntities.forEach(({ nodes }, edgeIndex) => nodes.forEach((node) => edgesAtNode[node].push(edgeIndex)));
  const isolatedEntityIds = new Set<string>(); const visited = new Set<number>();
  openEntities.forEach((_, startIndex) => {
    if (visited.has(startIndex)) return;
    const component: number[] = []; const queue = [startIndex]; visited.add(startIndex);
    while (queue.length) {
      const edgeIndex = queue.shift()!; component.push(edgeIndex);
      openEntities[edgeIndex].nodes.flatMap((node) => edgesAtNode[node]).forEach((neighbor) => {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      });
    }
    if (!component.some((edgeIndex) => active.has(edgeIndex))) component.forEach((edgeIndex) => isolatedEntityIds.add(openEntities[edgeIndex].entity.id));
  });
  const hasClosedPrimitive = drawable.some((entity) => entity.type === "circle" || entity.type === "ellipse" || entity.type === "spline" && entity.points.length > 2 && distance(entity.points[0], entity.points.at(-1)!) < tolerance);
  const hasClosedWire = active.size > 0;

  return {
    viable: drawable.length > 0 && openEndpoints.length === 0 && (hasClosedPrimitive || hasClosedWire),
    openEndpoints,
    affectedEntityIds: [...affectedEntityIds],
    removalEntityIds: [...removalEntityIds],
    isolatedEntityIds: [...isolatedEntityIds],
  };
}
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

function segmentIntersection(a: Point, b: Point, c: Point, d: Point): { point: Point; firstAmount: number; secondAmount: number } | null {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denominator) < EPSILON) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, firstAmount: t, secondAmount: u };
}

function lineIntersection(a: Point, b: Point, c: Point, d: Point): Point | null { return segmentIntersection(a, b, c, d)?.point ?? null; }

export function entityInSelectionBox(entity: SketchEntity, start: Point, end: Point, project: (point: Point) => Point = (point) => point): boolean {
  start = project(start); end = project(end);
  const box = normalizedSelectionBox(start, end);
  const points = sampleSketchEntity(entity).map(project);
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

export type SketchFilletResult = {
  first: Extract<SketchEntity, { type: "line" }>;
  second: Extract<SketchEntity, { type: "line" }>;
  arc: Extract<SketchEntity, { type: "arc" }>;
};

/**
 * Creates a tangent, constant-radius sketch fillet between the two line rays
 * selected by the user. The clicked side of each line is preserved, matching
 * the side-selection behavior of the Corner tool.
 */
export function filletLines(
  first: Extract<SketchEntity, { type: "line" }>,
  firstClick: Point,
  second: Extract<SketchEntity, { type: "line" }>,
  secondClick: Point,
  radius: number,
  arcId: string,
): SketchFilletResult | null {
  if (first.id === second.id || !(radius > EPSILON)) return null;
  const corner = infiniteLineIntersection(first, second);
  if (!corner) return null;
  const ray = (click: Point, line: Extract<SketchEntity, { type: "line" }>) => {
    let dx = click.x - corner.x; let dy = click.y - corner.y;
    if (Math.hypot(dx, dy) < EPSILON) {
      const aDistance = distance(line.a, corner); const bDistance = distance(line.b, corner);
      const far = aDistance >= bDistance ? line.a : line.b; dx = far.x - corner.x; dy = far.y - corner.y;
    }
    const length = Math.hypot(dx, dy);
    return length > EPSILON ? { x: dx / length, y: dy / length } : null;
  };
  const firstRay = ray(firstClick, first); const secondRay = ray(secondClick, second);
  if (!firstRay || !secondRay) return null;
  const dot = Math.max(-1, Math.min(1, firstRay.x * secondRay.x + firstRay.y * secondRay.y));
  const angle = Math.acos(dot);
  if (angle < 1e-4 || Math.PI - angle < 1e-4) return null;
  const tangentDistance = radius / Math.tan(angle / 2);
  const centerDistance = radius / Math.sin(angle / 2);
  const bisector = { x: firstRay.x + secondRay.x, y: firstRay.y + secondRay.y };
  const bisectorLength = Math.hypot(bisector.x, bisector.y);
  if (bisectorLength < EPSILON || !Number.isFinite(tangentDistance) || !Number.isFinite(centerDistance)) return null;
  const firstTangent = { x: corner.x + firstRay.x * tangentDistance, y: corner.y + firstRay.y * tangentDistance };
  const secondTangent = { x: corner.x + secondRay.x * tangentDistance, y: corner.y + secondRay.y * tangentDistance };
  const center = { x: corner.x + bisector.x / bisectorLength * centerDistance, y: corner.y + bisector.y / bisectorLength * centerDistance };
  const towardCorner = { x: corner.x - center.x, y: corner.y - center.y };
  const towardCornerLength = Math.max(Math.hypot(towardCorner.x, towardCorner.y), EPSILON);
  const through = { x: center.x + towardCorner.x / towardCornerLength * radius, y: center.y + towardCorner.y / towardCornerLength * radius };
  const trimTo = (line: Extract<SketchEntity, { type: "line" }>, direction: Point, tangent: Point) => {
    const aAmount = (line.a.x - corner.x) * direction.x + (line.a.y - corner.y) * direction.y;
    const bAmount = (line.b.x - corner.x) * direction.x + (line.b.y - corner.y) * direction.y;
    const relations = [...new Set([...(line.relations ?? []).filter((relation) => relation !== "Corner"), "Tangent"])] as string[];
    return aAmount >= bAmount ? { ...line, b: tangent, relations } : { ...line, a: tangent, relations };
  };
  const nextFirst = trimTo(first, firstRay, firstTangent);
  const nextSecond = trimTo(second, secondRay, secondTangent);
  if (distance(nextFirst.a, nextFirst.b) < EPSILON || distance(nextSecond.a, nextSecond.b) < EPSILON) return null;
  return {
    first: nextFirst,
    second: nextSecond,
    arc: { id: arcId, type: "arc", a: firstTangent, b: secondTangent, through, relations: ["Tangent", "Fillet"] },
  };
}

function signedDistanceToInfiniteLine(point: Point, line: Extract<SketchEntity, { type: "line" }>) {
  const dx = line.b.x - line.a.x; const dy = line.b.y - line.a.y; const length = Math.hypot(dx, dy);
  return length < EPSILON ? Number.POSITIVE_INFINITY : (dx * (point.y - line.a.y) - dy * (point.x - line.a.x)) / length;
}

function splineLineIntersections(spline: Extract<SketchEntity, { type: "spline" }>, line: Extract<SketchEntity, { type: "line" }>) {
  const handles = spline.handles?.length === spline.points.length ? spline.handles : automaticSplineHandles(spline.points);
  const results: { point: Point; parameter: number }[] = []; const samples = 64;
  for (let span = 0; span < spline.points.length - 1; span++) {
    const pointAtAmount = (amount: number) => cubicPoint(spline.points[span], handles[span].out, handles[span + 1].in, spline.points[span + 1], amount);
    let previousAmount = 0; let previousPoint = pointAtAmount(0); let previousDistance = signedDistanceToInfiniteLine(previousPoint, line);
    if (Math.abs(previousDistance) < 1e-5) results.push({ point: previousPoint, parameter: span });
    for (let sample = 1; sample <= samples; sample++) {
      const amount = sample / samples; const point = pointAtAmount(amount); const lineDistance = signedDistanceToInfiniteLine(point, line);
      if (Math.abs(lineDistance) < 1e-5) results.push({ point, parameter: span + amount });
      else if (previousDistance * lineDistance < 0) {
        let low = previousAmount; let high = amount; let lowDistance = previousDistance;
        for (let iteration = 0; iteration < 22; iteration++) {
          const middle = (low + high) / 2; const middleDistance = signedDistanceToInfiniteLine(pointAtAmount(middle), line);
          if (lowDistance * middleDistance <= 0) high = middle; else { low = middle; lowDistance = middleDistance; }
        }
        const root = (low + high) / 2; results.push({ point: pointAtAmount(root), parameter: span + root });
      }
      previousAmount = amount; previousPoint = point; previousDistance = lineDistance;
    }
  }
  return results.filter((result, index) => results.findIndex((candidate) => Math.abs(candidate.parameter - result.parameter) < 1e-4) === index);
}

function rayInfiniteLineIntersection(origin: Point, direction: Point, line: Extract<SketchEntity, { type: "line" }>) {
  const lx = line.b.x - line.a.x; const ly = line.b.y - line.a.y; const denominator = direction.x * ly - direction.y * lx;
  if (Math.abs(denominator) < EPSILON) return null;
  const ox = line.a.x - origin.x; const oy = line.a.y - origin.y; const amount = (ox * ly - oy * lx) / denominator;
  if (amount <= 1e-5) return null;
  return { point: { x: origin.x + direction.x * amount, y: origin.y + direction.y * amount }, distance: amount * Math.hypot(direction.x, direction.y) };
}

function extendSplineEndToCorner(spline: Extract<SketchEntity, { type: "spline" }>, end: "start" | "end", corner: Point): Extract<SketchEntity, { type: "spline" }> {
  const points = spline.points.map((point) => ({ ...point }));
  const handles = (spline.handles?.length === spline.points.length ? spline.handles : automaticSplineHandles(spline.points)).map((pair) => ({ in: { ...pair.in }, out: { ...pair.out } }));
  if (end === "start") {
    const former = points[0]; const cornerHandle = lerpPoint(corner, former, 1 / 3); handles[0].in = lerpPoint(corner, former, 2 / 3);
    points.unshift({ ...corner }); handles.unshift({ in: { ...corner }, out: cornerHandle });
  } else {
    const former = points.at(-1)!; handles[handles.length - 1].out = lerpPoint(former, corner, 1 / 3);
    points.push({ ...corner }); handles.push({ in: lerpPoint(former, corner, 2 / 3), out: { ...corner } });
  }
  return { ...spline, points, handles, relations: [...new Set([...(spline.relations ?? []), "Corner"])] };
}

function cornerSplineAndLine(
  spline: Extract<SketchEntity, { type: "spline" }>, splineClick: Point,
  line: Extract<SketchEntity, { type: "line" }>, lineClick: Point,
): [Extract<SketchEntity, { type: "spline" }>, Extract<SketchEntity, { type: "line" }>] | null {
  if (spline.points.length < 2 || distance(line.a, line.b) < EPSILON) return null;
  const spanCount = spline.points.length - 1; const clicked = nearestSplineSpan(spline, splineClick); const clickParameter = clicked.span + clicked.amount;
  const intersections = splineLineIntersections(spline, line).sort((first, second) => Math.abs(first.parameter - clickParameter) - Math.abs(second.parameter - clickParameter));
  if (intersections.length) {
    const chosen = intersections[0]; const section = clickParameter <= chosen.parameter ? splineSection(spline, 0, chosen.parameter) : splineSection(spline, chosen.parameter, spanCount);
    if (!section) return null;
    const nextSpline = { ...section, id: spline.id, relations: [...new Set([...(spline.relations ?? []), "Corner"])] };
    const nextLine = lineToCorner(line, lineClick, chosen.point);
    if (distance(nextLine.a, nextLine.b) < EPSILON) return null;
    return [nextSpline, nextLine];
  }
  if (distance(spline.points[0], spline.points.at(-1)!) < 0.001) return null;
  const handles = spline.handles?.length === spline.points.length ? spline.handles : automaticSplineHandles(spline.points);
  const start = spline.points[0]; const end = spline.points.at(-1)!;
  const startDirection = { x: start.x - handles[0].out.x, y: start.y - handles[0].out.y };
  if (Math.hypot(startDirection.x, startDirection.y) < EPSILON) { startDirection.x = start.x - spline.points[1].x; startDirection.y = start.y - spline.points[1].y; }
  const endDirection = { x: end.x - handles.at(-1)!.in.x, y: end.y - handles.at(-1)!.in.y };
  if (Math.hypot(endDirection.x, endDirection.y) < EPSILON) { endDirection.x = end.x - spline.points.at(-2)!.x; endDirection.y = end.y - spline.points.at(-2)!.y; }
  const candidates = [
    { end: "start" as const, hit: rayInfiniteLineIntersection(start, startDirection, line) },
    { end: "end" as const, hit: rayInfiniteLineIntersection(end, endDirection, line) },
  ].filter((candidate): candidate is { end: "start" | "end"; hit: { point: Point; distance: number } } => candidate.hit !== null).sort((first, second) => first.hit.distance - second.hit.distance);
  if (!candidates.length) return null;
  const chosen = candidates[0]; const nextSpline = extendSplineEndToCorner(spline, chosen.end, chosen.hit.point); const nextLine = lineToCorner(line, lineClick, chosen.hit.point);
  if (distance(nextLine.a, nextLine.b) < EPSILON) return null;
  return [nextSpline, nextLine];
}

export function cornerEntities(first: SketchEntity, firstClick: Point, second: SketchEntity, secondClick: Point): [SketchEntity, SketchEntity] | null {
  if (first.id === second.id) return null;
  if (first.type === "line" && second.type === "line") return cornerLines(first, firstClick, second, secondClick);
  if (first.type === "spline" && second.type === "line") return cornerSplineAndLine(first, firstClick, second, secondClick);
  if (first.type === "line" && second.type === "spline") {
    const result = cornerSplineAndLine(second, secondClick, first, firstClick); return result ? [result[1], result[0]] : null;
  }
  return null;
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

export type PatternExternalReference = { id: string; points: Point[] };

function mapSketchEntity(entity: SketchEntity, id: string, mapPoint: (point: Point) => Point, rotation = 0): SketchEntity {
  const relations = entity.relations?.filter((relation) => relation !== "Horizontal" && relation !== "Vertical");
  const axisConstraint = Math.abs(Math.sin(rotation)) < 1e-8 ? entity.axisConstraint : undefined;
  const base = { id, construction: entity.construction, relations, axisConstraint };
  if (entity.type === "line") return { ...base, type: "line", a: mapPoint(entity.a), b: mapPoint(entity.b) };
  if (entity.type === "circle") return { ...base, type: "circle", c: mapPoint(entity.c), r: entity.r };
  if (entity.type === "ellipse") return { ...base, type: "ellipse", c: mapPoint(entity.c), rx: entity.rx, ry: entity.ry, rotation: (entity.rotation ?? 0) + rotation };
  if (entity.type === "arc") return { ...base, type: "arc", a: mapPoint(entity.a), b: mapPoint(entity.b), through: mapPoint(entity.through) };
  return { ...base, type: "spline", points: entity.points.map(mapPoint), handles: entity.handles?.map((handle) => ({ in: mapPoint(handle.in), out: mapPoint(handle.out) })) };
}

function normalizedVector(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);
  return length > EPSILON ? { x: vector.x / length, y: vector.y / length } : { x: 1, y: 0 };
}

export function resolvePatternDirection(reference: PatternDirectionReference, entities: SketchEntity[], externalReferences: PatternExternalReference[] = []): Point {
  if (reference.kind === "entity") {
    const line = entities.find((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.id === reference.entityId && entity.type === "line");
    if (line) return normalizedVector({ x: line.b.x - line.a.x, y: line.b.y - line.a.y });
  } else {
    const external = externalReferences.find((candidate) => candidate.id === reference.referenceId);
    if (external && external.points.length > 1) return normalizedVector({ x: external.points.at(-1)!.x - external.points[0].x, y: external.points.at(-1)!.y - external.points[0].y });
  }
  return normalizedVector(reference.fallback);
}

function entityNodePoint(entity: SketchEntity, handle: string): Point | null {
  if (entity.type === "line") return handle === "a" ? entity.a : handle === "b" ? entity.b : handle === "midpoint" ? midpoint(entity.a, entity.b) : null;
  if (entity.type === "circle" || entity.type === "ellipse") return handle === "center" ? entity.c : null;
  if (entity.type === "arc") return handle === "a" ? entity.a : handle === "b" ? entity.b : handle === "through" ? entity.through : null;
  if (entity.type === "spline" && handle.startsWith("point-")) return entity.points[Number(handle.slice(6))] ?? null;
  return null;
}

export function resolvePatternCenter(reference: PatternCenterReference, entities: SketchEntity[], externalReferences: PatternExternalReference[] = []): Point {
  if (reference.kind === "origin") return { x: 0, y: 0 };
  if (reference.kind === "fixed") return reference.point;
  if (reference.kind === "entity-node") {
    const entity = entities.find((candidate) => candidate.id === reference.entityId);
    return entity ? entityNodePoint(entity, reference.handle) ?? reference.fallback : reference.fallback;
  }
  const external = externalReferences.find((candidate) => candidate.id === reference.referenceId);
  if (!external?.points.length) return reference.fallback;
  return external.points.reduce((nearest, point) => distance(point, reference.fallback) < distance(nearest, reference.fallback) ? point : nearest, external.points[0]);
}

export function linearPatternSketchEntity(entity: SketchEntity, direction1: Point, spacing1: number, column: number, direction2: Point, spacing2: number, row: number, id: string): SketchEntity {
  const delta = { x: direction1.x * spacing1 * column + direction2.x * spacing2 * row, y: direction1.y * spacing1 * column + direction2.y * spacing2 * row };
  return mapSketchEntity(entity, id, (point) => ({ x: point.x + delta.x, y: point.y + delta.y }));
}

export function circularPatternStep(count: number, span: number): number {
  const safeCount = Math.max(1, Math.round(count));
  if (safeCount <= 1) return 0;
  return span / (Math.abs(span) >= 359.999 ? safeCount : safeCount - 1);
}

export function circularPatternSketchEntity(entity: SketchEntity, center: Point, angleDegrees: number, rotateInstances: boolean, id: string): SketchEntity {
  const radians = angleDegrees * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  const rotatePoint = (point: Point) => ({ x: center.x + (point.x - center.x) * cosine - (point.y - center.y) * sine, y: center.y + (point.x - center.x) * sine + (point.y - center.y) * cosine });
  if (rotateInstances) return mapSketchEntity(entity, id, rotatePoint, radians);
  const anchor = entityBadgePoint(entity); const rotatedAnchor = rotatePoint(anchor); const delta = { x: rotatedAnchor.x - anchor.x, y: rotatedAnchor.y - anchor.y };
  return mapSketchEntity(entity, id, (point) => ({ x: point.x + delta.x, y: point.y + delta.y }));
}

function inverseLinearPatternEntity(entity: SketchEntity, direction1: Point, spacing1: number, column: number, direction2: Point, spacing2: number, row: number, id: string) {
  return linearPatternSketchEntity(entity, direction1, spacing1, -column, direction2, spacing2, -row, id);
}

function inverseCircularPatternEntity(entity: SketchEntity, center: Point, angleDegrees: number, rotateInstances: boolean, id: string) {
  return circularPatternSketchEntity(entity, center, -angleDegrees, rotateInstances, id);
}

export function synchronizePatternLinks(entities: SketchEntity[], links: (LinearPatternConstraint | CircularPatternConstraint)[], changedEntityIds: Set<string>, externalReferences: PatternExternalReference[] = []): SketchEntity[] {
  let next = entities;
  for (const link of links) {
    if (link.type === "circular-pattern") {
      const center = resolvePatternCenter(link.center, next, externalReferences); const step = (link.equalSpacing ? circularPatternStep(link.count, link.span) : link.span) * (link.reverse ? -1 : 1);
      for (const pair of link.pairs) {
        let source = next.find((entity) => entity.id === pair.sourceId); if (!source) continue;
        const changedInstance = pair.instances.find((instance) => changedEntityIds.has(instance.entityId));
        if (changedInstance && !changedEntityIds.has(source.id)) {
          const driver = next.find((entity) => entity.id === changedInstance.entityId);
          if (driver) { source = geometryOnto(source, inverseCircularPatternEntity(driver, center, step * changedInstance.index, link.rotateInstances, source.id)); next = next.map((entity) => entity.id === source!.id ? source! : entity); }
        }
        for (const instance of pair.instances) {
          const target = next.find((entity) => entity.id === instance.entityId); if (!target) continue;
          const replacement = geometryOnto(target, circularPatternSketchEntity(source, center, step * instance.index, link.rotateInstances, target.id));
          next = next.map((entity) => entity.id === target.id ? replacement : entity);
        }
      }
      continue;
    }
    const first = resolvePatternDirection(link.direction1, next, externalReferences); const direction1 = { x: first.x * (link.flip1 ? -1 : 1), y: first.y * (link.flip1 ? -1 : 1) };
    const resolvedSecond = link.direction2 ? resolvePatternDirection(link.direction2, next, externalReferences) : { x: -direction1.y, y: direction1.x };
    const direction2 = { x: resolvedSecond.x * (link.flip2 ? -1 : 1), y: resolvedSecond.y * (link.flip2 ? -1 : 1) };
    for (const pair of link.pairs) {
      let source = next.find((entity) => entity.id === pair.sourceId); if (!source) continue;
      const changedInstance = pair.instances.find((instance) => changedEntityIds.has(instance.entityId));
      if (changedInstance && !changedEntityIds.has(source.id)) {
        const driver = next.find((entity) => entity.id === changedInstance.entityId);
        if (driver) { source = geometryOnto(source, inverseLinearPatternEntity(driver, direction1, link.spacing1, changedInstance.column, direction2, link.spacing2 ?? 0, changedInstance.row, source.id)); next = next.map((entity) => entity.id === source!.id ? source! : entity); }
      }
      for (const instance of pair.instances) {
        const target = next.find((entity) => entity.id === instance.entityId); if (!target) continue;
        const replacement = geometryOnto(target, linearPatternSketchEntity(source, direction1, link.spacing1, instance.column, direction2, link.spacing2 ?? 0, instance.row, target.id));
        next = next.map((entity) => entity.id === target.id ? replacement : entity);
      }
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

function cubicSplit(a: Point, b: Point, c: Point, d: Point, amount: number): [[Point, Point, Point, Point], [Point, Point, Point, Point]] {
  const ab = lerpPoint(a, b, amount); const bc = lerpPoint(b, c, amount); const cd = lerpPoint(c, d, amount);
  const abc = lerpPoint(ab, bc, amount); const bcd = lerpPoint(bc, cd, amount); const point = lerpPoint(abc, bcd, amount);
  return [[a, ab, abc, point], [point, bcd, cd, d]];
}

function cubicSection(a: Point, b: Point, c: Point, d: Point, start: number, end: number): [Point, Point, Point, Point] {
  const [throughEnd] = cubicSplit(a, b, c, d, end);
  if (start <= EPSILON) return throughEnd;
  const [, section] = cubicSplit(...throughEnd, start / Math.max(end, EPSILON));
  return section;
}

function splineSection(target: Extract<SketchEntity, { type: "spline" }>, start: number, end: number): Extract<SketchEntity, { type: "spline" }> | null {
  const spanCount = target.points.length - 1;
  if (spanCount < 1 || end - start < EPSILON) return null;
  const handles = target.handles?.length === target.points.length ? target.handles : automaticSplineHandles(target.points);
  const points: Point[] = []; const nextHandles: SplineHandlePair[] = [];
  const appendRange = (rangeStart: number, rangeEnd: number) => {
    for (let span = Math.floor(rangeStart); span < Math.ceil(rangeEnd - EPSILON); span++) {
      const localStart = Math.max(0, rangeStart - span); const localEnd = Math.min(1, rangeEnd - span);
      if (localEnd - localStart < EPSILON) continue;
      const section = cubicSection(target.points[span], handles[span].out, handles[span + 1].in, target.points[span + 1], localStart, localEnd);
      if (!points.length) { points.push(section[0]); nextHandles.push({ in: section[0], out: section[1] }); }
      else nextHandles[nextHandles.length - 1].out = section[1];
      points.push(section[3]); nextHandles.push({ in: section[2], out: section[3] });
    }
  };
  if (end <= spanCount + EPSILON) appendRange(start, Math.min(end, spanCount));
  else { appendRange(start, spanCount); appendRange(0, end - spanCount); }
  if (points.length < 2) return null;
  return { id: trimId(target.id), type: "spline", construction: target.construction, points, handles: nextHandles, relations: ["Trimmed"] };
}

function trimSpline(target: Extract<SketchEntity, { type: "spline" }>, click: Point, others: SketchEntity[]): SketchEntity[] {
  if (target.points.length < 2) return [];
  const samplesPerSpan = 40; const samples = sampleSplineEntity(target, samplesPerSpan); const spanCount = target.points.length - 1;
  const cuts = uniquePoints(others.flatMap((other) => {
    const otherSamples = sampleSketchEntity(other);
    return samples.slice(1).flatMap((point, targetIndex) => otherSamples.slice(1).flatMap((otherPoint, otherIndex) => {
      const hit = segmentIntersection(samples[targetIndex], point, otherSamples[otherIndex], otherPoint);
      return hit ? [{ point: hit.point, parameter: (targetIndex + hit.firstAmount) / samplesPerSpan }] : [];
    }));
  }).map((candidate) => candidate.point), 0.025).map((point) => {
    let best = { parameter: 0, distance: Number.POSITIVE_INFINITY };
    samples.slice(1).forEach((sample, index) => {
      const nearest = closestPointOnSegment(point, samples[index], sample); const separation = distance(point, nearest);
      if (separation < best.distance) {
        const segmentLength = distance(samples[index], sample); const amount = segmentLength > EPSILON ? distance(samples[index], nearest) / segmentLength : 0;
        best = { parameter: (index + amount) / samplesPerSpan, distance: separation };
      }
    });
    return best.parameter;
  }).filter((parameter) => parameter > EPSILON && parameter < spanCount - EPSILON).sort((first, second) => first - second);
  if (!cuts.length) return [];
  let clickParameter = 0; let clickDistance = Number.POSITIVE_INFINITY;
  samples.slice(1).forEach((sample, index) => {
    const nearest = closestPointOnSegment(click, samples[index], sample); const separation = distance(click, nearest);
    if (separation < clickDistance) {
      const segmentLength = distance(samples[index], sample); const amount = segmentLength > EPSILON ? distance(samples[index], nearest) / segmentLength : 0;
      clickParameter = (index + amount) / samplesPerSpan; clickDistance = separation;
    }
  });
  const closed = distance(target.points[0], target.points.at(-1)!) < 0.001;
  if (closed) {
    if (cuts.length < 2) return [target];
    const intervals = cuts.map((start, index) => ({ start, end: index === cuts.length - 1 ? cuts[0] + spanCount : cuts[index + 1] }));
    const removed = intervals.findIndex(({ start, end }) => { const adjusted = clickParameter < start ? clickParameter + spanCount : clickParameter; return adjusted >= start - EPSILON && adjusted <= end + EPSILON; });
    return intervals.flatMap((interval, index) => index === removed ? [] : [splineSection(target, interval.start, interval.end)]).filter((entity): entity is Extract<SketchEntity, { type: "spline" }> => entity !== null);
  }
  const bounds = [0, ...cuts, spanCount];
  const removed = Math.max(0, bounds.findIndex((value, index) => index < bounds.length - 1 && clickParameter >= value - EPSILON && clickParameter <= bounds[index + 1] + EPSILON));
  return bounds.slice(0, -1).flatMap((start, index) => index === removed ? [] : [splineSection(target, start, bounds[index + 1])]).filter((entity): entity is Extract<SketchEntity, { type: "spline" }> => entity !== null);
}

export function sketchStrokeHits(entities: SketchEntity[], start: Point, end: Point): { entityId: string; point: Point }[] {
  return entities.flatMap((entity) => {
    const samples = entity.type === "spline" ? sampleSplineEntity(entity, 40) : sampleSketchEntity(entity);
    const hits = samples.slice(1).flatMap((point, index) => {
      const hit = segmentIntersection(start, end, samples[index], point);
      return hit ? [{ point: hit.point, amount: hit.firstAmount }] : [];
    }).sort((first, second) => first.amount - second.amount);
    return hits[0] ? [{ entityId: entity.id, point: hits[0].point, amount: hits[0].amount }] : [];
  }).sort((first, second) => first.amount - second.amount).map(({ entityId, point }) => ({ entityId, point }));
}

export function trimEntityAtPoint(target: SketchEntity, click: Point, entities: SketchEntity[]): SketchEntity[] {
  const others = entities.filter((entity) => entity.id !== target.id);
  if (target.type === "circle") return trimCircle(target, click, others);
  if (target.type === "ellipse") return trimEllipse(target, click, others);
  if (target.type === "line") return trimLine(target, click, others);
  if (target.type === "spline") return trimSpline(target, click, others);
  return [target];
}
