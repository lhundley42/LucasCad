"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { automaticSplineHandles, circumcircle, cornerLines, deleteSplinePoint, distance, entityBadgePoint, entityInSelectionBox, extendEntityToTarget, insertSplinePoint, midpoint, mirrorSketchEntity, nearestGridVertex, normalizedSelectionBox, perpendicularLineToReference, pointInSelectionBox, sketchRelationIsSatisfied, synchronizeMirrorLinks, translateSketchEntity, trimEntityAtPoint, type Point, type SketchEntity, type SplineHandlePair } from "./sketchGeometry";
import { angularDimensionLayout, angularDimensionValue, constraintSupersedesOrthogonalProfileDimension, constraintSupersedesSegmentDimension, controlPointsForEntity, cycleLinearOrientation, defaultLinearDimensionPosition, defaultLinearOrientation, diameterDimensionLayout, diameterDimensionValue, dimensionReferencePoints, linearDimensionLayout, linearDimensionValue, linearOrientationOptions, lineFor, nonOverlappingReferenceHitRadius, preferredAxisOrSketchLineTarget, referencePoint, targetPointForAngularValue, targetPointForLinearValue, validLinearDimensionPair, type DiameterDimensionConstraint, type ExternalSketchReference, type LinearDimensionConstraint, type LinearOrientation, type MirrorConstraint, type SketchConstraint, type SketchReference } from "./sketchConstraints";
import { formatLength, fromMillimeters, toMillimeters, type UnitSystem } from "./units";
export type { Point, SketchEntity } from "./sketchGeometry";
export type { ExternalSketchReference, LinearDimensionConstraint, SketchConstraint } from "./sketchConstraints";

type Tool = "select" | "line" | "centerline" | "rectangle" | "circle" | "ellipse" | "arc" | "spline" | "trim" | "extend" | "corner" | "mirror" | "linear-dimension" | "angular-dimension" | "diameter-dimension" | "perpendicular-constraint" | "horizontal-constraint" | "vertical-constraint";
type Snap = { point: Point; kind: "endpoint" | "midpoint" | "center" | "quadrant" | "grid" | "horizontal" | "vertical" };
type DimensionInfo = { key: string; entityId: string; axis?: "major" | "minor"; anchor: Point; offset: Point; text: string; value: number };
type DimensionDrag = { key: string; pointerId: number; startPoint: Point; originalOffset: Point; captureTarget: SVGGElement };
type ConstraintDrag = { id: string; pointerId: number; captureTarget: SVGGElement };
type SelectionMarquee = { start: Point; current: Point; pointerId: number };
type MultiSelectionDrag = { pointerId: number; start: Point; originalEntities: SketchEntity[]; originalConstraints: SketchConstraint[]; originalDimensionOffsets: Record<string, Point>; moved: boolean };
type SplineHandleDrag = { entityId: string; pointIndex: number; side: "in" | "out"; pointerId: number; captureTarget: SVGCircleElement };
type AxisRelation = "Horizontal" | "Vertical";
type ConstraintShortcut = { x: number; y: number; entityId: string; relation: AxisRelation };
type SplineContextMenu = { x: number; y: number; entityId: string; kind: "point" | "curve"; pointIndex?: number; point: Point };
export type SketchView = { center: Point; zoom: number };

const VIEW = { x: -260, y: -180, width: 520, height: 360 };
const DEFAULT_VIEW: SketchView = { center: { x: 0, y: 0 }, zoom: 1 };
const nextId = () => `entity-${crypto.randomUUID()}`;
const fmt = (value: number) => value.toFixed(value < 10 ? 2 : 1).replace(/\.0$/, "");

function dimensionArrowPath(first: Point, second: Point, scale: number) {
  const dx = second.x - first.x; const dy = second.y - first.y; const length = Math.max(Math.hypot(dx, dy), 1e-9);
  const ux = dx / length; const uy = dy / length; const nx = -uy; const ny = ux; const arrowLength = 5 * scale; const halfWidth = 2.4 * scale;
  const firstBase = { x: first.x + ux * arrowLength, y: first.y + uy * arrowLength }; const secondBase = { x: second.x - ux * arrowLength, y: second.y - uy * arrowLength };
  return `M ${first.x} ${first.y} L ${firstBase.x + nx * halfWidth} ${firstBase.y + ny * halfWidth} L ${firstBase.x - nx * halfWidth} ${firstBase.y - ny * halfWidth} Z M ${second.x} ${second.y} L ${secondBase.x + nx * halfWidth} ${secondBase.y + ny * halfWidth} L ${secondBase.x - nx * halfWidth} ${secondBase.y - ny * halfWidth} Z`;
}

function nearestPointOnPath(point: Point, points: Point[]) {
  let nearest = points[0] ?? point; let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]; const b = points[index]; const dx = b.x - a.x; const dy = b.y - a.y; const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared > 1e-10 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    const candidate = { x: a.x + dx * amount, y: a.y + dy * amount }; const separation = distance(point, candidate);
    if (separation < best) { nearest = candidate; best = separation; }
  }
  return nearest;
}

function splinePath(points: Point[], customHandles?: SplineHandlePair[]) {
  if (points.length < 2) return "";
  const handles = customHandles?.length === points.length ? customHandles : automaticSplineHandles(points);
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    path += ` C ${handles[i].out.x} ${handles[i].out.y}, ${handles[i + 1].in.x} ${handles[i + 1].in.y}, ${points[i + 1].x} ${points[i + 1].y}`;
  }
  return path;
}

function arcPath(a: Point, b: Point, through: Point) {
  const circle = circumcircle(a, b, through);
  const tau = Math.PI * 2;
  const start = Math.atan2(a.y - circle.c.y, a.x - circle.c.x);
  const end = Math.atan2(b.y - circle.c.y, b.x - circle.c.x);
  const mid = Math.atan2(through.y - circle.c.y, through.x - circle.c.x);
  const positiveEnd = (end - start + tau) % tau;
  const positiveMid = (mid - start + tau) % tau;
  const sweep = positiveMid <= positiveEnd ? 1 : 0;
  const span = sweep ? positiveEnd : (start - end + tau) % tau;
  return `M ${a.x} ${a.y} A ${circle.r} ${circle.r} 0 ${span > Math.PI ? 1 : 0} ${sweep} ${b.x} ${b.y}`;
}

function replaceConnectedPoint(entity: SketchEntity, from: Point, to: Point): SketchEntity {
  const replace = (point: Point) => distance(point, from) < 0.001 ? to : point;
  if (entity.type === "line") return { ...entity, a: replace(entity.a), b: replace(entity.b) };
  if (entity.type === "circle" || entity.type === "ellipse") return { ...entity, c: replace(entity.c) };
  if (entity.type === "arc") return { ...entity, a: replace(entity.a), b: replace(entity.b), through: replace(entity.through) };
  const movedIndices = entity.points.map((point, index) => distance(point, from) < 0.001 ? index : -1).filter((index) => index >= 0);
  const handles = entity.handles?.map((handle, index) => movedIndices.includes(index) ? { in: { x: handle.in.x + to.x - from.x, y: handle.in.y + to.y - from.y }, out: { x: handle.out.x + to.x - from.x, y: handle.out.y + to.y - from.y } } : handle);
  return { ...entity, points: entity.points.map(replace), handles };
}

function entitySnapPoints(entity: SketchEntity): Snap[] {
  if (entity.type === "line") return [
    { point: entity.a, kind: "endpoint" }, { point: entity.b, kind: "endpoint" }, { point: midpoint(entity.a, entity.b), kind: "midpoint" },
  ];
  if (entity.type === "circle") return [
    { point: entity.c, kind: "center" },
    ...[{ x: entity.c.x + entity.r, y: entity.c.y }, { x: entity.c.x - entity.r, y: entity.c.y }, { x: entity.c.x, y: entity.c.y + entity.r }, { x: entity.c.x, y: entity.c.y - entity.r }].map((point) => ({ point, kind: "quadrant" as const })),
  ];
  if (entity.type === "ellipse") return [
    { point: entity.c, kind: "center" },
    ...[[entity.rx, 0], [-entity.rx, 0], [0, entity.ry], [0, -entity.ry]].map(([x, y]) => { const angle = entity.rotation ?? 0; return { point: { x: entity.c.x + x * Math.cos(angle) - y * Math.sin(angle), y: entity.c.y + x * Math.sin(angle) + y * Math.cos(angle) }, kind: "quadrant" as const }; }),
  ];
  if (entity.type === "arc") {
    const circle = circumcircle(entity.a, entity.b, entity.through);
    return [{ point: entity.a, kind: "endpoint" }, { point: entity.b, kind: "endpoint" }, { point: circle.c, kind: "center" }];
  }
  return entity.points.map((point) => ({ point, kind: "endpoint" as const }));
}

function moveControlPoint(entity: SketchEntity, handle: string, point: Point): SketchEntity {
  if (entity.type === "line") {
    if (handle === "midpoint") { const current = midpoint(entity.a, entity.b); const delta = { x: point.x - current.x, y: point.y - current.y }; return { ...entity, a: { x: entity.a.x + delta.x, y: entity.a.y + delta.y }, b: { x: entity.b.x + delta.x, y: entity.b.y + delta.y } }; }
    return { ...entity, [handle]: point } as SketchEntity;
  }
  if (entity.type === "circle") return handle === "center" ? { ...entity, c: point } : { ...entity, r: Math.max(0.1, distance(entity.c, point)) };
  if (entity.type === "ellipse") {
    if (handle === "center") return { ...entity, c: point };
    if (handle === "major") return { ...entity, rx: Math.max(0.1, distance(entity.c, point)), rotation: Math.atan2(point.y - entity.c.y, point.x - entity.c.x) };
    const angle = entity.rotation ?? 0; const dx = point.x - entity.c.x; const dy = point.y - entity.c.y;
    return { ...entity, ry: Math.max(0.1, Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle))) };
  }
  if (entity.type === "arc") return { ...entity, [handle]: point } as SketchEntity;
  const index = Number(handle.replace("point-", ""));
  const previous = entity.points[index]; const delta = { x: point.x - previous.x, y: point.y - previous.y }; const closed = entity.points.length > 2 && distance(entity.points[0], entity.points.at(-1)!) < 0.001;
  const movedIndices = new Set(closed && (index === 0 || index === entity.points.length - 1) ? [0, entity.points.length - 1] : [index]);
  return { ...entity, points: entity.points.map((existing, pointIndex) => movedIndices.has(pointIndex) ? point : existing), handles: entity.handles?.map((pair, pointIndex) => movedIndices.has(pointIndex) ? { in: { x: pair.in.x + delta.x, y: pair.in.y + delta.y }, out: { x: pair.out.x + delta.x, y: pair.out.y + delta.y } } : pair) };
}

function constrainedEndpoint(entity: SketchEntity, handle: string, point: Point): Point {
  if (entity.type !== "line" || (handle !== "a" && handle !== "b")) return point;
  const fixed = handle === "a" ? entity.b : entity.a;
  if (entity.axisConstraint === "Horizontal") return { x: point.x, y: fixed.y };
  if (entity.axisConstraint === "Vertical") return { x: fixed.x, y: point.y };
  return point;
}

function dimensionsFor(entity: SketchEntity): DimensionInfo[] {
  if (entity.type === "line") {
    const m = midpoint(entity.a, entity.b);
    return [{ key: entity.id, entityId: entity.id, anchor: m, offset: { x: 0, y: -12 }, text: `${fmt(distance(entity.a, entity.b))} mm`, value: distance(entity.a, entity.b) }];
  }
  if (entity.type === "circle") return [{ key: entity.id, entityId: entity.id, anchor: { x: entity.c.x + entity.r * 0.707, y: entity.c.y - entity.r * 0.707 }, offset: { x: 9, y: -7 }, text: `Ø ${fmt(entity.r * 2)}`, value: entity.r * 2 }];
  if (entity.type === "ellipse") return [
    { key: `${entity.id}:major`, entityId: entity.id, axis: "major", anchor: { x: entity.c.x + entity.ry * Math.sin(entity.rotation ?? 0), y: entity.c.y - entity.ry * Math.cos(entity.rotation ?? 0) }, offset: { x: 0, y: -13 }, text: `${fmt(entity.rx * 2)} mm`, value: entity.rx * 2 },
    { key: `${entity.id}:minor`, entityId: entity.id, axis: "minor", anchor: { x: entity.c.x + entity.rx * Math.cos(entity.rotation ?? 0), y: entity.c.y + entity.rx * Math.sin(entity.rotation ?? 0) }, offset: { x: 15, y: 0 }, text: `${fmt(entity.ry * 2)} mm`, value: entity.ry * 2 },
  ];
  if (entity.type === "arc") {
    const circle = circumcircle(entity.a, entity.b, entity.through);
    return [{ key: entity.id, entityId: entity.id, anchor: entity.through, offset: { x: 0, y: -13 }, text: `R ${fmt(circle.r)}`, value: circle.r }];
  }
  let total = 0;
  entity.points.slice(1).forEach((point, index) => { total += distance(entity.points[index], point); });
  const m = entity.points[Math.floor(entity.points.length / 2)];
  return [{ key: entity.id, entityId: entity.id, anchor: m, offset: { x: 0, y: -13 }, text: `L ${fmt(total)}`, value: total }];
}

export function Sketcher({ entities: controlledEntities, constraints: controlledConstraints = [], externalReferences = [], dimensionOffsets: controlledDimensionOffsets = {}, dimensionTextScale = 0.5, nodeDiameterPx = 4, highlightWidthPx = 1.2, gridSquareSize = 8, unitSystem = "metric", onChange, onConstraintsChange, onDimensionOffsetsChange, onFinish, view = DEFAULT_VIEW, viewRotated = false, onSnapNormal }: { entities?: SketchEntity[]; constraints?: SketchConstraint[]; externalReferences?: ExternalSketchReference[]; dimensionOffsets?: Record<string, Point>; dimensionTextScale?: number; nodeDiameterPx?: number; highlightWidthPx?: number; gridSquareSize?: number; unitSystem?: UnitSystem; onChange?: (entities: SketchEntity[]) => void; onConstraintsChange?: (constraints: SketchConstraint[]) => void; onDimensionOffsetsChange?: (offsets: Record<string, Point>) => void; onFinish: () => void; view?: SketchView; viewRotated?: boolean; onSnapNormal?: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dimensionInputRef = useRef<HTMLInputElement>(null);
  const [entities, setEntitiesState] = useState<SketchEntity[]>(() => controlledEntities ?? []);
  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 });
  const [snap, setSnap] = useState<Snap | null>(null);
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);
  const [editingDimension, setEditingDimension] = useState<DimensionInfo | null>(null);
  const [editingConstraintId, setEditingConstraintId] = useState<string | null>(null);
  const [dimensionValue, setDimensionValue] = useState("");
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [history, setHistory] = useState<SketchEntity[][]>([]);
  const [future, setFuture] = useState<SketchEntity[][]>([]);
  const [dragging, setDragging] = useState<{ entityId: string; handle: string; pointerId: number; originalPoint: Point } | null>(null);
  const [dimensionOffsets, setDimensionOffsets] = useState<Record<string, Point>>(() => controlledDimensionOffsets);
  const [draggingDimension, setDraggingDimension] = useState<DimensionDrag | null>(null);
  const [constraints, setConstraintsState] = useState<SketchConstraint[]>(() => controlledConstraints);
  const [dimensionReferences, setDimensionReferences] = useState<SketchReference[]>([]);
  const [hoveredReferenceId, setHoveredReferenceId] = useState<string | null>(null);
  const [dimensionOrientation, setDimensionOrientation] = useState<LinearOrientation>("horizontal");
  const [dimensionOptions, setDimensionOptions] = useState<LinearOrientation[]>(["horizontal", "vertical"]);
  const [dimensionMessage, setDimensionMessage] = useState<string | null>(null);
  const [diameterEntityId, setDiameterEntityId] = useState<string | null>(null);
  const [selectedConstraintIds, setSelectedConstraintIds] = useState<string[]>([]);
  const [selectedDimensionKeys, setSelectedDimensionKeys] = useState<string[]>([]);
  const [hiddenDimensionKeys, setHiddenDimensionKeys] = useState<string[]>([]);
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee | null>(null);
  const [draggingSelection, setDraggingSelection] = useState<MultiSelectionDrag | null>(null);
  const [draggingConstraint, setDraggingConstraint] = useState<ConstraintDrag | null>(null);
  const [draggingSplineHandle, setDraggingSplineHandle] = useState<SplineHandleDrag | null>(null);
  const [selectedAxisConstraint, setSelectedAxisConstraint] = useState<{ entityId: string; relation: AxisRelation } | null>(null);
  const [constraintShortcut, setConstraintShortcut] = useState<ConstraintShortcut | null>(null);
  const [splineContextMenu, setSplineContextMenu] = useState<SplineContextMenu | null>(null);
  const [extendSource, setExtendSource] = useState<{ entityId: string; click: Point } | null>(null);
  const [extendMessage, setExtendMessage] = useState<string | null>(null);
  const [cornerSource, setCornerSource] = useState<{ entityId: string; click: Point } | null>(null);
  const [cornerMessage, setCornerMessage] = useState<string | null>(null);
  const [perpendicularSource, setPerpendicularSource] = useState<string | null>(null);
  const [perpendicularMessage, setPerpendicularMessage] = useState<string | null>(null);
  const [mirrorMessage, setMirrorMessage] = useState<string | null>(null);
  const dragStartRef = useRef<SketchEntity[] | null>(null);
  const lineClickRef = useRef<{ entityId: string; at: number } | null>(null);
  const selected = selectedEntityIds.at(-1) ?? null;
  const selectedConstraintId = selectedConstraintIds.at(-1) ?? null;
  const setSelected = (entityId: string | null) => setSelectedEntityIds(entityId ? [entityId] : []);
  const setSelectedConstraintId = (constraintId: string | null) => setSelectedConstraintIds(constraintId ? [constraintId] : []);

  const synchronizeMirrors = useCallback((next: SketchEntity[], previous = entities, activeConstraints = constraints) => {
    const previousById = new Map(previous.map((entity) => [entity.id, JSON.stringify(entity)]));
    const changed = new Set(next.filter((entity) => previousById.get(entity.id) !== JSON.stringify(entity)).map((entity) => entity.id));
    return synchronizeMirrorLinks(next, activeConstraints.filter((constraint): constraint is MirrorConstraint => constraint.type === "mirror"), changed);
  }, [constraints, entities]);
  const commit = useCallback((next: SketchEntity[]) => {
    const synchronized = synchronizeMirrors(next);
    setHistory((items) => [...items.slice(-39), entities]);
    setFuture([]);
    setEntitiesState(synchronized);
    onChange?.(synchronized);
  }, [entities, onChange, synchronizeMirrors]);
  const commitConstraints = useCallback((next: SketchConstraint[]) => { setConstraintsState(next); onConstraintsChange?.(next); }, [onConstraintsChange]);
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((items) => [entities, ...items]); setHistory((items) => items.slice(0, -1)); setEntitiesState(previous); onChange?.(previous); };
  const redo = () => { const next = future[0]; if (!next) return; setHistory((items) => [...items, entities]); setFuture((items) => items.slice(1)); setEntitiesState(next); onChange?.(next); };

  const pointFromEvent = (event: Pick<React.PointerEvent<SVGElement>, "clientX" | "clientY">): Point => {
    const svg = svgRef.current!; const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: transformed.x, y: transformed.y };
  };
  const findSnap = (raw: Point, anchor?: Point, excludeEntityId?: string) => {
    if (!snapEnabled) return null;
    const draftClosureCandidates: Snap[] = tool === "spline" && draft.length >= 3 ? [{ point: draft[0], kind: "endpoint" }] : [];
    const candidates = [...draftClosureCandidates, ...entities.filter((entity) => entity.id !== excludeEntityId).flatMap(entitySnapPoints)];
    const snapTolerance = 9 / Math.max(0.05, Math.min(40, view.zoom));
    const gridSnap: Snap = { point: nearestGridVertex(raw, gridSquareSize), kind: "grid" };
    const gridDistance = distance(raw, gridSnap.point);
    let best: Snap | null = null; let bestDistance = Math.min(snapTolerance, gridDistance + 1e-6);
    for (const candidate of candidates) { const d = distance(raw, candidate.point); if (d <= bestDistance) { best = candidate; bestDistance = d; } }
    if (best) return best;
    if (anchor && Math.abs(raw.x - anchor.x) < snapTolerance / 2) return { point: { x: anchor.x, y: raw.y }, kind: "vertical" as const };
    if (anchor && Math.abs(raw.y - anchor.y) < snapTolerance / 2) return { point: { x: raw.x, y: anchor.y }, kind: "horizontal" as const };
    return gridSnap;
  };

  const finishSpline = () => {
    const points = draft.filter((point, index) => index === 0 || distance(point, draft[index - 1]) > 0.0001);
    if (points.length > 1) commit([...entities, { id: nextId(), type: "spline", points, relations: snap?.kind === "endpoint" ? ["Coincident"] : [] }]);
    setDraft([]); setTool("select");
  };
  const finishChain = () => { setDraft([]); setDimensionReferences([]); setDimensionMessage(null); setDiameterEntityId(null); setExtendSource(null); setExtendMessage(null); setCornerSource(null); setCornerMessage(null); setPerpendicularSource(null); setPerpendicularMessage(null); setTool("select"); setSnap(null); };
  const commitLinearDimension = (first: SketchReference, second: SketchReference, orientation: LinearOrientation, position: Point) => {
    const next: LinearDimensionConstraint = { id: `constraint-${crypto.randomUUID()}`, type: "linear", first, second, orientation, position, value: linearDimensionValue(first, second, orientation, entities) };
    commitConstraints([...constraints, next]); setSelectedConstraintId(next.id); setSelected(null); setSelectedDimensionKeys([]); setDimensionReferences([]);
  };
  const commitAngularDimension = (first: Extract<SketchReference, { kind: "line" | "external-line" }>, second: Extract<SketchReference, { kind: "line" | "external-line" }>, position: Point) => {
    const next: SketchConstraint = { id: `constraint-${crypto.randomUUID()}`, type: "angular", first, second, position, value: angularDimensionValue(first, second, position, entities) };
    commitConstraints([...constraints, next]); setSelectedConstraintId(next.id); setSelected(null); setSelectedDimensionKeys([]); setDimensionReferences([]); setDimensionMessage(null);
  };
  const commitDiameterDimension = (entityId: string, position: Point) => {
    const existing = constraints.find((constraint) => constraint.type === "diameter" && constraint.entityId === entityId);
    if (existing) { setSelectedConstraintId(existing.id); setDiameterEntityId(null); return; }
    const next: DiameterDimensionConstraint = { id: `constraint-${crypto.randomUUID()}`, type: "diameter", entityId, position, value: diameterDimensionValue(entityId, entities) };
    commitConstraints([...constraints, next]); setSelectedConstraintId(next.id); setSelected(null); setSelectedDimensionKeys([]); setDiameterEntityId(null); setDimensionMessage(null);
  };
  const placeLinearDimension = (position: Point) => {
    if (dimensionReferences.length !== 2) return;
    commitLinearDimension(dimensionReferences[0], dimensionReferences[1], dimensionOrientation, position);
  };
  const placeAngularDimension = (position: Point) => {
    if (dimensionReferences.length !== 2) return;
    const [first, second] = dimensionReferences;
    if ((first.kind === "line" || first.kind === "external-line") && (second.kind === "line" || second.kind === "external-line")) commitAngularDimension(first, second, position);
  };
  const chooseDimensionReference = (reference: SketchReference, position: Point) => {
    if (tool === "angular-dimension") {
      if (reference.kind !== "line" && reference.kind !== "external-line") { setDimensionMessage("Angular dimension needs line references"); return; }
      if (dimensionReferences.length === 2) { placeAngularDimension(position); return; }
      if (!dimensionReferences.length) { setDimensionMessage(null); setDimensionReferences([reference]); return; }
      const first = dimensionReferences[0];
      const sameReference = first.kind === reference.kind && (
        (first.kind === "line" && reference.kind === "line" && first.entityId === reference.entityId)
        || (first.kind === "external-line" && reference.kind === "external-line" && first.referenceId === reference.referenceId)
      );
      if (sameReference) return;
      if (first.kind !== "line" && first.kind !== "external-line") { setDimensionMessage("Angular dimension needs line references"); setDimensionReferences([reference]); return; }
      const firstLine = lineFor(first, entities); const secondLine = lineFor(reference, entities);
      if (!firstLine || !secondLine) return;
      const firstVector = { x: firstLine.b.x - firstLine.a.x, y: firstLine.b.y - firstLine.a.y };
      const secondVector = { x: secondLine.b.x - secondLine.a.x, y: secondLine.b.y - secondLine.a.y };
      const scale = Math.max(Math.hypot(firstVector.x, firstVector.y) * Math.hypot(secondVector.x, secondVector.y), 1e-9);
      if (Math.abs(firstVector.x * secondVector.y - firstVector.y * secondVector.x) / scale < 0.001) { setDimensionMessage("Angular dimension needs two non-parallel lines"); return; }
      setDimensionMessage(null); setDimensionReferences([first, reference]); setCursor(position); return;
    }
    if (dimensionReferences.length === 2) { placeLinearDimension(position); return; }
    if (!dimensionReferences.length) { setDimensionMessage(null); setDimensionReferences([reference]); return; }
    const first = dimensionReferences[0];
    const sameReference = first.kind === reference.kind && (
      (first.kind === "line" && reference.kind === "line" && first.entityId === reference.entityId)
      || (first.kind === "node" && reference.kind === "node" && first.entityId === reference.entityId && first.handle === reference.handle)
      || (first.kind === "external-point" && reference.kind === "external-point" && first.referenceId === reference.referenceId)
      || (first.kind === "external-line" && reference.kind === "external-line" && first.referenceId === reference.referenceId)
    );
    if (sameReference) return;
    if (!validLinearDimensionPair(first, reference, entities)) { setDimensionMessage("Line-to-line dimensions require parallel lines · choose another line or point"); return; }
    setDimensionMessage(null);
    const options = linearOrientationOptions(first, reference, entities); const orientation = defaultLinearOrientation(first, reference, entities);
    const firstIsSketchAxis = first.kind === "external-line" && first.source === "sketch-axis";
    const secondIsSketchAxis = reference.kind === "external-line" && reference.source === "sketch-axis";
    if (firstIsSketchAxis !== secondIsSketchAxis) {
      const offset = 34 / Math.max(0.05, Math.min(40, view.zoom));
      commitLinearDimension(first, reference, orientation, defaultLinearDimensionPosition(first, reference, orientation, entities, offset));
      return;
    }
    setDimensionOptions(options); setDimensionOrientation(orientation); setDimensionReferences([first, reference]); setCursor(position);
  };

  const clearSelection = () => { setSelectedEntityIds([]); setSelectedConstraintIds([]); setSelectedDimensionKeys([]); setSelectedAxisConstraint(null); };
  const constraintReferencesEntity = (constraint: SketchConstraint, entityIds: Set<string>) => constraint.type === "mirror"
    ? entityIds.has(constraint.axisEntityId) || constraint.pairs.some((pair) => entityIds.has(pair.sourceId) || entityIds.has(pair.mirroredId))
    : constraint.type === "diameter" ? entityIds.has(constraint.entityId)
    : [constraint.first, constraint.second].some((reference) => (reference.kind === "node" || reference.kind === "line") && entityIds.has(reference.entityId));
  const deleteSelection = () => {
    if (editingDimension || editingConstraintId) return;
    const entityIds = new Set(selectedEntityIds); const constraintIds = new Set(selectedConstraintIds);
    if (entityIds.size) commit(entities.filter((entity) => !entityIds.has(entity.id)));
    if (selectedAxisConstraint) commit(entities.map((entity) => entity.id === selectedAxisConstraint.entityId ? { ...entity, axisConstraint: undefined, relations: entity.relations?.filter((relation) => relation !== selectedAxisConstraint.relation) } : entity));
    if (constraintIds.size || entityIds.size) commitConstraints(constraints.filter((constraint) => !constraintIds.has(constraint.id) && !constraintReferencesEntity(constraint, entityIds)));
    if (selectedDimensionKeys.length) setHiddenDimensionKeys((keys) => [...new Set([...keys, ...selectedDimensionKeys])]);
    if (entityIds.size || constraintIds.size || selectedDimensionKeys.length || selectedAxisConstraint) clearSelection();
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setEditingConstraintId(null); setConstraintShortcut(null); setSplineContextMenu(null); finishChain(); }
      if (event.key === "Tab" && tool === "linear-dimension" && dimensionReferences.length === 2) { event.preventDefault(); setDimensionOrientation((orientation) => cycleLinearOrientation(orientation, dimensionOptions)); }
      if ((event.key === "Delete" || event.key === "Backspace") && (selectedEntityIds.length || selectedConstraintIds.length || selectedDimensionKeys.length || selectedAxisConstraint) && !editingDimension && !editingConstraintId) { event.preventDefault(); deleteSelection(); }
      if (event.key === "Enter" && tool === "spline") finishSpline();
      if (event.ctrlKey && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
      if (event.ctrlKey && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  });

  useEffect(() => {
    if (!editingDimension && !editingConstraintId) return;
    const frame = requestAnimationFrame(() => { dimensionInputRef.current?.focus(); dimensionInputRef.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, [editingConstraintId, editingDimension]);

  const beginSelectionDrag = (event: React.PointerEvent<SVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); setEditingDimension(null); setEditingConstraintId(null); setSnap(null);
    setDraggingSelection({ pointerId: event.pointerId, start: pointFromEvent(event), originalEntities: entities, originalConstraints: constraints, originalDimensionOffsets: dimensionOffsets, moved: false });
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (selectionMarquee) {
      const current = pointFromEvent(event); setSelectionMarquee({ ...selectionMarquee, current }); setCursor(current); setSnap(null); return;
    }
    if (draggingSelection) {
      const current = pointFromEvent(event); const delta = { x: current.x - draggingSelection.start.x, y: current.y - draggingSelection.start.y };
      const entityIds = new Set(selectedEntityIds);
      const translatedEntities = draggingSelection.originalEntities.map((entity) => entityIds.has(entity.id) ? translateSketchEntity(entity, delta) : entity);
      const nextEntities = synchronizeMirrorLinks(translatedEntities, draggingSelection.originalConstraints.filter((constraint): constraint is MirrorConstraint => constraint.type === "mirror"), entityIds);
      const modelScale = dimensionModelScale();
      const nextOffsets = { ...draggingSelection.originalDimensionOffsets };
      selectedDimensionKeys.forEach((key) => {
        const dimension = allDimensions.find((candidate) => candidate.key === key);
        if (dimension && entityIds.has(dimension.entityId)) return;
        const original = draggingSelection.originalDimensionOffsets[key] ?? { x: 0, y: 0 };
        nextOffsets[key] = { x: original.x + delta.x / modelScale, y: original.y + delta.y / modelScale };
      });
      const nextConstraints = draggingSelection.originalConstraints.map((constraint) => {
        if (constraint.type === "mirror") return constraint;
        const positioned = selectedConstraintIds.includes(constraint.id) ? { ...constraint, position: { x: constraint.position.x + delta.x, y: constraint.position.y + delta.y } } : constraint;
        const actual = positioned.type === "linear" ? linearDimensionValue(positioned.first, positioned.second, positioned.orientation, nextEntities) : positioned.type === "angular" ? angularDimensionValue(positioned.first, positioned.second, positioned.position, nextEntities) : diameterDimensionValue(positioned.entityId, nextEntities);
        return { ...positioned, conflicted: Math.abs(actual - positioned.value) > (positioned.type === "angular" ? 0.1 : 0.01) };
      });
      setEntitiesState(nextEntities); onChange?.(nextEntities); setDimensionOffsets(nextOffsets); onDimensionOffsetsChange?.(nextOffsets); setConstraintsState(nextConstraints); onConstraintsChange?.(nextConstraints);
      setDraggingSelection({ ...draggingSelection, moved: true }); setCursor(current); setSnap(null); return;
    }
    if (draggingConstraint) {
      const position = pointFromEvent(event); const next = constraints.map((constraint) => constraint.id === draggingConstraint.id ? { ...constraint, position } : constraint);
      setConstraintsState(next); onConstraintsChange?.(next); return;
    }
    if (draggingSplineHandle) {
      const raw = pointFromEvent(event); const source = entities.find((entity) => entity.id === draggingSplineHandle.entityId);
      if (!source || source.type !== "spline") return;
      const handles = (source.handles?.length === source.points.length ? source.handles : automaticSplineHandles(source.points)).map((pair) => ({ in: { ...pair.in }, out: { ...pair.out } }));
      const point = source.points[draggingSplineHandle.pointIndex]; handles[draggingSplineHandle.pointIndex][draggingSplineHandle.side] = raw;
      if (event.altKey) { const opposite = draggingSplineHandle.side === "in" ? "out" : "in"; handles[draggingSplineHandle.pointIndex][opposite] = { x: point.x * 2 - raw.x, y: point.y * 2 - raw.y }; }
      const closed = source.points.length > 2 && distance(source.points[0], source.points.at(-1)!) < 0.001;
      if (closed && (draggingSplineHandle.pointIndex === 0 || draggingSplineHandle.pointIndex === source.points.length - 1)) { const pairedIndex = draggingSplineHandle.pointIndex === 0 ? source.points.length - 1 : 0; handles[pairedIndex] = { in: { ...handles[draggingSplineHandle.pointIndex].in }, out: { ...handles[draggingSplineHandle.pointIndex].out } }; }
      const next = synchronizeMirrors(entities.map((entity) => entity.id === source.id ? { ...source, handles } : entity)); setEntitiesState(next); onChange?.(next); setCursor(raw); return;
    }
    if (draggingDimension) {
      const raw = pointFromEvent(event);
      const dimensionScale = dimensionModelScale();
      setDimensionOffsets((offsets) => {
        const next = { ...offsets, [draggingDimension.key]: {
          x: draggingDimension.originalOffset.x + (raw.x - draggingDimension.startPoint.x) / dimensionScale,
          y: draggingDimension.originalOffset.y + (raw.y - draggingDimension.startPoint.y) / dimensionScale,
        } };
        onDimensionOffsetsChange?.(next);
        return next;
      });
      return;
    }
    if (dragging) {
      const raw = pointFromEvent(event);
      const activeSnap = findSnap(raw, undefined, dragging.entityId);
      let nextPoint = activeSnap?.point ?? raw;
      const source = entities.find((entity) => entity.id === dragging.entityId);
      if (!source) return;
      const currentPoint = controlPointsForEntity(source).find((control) => control.handle === dragging.handle)?.point ?? dragging.originalPoint;
      nextPoint = constrainedEndpoint(source, dragging.handle, nextPoint);
      for (const entity of entities) {
        if (entity.id === source.id || entity.type !== "line") continue;
        if (distance(entity.a, currentPoint) < 0.001) nextPoint = constrainedEndpoint(entity, "a", nextPoint);
        else if (distance(entity.b, currentPoint) < 0.001) nextPoint = constrainedEndpoint(entity, "b", nextPoint);
      }
      let next = entities.map((entity) => entity.id === dragging.entityId ? moveControlPoint(entity, dragging.handle, nextPoint) : entity);
      const propagates = dragging.handle === "a" || dragging.handle === "b" || (dragging.handle.startsWith("point-") && (dragging.handle === "point-0" || dragging.handle === `point-${source.type === "spline" ? source.points.length - 1 : -1}`));
      if (propagates) next = next.map((entity) => entity.id === dragging.entityId ? entity : replaceConnectedPoint(entity, currentPoint, nextPoint));
      next = synchronizeMirrors(next); setEntitiesState(next); onChange?.(next); const nextConstraints = constraintsForGeometry(next); setConstraintsState(nextConstraints); onConstraintsChange?.(nextConstraints); setCursor(nextPoint); setSnap(activeSnap); return;
    }
    const raw = pointFromEvent(event);
    if ((tool === "linear-dimension" || tool === "angular-dimension") && dimensionReferences.length === 2 || tool === "diameter-dimension" && diameterEntityId) { setCursor(raw); setSnap(null); return; }
    const nextSnap = findSnap(raw, draft.at(-1)); setSnap(nextSnap); setCursor(nextSnap?.point ?? raw);
  };
  const beginDrag = (event: React.PointerEvent<SVGCircleElement>, entityId: string, handle: string, originalPoint: Point) => {
    if (tool !== "select") return;
    event.preventDefault(); event.stopPropagation();
    if (event.shiftKey) { setSelectedEntityIds((ids) => ids.includes(entityId) ? ids.filter((id) => id !== entityId) : [...ids, entityId]); return; }
    dragStartRef.current = entities;
    setSelected(entityId); setSelectedConstraintId(null); setSelectedDimensionKeys([]); setEditingConstraintId(null);
    setDragging({ entityId, handle, pointerId: event.pointerId, originalPoint });
    svgRef.current?.setPointerCapture(event.pointerId);
  };
  const beginSplineHandleDrag = (event: React.PointerEvent<SVGCircleElement>, entityId: string, pointIndex: number, side: "in" | "out") => {
    event.preventDefault(); event.stopPropagation(); dragStartRef.current = entities;
    setDraggingSplineHandle({ entityId, pointIndex, side, pointerId: event.pointerId, captureTarget: event.currentTarget }); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const beginDimensionDrag = (event: React.PointerEvent<SVGGElement>, dimension: DimensionInfo) => {
    if (event.button !== 0) return;
    if (selectedDimensionKeys.includes(dimension.key) && selectedEntityIds.length + selectedConstraintIds.length + selectedDimensionKeys.length > 1) { beginSelectionDrag(event); return; }
    event.stopPropagation();
    setTool("select"); setSelected(null); setSelectedConstraintId(null); setSelectedDimensionKeys([dimension.key]); setEditingConstraintId(null); setEditingDimension(null);
    setDraggingDimension({ key: dimension.key, pointerId: event.pointerId, startPoint: pointFromEvent(event), originalOffset: dimensionOffsets[dimension.key] ?? { x: 0, y: 0 }, captureTarget: event.currentTarget });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const beginConstraintDrag = (event: React.PointerEvent<SVGGElement>, constraint: SketchConstraint) => {
    if (event.button !== 0) return;
    if (selectedConstraintIds.includes(constraint.id) && selectedEntityIds.length + selectedConstraintIds.length + selectedDimensionKeys.length > 1) { beginSelectionDrag(event); return; }
    event.stopPropagation(); setTool("select"); setSelected(null); setSelectedConstraintId(constraint.id); setSelectedDimensionKeys([]); setEditingDimension(null); setEditingConstraintId(null);
    setDraggingConstraint({ id: constraint.id, pointerId: event.pointerId, captureTarget: event.currentTarget }); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const finishDrag = (event?: React.PointerEvent<SVGSVGElement>) => {
    if (selectionMarquee) {
      const end = event ? pointFromEvent(event) : selectionMarquee.current; const box = normalizedSelectionBox(selectionMarquee.start, end);
      setSelectedEntityIds(entities.filter((entity) => entityInSelectionBox(entity, selectionMarquee.start, end)).map((entity) => entity.id));
      setSelectedConstraintIds(constraints.filter((constraint) => constraint.type !== "mirror" && pointInSelectionBox(constraintLabelPoint(constraint), box)).map((constraint) => constraint.id));
      setSelectedDimensionKeys(visibleDimensions.filter((dimension) => pointInSelectionBox(dimensionPosition(dimension), box)).map((dimension) => dimension.key));
      if (svgRef.current?.hasPointerCapture(selectionMarquee.pointerId)) svgRef.current.releasePointerCapture(selectionMarquee.pointerId);
      setSelectionMarquee(null); setSnap(null); return;
    }
    if (draggingSelection) {
      if (svgRef.current?.hasPointerCapture(draggingSelection.pointerId)) svgRef.current.releasePointerCapture(draggingSelection.pointerId);
      if (draggingSelection.moved) { setHistory((items) => [...items.slice(-39), draggingSelection.originalEntities]); setFuture([]); }
      setDraggingSelection(null); setSnap(null); return;
    }
    if (draggingConstraint) {
      if (draggingConstraint.captureTarget.hasPointerCapture(draggingConstraint.pointerId)) draggingConstraint.captureTarget.releasePointerCapture(draggingConstraint.pointerId);
      setDraggingConstraint(null); return;
    }
    if (draggingDimension) {
      if (draggingDimension.captureTarget.hasPointerCapture(draggingDimension.pointerId)) draggingDimension.captureTarget.releasePointerCapture(draggingDimension.pointerId);
      setDraggingDimension(null); return;
    }
    if (draggingSplineHandle) {
      if (draggingSplineHandle.captureTarget.hasPointerCapture(draggingSplineHandle.pointerId)) draggingSplineHandle.captureTarget.releasePointerCapture(draggingSplineHandle.pointerId);
      if (dragStartRef.current) setHistory((items) => [...items.slice(-39), dragStartRef.current!]); setFuture([]); dragStartRef.current = null; setDraggingSplineHandle(null); return;
    }
    if (!dragging) return;
    if (svgRef.current?.hasPointerCapture(dragging.pointerId)) svgRef.current.releasePointerCapture(dragging.pointerId);
    if (dragStartRef.current) setHistory((items) => [...items.slice(-39), dragStartRef.current!]);
    setFuture([]); dragStartRef.current = null; setDragging(null); setSnap(null);
  };
  const relationFrom = (activeSnap: Snap | null) => activeSnap ? ({ horizontal: "Horizontal", vertical: "Vertical", endpoint: "Coincident", midpoint: "Midpoint", center: "Concentric", quadrant: "Quadrant", grid: "Grid" }[activeSnap.kind]) : "Free";
  const applyAxisConstraint = (entityId: string, relation: AxisRelation) => {
    const source = entities.find((entity) => entity.id === entityId);
    if (!source || source.type !== "line") return;
    const nextB = relation === "Horizontal" ? { x: source.b.x, y: source.a.y } : { x: source.a.x, y: source.b.y };
    const constrained = { ...source, b: nextB, axisConstraint: relation, relations: [...(source.relations ?? []).filter((item) => item !== "Horizontal" && item !== "Vertical"), relation] };
    const next = entities.map((entity) => entity.id === source.id ? constrained : replaceConnectedPoint(entity, source.b, nextB));
    commit(next); setSelected(entityId); setSelectedAxisConstraint({ entityId, relation }); setConstraintShortcut(null);
  };
  const applyPerpendicularConstraint = (firstId: string, second: Extract<SketchEntity, { type: "line" }>, click: Point) => {
    const first = entities.find((candidate): candidate is Extract<SketchEntity, { type: "line" }> => candidate.id === firstId && candidate.type === "line");
    if (!first || first.id === second.id) return null;
    const adjustedSecond = perpendicularLineToReference(first, second, click);
    if (!adjustedSecond) return null;
    const firstWithRelation = { ...first, relations: [...new Set([...(first.relations ?? []), "Perpendicular"])] };
    return entities.map((entity) => entity.id === first.id ? firstWithRelation : entity.id === second.id ? adjustedSecond : replaceConnectedPoint(replaceConnectedPoint(entity, second.a, adjustedSecond.a), second.b, adjustedSecond.b));
  };
  const openConstraintShortcut = (event: React.MouseEvent<SVGElement>, entity: SketchEntity) => {
    if (entity.type === "spline") {
      event.preventDefault(); event.stopPropagation(); setConstraintShortcut(null);
      const point = pointFromEvent(event); const pointTolerance = Math.max(nodeDiameterPx * 1.75, 9) / Math.max(0.05, Math.min(40, view.zoom));
      const pointIndex = entity.points.reduce((nearest, candidate, index) => distance(point, candidate) < distance(point, entity.points[nearest]) ? index : nearest, 0);
      const onPoint = distance(point, entity.points[pointIndex]) <= pointTolerance;
      setSplineContextMenu({ x: event.clientX, y: event.clientY, entityId: entity.id, kind: onPoint ? "point" : "curve", pointIndex: onPoint ? pointIndex : undefined, point });
      setSelected(entity.id); setTool("select"); return;
    }
    if (entity.type !== "line") return;
    event.preventDefault(); event.stopPropagation();
    setSplineContextMenu(null);
    const relation: AxisRelation = Math.abs(entity.b.x - entity.a.x) >= Math.abs(entity.b.y - entity.a.y) ? "Horizontal" : "Vertical";
    setConstraintShortcut({ x: event.clientX, y: event.clientY, entityId: entity.id, relation });
  };
  const remapSplineConstraints = (entityId: string, remapIndex: (index: number) => number | null) => constraints.flatMap((constraint) => {
    if (constraint.type === "mirror") return [constraint];
    const remapReference = (reference: SketchReference): SketchReference | null => {
      if (reference.kind !== "node" || reference.entityId !== entityId || !reference.handle.startsWith("point-")) return reference;
      const nextIndex = remapIndex(Number(reference.handle.slice(6)));
      return nextIndex === null ? null : { ...reference, handle: `point-${nextIndex}` };
    };
    const first = remapReference(constraint.first); const second = remapReference(constraint.second);
    return first && second ? [{ ...constraint, first, second }] : [];
  });
  const addSplinePointFromMenu = () => {
    if (!splineContextMenu || splineContextMenu.kind !== "curve") return;
    const source = entities.find((entity): entity is Extract<SketchEntity, { type: "spline" }> => entity.id === splineContextMenu.entityId && entity.type === "spline");
    if (!source) return;
    const inserted = insertSplinePoint(source, splineContextMenu.point);
    commit(entities.map((entity) => entity.id === source.id ? inserted.entity : entity));
    commitConstraints(remapSplineConstraints(source.id, (index) => index >= inserted.pointIndex ? index + 1 : index));
    setSelected(source.id); setSplineContextMenu(null);
  };
  const deleteSplinePointFromMenu = () => {
    if (!splineContextMenu || splineContextMenu.kind !== "point" || splineContextMenu.pointIndex === undefined) return;
    const source = entities.find((entity): entity is Extract<SketchEntity, { type: "spline" }> => entity.id === splineContextMenu.entityId && entity.type === "spline");
    if (!source) return;
    const closed = source.points.length > 2 && distance(source.points[0], source.points.at(-1)!) < 0.001; const uniqueCount = closed ? source.points.length - 1 : source.points.length;
    const removedIndex = closed && splineContextMenu.pointIndex === uniqueCount ? 0 : splineContextMenu.pointIndex;
    const nextSpline = deleteSplinePoint(source, splineContextMenu.pointIndex);
    if (!nextSpline) { setSplineContextMenu(null); return; }
    const remapIndex = (index: number) => {
      const normalized = closed && index === uniqueCount ? 0 : index;
      if (normalized === removedIndex) return null;
      if (!closed) return normalized > removedIndex ? normalized - 1 : normalized;
      const shifted = normalized > removedIndex ? normalized - 1 : normalized;
      return index === uniqueCount ? nextSpline.points.length - 1 : shifted;
    };
    commit(entities.map((entity) => entity.id === source.id ? nextSpline : entity)); commitConstraints(remapSplineConstraints(source.id, remapIndex));
    setSelected(source.id); setSplineContextMenu(null);
  };
  const onCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    setConstraintShortcut(null);
    setSplineContextMenu(null);
    if (tool === "select") {
      const start = pointFromEvent(event); event.preventDefault(); clearSelection(); setSelectionMarquee({ start, current: start, pointerId: event.pointerId }); setSnap(null); event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    if (tool === "trim") return;
    if (tool === "linear-dimension") { if (dimensionReferences.length === 2) placeLinearDimension(pointFromEvent(event)); return; }
    if (tool === "angular-dimension") { if (dimensionReferences.length === 2) placeAngularDimension(pointFromEvent(event)); return; }
    if (tool === "diameter-dimension") { if (diameterEntityId) commitDiameterDimension(diameterEntityId, pointFromEvent(event)); return; }
    const point = findSnap(pointFromEvent(event), draft.at(-1))?.point ?? pointFromEvent(event);
    if (tool === "line" || tool === "centerline") {
      if (!draft.length) { setDraft([point]); return; }
      const segmentStart = draft.at(-1)!;
      if (distance(segmentStart, point) < 0.01) return;
      const relations = [relationFrom(snap)];
      const next = { id: nextId(), type: "line" as const, a: segmentStart, b: point, construction: tool === "centerline", relations };
      const closesProfile = tool === "line" && draft.length >= 3 && distance(draft[0], point) < 0.01;
      commit([...entities, next]);
      if (closesProfile) { setDraft([]); setTool("select"); setSnap(null); }
      else setDraft([...draft, point]);
      return;
    }
    if (tool === "rectangle") {
      if (!draft.length) { setDraft([point]); return; }
      const a = draft[0]; const b = point;
      if (Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01) return;
      const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      const rectangle = corners.map((corner, index) => ({ id: nextId(), type: "line" as const, a: corner, b: corners[(index + 1) % 4], relations: [index % 2 ? "Vertical" : "Horizontal", "Coincident"] }));
      commit([...entities, ...rectangle]); setDraft([]); return;
    }
    if (tool === "circle") {
      if (!draft.length) setDraft([point]); else { commit([...entities, { id: nextId(), type: "circle", c: draft[0], r: Math.max(0.1, distance(draft[0], point)), relations: [relationFrom(snap)] }]); setDraft([]); }
      return;
    }
    if (tool === "ellipse") {
      if (draft.length < 2) setDraft([...draft, point]); else { commit([...entities, { id: nextId(), type: "ellipse", c: draft[0], rx: Math.max(0.1, Math.abs(draft[1].x - draft[0].x) || distance(draft[0], draft[1])), ry: Math.max(0.1, Math.abs(point.y - draft[0].y) || distance(draft[0], point)), relations: ["Center"] }]); setDraft([]); }
      return;
    }
    if (tool === "arc") {
      if (draft.length < 2) setDraft([...draft, point]); else { commit([...entities, { id: nextId(), type: "arc", a: draft[0], b: draft[1], through: point, relations: [relationFrom(snap)] }]); setDraft([]); }
      return;
    }
    if (tool === "spline") setDraft([...draft, point]);
  };

  const constraintsForGeometry = (nextEntities: SketchEntity[], drivingId?: string, drivingValue?: number) => constraints.map((constraint) => {
    if (constraint.type === "mirror") return constraint;
    if (constraint.id === drivingId) return { ...constraint, value: drivingValue ?? constraint.value, conflicted: false };
    const actual = constraint.type === "linear" ? linearDimensionValue(constraint.first, constraint.second, constraint.orientation, nextEntities) : constraint.type === "angular" ? angularDimensionValue(constraint.first, constraint.second, constraint.position, nextEntities) : diameterDimensionValue(constraint.entityId, nextEntities);
    return { ...constraint, conflicted: Math.abs(actual - constraint.value) > (constraint.type === "angular" ? 0.1 : 0.01) };
  });
  const moveConstraintReference = (sourceEntities: SketchEntity[], reference: SketchReference, target: Point): SketchEntity[] => {
    const source = sourceEntities.find((entity) => entity.id === reference.entityId);
    if (!source) return sourceEntities;
    if (reference.kind === "line" && source.type === "line") {
      const current = referencePoint(reference, sourceEntities); const delta = { x: target.x - current.x, y: target.y - current.y };
      const nextA = { x: source.a.x + delta.x, y: source.a.y + delta.y }; const nextB = { x: source.b.x + delta.x, y: source.b.y + delta.y };
      let next = sourceEntities.map((entity) => entity.id === source.id ? { ...source, a: nextA, b: nextB } : entity);
      next = next.map((entity) => entity.id === source.id ? entity : replaceConnectedPoint(replaceConnectedPoint(entity, source.a, nextA), source.b, nextB));
      return next;
    }
    if (reference.kind !== "node") return sourceEntities;
    const current = referencePoint(reference, sourceEntities);
    let next = sourceEntities.map((entity) => entity.id === source.id ? moveControlPoint(entity, reference.handle, target) : entity);
    const propagates = reference.handle === "a" || reference.handle === "b" || (reference.handle.startsWith("point-") && (reference.handle === "point-0" || reference.handle === `point-${source.type === "spline" ? source.points.length - 1 : -1}`));
    if (propagates) next = next.map((entity) => entity.id === source.id ? entity : replaceConnectedPoint(entity, current, target));
    return next;
  };
  const applyConstraintDimension = () => {
    const constraint = constraints.find((candidate) => candidate.id === editingConstraintId); const enteredValue = Number(dimensionValue);
    if (!constraint || constraint.type === "mirror" || !(enteredValue > 0)) { setEditingConstraintId(null); return; }
    if (constraint.type === "diameter") {
      const value = toMillimeters(enteredValue, unitSystem);
      const nextEntities = synchronizeMirrors(entities.map((entity) => entity.id === constraint.entityId && entity.type === "circle" ? { ...entity, r: value / 2 } : entity));
      const nextConstraints = constraintsForGeometry(nextEntities, constraint.id, value);
      setEntitiesState(nextEntities); onChange?.(nextEntities); commitConstraints(nextConstraints); setEditingConstraintId(null); return;
    }
    if (constraint.type === "angular") {
      if (!(enteredValue > 0 && enteredValue < 360) || constraint.second.kind !== "line") { setEditingConstraintId(null); return; }
      const firstLine = lineFor(constraint.first, entities); const secondLine = lineFor(constraint.second, entities);
      const target = firstLine && secondLine ? targetPointForAngularValue(firstLine, secondLine, constraint.position, enteredValue) : null;
      if (!target) { setEditingConstraintId(null); return; }
      const nextEntities = synchronizeMirrors(moveConstraintReference(entities, { kind: "node", entityId: constraint.second.entityId, handle: target.movingHandle }, target.target));
      const nextConstraints = constraintsForGeometry(nextEntities, constraint.id, enteredValue);
      setEntitiesState(nextEntities); onChange?.(nextEntities); commitConstraints(nextConstraints); setEditingConstraintId(null); return;
    }
    const value = toMillimeters(enteredValue, unitSystem);
    const [firstPoint, secondPoint] = dimensionReferencePoints(constraint.first, constraint.second, entities);
    const secondFixed = constraint.second.kind === "external-point" || constraint.second.kind === "external-line";
    const firstFixed = constraint.first.kind === "external-point" || constraint.first.kind === "external-line";
    if (firstFixed && secondFixed) { setEditingConstraintId(null); return; }
    const target = secondFixed ? targetPointForLinearValue(secondPoint, firstPoint, constraint.orientation, value) : targetPointForLinearValue(firstPoint, secondPoint, constraint.orientation, value);
    const nextEntities = synchronizeMirrors(moveConstraintReference(entities, secondFixed ? constraint.first : constraint.second, target));
    const nextConstraints = constraintsForGeometry(nextEntities, constraint.id, value);
    setEntitiesState(nextEntities); onChange?.(nextEntities); commitConstraints(nextConstraints); setEditingConstraintId(null);
  };
  const applyDimension = () => {
    if (!editingDimension) return;
    const enteredValue = Number(dimensionValue);
    if (!(enteredValue > 0)) { setEditingDimension(null); return; }
    const value = toMillimeters(enteredValue, unitSystem);
    const pointChanges: { source: string; from: Point; to: Point }[] = [];
    let next = entities.map((entity): SketchEntity => {
      if (entity.id !== editingDimension.entityId) return entity;
      if (entity.type === "line") { const current = distance(entity.a, entity.b); const scale = value / current; const b = { x: entity.a.x + (entity.b.x - entity.a.x) * scale, y: entity.a.y + (entity.b.y - entity.a.y) * scale }; pointChanges.push({ source: entity.id, from: entity.b, to: b }); return { ...entity, b }; }
      if (entity.type === "circle") return { ...entity, r: value / 2 };
      if (entity.type === "ellipse") return editingDimension.axis === "minor" ? { ...entity, ry: value / 2 } : { ...entity, rx: value / 2 };
      if (entity.type === "arc") { const circle = circumcircle(entity.a, entity.b, entity.through); const scale = value / circle.r; const a = { x: circle.c.x + (entity.a.x - circle.c.x) * scale, y: circle.c.y + (entity.a.y - circle.c.y) * scale }; const b = { x: circle.c.x + (entity.b.x - circle.c.x) * scale, y: circle.c.y + (entity.b.y - circle.c.y) * scale }; pointChanges.push({ source: entity.id, from: entity.a, to: a }, { source: entity.id, from: entity.b, to: b }); return { ...entity, a, b, through: { x: circle.c.x + (entity.through.x - circle.c.x) * scale, y: circle.c.y + (entity.through.y - circle.c.y) * scale } }; }
      const current = dimensionsFor(entity)[0].value; const origin = entity.points[0]; const scale = value / current; const points = entity.points.map((point) => ({ x: origin.x + (point.x - origin.x) * scale, y: origin.y + (point.y - origin.y) * scale })); pointChanges.push({ source: entity.id, from: entity.points.at(-1)!, to: points.at(-1)! }); return { ...entity, points };
    });
    for (const change of pointChanges) next = next.map((entity) => entity.id === change.source ? entity : replaceConnectedPoint(entity, change.from, change.to));
    commit(next); commitConstraints(constraintsForGeometry(next)); setEditingDimension(null);
  };

  const allDimensions = useMemo(() => entities.flatMap(dimensionsFor), [entities]);
  const activeEntity = entities.find((entity) => entity.id === selected);
  const preview = draft.length ? [...draft, cursor] : [];
  const safeZoom = Math.max(0.05, Math.min(40, view.zoom));
  const dimensionScreenScale = Math.max(0.65, Math.min(1.15, 1 - Math.log2(safeZoom) * 0.1));
  function dimensionModelScale() { return dimensionScreenScale / safeZoom; }
  const dimensionScale = dimensionModelScale();
  const dimensionLabelScale = dimensionScale * dimensionTextScale;
  const nodeRadius = nodeDiameterPx / 2 / safeZoom;
  const dimensionControlPoints = entities.flatMap((entity) => controlPointsForEntity(entity).map((control) => ({ entityId: entity.id, ...control })));
  const dimensionTextFor = (dimension: DimensionInfo) => {
    const entity = entities.find((candidate) => candidate.id === dimension.entityId);
    const value = formatLength(dimension.value, unitSystem);
    if (entity?.type === "circle") return `Ø ${value}`;
    if (entity?.type === "arc") return `R ${value}`;
    if (entity?.type === "spline") return `L ${value}`;
    return value;
  };
  const dimensionPosition = (dimension: DimensionInfo) => {
    const userOffset = dimensionOffsets[dimension.key] ?? { x: 0, y: 0 };
    return { x: dimension.anchor.x + (dimension.offset.x + userOffset.x) * dimensionScale, y: dimension.anchor.y + (dimension.offset.y + userOffset.y) * dimensionScale };
  };
  const constraintLabelPoint = (constraint: Exclude<SketchConstraint, MirrorConstraint>) => constraint.type === "linear" ? linearDimensionLayout(constraint.first, constraint.second, constraint.orientation, constraint.position, entities).label : constraint.type === "angular" ? angularDimensionLayout(constraint.first, constraint.second, constraint.position, entities).label : diameterDimensionLayout(constraint.entityId, constraint.position, entities).label;
  const createLineLengthDimension = (entity: Extract<SketchEntity, { type: "line" }>) => {
    const existing = constraints.find((constraint) => constraint.type === "linear" && constraintSupersedesSegmentDimension(constraint, entity));
    setDraft([]); setDimensionReferences([]); setDimensionMessage(null); setSnap(null); setEditingConstraintId(null); setEditingDimension(null); setSelected(null); setSelectedDimensionKeys([]);
    if (existing) { setSelectedConstraintId(existing.id); return; }
    const first: SketchReference = { kind: "node", entityId: entity.id, handle: "a" }; const second: SketchReference = { kind: "node", entityId: entity.id, handle: "b" };
    const offset = 34 / safeZoom; const position = defaultLinearDimensionPosition(first, second, "aligned", entities, offset);
    commitLinearDimension(first, second, "aligned", position);
  };
  const visibleDimensions = allDimensions.filter((dimension) => {
    if (hiddenDimensionKeys.includes(dimension.key)) return false;
    const entity = entities.find((candidate) => candidate.id === dimension.entityId);
    if (entity?.type === "circle" && constraints.some((constraint) => constraint.type === "diameter" && constraint.entityId === entity.id)) return false;
    return !entity || !constraints.some((constraint) => constraint.type === "linear" && constraintSupersedesOrthogonalProfileDimension(constraint, entity, entities));
  });
  const selectionCount = selectedEntityIds.length + selectedConstraintIds.length + selectedDimensionKeys.length;
  const marqueeBox = selectionMarquee ? normalizedSelectionBox(selectionMarquee.start, selectionMarquee.current) : null;
  const editingDimensionPosition = editingDimension ? dimensionPosition(editingDimension) : null;
  const editingConstraint = constraints.find((constraint): constraint is Exclude<SketchConstraint, MirrorConstraint> => constraint.id === editingConstraintId && constraint.type !== "mirror") ?? null;
  const editingConstraintPosition = editingConstraint ? constraintLabelPoint(editingConstraint) : null;
  const linearPreview = tool === "linear-dimension" && dimensionReferences.length === 2 ? linearDimensionLayout(dimensionReferences[0], dimensionReferences[1], dimensionOrientation, cursor, entities) : null;
  const angularPreview = tool === "angular-dimension" && dimensionReferences.length === 2 && (dimensionReferences[0].kind === "line" || dimensionReferences[0].kind === "external-line") && (dimensionReferences[1].kind === "line" || dimensionReferences[1].kind === "external-line") ? angularDimensionLayout(dimensionReferences[0], dimensionReferences[1], cursor, entities) : null;
  const diameterPreview = tool === "diameter-dimension" && diameterEntityId ? diameterDimensionLayout(diameterEntityId, cursor, entities) : null;
  const hasConstraintConflict = constraints.some((constraint) => constraint.conflicted);
  const viewWidth = VIEW.width / safeZoom; const viewHeight = VIEW.height / safeZoom;
  const viewX = view.center.x - viewWidth / 2; const viewY = view.center.y - viewHeight / 2;
  const highlightStyle = { "--sketch-highlight-width": `${highlightWidthPx}px` } as CSSProperties;
  const xAxisChosen = dimensionReferences.some((reference) => reference.kind === "external-line" && reference.referenceId === "sketch-axis:x");
  const yAxisChosen = dimensionReferences.some((reference) => reference.kind === "external-line" && reference.referenceId === "sketch-axis:y");
  const axisReference = (axis: "x" | "y"): Extract<SketchReference, { kind: "external-line" }> => axis === "x"
    ? { kind: "external-line", referenceId: "sketch-axis:x", a: { x: viewX, y: 0 }, b: { x: viewX + viewWidth, y: 0 }, source: "sketch-axis" }
    : { kind: "external-line", referenceId: "sketch-axis:y", a: { x: 0, y: viewY }, b: { x: 0, y: viewY + viewHeight }, source: "sketch-axis" };
  const axisOrLineAt = (axis: "x" | "y", position: Point) => preferredAxisOrSketchLineTarget(position, axis, entities, 14 / safeZoom);
  const hoverAxisOrLine = (axis: "x" | "y", event: React.PointerEvent<SVGRectElement>) => {
    const target = axisOrLineAt(axis, pointFromEvent(event));
    setHoveredReferenceId(target.kind === "line" ? `line:${target.entityId}` : `sketch-axis:${axis}`);
  };
  const chooseAxisOrLine = (axis: "x" | "y", event: React.PointerEvent<SVGRectElement>) => {
    event.stopPropagation(); const position = pointFromEvent(event); const target = axisOrLineAt(axis, position);
    chooseDimensionReference(target.kind === "line" ? { kind: "line", entityId: target.entityId } : axisReference(axis), position);
  };
  const handleEntityPointerDown = (event: React.PointerEvent<SVGGElement>, entity: SketchEntity) => {
    if (tool === "mirror") {
      event.preventDefault(); event.stopPropagation();
      if (!selectedEntityIds.length || event.shiftKey) {
        setSelectedEntityIds((ids) => ids.includes(entity.id) ? ids.filter((id) => id !== entity.id) : [...ids, entity.id]);
        setMirrorMessage("Geometry selected · click a straight line to set the mirror axis · Shift-click to add or remove geometry");
        return;
      }
      if (entity.type !== "line") { setMirrorMessage("Mirror needs a straight sketch line as its axis"); return; }
      const sources = entities.filter((candidate) => selectedEntityIds.includes(candidate.id) && candidate.id !== entity.id);
      if (!sources.length) { setMirrorMessage("Select geometry in addition to the straight line that will be the mirror axis"); return; }
      const copies = sources.map((source) => mirrorSketchEntity(source, entity, nextId()));
      const nextConstraint: MirrorConstraint = { id: `constraint-${crypto.randomUUID()}`, type: "mirror", axisEntityId: entity.id, pairs: sources.map((source, index) => ({ sourceId: source.id, mirroredId: copies[index].id })) };
      commit([...entities, ...copies]); commitConstraints([...constraints, nextConstraint]);
      setSelectedEntityIds(copies.map((copy) => copy.id)); setSelectedConstraintId(null); setSelectedDimensionKeys([]); setTool("select"); setMirrorMessage(null);
      return;
    }
    if (tool === "extend") {
      event.preventDefault(); event.stopPropagation(); const click = pointFromEvent(event);
      if (!extendSource) {
        if (entity.type !== "line" && entity.type !== "arc" && entity.type !== "circle") { setExtendMessage("Extend supports a straight line, arc, or circle as the first selection"); return; }
        setExtendSource({ entityId: entity.id, click }); setExtendMessage("Select the line or curve this entity should meet"); setSelected(entity.id); return;
      }
      if (extendSource.entityId === entity.id) return;
      const source = entities.find((candidate) => candidate.id === extendSource.entityId); const extended = source ? extendEntityToTarget(source, extendSource.click, entity) : null;
      if (!extended) { setExtendMessage("Those entities do not meet along the selected extension direction"); return; }
      commit(entities.map((item) => item.id === extended.id ? extended : item)); setExtendSource(null); setExtendMessage("Extended to the selected geometry"); setSelected(extended.id); return;
    }
    if (tool === "corner") {
      event.preventDefault(); event.stopPropagation(); const click = pointFromEvent(event);
      if (entity.type !== "line") { setCornerMessage("Corner only works with line segments"); return; }
      if (!cornerSource) {
        setCornerSource({ entityId: entity.id, click }); setCornerMessage("Select the second non-parallel line segment"); clearSelection(); setSelected(entity.id); return;
      }
      if (cornerSource.entityId === entity.id) return;
      const source = entities.find((candidate): candidate is Extract<SketchEntity, { type: "line" }> => candidate.id === cornerSource.entityId && candidate.type === "line");
      const result = source ? cornerLines(source, cornerSource.click, entity, click) : null;
      if (!result) { setCornerMessage("Corner needs two non-parallel line segments"); return; }
      const [first, second] = result;
      const next = entities.map((item) => item.id === first.id ? first : item.id === second.id ? second : item);
      commit(next); commitConstraints(constraintsForGeometry(next)); setCornerSource(null); setCornerMessage("Corner created"); setSelected(second.id); return;
    }
    if (tool === "perpendicular-constraint") {
      event.preventDefault(); event.stopPropagation(); const click = pointFromEvent(event);
      if (entity.type !== "line") { setPerpendicularMessage("Perpendicular needs two line segments"); return; }
      if (!perpendicularSource) {
        setPerpendicularSource(entity.id); setPerpendicularMessage("Select the second line segment"); clearSelection(); setSelected(entity.id); return;
      }
      if (perpendicularSource === entity.id) return;
      const next = applyPerpendicularConstraint(perpendicularSource, entity, click);
      if (!next) { setPerpendicularMessage("Perpendicular needs two valid line segments"); return; }
      commit(next); commitConstraints(constraintsForGeometry(next)); setPerpendicularSource(null); setPerpendicularMessage("Perpendicular relation added"); setSelected(entity.id); return;
    }
    if ((tool === "horizontal-constraint" || tool === "vertical-constraint") && entity.type === "line") { event.stopPropagation(); applyAxisConstraint(entity.id, tool === "horizontal-constraint" ? "Horizontal" : "Vertical"); return; }
    if (tool === "linear-dimension" && entity.type === "line") { event.stopPropagation(); const now = performance.now(); const previous = lineClickRef.current; if (previous?.entityId === entity.id && now - previous.at <= 500) { event.preventDefault(); lineClickRef.current = null; createLineLengthDimension(entity); return; } lineClickRef.current = { entityId: entity.id, at: now }; chooseDimensionReference({ kind: "line", entityId: entity.id }, pointFromEvent(event)); return; }
    if (tool === "angular-dimension" && entity.type === "line") { event.stopPropagation(); chooseDimensionReference({ kind: "line", entityId: entity.id }, pointFromEvent(event)); return; }
    if (tool === "diameter-dimension") {
      event.preventDefault(); event.stopPropagation();
      if (entity.type !== "circle") { setDimensionMessage("Diameter dimension requires a circle"); return; }
      const existing = constraints.find((constraint) => constraint.type === "diameter" && constraint.entityId === entity.id);
      if (existing) { setSelectedConstraintId(existing.id); setDiameterEntityId(null); setTool("select"); return; }
      setDiameterEntityId(entity.id); setCursor(pointFromEvent(event)); setDimensionMessage("Move the pointer and click to place the diameter dimension"); clearSelection(); return;
    }
    if (tool !== "select" && tool !== "trim") return;
    event.stopPropagation();
    if (tool === "trim") { const replacements = trimEntityAtPoint(entity, pointFromEvent(event), entities); commit(entities.flatMap((item) => item.id === entity.id ? replacements : [item])); setSelected(null); return; }
    if (event.shiftKey) {
      event.preventDefault();
      setSelectedEntityIds((ids) => ids.includes(entity.id) ? ids.filter((id) => id !== entity.id) : [...ids, entity.id]);
      setSelectedAxisConstraint(null); setSelectedConstraintId(null); setSelectedDimensionKeys([]); setTool("select"); return;
    }
    if (selectedEntityIds.includes(entity.id) && selectionCount > 1) { beginSelectionDrag(event); return; }
    setSelected(entity.id); setSelectedAxisConstraint(null); setSelectedConstraintId(null); setSelectedDimensionKeys([]); setTool("select");
  };
  const resetTransientToolState = () => {
    setDraft([]); setExtendSource(null); setExtendMessage(null); setCornerSource(null); setCornerMessage(null); setPerpendicularSource(null); setPerpendicularMessage(null); setMirrorMessage(null); setDimensionReferences([]); setDiameterEntityId(null); setDimensionMessage(null);
  };
  const chooseTool = (nextTool: Tool, options: { clear?: boolean; selected?: string | null } = {}) => {
    setTool(nextTool); resetTransientToolState();
    if (options.clear) clearSelection();
    if ("selected" in options) setSelected(options.selected ?? null);
  };
  const SketchCommandButton = ({ active = false, className = "", disabled = viewRotated, icon, label, title, onClick, pressed }: { active?: boolean; className?: string; disabled?: boolean; icon: React.ReactNode; label: string; title: string; onClick: () => void; pressed?: boolean }) => (
    <button type="button" disabled={disabled} className={`sketch-tool-button ${className} ${active && !disabled ? "active" : ""}`} aria-label={title} aria-pressed={pressed} title={title} onClick={onClick}><span className="sketch-tool-icon">{icon}</span><span className="sketch-tool-label">{label}</span></button>
  );
  const sketchingToolActive = tool === "line" || tool === "centerline" || tool === "rectangle" || tool === "circle" || tool === "ellipse" || tool === "arc" || tool === "spline";

  return <div className={`sketcher-shell ${viewRotated ? "view-rotated" : ""}`} style={highlightStyle}>
    <div className="sketch-commandbar">
      <div className="sketch-command-group admin-group" aria-label="Sketch administration tools"><b>Admin</b><div className="sketch-command-tools">
        <SketchCommandButton active={tool === "select"} icon="↖" label="Select" title="Select and edit sketch entities" onClick={() => chooseTool("select")} />
        <SketchCommandButton disabled={!history.length} icon="↶" label="Undo" title="Undo last sketch edit" onClick={undo} />
        <SketchCommandButton disabled={!future.length} icon="↷" label="Redo" title="Redo sketch edit" onClick={redo} />
        <SketchCommandButton className={showGrid ? "toggle-on" : ""} disabled={false} icon="▦" label="Grid" title={`${showGrid ? "Hide" : "Show"} sketch grid`} onClick={() => setShowGrid(!showGrid)} pressed={showGrid} />
        <SketchCommandButton className={snapEnabled ? "toggle-on" : ""} disabled={false} icon="◇" label="Snap" title={snapEnabled ? "Snapping enabled: nodes move between geometry and grid snap points" : "Snapping disabled: nodes move freely"} onClick={() => { setSnapEnabled(!snapEnabled); setSnap(null); }} pressed={snapEnabled} />
        <SketchCommandButton active={viewRotated} disabled={false} icon="⟂" label="Normal" title="Snap normal: align the view to the sketch plane" onClick={onSnapNormal} />
        <SketchCommandButton className="finish-sketch" disabled={false} icon="✓" label="Finish" title="Finish sketch" onClick={onFinish} /></div>
      </div>
      <div className="sketch-command-group geometry-group" aria-label="Sketch geometry tools"><b>Geometry</b><div className="sketch-command-tools">
        <SketchCommandButton active={tool === "line"} icon="╱" label="Line" title="Line: click points to create connected line segments" onClick={() => chooseTool("line")} />
        <SketchCommandButton active={tool === "centerline"} icon="┄" label="Center" title="Centerline: create construction line segments" onClick={() => chooseTool("centerline")} />
        <SketchCommandButton active={tool === "rectangle"} icon="▭" label="Rect" title="Rectangle: click two opposite corners" onClick={() => chooseTool("rectangle")} />
        <SketchCommandButton active={tool === "circle"} icon="○" label="Circle" title="Circle: click center, then radius" onClick={() => chooseTool("circle")} />
        <SketchCommandButton active={tool === "ellipse"} icon="⬭" label="Ellipse" title="Ellipse: click center, major radius, then minor radius" onClick={() => chooseTool("ellipse")} />
        <SketchCommandButton active={tool === "arc"} icon="⌒" label="Arc" title="3 point arc" onClick={() => chooseTool("arc")} />
        <SketchCommandButton active={tool === "spline"} icon="〰" label="Spline" title="Spline: click control points, Enter or double-click to finish" onClick={() => chooseTool("spline")} /></div>
      </div>
      <div className="sketch-command-group modify-group" aria-label="Sketch modification tools"><b>Modify</b><div className="sketch-command-tools">
        <SketchCommandButton active={tool === "trim"} icon="✂" label="Trim" title="Trim a sketch segment at its nearest intersections" onClick={() => chooseTool("trim")} />
        <SketchCommandButton active={tool === "extend"} icon="↗" label="Extend" title="Select a line, arc, or circle, then select the geometry it should meet" onClick={() => chooseTool("extend", { clear: true })} />
        <SketchCommandButton active={tool === "corner"} icon="⌜" label="Corner" title="Select two non-parallel line segments to trim or extend them into a corner" onClick={() => chooseTool("corner", { clear: true })} />
        {activeEntity?.type === "spline" && <SketchCommandButton icon="≈" label="Relax" title="Relax spline: reset tangent handles to a relaxed automatic curve" onClick={() => commit(entities.map((entity) => entity.id === activeEntity.id ? { ...activeEntity, handles: undefined } : entity))} />}</div>
      </div>
      <div className="sketch-command-group pattern-group" aria-label="Sketch pattern tools"><b>Patterns</b><div className="sketch-command-tools">
        <SketchCommandButton active={tool === "mirror"} icon={<span className="mirror-pattern-icon"><i/><i/></span>} label="Mirror" title="Mirror selected sketch geometry about a straight line and keep both sides linked" onClick={() => { chooseTool("mirror"); setMirrorMessage(selectedEntityIds.length ? "Click a straight line to set the mirror axis" : "Select geometry first · click an element, Shift-click to add more, then click the mirror line"); }} />
      </div></div>
      <div className="sketch-command-group constraint-group" aria-label="Sketch constraint tools"><b>Constraints</b><div className="sketch-command-tools">
        <SketchCommandButton active={tool === "linear-dimension"} className="constraint-tool" icon={<span className="linear-dimension-icon">↔</span>} label="Linear" title="Linear dimension constraint: select two nodes or lines, press Tab to change orientation, then click to place" onClick={() => chooseTool("linear-dimension", { selected: null })} />
        <SketchCommandButton active={tool === "angular-dimension"} className="constraint-tool" icon={<span className="angular-dimension-icon">∠</span>} label="Angle" title="Angular dimension constraint: select two non-parallel lines, then click to place" onClick={() => chooseTool("angular-dimension", { selected: null })} />
        <SketchCommandButton active={tool === "diameter-dimension"} className="constraint-tool diameter-constraint-tool" icon={<span className="diameter-dimension-icon">⌀</span>} label="Diameter" title="Diameter dimension constraint: select a circle, then click to place its driving diameter" onClick={() => chooseTool("diameter-dimension", { selected: null })} />
        <SketchCommandButton active={tool === "perpendicular-constraint"} className="constraint-tool perpendicular-constraint-tool" icon={<span className="perpendicular-constraint-icon" />} label="Perp" title="Perpendicular constraint: select two lines to make them meet at 90 degrees" onClick={() => chooseTool("perpendicular-constraint", { clear: true })} />
        <SketchCommandButton active={tool === "horizontal-constraint"} className="constraint-tool axis-constraint-tool" icon={<span className="axis-constraint-icon horizontal" />} label="Horiz" title="Lock a line horizontal" onClick={() => chooseTool("horizontal-constraint", { clear: true })} />
        <SketchCommandButton active={tool === "vertical-constraint"} className="constraint-tool axis-constraint-tool" icon={<span className="axis-constraint-icon vertical" />} label="Vert" title="Lock a line vertical" onClick={() => chooseTool("vertical-constraint", { clear: true })} /></div>
      </div>
    </div>
    <svg ref={svgRef} className={`sketch-canvas tool-${tool} ${dragging ? "dragging-point" : ""} ${draggingDimension ? "dragging-dimension" : ""} ${selectionMarquee ? "marquee-selecting" : ""} ${draggingSelection ? "dragging-selection" : ""}`} viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} preserveAspectRatio="xMidYMid slice" onPointerMove={onMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onPointerDown={onCanvasPointerDown} onDoubleClick={() => tool === "spline" && finishSpline()} onContextMenu={(event) => event.preventDefault()}>
      <defs><pattern id="minor-grid" width={gridSquareSize} height={gridSquareSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSquareSize} 0 L 0 0 0 ${gridSquareSize}`} className="minor-grid-line" /></pattern><pattern id="major-grid" width={gridSquareSize * 5} height={gridSquareSize * 5} patternUnits="userSpaceOnUse"><rect width={gridSquareSize * 5} height={gridSquareSize * 5} fill="url(#minor-grid)"/><path d={`M ${gridSquareSize * 5} 0 L 0 0 0 ${gridSquareSize * 5}`} className="major-grid-line" /></pattern></defs>
      {showGrid && <rect x={viewX} y={viewY} width={viewWidth} height={viewHeight} fill="url(#major-grid)" />}
      <line x1={viewX} y1="0" x2={viewX + viewWidth} y2="0" className={`sketch-axis x ${hoveredReferenceId === "sketch-axis:x" || xAxisChosen ? "reference-highlighted" : ""}`}/><line x1="0" y1={viewY} x2="0" y2={viewY + viewHeight} className={`sketch-axis y ${hoveredReferenceId === "sketch-axis:y" || yAxisChosen ? "reference-highlighted" : ""}`}/>
      {(tool === "linear-dimension" || tool === "angular-dimension") && externalReferences.map((reference) => {
        if (reference.points.length < 2) return null;
        const collapsed = reference.kind === "body-edge" && reference.points.every((point) => distance(point, reference.points[0]) < 0.05);
        const chooseExternalReference = (event: React.PointerEvent<SVGElement>) => { event.stopPropagation(); const position = pointFromEvent(event); if (reference.kind === "plane-intersection") chooseDimensionReference({ kind: "external-line", referenceId: reference.id, a: reference.points[0], b: reference.points.at(-1)!, source: "plane-intersection" }, position); else if (tool === "linear-dimension") chooseDimensionReference({ kind: "external-point", referenceId: reference.id, point: nearestPointOnPath(position, reference.points), source: "body-edge" }, position); };
        return collapsed ? <circle key={reference.id} className="external-reference-point" aria-label={reference.label} cx={reference.points[0].x} cy={reference.points[0].y} r={nodeRadius * 1.25} onPointerDown={chooseExternalReference}/> : <polyline key={reference.id} className={`external-reference ${reference.kind}`} aria-label={reference.label} points={reference.points.map((point) => `${point.x},${point.y}`).join(" ")} onPointerDown={chooseExternalReference}/>;
      })}
      {entities.map((entity) => { const referenceId = `line:${entity.id}`; const dimensionLineTool = tool === "linear-dimension" || tool === "angular-dimension" || tool === "perpendicular-constraint" || tool === "mirror"; const referenceChosen = dimensionReferences.some((reference) => reference.kind === "line" && reference.entityId === entity.id); return <g key={entity.id} className={`sketch-entity ${selectedEntityIds.includes(entity.id) ? "selected" : ""} ${extendSource?.entityId === entity.id || cornerSource?.entityId === entity.id || perpendicularSource === entity.id ? "extend-source" : ""} ${entity.construction ? "construction" : ""} ${dimensionLineTool && entity.type === "line" || tool === "diameter-dimension" && entity.type === "circle" ? "constraint-selectable" : ""}`} onContextMenu={(event) => openConstraintShortcut(event, entity)} onPointerDown={(event) => handleEntityPointerDown(event, entity)}>
        {entity.type === "line" && <line className={hoveredReferenceId === referenceId || referenceChosen ? "reference-highlighted" : ""} x1={entity.a.x} y1={entity.a.y} x2={entity.b.x} y2={entity.b.y} />}
        {entity.type === "circle" && <circle cx={entity.c.x} cy={entity.c.y} r={entity.r} />}
        {entity.type === "ellipse" && <ellipse cx={entity.c.x} cy={entity.c.y} rx={entity.rx} ry={entity.ry} transform={entity.rotation ? `rotate(${entity.rotation * 180 / Math.PI} ${entity.c.x} ${entity.c.y})` : undefined} />}
        {entity.type === "arc" && <path d={arcPath(entity.a, entity.b, entity.through)} />}
        {entity.type === "spline" && <><path d={splinePath(entity.points, entity.handles)} /><path className="spline-hit" d={splinePath(entity.points, entity.handles)} /></>}
        {entity.type === "line" && <line className={`sketch-line-hit ${dimensionLineTool ? "constraint-line-hit" : ""}`} x1={entity.a.x} y1={entity.a.y} x2={entity.b.x} y2={entity.b.y} onPointerEnter={() => { if (dimensionLineTool) setHoveredReferenceId(referenceId); }} onPointerLeave={() => { if (dimensionLineTool) setHoveredReferenceId((current) => current === referenceId ? null : current); }} />}
        {(tool === "trim" || tool === "corner") && entity.type === "line" && <line className="trim-hit" x1={entity.a.x} y1={entity.a.y} x2={entity.b.x} y2={entity.b.y} />}
        {tool === "trim" && entity.type === "circle" && <circle className="trim-hit" cx={entity.c.x} cy={entity.c.y} r={entity.r} />}
        {tool === "trim" && entity.type === "ellipse" && <ellipse className="trim-hit" cx={entity.c.x} cy={entity.c.y} rx={entity.rx} ry={entity.ry} transform={entity.rotation ? `rotate(${entity.rotation * 180 / Math.PI} ${entity.c.x} ${entity.c.y})` : undefined} />}
        {tool === "trim" && entity.type === "arc" && <path className="trim-hit" d={arcPath(entity.a, entity.b, entity.through)} />}
        {tool === "trim" && entity.type === "spline" && <path className="trim-hit" d={splinePath(entity.points, entity.handles)} />}
        {entitySnapPoints(entity).map((candidate, index) => <circle key={index} className={`sketch-point ${candidate.kind}`} cx={candidate.point.x} cy={candidate.point.y} r={nodeRadius} />)}
      </g>; })}
      {tool === "select" && entities.map((entity) => <g key={`controls-${entity.id}`} className={`control-layer ${selectedEntityIds.includes(entity.id) ? "active" : "inactive"}`}>{controlPointsForEntity(entity).map((control) => <circle key={control.handle} className="control-point" cx={control.point.x} cy={control.point.y} r={nodeRadius * (selectedEntityIds.includes(entity.id) ? 1.25 : 1)} onPointerDown={(event) => beginDrag(event, entity.id, control.handle, control.point)} onContextMenu={entity.type === "spline" ? (event) => openConstraintShortcut(event, entity) : undefined} />)}</g>)}
      {tool === "select" && entities.filter((entity): entity is Extract<SketchEntity, { type: "spline" }> => entity.type === "spline" && selectedEntityIds.includes(entity.id)).map((entity) => { const handles = entity.handles?.length === entity.points.length ? entity.handles : automaticSplineHandles(entity.points); return <g key={`spline-handles-${entity.id}`} className="spline-handle-layer">{entity.points.flatMap((point, index) => ([<line key={`${index}-in-line`} x1={point.x} y1={point.y} x2={handles[index].in.x} y2={handles[index].in.y}/>, <line key={`${index}-out-line`} x1={point.x} y1={point.y} x2={handles[index].out.x} y2={handles[index].out.y}/>, <circle key={`${index}-in`} cx={handles[index].in.x} cy={handles[index].in.y} r={nodeRadius * .9} onPointerDown={(event) => beginSplineHandleDrag(event, entity.id, index, "in")}/>, <circle key={`${index}-out`} cx={handles[index].out.x} cy={handles[index].out.y} r={nodeRadius * .9} onPointerDown={(event) => beginSplineHandleDrag(event, entity.id, index, "out")}/>]))}</g>; })}
      {(tool === "linear-dimension" || tool === "angular-dimension") && <g className="axis-reference-layer">
        <rect x={viewX} y={-11 / safeZoom} width={viewWidth} height={22 / safeZoom} className="axis-reference-hit x" role="button" tabIndex={0} aria-label="Red sketch X axis" onPointerEnter={(event) => hoverAxisOrLine("x", event)} onPointerMove={(event) => hoverAxisOrLine("x", event)} onPointerLeave={() => setHoveredReferenceId(null)} onPointerDown={(event) => chooseAxisOrLine("x", event)}/>
        <rect x={-11 / safeZoom} y={viewY} width={22 / safeZoom} height={viewHeight} className="axis-reference-hit y" role="button" tabIndex={0} aria-label="Green sketch Y axis" onPointerEnter={(event) => hoverAxisOrLine("y", event)} onPointerMove={(event) => hoverAxisOrLine("y", event)} onPointerLeave={() => setHoveredReferenceId(null)} onPointerDown={(event) => chooseAxisOrLine("y", event)}/>
      </g>}
      {tool === "linear-dimension" && entities.map((entity) => <g key={`constraint-nodes-${entity.id}`} className="constraint-node-layer">{controlPointsForEntity(entity).map((control) => { const reference: SketchReference = { kind: "node", entityId: entity.id, handle: control.handle }; const referenceId = `node:${entity.id}:${control.handle}`; const chosen = dimensionReferences.some((candidate) => candidate.kind === "node" && candidate.entityId === reference.entityId && candidate.handle === reference.handle); const otherPoints = dimensionControlPoints.filter((candidate) => candidate.entityId !== entity.id || candidate.handle !== control.handle).map((candidate) => candidate.point); const preferredHitRadius = Math.max(nodeRadius, (entity.type === "line" ? 10 : 16) / safeZoom); const hitRadius = nonOverlappingReferenceHitRadius(control.point, otherPoints, preferredHitRadius, entity.type === "line" ? 0.22 : 0.45); const chooseNode = (event: React.PointerEvent<SVGCircleElement>) => { event.stopPropagation(); chooseDimensionReference(reference, pointFromEvent(event)); }; return <g key={control.handle}><circle className="constraint-node-hit" role="button" tabIndex={0} aria-label={`Dimension node ${entity.id} ${control.handle}`} cx={control.point.x} cy={control.point.y} r={hitRadius} onPointerEnter={() => setHoveredReferenceId(referenceId)} onPointerLeave={() => setHoveredReferenceId((current) => current === referenceId ? null : current)} onPointerDown={chooseNode} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseDimensionReference(reference, control.point); } }} /><circle className={`constraint-node ${hoveredReferenceId === referenceId || chosen ? "reference-highlighted" : ""}`} cx={control.point.x} cy={control.point.y} r={nodeRadius} /></g>; })}</g>)}
      {preview.length > 1 && <g className="sketch-preview">{tool === "circle" && draft[0] ? <circle cx={draft[0].x} cy={draft[0].y} r={distance(draft[0], cursor)} /> : tool === "ellipse" && draft.length === 2 ? <ellipse cx={draft[0].x} cy={draft[0].y} rx={Math.abs(draft[1].x - draft[0].x) || distance(draft[0], draft[1])} ry={Math.abs(cursor.y - draft[0].y)} /> : tool === "arc" && draft.length === 2 ? <path d={arcPath(draft[0], draft[1], cursor)} /> : tool === "rectangle" && draft[0] ? <rect x={Math.min(draft[0].x, cursor.x)} y={Math.min(draft[0].y, cursor.y)} width={Math.abs(cursor.x - draft[0].x)} height={Math.abs(cursor.y - draft[0].y)} /> : tool === "spline" ? <path d={splinePath(preview)} /> : <line x1={draft.at(-1)!.x} y1={draft.at(-1)!.y} x2={cursor.x} y2={cursor.y} />}</g>}
      {constraints.map((constraint) => {
        if (constraint.type === "mirror") return null;
        if (constraint.type === "diameter") {
          const layout = diameterDimensionLayout(constraint.entityId, constraint.position, entities);
          const actualValue = diameterDimensionValue(constraint.entityId, entities); const displayedValue = constraint.conflicted ? actualValue : constraint.value;
          const text = `⌀ ${formatLength(displayedValue, unitSystem)}`; const editableValue = fromMillimeters(displayedValue, unitSystem); const labelWidth = Math.max(42, text.length * 4.3 + 13);
          return <g key={constraint.id} className={`linear-constraint diameter-constraint ${constraint.conflicted ? "conflicted" : ""} ${selectedConstraintIds.includes(constraint.id) ? "selected" : ""}`}><line className="constraint-measure" x1={layout.first.x} y1={layout.first.y} x2={layout.second.x} y2={layout.second.y}/><path className="constraint-arrow" d={dimensionArrowPath(layout.first, layout.second, dimensionScale)}/><line className="constraint-extension" x1={layout.second.x} y1={layout.second.y} x2={layout.label.x} y2={layout.label.y}/><g className="constraint-label" role="button" tabIndex={0} aria-label={`Diameter dimension ${text}${constraint.conflicted ? ", over defined" : ""}`} transform={`translate(${layout.label.x} ${layout.label.y}) scale(${dimensionLabelScale})`} onPointerDown={(event) => beginConstraintDrag(event, constraint)} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedConstraintId(constraint.id); setEditingDimension(null); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(editableValue.toFixed(4)))); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(editableValue.toFixed(4)))); } }}><rect x={-labelWidth / 2} y="-7" width={labelWidth} height="14" rx="3"/><text textAnchor="middle" dominantBaseline="central">{text}</text></g></g>;
        }
        if (constraint.type === "angular") {
          const layout = angularDimensionLayout(constraint.first, constraint.second, constraint.position, entities);
          const actualValue = angularDimensionValue(constraint.first, constraint.second, constraint.position, entities);
          const displayedValue = constraint.conflicted ? actualValue : constraint.value;
          const text = `${displayedValue.toFixed(1).replace(/\.0$/, "")}°`;
          const labelWidth = Math.max(38, text.length * 4.3 + 13);
          return <g key={constraint.id} className={`linear-constraint angular-constraint ${constraint.conflicted ? "conflicted" : ""} ${selectedConstraintIds.includes(constraint.id) ? "selected" : ""}`}><line className="constraint-extension" x1={layout.vertex.x} y1={layout.vertex.y} x2={layout.firstRay.x} y2={layout.firstRay.y}/><line className="constraint-extension" x1={layout.vertex.x} y1={layout.vertex.y} x2={layout.secondRay.x} y2={layout.secondRay.y}/><path className="constraint-measure" d={`M ${layout.firstRay.x} ${layout.firstRay.y} A ${layout.radius} ${layout.radius} 0 ${layout.largeArc ? 1 : 0} ${layout.sweep ? 1 : 0} ${layout.secondRay.x} ${layout.secondRay.y}`}/><g className="constraint-label" role="button" tabIndex={0} aria-label={`Angular dimension ${text}${constraint.conflicted ? ", over defined" : ""}`} transform={`translate(${layout.label.x} ${layout.label.y}) scale(${dimensionLabelScale})`} onPointerDown={(event) => beginConstraintDrag(event, constraint)} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedConstraintId(constraint.id); setEditingDimension(null); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(displayedValue.toFixed(4)))); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(displayedValue.toFixed(4)))); } }}><rect x={-labelWidth / 2} y="-7" width={labelWidth} height="14" rx="3"/><text textAnchor="middle" dominantBaseline="central">{text}</text></g></g>;
        }
        const layout = linearDimensionLayout(constraint.first, constraint.second, constraint.orientation, constraint.position, entities); const actualValue = linearDimensionValue(constraint.first, constraint.second, constraint.orientation, entities); const displayedValue = constraint.conflicted ? actualValue : constraint.value; const text = formatLength(displayedValue, unitSystem); const editableValue = fromMillimeters(displayedValue, unitSystem); const labelWidth = Math.max(38, text.length * 4.3 + 13); return <g key={constraint.id} className={`linear-constraint ${constraint.conflicted ? "conflicted" : ""} ${selectedConstraintIds.includes(constraint.id) ? "selected" : ""}`}><line className="constraint-extension" x1={layout.first.x} y1={layout.first.y} x2={layout.dimensionFirst.x} y2={layout.dimensionFirst.y}/><line className="constraint-extension" x1={layout.second.x} y1={layout.second.y} x2={layout.dimensionSecond.x} y2={layout.dimensionSecond.y}/><line className="constraint-measure" x1={layout.dimensionFirst.x} y1={layout.dimensionFirst.y} x2={layout.dimensionSecond.x} y2={layout.dimensionSecond.y}/><path className="constraint-arrow" d={dimensionArrowPath(layout.dimensionFirst, layout.dimensionSecond, dimensionScale)}/><g className="constraint-label" role="button" tabIndex={0} aria-label={`Linear dimension ${text}${constraint.conflicted ? ", over defined" : ""}`} transform={`translate(${layout.label.x} ${layout.label.y}) scale(${dimensionLabelScale})`} onPointerDown={(event) => beginConstraintDrag(event, constraint)} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedConstraintId(constraint.id); setEditingDimension(null); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(editableValue.toFixed(4)))); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(editableValue.toFixed(4)))); } }}><rect x={-labelWidth / 2} y="-7" width={labelWidth} height="14" rx="3"/><text textAnchor="middle" dominantBaseline="central">{text}</text></g></g>;
      })}
      {linearPreview && <g className="linear-constraint preview"><line className="constraint-extension" x1={linearPreview.first.x} y1={linearPreview.first.y} x2={linearPreview.dimensionFirst.x} y2={linearPreview.dimensionFirst.y}/><line className="constraint-extension" x1={linearPreview.second.x} y1={linearPreview.second.y} x2={linearPreview.dimensionSecond.x} y2={linearPreview.dimensionSecond.y}/><line className="constraint-measure" x1={linearPreview.dimensionFirst.x} y1={linearPreview.dimensionFirst.y} x2={linearPreview.dimensionSecond.x} y2={linearPreview.dimensionSecond.y}/><path className="constraint-arrow" d={dimensionArrowPath(linearPreview.dimensionFirst, linearPreview.dimensionSecond, dimensionScale)}/><g className="constraint-preview-label" transform={`translate(${linearPreview.label.x} ${linearPreview.label.y}) scale(${dimensionLabelScale})`}><rect x="-32" y="-12" width="64" height="24" rx="4"/><text y="-2" textAnchor="middle">{formatLength(linearPreview.value, unitSystem)}</text><text y="7" textAnchor="middle" className="orientation-hint">{dimensionOrientation} · Tab</text></g></g>}
      {angularPreview && <g className="linear-constraint angular-constraint preview"><line className="constraint-extension" x1={angularPreview.vertex.x} y1={angularPreview.vertex.y} x2={angularPreview.firstRay.x} y2={angularPreview.firstRay.y}/><line className="constraint-extension" x1={angularPreview.vertex.x} y1={angularPreview.vertex.y} x2={angularPreview.secondRay.x} y2={angularPreview.secondRay.y}/><path className="constraint-measure" d={`M ${angularPreview.firstRay.x} ${angularPreview.firstRay.y} A ${angularPreview.radius} ${angularPreview.radius} 0 ${angularPreview.largeArc ? 1 : 0} ${angularPreview.sweep ? 1 : 0} ${angularPreview.secondRay.x} ${angularPreview.secondRay.y}`}/><g className="constraint-preview-label" transform={`translate(${angularPreview.label.x} ${angularPreview.label.y}) scale(${dimensionLabelScale})`}><rect x="-32" y="-10" width="64" height="20" rx="4"/><text textAnchor="middle" dominantBaseline="central">{`${angularPreview.value.toFixed(1).replace(/\.0$/, "")}°`}</text></g></g>}
      {diameterPreview && <g className="linear-constraint diameter-constraint preview"><line className="constraint-measure" x1={diameterPreview.first.x} y1={diameterPreview.first.y} x2={diameterPreview.second.x} y2={diameterPreview.second.y}/><path className="constraint-arrow" d={dimensionArrowPath(diameterPreview.first, diameterPreview.second, dimensionScale)}/><line className="constraint-extension" x1={diameterPreview.second.x} y1={diameterPreview.second.y} x2={diameterPreview.label.x} y2={diameterPreview.label.y}/><g className="constraint-preview-label" transform={`translate(${diameterPreview.label.x} ${diameterPreview.label.y}) scale(${dimensionLabelScale})`}><rect x="-32" y="-10" width="64" height="20" rx="4"/><text textAnchor="middle" dominantBaseline="central">{`⌀ ${formatLength(diameterPreview.value, unitSystem)}`}</text></g></g>}
      {visibleDimensions.map((dimension) => { const position = dimensionPosition(dimension); const text = dimensionTextFor(dimension); const editableValue = fromMillimeters(dimension.value, unitSystem); const labelWidth = Math.max(36, text.length * 4.3 + 13); const moved = dimensionOffsets[dimension.key] && (Math.abs(dimensionOffsets[dimension.key].x) > 0.1 || Math.abs(dimensionOffsets[dimension.key].y) > 0.1); return <g key={dimension.key} className={`dimension-annotation ${selectedDimensionKeys.includes(dimension.key) ? "selected" : ""}`}>{moved && <line className="dimension-leader" x1={dimension.anchor.x} y1={dimension.anchor.y} x2={position.x} y2={position.y}/>}<g className="sketch-dimension" role="button" tabIndex={0} aria-label={`Edit dimension ${text}`} transform={`translate(${position.x} ${position.y}) scale(${dimensionLabelScale})`} onPointerDown={(event) => beginDimensionDrag(event, dimension)} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setTool("select"); setEditingConstraintId(null); setSelectedConstraintId(null); setEditingDimension(dimension); setDimensionValue(String(Number(editableValue.toFixed(4)))); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setEditingConstraintId(null); setSelectedConstraintId(null); setEditingDimension(dimension); setDimensionValue(String(Number(editableValue.toFixed(4)))); } }}><line x1={-labelWidth / 2 - 5} y1="0" x2={labelWidth / 2 + 5} y2="0"/><path d={`M${-labelWidth / 2 - 5} 0 l4 -2 v4z M${labelWidth / 2 + 5} 0 l-4 -2 v4z`}/><rect x={-labelWidth / 2} y="-7" width={labelWidth} height="14" rx="3"/><text textAnchor="middle" dominantBaseline="central">{text}</text></g></g>; })}
      {selectionMarquee && marqueeBox && <rect className={`sketch-selection-box ${selectionMarquee.current.x < selectionMarquee.start.x ? "crossing" : "window"}`} x={marqueeBox.left} y={marqueeBox.top} width={marqueeBox.right - marqueeBox.left} height={marqueeBox.bottom - marqueeBox.top}/>}
      {entities.filter((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.type === "line" && Boolean(entity.axisConstraint)).map((entity) => { const relation = entity.axisConstraint!; const center = midpoint(entity.a, entity.b); const dx = entity.b.x - entity.a.x; const dy = entity.b.y - entity.a.y; const length = Math.max(distance(entity.a, entity.b), 0.001); const position = { x: center.x - dy / length * 10 / safeZoom, y: center.y + dx / length * 10 / safeZoom }; const selectedRelation = selectedAxisConstraint?.entityId === entity.id && selectedAxisConstraint.relation === relation; return <g key={`locked-${entity.id}`} role="button" tabIndex={0} aria-label={`${relation} constraint; select and press Delete to remove`} transform={`translate(${position.x} ${position.y}) scale(${1 / safeZoom})`} className={`locked-axis-constraint ${selectedRelation ? "selected" : ""}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); clearSelection(); setSelectedAxisConstraint({ entityId: entity.id, relation }); setTool("select"); }}><rect x="-5" y="-5" width="10" height="10" rx="2"/><text textAnchor="middle" dominantBaseline="central">{relation === "Horizontal" ? "H" : "V"}</text></g>; })}
      {constraints.filter((constraint): constraint is MirrorConstraint => constraint.type === "mirror").flatMap((constraint) => constraint.pairs.map((pair, index) => {
        const mirrored = entities.find((entity) => entity.id === pair.mirroredId); if (!mirrored) return null;
        const anchor = entityBadgePoint(mirrored); const selectedMirror = selectedConstraintIds.includes(constraint.id);
        return <g key={`${constraint.id}-${index}`} role="button" tabIndex={0} aria-label="Mirror constraint; select and press Delete to unlink" transform={`translate(${anchor.x + 8 / safeZoom} ${anchor.y - 8 / safeZoom}) scale(${1 / safeZoom})`} className={`mirror-constraint-badge ${selectedMirror ? "selected" : ""}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); clearSelection(); setSelectedConstraintId(constraint.id); setTool("select"); }}><rect x="-4" y="-4" width="8" height="8" rx="1.5"/><text textAnchor="middle" dominantBaseline="central">M</text></g>;
      }))}
      {entities.flatMap((entity) => entity.type === "spline" ? [] : entity.relations?.map((relation, index) => ({ entity, relation, index })).filter(({ relation }) => entity.axisConstraint !== relation && sketchRelationIsSatisfied(entity, relation) && (relation === "Horizontal" || relation === "Vertical" || relation === "Coincident" || relation === "Concentric" || relation === "Perpendicular")) ?? []).map(({ entity, relation, index }) => { const point = entity.type === "line" ? midpoint(entity.a, entity.b) : entity.type === "circle" || entity.type === "ellipse" ? entity.c : entity.type === "arc" ? entity.through : entity.points[0]; return <text key={`${entity.id}-${index}`} x={point.x + 5 + index * 8} y={point.y + 9} className="relation-glyph">{relation === "Horizontal" ? "H" : relation === "Vertical" ? "V" : relation === "Coincident" ? "●" : relation === "Perpendicular" ? "⊥" : "◎"}</text>; })}
      {snap && sketchingToolActive && <g className={`snap-marker ${snap.kind}`}><circle cx={snap.point.x} cy={snap.point.y} r={gridSquareSize / 2}/><text x={snap.point.x + 7} y={snap.point.y - 7}>{snap.kind}</text></g>}
      {editingDimension && editingDimensionPosition && <foreignObject x="-36" y="-16" width="72" height="32" transform={`translate(${editingDimensionPosition.x} ${editingDimensionPosition.y}) scale(${dimensionLabelScale})`}><input ref={dimensionInputRef} className="dimension-editor" aria-label="Dimension value" value={dimensionValue} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => setDimensionValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyDimension(); if (event.key === "Escape") setEditingDimension(null); }} onBlur={applyDimension} /></foreignObject>}
      {editingConstraint && editingConstraintPosition && <foreignObject x="-38" y="-16" width="76" height="32" transform={`translate(${editingConstraintPosition.x} ${editingConstraintPosition.y}) scale(${dimensionLabelScale})`}><input ref={dimensionInputRef} className="dimension-editor constraint-editor" aria-label={editingConstraint.type === "angular" ? "Angular constraint value" : editingConstraint.type === "diameter" ? "Diameter constraint value" : "Linear constraint value"} value={dimensionValue} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => setDimensionValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyConstraintDimension(); if (event.key === "Escape") setEditingConstraintId(null); }} onBlur={applyConstraintDimension} /></foreignObject>}
    </svg>
    {constraintShortcut && <div className="sketch-constraint-shortcut" style={{ left: constraintShortcut.x, top: constraintShortcut.y }} role="menu" aria-label="Suggested line constraint"><button role="menuitem" title={`Apply ${constraintShortcut.relation.toLowerCase()} constraint`} onClick={() => applyAxisConstraint(constraintShortcut.entityId, constraintShortcut.relation)}><span className={`axis-constraint-icon ${constraintShortcut.relation.toLowerCase()}`} />{constraintShortcut.relation}</button></div>}
    {splineContextMenu && <div className="sketch-constraint-shortcut sketch-spline-context" style={{ left: splineContextMenu.x, top: splineContextMenu.y }} role="menu" aria-label="Spline point editing">{splineContextMenu.kind === "point" ? <button className="delete" role="menuitem" onClick={deleteSplinePointFromMenu}>Delete spline point</button> : <button className="add" role="menuitem" onClick={addSplinePointFromMenu}>Add spline point</button>}</div>}
    <div className={`sketch-status ${hasConstraintConflict ? "over-defined" : ""}`}><span>{viewRotated ? "Sketch view rotated · middle-drag orbit · right-drag pan · wheel zoom · Snap normal to edit" : tool === "mirror" ? mirrorMessage ?? "Mirror · select geometry, then select a separate straight line as the mirror axis" : tool === "extend" ? extendMessage ?? "Extend · select the line, arc, or circle to extend, then select its target geometry" : tool === "corner" ? cornerMessage ?? "Corner · select the first line segment, then the second non-parallel line segment" : tool === "perpendicular-constraint" ? perpendicularSource ? perpendicularMessage ?? "Perpendicular · select the second line segment" : perpendicularMessage ?? "Perpendicular · select the first line segment" : tool === "linear-dimension" ? dimensionReferences.length === 0 ? "Linear dimension · select references · double-click a line for its segment length" : dimensionReferences.length === 1 ? dimensionMessage ?? "Linear dimension · select the second reference · line references measure perpendicular distance" : `Linear dimension · move to position · Tab cycles ${dimensionOptions.join(" / ")} · click to place` : tool === "angular-dimension" ? dimensionReferences.length === 0 ? "Angular dimension · select the first line" : dimensionReferences.length === 1 ? dimensionMessage ?? "Angular dimension · select a second non-parallel line" : "Angular dimension · move to choose angle side · click to place" : tool === "diameter-dimension" ? diameterEntityId ? "Diameter dimension · move the label and click to place" : dimensionMessage ?? "Diameter dimension · select a circle" : "Wheel zoom · right-drag pan · middle-drag orbit · " + (tool === "select" ? "Shift-click adds/removes geometry · left-drag selection box · drag any selected item to move the group · Delete removes selection" : tool === "spline" ? "click control points · Enter or double-click to finish" : `${tool}: click to place points · Esc to finish`)}</span><span>{selectionCount ? `${selectionCount} selected` : activeEntity ? `${activeEntity.type} · ${activeEntity.relations?.join(", ")}` : `${entities.length} entities · ${constraints.length} constraints`}</span><span>{hasConstraintConflict ? "Over defined" : viewRotated ? "3D inspection" : snapEnabled ? "Snap on" : "Free drag"} <i /></span></div>
  </div>;
}
