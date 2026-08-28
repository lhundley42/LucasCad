"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { analyzeSketchContours, automaticSplineHandles, circularPatternSketchEntity, circularPatternStep, circumcircle, cornerEntities, deleteSplinePoint, distance, entityBadgePoint, entityInSelectionBox, extendEntityToTarget, filletLines, insertSplinePoint, linearPatternSketchEntity, midpoint, mirrorSketchEntity, nearestGridVertex, normalizedSelectionBox, perpendicularLineToReference, pointInSelectionBox, preferredSketchSnap, resolvePatternCenter, resolvePatternDirection, sketchRelationIsSatisfied, sketchStrokeHits, synchronizeMirrorLinks, synchronizePatternLinks, translateSketchEntity, trimEntityAtPoint, type Point, type SketchCheckResult, type SketchEntity, type SketchFilletResult, type SplineHandlePair } from "./sketchGeometry";
import { angularDimensionLayout, angularDimensionValue, constraintSupersedesOrthogonalProfileDimension, constraintSupersedesSegmentDimension, controlPointsForEntity, cycleLinearOrientation, defaultLinearDimensionPosition, defaultLinearOrientation, diameterDimensionLayout, diameterDimensionValue, dimensionReferencePoints, linearDimensionLayout, linearDimensionValue, linearOrientationOptions, lineFor, nonOverlappingReferenceHitRadius, preferredAxisOrSketchLineTarget, radialDimensionLayout, radialDimensionValue, referencePoint, targetPointForAngularValue, targetPointForLinearValue, validLinearDimensionPair, type CircularPatternConstraint, type DiameterDimensionConstraint, type ExternalSketchReference, type LinearDimensionConstraint, type LinearOrientation, type LinearPatternConstraint, type MirrorConstraint, type PatternCenterReference, type PatternConstraint, type PatternDirectionReference, type RadialDimensionConstraint, type SketchConstraint, type SketchReference } from "./sketchConstraints";
import { formatLength, fromMillimeters, toMillimeters, type UnitSystem } from "./units";
import { BufferedNumberInput, keyboardEventOwnedByControl } from "./BufferedNumberInput";
export type { Point, SketchEntity } from "./sketchGeometry";
export type { ExternalSketchReference, LinearDimensionConstraint, SketchConstraint } from "./sketchConstraints";

type Tool = "select" | "sketch-check" | "line" | "centerline" | "rectangle" | "circle" | "ellipse" | "arc" | "spline" | "trim" | "extend" | "corner" | "radius" | "mirror" | "linear-pattern" | "rectangular-pattern" | "circular-pattern" | "linear-dimension" | "angular-dimension" | "diameter-dimension" | "radial-dimension" | "perpendicular-constraint" | "horizontal-constraint" | "vertical-constraint";
export type SketchInitialTool = Extract<Tool, "select" | "sketch-check">;
type Snap = { point: Point; kind: "endpoint" | "midpoint" | "center" | "quadrant" | "grid" | "horizontal" | "vertical"; entityId?: string; handle?: string };
type DimensionInfo = { key: string; entityId: string; axis?: "major" | "minor"; anchor: Point; offset: Point; text: string; value: number };
type DimensionDrag = { key: string; pointerId: number; startPoint: Point; originalOffset: Point; captureTarget: SVGGElement };
type ConstraintDrag = { id: string; pointerId: number; captureTarget: SVGGElement };
type SelectionMarquee = { start: Point; current: Point; pointerId: number };
type MultiSelectionDrag = { pointerId: number; start: Point; originalEntities: SketchEntity[]; originalConstraints: SketchConstraint[]; originalDimensionOffsets: Record<string, Point>; moved: boolean };
type SplineHandleDrag = { entityId: string; pointIndex: number; side: "in" | "out"; pointerId: number; captureTarget: SVGCircleElement };
type AxisRelation = "Horizontal" | "Vertical";
type ConstraintShortcut = { x: number; y: number; entityId: string; relation: AxisRelation };
type SplineContextMenu = { x: number; y: number; entityId: string; kind: "point" | "curve"; pointIndex?: number; point: Point };
type TrimGesture = { pointerId: number; points: Point[]; hits: { entityId: string; point: Point }[]; originalEntities: SketchEntity[] };
type RadiusSelection = { entityId: string; click: Point };
type PatternTool = Extract<Tool, "linear-pattern" | "rectangular-pattern" | "circular-pattern">;
type PatternDraft = {
  kind: PatternTool;
  stage: "entities" | "direction-1" | "direction-2" | "center" | "parameters";
  seedIds: string[];
  direction1?: PatternDirectionReference;
  direction2?: PatternDirectionReference;
  center?: PatternCenterReference;
  count1: number;
  spacing1: number;
  flip1: boolean;
  count2: number;
  spacing2: number;
  flip2: boolean;
  circularCount: number;
  span: number;
  radius: number;
  arcAngle: number;
  equalSpacing: boolean;
  reverse: boolean;
  rotateInstances: boolean;
  skipped: number[];
};
export type SketchView = { center: Point; zoom: number };

const VIEW = { x: -260, y: -180, width: 520, height: 360 };
const DEFAULT_VIEW: SketchView = { center: { x: 0, y: 0 }, zoom: 1 };
const nextId = () => `entity-${crypto.randomUUID()}`;
const fmt = (value: number) => value.toFixed(value < 10 ? 2 : 1).replace(/\.0$/, "");
const isPatternConstraint = (constraint: SketchConstraint): constraint is PatternConstraint => constraint.type === "linear-pattern" || constraint.type === "rectangular-pattern" || constraint.type === "circular-pattern";
const isDimensionConstraint = (constraint: SketchConstraint): constraint is Exclude<SketchConstraint, MirrorConstraint | PatternConstraint> => constraint.type === "linear" || constraint.type === "angular" || constraint.type === "diameter" || constraint.type === "radial";

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
    { point: entity.a, kind: "endpoint", entityId: entity.id, handle: "a" }, { point: entity.b, kind: "endpoint", entityId: entity.id, handle: "b" }, { point: midpoint(entity.a, entity.b), kind: "midpoint", entityId: entity.id, handle: "midpoint" },
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
    return [{ point: entity.a, kind: "endpoint", entityId: entity.id, handle: "a" }, { point: entity.b, kind: "endpoint", entityId: entity.id, handle: "b" }, { point: circle.c, kind: "center", entityId: entity.id }];
  }
  return entity.points.map((point, index) => ({ point, kind: "endpoint" as const, entityId: entity.id, handle: `point-${index}` }));
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

function sketchCheckResultMessage(result: SketchCheckResult) {
  return result.viable
    ? "SketchCheck passed · closed profile geometry is ready for Extrude or Revolve"
    : result.openEndpoints.length
      ? `SketchCheck found ${result.openEndpoints.length} open ${result.openEndpoints.length === 1 ? "endpoint" : "endpoints"} · click SketchCheck again to repair`
      : "SketchCheck found no closed profile geometry";
}

export function Sketcher({ entities: controlledEntities, constraints: controlledConstraints = [], externalReferences = [], dimensionOffsets: controlledDimensionOffsets = {}, dimensionTextScale = 0.5, nodeDiameterPx = 4, highlightWidthPx = 1.2, gridSquareSize = 8, unitSystem = "metric", initialTool = "select", onChange, onConstraintsChange, onDimensionOffsetsChange, onFinish, view = DEFAULT_VIEW, viewRotated = false, onSnapNormal }: { entities?: SketchEntity[]; constraints?: SketchConstraint[]; externalReferences?: ExternalSketchReference[]; dimensionOffsets?: Record<string, Point>; dimensionTextScale?: number; nodeDiameterPx?: number; highlightWidthPx?: number; gridSquareSize?: number; unitSystem?: UnitSystem; initialTool?: SketchInitialTool; onChange?: (entities: SketchEntity[]) => void; onConstraintsChange?: (constraints: SketchConstraint[]) => void; onDimensionOffsetsChange?: (offsets: Record<string, Point>) => void; onFinish: () => void; view?: SketchView; viewRotated?: boolean; onSnapNormal?: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dimensionInputRef = useRef<HTMLInputElement>(null);
  const cancelDimensionEditOnBlur = useRef(false);
  const [entities, setEntitiesState] = useState<SketchEntity[]>(() => controlledEntities ?? []);
  const [tool, setTool] = useState<Tool>(initialTool);
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
  const [radiusSelections, setRadiusSelections] = useState<RadiusSelection[]>([]);
  const [radiusValue, setRadiusValue] = useState(Math.max(gridSquareSize / 2, 0.1));
  const [radiusMessage, setRadiusMessage] = useState<string | null>(null);
  const [perpendicularSource, setPerpendicularSource] = useState<string | null>(null);
  const [perpendicularMessage, setPerpendicularMessage] = useState<string | null>(null);
  const [mirrorMessage, setMirrorMessage] = useState<string | null>(null);
  const [mirrorStage, setMirrorStage] = useState<"entities" | "axis">("entities");
  const [patternDraft, setPatternDraft] = useState<PatternDraft | null>(null);
  const [patternSkippedInput, setPatternSkippedInput] = useState<string | null>(null);
  const [patternMessage, setPatternMessage] = useState<string | null>(null);
  const [trimGesture, setTrimGesture] = useState<TrimGesture | null>(null);
  const [trimMessage, setTrimMessage] = useState<string | null>(null);
  const [sketchCheck, setSketchCheck] = useState<SketchCheckResult | null>(() => initialTool === "sketch-check" ? analyzeSketchContours(controlledEntities ?? []) : null);
  const [sketchCheckMessage, setSketchCheckMessage] = useState<string | null>(() => sketchCheck ? sketchCheckResultMessage(sketchCheck) : null);
  const [radialEntityId, setRadialEntityId] = useState<string | null>(null);
  const dragStartRef = useRef<SketchEntity[] | null>(null);
  const dragSnapRef = useRef<Snap | null>(null);
  const lineClickRef = useRef<{ entityId: string; at: number } | null>(null);
  const selected = selectedEntityIds.at(-1) ?? null;
  const selectedConstraintId = selectedConstraintIds.at(-1) ?? null;
  const setSelected = (entityId: string | null) => setSelectedEntityIds(entityId ? [entityId] : []);
  const setSelectedConstraintId = (constraintId: string | null) => setSelectedConstraintIds(constraintId ? [constraintId] : []);

  const synchronizeLinkedGeometry = useCallback((next: SketchEntity[], previous = entities, activeConstraints = constraints) => {
    const previousById = new Map(previous.map((entity) => [entity.id, JSON.stringify(entity)]));
    const changed = new Set(next.filter((entity) => previousById.get(entity.id) !== JSON.stringify(entity)).map((entity) => entity.id));
    const mirrored = synchronizeMirrorLinks(next, activeConstraints.filter((constraint): constraint is MirrorConstraint => constraint.type === "mirror"), changed);
    return synchronizePatternLinks(mirrored, activeConstraints.filter(isPatternConstraint), changed, externalReferences);
  }, [constraints, entities, externalReferences]);
  const commit = useCallback((next: SketchEntity[]) => {
    const synchronized = synchronizeLinkedGeometry(next);
    setHistory((items) => [...items.slice(-39), entities]);
    setFuture([]);
    setEntitiesState(synchronized);
    onChange?.(synchronized);
  }, [entities, onChange, synchronizeLinkedGeometry]);
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
    const best = preferredSketchSnap(raw, candidates, snapTolerance, gridSnap);
    if (best !== gridSnap) return best;
    if (anchor && Math.abs(raw.x - anchor.x) < snapTolerance / 2) return { point: { x: anchor.x, y: raw.y }, kind: "vertical" as const };
    if (anchor && Math.abs(raw.y - anchor.y) < snapTolerance / 2) return { point: { x: raw.x, y: anchor.y }, kind: "horizontal" as const };
    return gridSnap;
  };

  const finishSpline = () => {
    const points = draft.filter((point, index) => index === 0 || distance(point, draft[index - 1]) > 0.0001);
    if (points.length > 1) commit([...entities, { id: nextId(), type: "spline", points, relations: snap?.kind === "endpoint" ? ["Coincident"] : [] }]);
    setDraft([]); setTool("select");
  };
  const finishChain = () => { setDraft([]); setDimensionReferences([]); setDimensionMessage(null); setDiameterEntityId(null); setRadialEntityId(null); setExtendSource(null); setExtendMessage(null); setCornerSource(null); setCornerMessage(null); setRadiusSelections([]); setRadiusMessage(null); setPerpendicularSource(null); setPerpendicularMessage(null); setTool("select"); setSnap(null); };
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
  const commitRadialDimension = (entityId: string, position: Point) => {
    const existing = constraints.find((constraint) => constraint.type === "radial" && constraint.entityId === entityId);
    if (existing) { setSelectedConstraintId(existing.id); setRadialEntityId(null); return; }
    const next: RadialDimensionConstraint = { id: `constraint-${crypto.randomUUID()}`, type: "radial", entityId, position, value: radialDimensionValue(entityId, entities) };
    commitConstraints([...constraints, next]); setSelectedConstraintId(next.id); setSelected(null); setSelectedDimensionKeys([]); setRadialEntityId(null); setDimensionMessage(null);
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
  const constraintReferencesEntity = (constraint: SketchConstraint, entityIds: Set<string>) => {
    if (constraint.type === "mirror") return entityIds.has(constraint.axisEntityId) || constraint.pairs.some((pair) => entityIds.has(pair.sourceId) || entityIds.has(pair.mirroredId));
    if (constraint.type === "linear-pattern" || constraint.type === "rectangular-pattern") return (constraint.direction1.kind === "entity" && entityIds.has(constraint.direction1.entityId)) || (constraint.direction2?.kind === "entity" && entityIds.has(constraint.direction2.entityId)) || constraint.pairs.some((pair) => entityIds.has(pair.sourceId) || pair.instances.some((instance) => entityIds.has(instance.entityId)));
    if (constraint.type === "circular-pattern") return (constraint.center.kind === "entity-node" && entityIds.has(constraint.center.entityId)) || constraint.pairs.some((pair) => entityIds.has(pair.sourceId) || pair.instances.some((instance) => entityIds.has(instance.entityId)));
    if (constraint.type === "diameter" || constraint.type === "radial") return entityIds.has(constraint.entityId);
    return [constraint.first, constraint.second].some((reference) => (reference.kind === "node" || reference.kind === "line") && entityIds.has(reference.entityId));
  };
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
      if (keyboardEventOwnedByControl(event.target)) return;
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
    cancelDimensionEditOnBlur.current = false;
    const frame = requestAnimationFrame(() => { dimensionInputRef.current?.focus(); dimensionInputRef.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, [editingConstraintId, editingDimension]);

  useEffect(() => {
    const patternConstraints = constraints.filter(isPatternConstraint); if (!patternConstraints.length) return;
    const synchronized = synchronizePatternLinks(entities, patternConstraints, new Set(), externalReferences);
    if (JSON.stringify(synchronized) !== JSON.stringify(entities)) { setEntitiesState(synchronized); onChange?.(synchronized); }
    // External model edges and plane intersections are live pattern references.
  }, [externalReferences]);

  const beginSelectionDrag = (event: React.PointerEvent<SVGElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); setEditingDimension(null); setEditingConstraintId(null); setSnap(null);
    setDraggingSelection({ pointerId: event.pointerId, start: pointFromEvent(event), originalEntities: entities, originalConstraints: constraints, originalDimensionOffsets: dimensionOffsets, moved: false });
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const beginTrimGesture = (event: React.PointerEvent<SVGElement>, entityId?: string) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); setSelected(null); setSnap(null);
    const point = pointFromEvent(event);
    setTrimGesture({ pointerId: event.pointerId, points: [point], hits: entityId ? [{ entityId, point }] : [], originalEntities: entities });
    setTrimMessage("Trim · drag the dotted cutter across every segment to remove, then release");
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (trimGesture) {
      const current = pointFromEvent(event); const previous = trimGesture.points.at(-1)!;
      const crossed = sketchStrokeHits(trimGesture.originalEntities, previous, current).filter((hit) => !trimGesture.hits.some((existing) => existing.entityId === hit.entityId));
      setTrimGesture({ ...trimGesture, points: [...trimGesture.points, current], hits: [...trimGesture.hits, ...crossed] });
      setTrimMessage(crossed.length || trimGesture.hits.length ? `Trim · ${trimGesture.hits.length + crossed.length} ${trimGesture.hits.length + crossed.length === 1 ? "segment" : "segments"} queued · release to trim` : "Trim · cross a sketch segment with the dotted cutter");
      setCursor(current); setSnap(null); return;
    }
    if (selectionMarquee) {
      const current = pointFromEvent(event); setSelectionMarquee({ ...selectionMarquee, current }); setCursor(current); setSnap(null); return;
    }
    if (draggingSelection) {
      const current = pointFromEvent(event); const delta = { x: current.x - draggingSelection.start.x, y: current.y - draggingSelection.start.y };
      const entityIds = new Set(selectedEntityIds);
      const translatedEntities = draggingSelection.originalEntities.map((entity) => entityIds.has(entity.id) ? translateSketchEntity(entity, delta) : entity);
      const mirroredEntities = synchronizeMirrorLinks(translatedEntities, draggingSelection.originalConstraints.filter((constraint): constraint is MirrorConstraint => constraint.type === "mirror"), entityIds);
      const nextEntities = synchronizePatternLinks(mirroredEntities, draggingSelection.originalConstraints.filter(isPatternConstraint), entityIds, externalReferences);
      const modelScale = dimensionModelScale();
      const nextOffsets = { ...draggingSelection.originalDimensionOffsets };
      selectedDimensionKeys.forEach((key) => {
        const dimension = allDimensions.find((candidate) => candidate.key === key);
        if (dimension && entityIds.has(dimension.entityId)) return;
        const original = draggingSelection.originalDimensionOffsets[key] ?? { x: 0, y: 0 };
        nextOffsets[key] = { x: original.x + delta.x / modelScale, y: original.y + delta.y / modelScale };
      });
      const nextConstraints = draggingSelection.originalConstraints.map((constraint) => {
        if (constraint.type === "mirror" || isPatternConstraint(constraint)) return constraint;
        const positioned = selectedConstraintIds.includes(constraint.id) ? { ...constraint, position: { x: constraint.position.x + delta.x, y: constraint.position.y + delta.y } } : constraint;
        const actual = positioned.type === "linear" ? linearDimensionValue(positioned.first, positioned.second, positioned.orientation, nextEntities) : positioned.type === "angular" ? angularDimensionValue(positioned.first, positioned.second, positioned.position, nextEntities) : positioned.type === "diameter" ? diameterDimensionValue(positioned.entityId, nextEntities) : radialDimensionValue(positioned.entityId, nextEntities);
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
      const next = synchronizeLinkedGeometry(entities.map((entity) => entity.id === source.id ? { ...source, handles } : entity)); setEntitiesState(next); onChange?.(next); setCursor(raw); return;
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
      next = synchronizeLinkedGeometry(next); setEntitiesState(next); onChange?.(next); const nextConstraints = constraintsForGeometry(next); setConstraintsState(nextConstraints); onConstraintsChange?.(nextConstraints); setCursor(nextPoint); setSnap(activeSnap); dragSnapRef.current = activeSnap; return;
    }
    const raw = pointFromEvent(event);
    if ((tool === "linear-dimension" || tool === "angular-dimension") && dimensionReferences.length === 2 || tool === "diameter-dimension" && diameterEntityId || tool === "radial-dimension" && radialEntityId) { setCursor(raw); setSnap(null); return; }
    const nextSnap = findSnap(raw, draft.at(-1)); setSnap(nextSnap); setCursor(nextSnap?.point ?? raw);
  };
  const beginDrag = (event: React.PointerEvent<SVGCircleElement>, entityId: string, handle: string, originalPoint: Point) => {
    if (tool !== "select") return;
    event.preventDefault(); event.stopPropagation();
    if (event.shiftKey) { setSelectedEntityIds((ids) => ids.includes(entityId) ? ids.filter((id) => id !== entityId) : [...ids, entityId]); return; }
    dragStartRef.current = entities;
    dragSnapRef.current = null;
    setSelected(entityId); setSelectedConstraintId(null); setSelectedDimensionKeys([]); setEditingConstraintId(null);
    setDragging({ entityId, handle, pointerId: event.pointerId, originalPoint });
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const runSketchCheck = () => {
    if (tool === "sketch-check" && sketchCheck?.openEndpoints.length) {
      const removeIds = new Set(sketchCheck.removalEntityIds);
      if (!removeIds.size) {
        setSketchCheckMessage("SketchCheck found branching open geometry that needs a manual trim");
        return;
      }
      const nextEntities = entities.filter((entity) => !removeIds.has(entity.id));
      const nextConstraints = constraints.filter((constraint) => !constraintReferencesEntity(constraint, removeIds));
      commit(nextEntities); commitConstraints(nextConstraints);
      setHiddenDimensionKeys((keys) => keys.filter((key) => ![...removeIds].some((entityId) => key === entityId || key.startsWith(`${entityId}:`))));
      const nextOffsets = Object.fromEntries(Object.entries(dimensionOffsets).filter(([key]) => ![...removeIds].some((entityId) => key === entityId || key.startsWith(`${entityId}:`))));
      setDimensionOffsets(nextOffsets); onDimensionOffsetsChange?.(nextOffsets);
      clearSelection(); setSketchCheck(null); setTool("select");
      setSketchCheckMessage(`SketchCheck removed ${removeIds.size} open ${removeIds.size === 1 ? "segment" : "segments"}`);
      return;
    }
    resetTransientToolState(); clearSelection();
    const result = analyzeSketchContours(entities);
    setTool("sketch-check"); setSketchCheck(result);
    setSketchCheckMessage(sketchCheckResultMessage(result));
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
    if (trimGesture) {
      const cancelled = event?.type === "pointercancel";
      if (!cancelled && trimGesture.hits.length) {
        let next = trimGesture.originalEntities; const trimmedIds = new Set<string>();
        trimGesture.hits.forEach((hit) => {
          const target = next.find((entity) => entity.id === hit.entityId); if (!target) return;
          const replacements = trimEntityAtPoint(target, hit.point, next);
          next = next.flatMap((entity) => entity.id === target.id ? replacements : [entity]); trimmedIds.add(target.id);
        });
        commit(next); commitConstraints(constraints.filter((constraint) => !constraintReferencesEntity(constraint, trimmedIds)));
        setTrimMessage(`Trim complete · ${trimmedIds.size} ${trimmedIds.size === 1 ? "segment" : "segments"} removed`);
      } else setTrimMessage(cancelled ? "Trim gesture cancelled" : "Trim · click a segment or drag across several segments");
      if (svgRef.current?.hasPointerCapture(trimGesture.pointerId)) svgRef.current.releasePointerCapture(trimGesture.pointerId);
      setTrimGesture(null); setSnap(null); return;
    }
    if (selectionMarquee) {
      const end = event ? pointFromEvent(event) : selectionMarquee.current; const box = normalizedSelectionBox(selectionMarquee.start, end);
      const selectedIds = entities.filter((entity) => entityInSelectionBox(entity, selectionMarquee.start, end)).map((entity) => entity.id);
      setSelectedEntityIds(selectedIds);
      if (tool === "mirror") {
        setSelectedConstraintIds([]); setSelectedDimensionKeys([]); setMirrorStage(selectedIds.length ? "axis" : "entities");
        setMirrorMessage(selectedIds.length ? `${selectedIds.length} ${selectedIds.length === 1 ? "entity" : "entities"} selected · click a separate straight sketch line as the mirror axis` : "Drag a selection box around the geometry to mirror");
      } else {
        setSelectedConstraintIds(constraints.filter(isDimensionConstraint).filter((constraint) => pointInSelectionBox(constraintLabelPoint(constraint), box)).map((constraint) => constraint.id));
        setSelectedDimensionKeys(visibleDimensions.filter((dimension) => pointInSelectionBox(dimensionPosition(dimension), box)).map((dimension) => dimension.key));
      }
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
    const finalSnap = dragSnapRef.current;
    if (finalSnap?.kind === "endpoint" && finalSnap.entityId && finalSnap.handle && finalSnap.entityId !== dragging.entityId) {
      const endpointHandle = dragging.handle === "a" || dragging.handle === "b" || dragging.handle.startsWith("point-");
      if (endpointHandle) {
        const involved = new Set([dragging.entityId, finalSnap.entityId]);
        const next = entities.map((entity) => involved.has(entity.id) ? { ...entity, relations: [...new Set([...(entity.relations ?? []), "Coincident"])] } : entity);
        setEntitiesState(next); onChange?.(next); setSketchCheckMessage("Coincident relation added · connected endpoints now move together");
      }
    }
    if (dragStartRef.current) setHistory((items) => [...items.slice(-39), dragStartRef.current!]);
    setFuture([]); dragStartRef.current = null; dragSnapRef.current = null; setDragging(null); setSnap(null);
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
  const remapSplineConstraints = (entityId: string, remapIndex: (index: number) => number | null): SketchConstraint[] => constraints.flatMap<SketchConstraint>((constraint): SketchConstraint[] => {
    if (constraint.type !== "linear") return [constraint];
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
    if (tool === "select" || tool === "mirror" && mirrorStage === "entities") {
      const start = pointFromEvent(event); event.preventDefault(); clearSelection(); setSelectionMarquee({ start, current: start, pointerId: event.pointerId }); setSnap(null); event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    if (tool === "trim") { beginTrimGesture(event); return; }
    if (tool === "linear-dimension") { if (dimensionReferences.length === 2) placeLinearDimension(pointFromEvent(event)); return; }
    if (tool === "angular-dimension") { if (dimensionReferences.length === 2) placeAngularDimension(pointFromEvent(event)); return; }
    if (tool === "diameter-dimension") { if (diameterEntityId) commitDiameterDimension(diameterEntityId, pointFromEvent(event)); return; }
    if (tool === "radial-dimension") { if (radialEntityId) commitRadialDimension(radialEntityId, pointFromEvent(event)); return; }
    if (isPatternTool(tool)) {
      if (patternDraft?.kind === "circular-pattern" && patternDraft.stage === "center") { const raw = pointFromEvent(event); choosePatternCenter(centerReferenceAt(findSnap(raw)?.point ?? raw)); }
      return;
    }
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
    if (constraint.type === "mirror" || isPatternConstraint(constraint)) return constraint;
    if (constraint.id === drivingId) return { ...constraint, value: drivingValue ?? constraint.value, conflicted: false };
    const actual = constraint.type === "linear" ? linearDimensionValue(constraint.first, constraint.second, constraint.orientation, nextEntities) : constraint.type === "angular" ? angularDimensionValue(constraint.first, constraint.second, constraint.position, nextEntities) : constraint.type === "diameter" ? diameterDimensionValue(constraint.entityId, nextEntities) : radialDimensionValue(constraint.entityId, nextEntities);
    return { ...constraint, conflicted: Math.abs(actual - constraint.value) > (constraint.type === "angular" ? 0.1 : 0.01) };
  });
  const moveConstraintReference = (sourceEntities: SketchEntity[], reference: SketchReference, target: Point): SketchEntity[] => {
    if (reference.kind === "external-point" || reference.kind === "external-line") return sourceEntities;
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
    if (!constraint || constraint.type === "mirror" || isPatternConstraint(constraint) || !Number.isFinite(enteredValue)) { setEditingConstraintId(null); return; }
    if (constraint.type === "diameter") {
      if (!(enteredValue > 0)) { setEditingConstraintId(null); return; }
      const value = toMillimeters(enteredValue, unitSystem);
      const nextEntities = synchronizeLinkedGeometry(entities.map((entity) => entity.id === constraint.entityId && entity.type === "circle" ? { ...entity, r: value / 2 } : entity));
      const nextConstraints = constraintsForGeometry(nextEntities, constraint.id, value);
      setEntitiesState(nextEntities); onChange?.(nextEntities); commitConstraints(nextConstraints); setEditingConstraintId(null); return;
    }
    if (constraint.type === "radial") {
      if (!(enteredValue > 0)) { setEditingConstraintId(null); return; }
      const value = toMillimeters(enteredValue, unitSystem); const pointChanges: { source: string; from: Point; to: Point }[] = [];
      let resized = entities.map((entity): SketchEntity => {
        if (entity.id !== constraint.entityId) return entity;
        if (entity.type === "circle") return { ...entity, r: value };
        if (entity.type !== "arc") return entity;
        const circle = circumcircle(entity.a, entity.b, entity.through); const scale = value / Math.max(circle.r, 1e-9);
        const resize = (point: Point) => ({ x: circle.c.x + (point.x - circle.c.x) * scale, y: circle.c.y + (point.y - circle.c.y) * scale });
        const a = resize(entity.a); const b = resize(entity.b); pointChanges.push({ source: entity.id, from: entity.a, to: a }, { source: entity.id, from: entity.b, to: b });
        return { ...entity, a, b, through: resize(entity.through) };
      });
      for (const change of pointChanges) resized = resized.map((entity) => entity.id === change.source ? entity : replaceConnectedPoint(entity, change.from, change.to));
      const nextEntities = synchronizeLinkedGeometry(resized); const nextConstraints = constraintsForGeometry(nextEntities, constraint.id, value);
      setEntitiesState(nextEntities); onChange?.(nextEntities); commitConstraints(nextConstraints); setEditingConstraintId(null); return;
    }
    if (constraint.type === "angular") {
      if (!(enteredValue > 0 && enteredValue < 360) || constraint.second.kind !== "line") { setEditingConstraintId(null); return; }
      const firstLine = lineFor(constraint.first, entities); const secondLine = lineFor(constraint.second, entities);
      const target = firstLine && secondLine ? targetPointForAngularValue(firstLine, secondLine, constraint.position, enteredValue) : null;
      if (!target) { setEditingConstraintId(null); return; }
      const nextEntities = synchronizeLinkedGeometry(moveConstraintReference(entities, { kind: "node", entityId: constraint.second.entityId, handle: target.movingHandle }, target.target));
      const nextConstraints = constraintsForGeometry(nextEntities, constraint.id, enteredValue);
      setEntitiesState(nextEntities); onChange?.(nextEntities); commitConstraints(nextConstraints); setEditingConstraintId(null); return;
    }
    if (enteredValue < 0) { setEditingConstraintId(null); return; }
    const value = toMillimeters(enteredValue, unitSystem);
    const [firstPoint, secondPoint] = dimensionReferencePoints(constraint.first, constraint.second, entities);
    const secondFixed = constraint.second.kind === "external-point" || constraint.second.kind === "external-line";
    const firstFixed = constraint.first.kind === "external-point" || constraint.first.kind === "external-line";
    if (firstFixed && secondFixed) { setEditingConstraintId(null); return; }
    const target = secondFixed ? targetPointForLinearValue(secondPoint, firstPoint, constraint.orientation, value) : targetPointForLinearValue(firstPoint, secondPoint, constraint.orientation, value);
    const nextEntities = synchronizeLinkedGeometry(moveConstraintReference(entities, secondFixed ? constraint.first : constraint.second, target));
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
  const radiusPreview = useMemo<SketchFilletResult | null>(() => {
    if (tool !== "radius" || radiusSelections.length !== 2) return null;
    const first = entities.find((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.id === radiusSelections[0].entityId && entity.type === "line");
    const second = entities.find((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.id === radiusSelections[1].entityId && entity.type === "line");
    return first && second ? filletLines(first, radiusSelections[0].click, second, radiusSelections[1].click, radiusValue, "radius-preview") : null;
  }, [entities, radiusSelections, radiusValue, tool]);
  const safeZoom = Math.max(0.05, Math.min(40, view.zoom));
  const dimensionScreenScale = Math.max(0.65, Math.min(1.15, 1 - Math.log2(safeZoom) * 0.1));
  function dimensionModelScale() { return dimensionScreenScale / safeZoom; }
  const dimensionScale = dimensionModelScale();
  const dimensionLabelScale = dimensionScale * dimensionTextScale;
  const nodeRadius = nodeDiameterPx / 2 / safeZoom;
  const dimensionControlPoints = entities.flatMap((entity) => controlPointsForEntity(entity).map((control) => ({ entityId: entity.id, ...control })));
  const coincidentMarkers = useMemo(() => {
    const endpoints = entities.flatMap((entity) => entitySnapPoints(entity).filter((candidate) => candidate.kind === "endpoint").map((candidate) => ({ ...candidate, relations: entity.relations ?? [] })));
    const groups: { point: Point; entityIds: Set<string>; related: boolean }[] = [];
    endpoints.forEach((candidate) => {
      let group = groups.find((item) => distance(item.point, candidate.point) < 0.001);
      if (!group) { group = { point: candidate.point, entityIds: new Set(), related: false }; groups.push(group); }
      if (candidate.entityId) group.entityIds.add(candidate.entityId);
      group.related ||= candidate.relations.includes("Coincident");
    });
    return groups.filter((group) => group.entityIds.size > 1 && group.related).map((group) => group.point);
  }, [entities]);
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
  const constraintLabelPoint = (constraint: Exclude<SketchConstraint, MirrorConstraint | PatternConstraint>) => constraint.type === "linear" ? linearDimensionLayout(constraint.first, constraint.second, constraint.orientation, constraint.position, entities).label : constraint.type === "angular" ? angularDimensionLayout(constraint.first, constraint.second, constraint.position, entities).label : constraint.type === "diameter" ? diameterDimensionLayout(constraint.entityId, constraint.position, entities).label : radialDimensionLayout(constraint.entityId, constraint.position, entities).label;
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
    if ((entity?.type === "circle" || entity?.type === "arc") && constraints.some((constraint) => (constraint.type === "diameter" || constraint.type === "radial") && constraint.entityId === entity.id)) return false;
    return !entity || !constraints.some((constraint) => constraint.type === "linear" && constraintSupersedesOrthogonalProfileDimension(constraint, entity, entities));
  });
  const selectionCount = selectedEntityIds.length + selectedConstraintIds.length + selectedDimensionKeys.length;
  const marqueeBox = selectionMarquee ? normalizedSelectionBox(selectionMarquee.start, selectionMarquee.current) : null;
  const editingDimensionPosition = editingDimension ? dimensionPosition(editingDimension) : null;
  const editingConstraint = constraints.find((constraint): constraint is Exclude<SketchConstraint, MirrorConstraint | PatternConstraint> => constraint.id === editingConstraintId && isDimensionConstraint(constraint)) ?? null;
  const editingConstraintPosition = editingConstraint ? constraintLabelPoint(editingConstraint) : null;
  const linearPreview = tool === "linear-dimension" && dimensionReferences.length === 2 ? linearDimensionLayout(dimensionReferences[0], dimensionReferences[1], dimensionOrientation, cursor, entities) : null;
  const angularPreview = tool === "angular-dimension" && dimensionReferences.length === 2 && (dimensionReferences[0].kind === "line" || dimensionReferences[0].kind === "external-line") && (dimensionReferences[1].kind === "line" || dimensionReferences[1].kind === "external-line") ? angularDimensionLayout(dimensionReferences[0], dimensionReferences[1], cursor, entities) : null;
  const diameterPreview = tool === "diameter-dimension" && diameterEntityId ? diameterDimensionLayout(diameterEntityId, cursor, entities) : null;
  const radialPreview = tool === "radial-dimension" && radialEntityId ? radialDimensionLayout(radialEntityId, cursor, entities) : null;
  const hasConstraintConflict = constraints.some((constraint) => "conflicted" in constraint && constraint.conflicted);
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
  const choosePatternAxisOrLine = (axis: "x" | "y", event: React.PointerEvent<SVGRectElement>) => {
    event.preventDefault(); event.stopPropagation(); const target = axisOrLineAt(axis, pointFromEvent(event));
    if (target.kind === "line") { const line = entities.find((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.id === target.entityId && entity.type === "line"); if (line) choosePatternDirection(directionReferenceForLine(line)); }
    else choosePatternDirection({ kind: "external", referenceId: `sketch-axis:${axis}`, fallback: axis === "x" ? { x: 1, y: 0 } : { x: 0, y: 1 } });
  };
  const isPatternTool = (candidate: Tool): candidate is PatternTool => candidate === "linear-pattern" || candidate === "rectangular-pattern" || candidate === "circular-pattern";
  const defaultPatternDraft = (kind: PatternTool, seedIds: string[]): PatternDraft => ({
    kind, stage: seedIds.length ? kind === "circular-pattern" ? "center" : "direction-1" : "entities", seedIds,
    count1: 3, spacing1: Math.max(gridSquareSize * 2, 1), flip1: false, count2: 3, spacing2: Math.max(gridSquareSize * 2, 1), flip2: false,
    circularCount: 6, span: 360, radius: Math.max(gridSquareSize * 2, 1), arcAngle: 0, equalSpacing: true, reverse: false, rotateInstances: true, skipped: [],
  });
  const selectedSketchEntityIds = () => {
    const available = new Set(entities.map((entity) => entity.id));
    return selectedEntityIds.filter((id) => available.has(id));
  };
  const startRadius = () => {
    resetTransientToolState(); setTool("radius");
    const selectedLines = entities.filter((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.type === "line" && selectedEntityIds.includes(entity.id)).slice(0, 2);
    const selections = selectedLines.map((line) => ({ entityId: line.id, click: midpoint(line.a, line.b) }));
    setRadiusSelections(selections); setSelectedEntityIds(selections.map((selection) => selection.entityId));
    setRadiusMessage(selections.length === 2 ? "Adjust the radius and create the fillet" : selections.length === 1 ? "Select the second line segment" : "Select the first line segment");
  };
  const applyRadius = () => {
    if (radiusSelections.length !== 2) { setRadiusMessage("Select two non-parallel line segments"); return; }
    const first = entities.find((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.id === radiusSelections[0].entityId && entity.type === "line");
    const second = entities.find((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.id === radiusSelections[1].entityId && entity.type === "line");
    const result = first && second ? filletLines(first, radiusSelections[0].click, second, radiusSelections[1].click, radiusValue, nextId()) : null;
    if (!result) { setRadiusMessage("The selected lines cannot form a fillet at this radius"); return; }
    const next = [...entities.map((entity) => entity.id === result.first.id ? result.first : entity.id === result.second.id ? result.second : entity), result.arc];
    commit(next); commitConstraints(constraintsForGeometry(next)); setRadiusSelections([]); setRadiusMessage(null); setSelected(result.arc.id); setTool("select");
  };
  const startPattern = (kind: PatternTool) => {
    resetTransientToolState(); setTool(kind); const next = defaultPatternDraft(kind, selectedSketchEntityIds()); setPatternDraft(next);
    setPatternMessage(next.stage === "entities" ? `${kind === "circular-pattern" ? "Circular" : kind === "rectangular-pattern" ? "Rectangular" : "Linear"} pattern · select seed geometry · Shift-click to add, then click the reference` : kind === "circular-pattern" ? "Select the pattern center" : "Select a straight line or background edge for Direction 1");
  };
  const startMirror = () => {
    resetTransientToolState(); setTool("mirror"); const seedIds = selectedSketchEntityIds(); setSelectedEntityIds(seedIds); setMirrorStage(seedIds.length ? "axis" : "entities");
    setMirrorMessage(seedIds.length ? "Click a separate straight sketch line to set the mirror axis" : "Select geometry to mirror · Shift-click to add more");
  };
  const directionReferenceForLine = (line: Extract<SketchEntity, { type: "line" }>): PatternDirectionReference => ({ kind: "entity", entityId: line.id, fallback: { x: line.b.x - line.a.x, y: line.b.y - line.a.y } });
  const directionReferenceForExternal = (reference: ExternalSketchReference): PatternDirectionReference | null => reference.points.length > 1 ? { kind: "external", referenceId: reference.id, fallback: { x: reference.points.at(-1)!.x - reference.points[0].x, y: reference.points.at(-1)!.y - reference.points[0].y } } : null;
  const choosePatternDirection = (reference: PatternDirectionReference) => {
    if (!patternDraft) return;
    if (patternDraft.stage === "direction-1") {
      if (patternDraft.kind === "rectangular-pattern") { setPatternDraft({ ...patternDraft, direction1: reference, stage: "direction-2" }); setPatternMessage("Select a second, non-parallel direction"); }
      else { setPatternDraft({ ...patternDraft, direction1: reference, stage: "parameters" }); setPatternMessage("Set spacing and instances, then apply the pattern"); }
      return;
    }
    if (patternDraft.stage === "direction-2") {
      const first = patternDraft.direction1 ? resolvePatternDirection(patternDraft.direction1, entities, externalReferences) : { x: 1, y: 0 }; const second = resolvePatternDirection(reference, entities, externalReferences);
      if (Math.abs(first.x * second.y - first.y * second.x) < 0.001) { setPatternMessage("Direction 2 must not be parallel to Direction 1"); return; }
      setPatternDraft({ ...patternDraft, direction2: reference, stage: "parameters" }); setPatternMessage("Set both direction spacings and instance counts, then apply");
    }
  };
  const centerReferenceAt = (position: Point, entity?: SketchEntity): PatternCenterReference => {
    if (distance(position, { x: 0, y: 0 }) <= 10 / safeZoom) return { kind: "origin" };
    if (entity) {
      const nearest = controlPointsForEntity(entity).reduce<{ handle: string; point: Point } | null>((best, control) => !best || distance(position, control.point) < distance(position, best.point) ? control : best, null);
      if (nearest && distance(position, nearest.point) <= 12 / safeZoom) return { kind: "entity-node", entityId: entity.id, handle: nearest.handle, fallback: nearest.point };
    }
    return { kind: "fixed", point: position };
  };
  const choosePatternCenter = (center: PatternCenterReference) => {
    if (!patternDraft || patternDraft.kind !== "circular-pattern") return;
    const resolved = resolvePatternCenter(center, entities, externalReferences); const seeds = entities.filter((entity) => patternDraft.seedIds.includes(entity.id));
    const seedCenter = seeds.length ? seeds.map(entityBadgePoint).reduce((sum, point) => ({ x: sum.x + point.x / seeds.length, y: sum.y + point.y / seeds.length }), { x: 0, y: 0 }) : { x: resolved.x + patternDraft.radius, y: resolved.y };
    setPatternDraft({ ...patternDraft, center, radius: Math.max(0.001, distance(seedCenter, resolved)), arcAngle: Math.atan2(seedCenter.y - resolved.y, seedCenter.x - resolved.x) * 180 / Math.PI, stage: "parameters" }); setPatternMessage("Set the angular span and instance options, then apply");
  };
  const updatePatternDraft = (changes: Partial<PatternDraft>) => setPatternDraft((current) => current ? { ...current, ...changes } : current);
  const parseSkippedInstances = (value: string) => [...new Set(value.split(/[,\s]+/).map(Number).filter((item) => Number.isInteger(item) && item > 1).map((item) => item - 1))];
  const positionedCircularSeeds = (draftState: PatternDraft) => {
    const seeds = entities.filter((entity) => draftState.seedIds.includes(entity.id)); if (!draftState.center || !seeds.length) return seeds;
    const center = resolvePatternCenter(draftState.center, entities, externalReferences); const current = seeds.map(entityBadgePoint).reduce((sum, point) => ({ x: sum.x + point.x / seeds.length, y: sum.y + point.y / seeds.length }), { x: 0, y: 0 }); const angle = draftState.arcAngle * Math.PI / 180;
    const target = { x: center.x + Math.cos(angle) * Math.max(0.001, draftState.radius), y: center.y + Math.sin(angle) * Math.max(0.001, draftState.radius) }; const delta = { x: target.x - current.x, y: target.y - current.y };
    return seeds.map((seed) => translateSketchEntity(seed, delta));
  };
  const patternPreviewEntities = useMemo(() => {
    if (!patternDraft || patternDraft.stage !== "parameters") return [];
    const seeds = patternDraft.kind === "circular-pattern" ? positionedCircularSeeds(patternDraft) : entities.filter((entity) => patternDraft.seedIds.includes(entity.id)); if (!seeds.length) return [];
    if (patternDraft.kind === "circular-pattern" && patternDraft.center) {
      const center = resolvePatternCenter(patternDraft.center, entities, externalReferences); const count = Math.max(2, Math.min(100, Math.round(patternDraft.circularCount))); const step = (patternDraft.equalSpacing ? circularPatternStep(count, patternDraft.span) : patternDraft.span) * (patternDraft.reverse ? -1 : 1);
      return seeds.flatMap((seed) => Array.from({ length: count - 1 }, (_, offset) => offset + 1).filter((index) => !patternDraft.skipped.includes(index)).map((index) => circularPatternSketchEntity(seed, center, step * index, patternDraft.rotateInstances, `preview-${seed.id}-${index}`)));
    }
    if (!patternDraft.direction1) return [];
    const first = resolvePatternDirection(patternDraft.direction1, entities, externalReferences); const direction1 = { x: first.x * (patternDraft.flip1 ? -1 : 1), y: first.y * (patternDraft.flip1 ? -1 : 1) };
    const secondRaw = patternDraft.direction2 ? resolvePatternDirection(patternDraft.direction2, entities, externalReferences) : { x: -direction1.y, y: direction1.x }; const direction2 = { x: secondRaw.x * (patternDraft.flip2 ? -1 : 1), y: secondRaw.y * (patternDraft.flip2 ? -1 : 1) };
    const columns = Math.max(2, Math.min(100, Math.round(patternDraft.count1))); const rows = patternDraft.kind === "rectangular-pattern" ? Math.max(2, Math.min(100, Math.round(patternDraft.count2))) : 1;
    return seeds.flatMap((seed) => Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => ({ column, row }))).flat().filter(({ column, row }) => (column || row) && !patternDraft.skipped.includes(row * columns + column)).map(({ column, row }) => linearPatternSketchEntity(seed, direction1, patternDraft.spacing1, column, direction2, patternDraft.spacing2, row, `preview-${seed.id}-${column}-${row}`)));
  }, [entities, externalReferences, patternDraft]);
  const applyPattern = () => {
    if (!patternDraft || patternDraft.stage !== "parameters") return;
    let seeds = entities.filter((entity) => patternDraft.seedIds.includes(entity.id)); if (!seeds.length) { setPatternMessage("Select at least one seed entity"); return; }
    if (patternDraft.kind === "circular-pattern") {
      if (!patternDraft.center) return; seeds = positionedCircularSeeds(patternDraft);
      const center = resolvePatternCenter(patternDraft.center, entities, externalReferences); const count = Math.max(2, Math.min(100, Math.round(patternDraft.circularCount))); const span = Math.max(0.1, Math.min(360, Math.abs(patternDraft.span))); const step = (patternDraft.equalSpacing ? circularPatternStep(count, span) : span) * (patternDraft.reverse ? -1 : 1); const copies: SketchEntity[] = [];
      const pairs = seeds.map((seed) => ({ sourceId: seed.id, instances: Array.from({ length: count - 1 }, (_, offset) => offset + 1).filter((index) => !patternDraft.skipped.includes(index)).map((index) => { const entityId = nextId(); copies.push(circularPatternSketchEntity(seed, center, step * index, patternDraft.rotateInstances, entityId)); return { entityId, index }; }) }));
      const constraint: CircularPatternConstraint = { id: `constraint-${crypto.randomUUID()}`, type: "circular-pattern", center: patternDraft.center, count, span, equalSpacing: patternDraft.equalSpacing, reverse: patternDraft.reverse, rotateInstances: patternDraft.rotateInstances, skipped: patternDraft.skipped, pairs };
      const positionedById = new Map(seeds.map((seed) => [seed.id, seed])); commit([...entities.map((entity) => positionedById.get(entity.id) ?? entity), ...copies]); commitConstraints([...constraints, constraint]); setSelectedEntityIds(copies.map((copy) => copy.id)); setPatternDraft(null); setPatternMessage(null); setTool("select"); return;
    }
    if (!patternDraft.direction1) return;
    const first = resolvePatternDirection(patternDraft.direction1, entities, externalReferences); const direction1 = { x: first.x * (patternDraft.flip1 ? -1 : 1), y: first.y * (patternDraft.flip1 ? -1 : 1) };
    const secondRaw = patternDraft.direction2 ? resolvePatternDirection(patternDraft.direction2, entities, externalReferences) : { x: -direction1.y, y: direction1.x }; const direction2 = { x: secondRaw.x * (patternDraft.flip2 ? -1 : 1), y: secondRaw.y * (patternDraft.flip2 ? -1 : 1) };
    const count1 = Math.max(2, Math.min(100, Math.round(patternDraft.count1))); const count2 = patternDraft.kind === "rectangular-pattern" ? Math.max(2, Math.min(100, Math.round(patternDraft.count2))) : 1; const copies: SketchEntity[] = [];
    const pairs = seeds.map((seed) => ({ sourceId: seed.id, instances: Array.from({ length: count2 }, (_, row) => Array.from({ length: count1 }, (_, column) => ({ column, row }))).flat().filter(({ column, row }) => (column || row) && !patternDraft.skipped.includes(row * count1 + column)).map(({ column, row }) => { const entityId = nextId(); copies.push(linearPatternSketchEntity(seed, direction1, patternDraft.spacing1, column, direction2, patternDraft.spacing2, row, entityId)); return { entityId, column, row }; }) }));
    const skipped = patternDraft.skipped.map((index) => ({ column: index % count1, row: Math.floor(index / count1) }));
    const common = { id: `constraint-${crypto.randomUUID()}`, direction1: patternDraft.direction1, spacing1: Math.max(0.01, patternDraft.spacing1), count1, flip1: patternDraft.flip1, spacing2: Math.max(0.01, patternDraft.spacing2), count2, flip2: patternDraft.flip2, skipped, pairs };
    const constraint: LinearPatternConstraint = patternDraft.kind === "rectangular-pattern" ? { ...common, type: "rectangular-pattern", direction2: patternDraft.direction2! } : { ...common, type: "linear-pattern", direction2: patternDraft.direction2 };
    commit([...entities, ...copies]); commitConstraints([...constraints, constraint]); setSelectedEntityIds(copies.map((copy) => copy.id)); setPatternDraft(null); setPatternMessage(null); setTool("select");
  };
  const handleEntityPointerDown = (event: React.PointerEvent<SVGGElement>, entity: SketchEntity) => {
    if (isPatternTool(tool) && patternDraft) {
      event.preventDefault(); event.stopPropagation(); const position = pointFromEvent(event);
      if (patternDraft.stage === "entities" || event.shiftKey && (patternDraft.stage === "direction-1" || patternDraft.stage === "center")) {
        const seedIds = patternDraft.seedIds.includes(entity.id) ? patternDraft.seedIds.filter((id) => id !== entity.id) : [...patternDraft.seedIds, entity.id]; const nextStage = seedIds.length ? patternDraft.kind === "circular-pattern" ? "center" : "direction-1" : "entities";
        setPatternDraft({ ...patternDraft, seedIds, stage: nextStage }); setSelectedEntityIds(seedIds); setPatternMessage(seedIds.length ? patternDraft.kind === "circular-pattern" ? "Select the pattern center · Shift-click to adjust seeds" : "Select a straight direction reference · Shift-click to adjust seeds" : "Select seed geometry"); return;
      }
      if (patternDraft.kind === "circular-pattern" && patternDraft.stage === "center") { choosePatternCenter(centerReferenceAt(position, entity)); return; }
      if ((patternDraft.stage === "direction-1" || patternDraft.stage === "direction-2") && entity.type === "line" && !patternDraft.seedIds.includes(entity.id)) { choosePatternDirection(directionReferenceForLine(entity)); return; }
      setPatternMessage(patternDraft.stage.startsWith("direction") ? "Select a straight line that is not part of the seed geometry" : "Select the pattern reference"); return;
    }
    if (tool === "mirror") {
      event.preventDefault(); event.stopPropagation();
      if (mirrorStage === "entities" || event.shiftKey) {
        const seedIds = selectedEntityIds.includes(entity.id) ? selectedEntityIds.filter((id) => id !== entity.id) : [...selectedEntityIds, entity.id];
        setSelectedEntityIds(seedIds); setMirrorStage(seedIds.length ? "axis" : "entities");
        setMirrorMessage(seedIds.length ? "Geometry selected · click a separate straight sketch line · Shift-click to adjust the selection" : "Select geometry to mirror");
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
      if (entity.type !== "line" && entity.type !== "spline") { setCornerMessage("Corner supports line segments and open splines"); return; }
      if (!cornerSource) {
        setCornerSource({ entityId: entity.id, click }); setCornerMessage("Select a line segment or spline to form the corner"); clearSelection(); setSelected(entity.id); return;
      }
      if (cornerSource.entityId === entity.id) return;
      const source = entities.find((candidate) => candidate.id === cornerSource.entityId);
      const result = source ? cornerEntities(source, cornerSource.click, entity, click) : null;
      if (!result) { setCornerMessage("Corner needs two non-parallel lines, or one line paired with an open spline"); return; }
      const [first, second] = result;
      const next = entities.map((item) => item.id === first.id ? first : item.id === second.id ? second : item);
      commit(next); commitConstraints(constraintsForGeometry(next)); setCornerSource(null); setCornerMessage("Corner created"); setSelected(second.id); return;
    }
    if (tool === "radius") {
      event.preventDefault(); event.stopPropagation(); const click = pointFromEvent(event);
      if (entity.type !== "line") { setRadiusMessage("Radius fillets require two line segments"); return; }
      const existingIndex = radiusSelections.findIndex((selection) => selection.entityId === entity.id);
      if (existingIndex >= 0) { const next = radiusSelections.filter((_, index) => index !== existingIndex); setRadiusSelections(next); setSelectedEntityIds(next.map((selection) => selection.entityId)); setRadiusMessage(next.length ? "Select the second line segment" : "Select the first line segment"); return; }
      const next = radiusSelections.length >= 2 ? [{ entityId: entity.id, click }] : [...radiusSelections, { entityId: entity.id, click }];
      setRadiusSelections(next); setSelectedEntityIds(next.map((selection) => selection.entityId)); setRadiusMessage(next.length === 2 ? "Adjust the radius and create the fillet" : "Select the second line segment"); return;
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
    if (tool === "radial-dimension") {
      event.preventDefault(); event.stopPropagation();
      if (entity.type !== "circle" && entity.type !== "arc") { setDimensionMessage("Radial dimension requires a circle or arc"); return; }
      const existing = constraints.find((constraint) => constraint.type === "radial" && constraint.entityId === entity.id);
      if (existing) { setSelectedConstraintId(existing.id); setRadialEntityId(null); setTool("select"); return; }
      setRadialEntityId(entity.id); setCursor(pointFromEvent(event)); setDimensionMessage("Move the pointer and click to place the radial dimension"); clearSelection(); return;
    }
    if (tool !== "select" && tool !== "trim") return;
    event.stopPropagation();
    if (tool === "trim") { beginTrimGesture(event, entity.id); return; }
    if (event.shiftKey) {
      event.preventDefault();
      setSelectedEntityIds((ids) => ids.includes(entity.id) ? ids.filter((id) => id !== entity.id) : [...ids, entity.id]);
      setSelectedAxisConstraint(null); setSelectedConstraintId(null); setSelectedDimensionKeys([]); setTool("select"); return;
    }
    if (selectedEntityIds.includes(entity.id) && selectionCount > 1) { beginSelectionDrag(event); return; }
    setSelected(entity.id); setSelectedAxisConstraint(null); setSelectedConstraintId(null); setSelectedDimensionKeys([]); setTool("select");
  };
  const resetTransientToolState = () => {
    setDraft([]); setExtendSource(null); setExtendMessage(null); setCornerSource(null); setCornerMessage(null); setRadiusSelections([]); setRadiusMessage(null); setPerpendicularSource(null); setPerpendicularMessage(null); setMirrorMessage(null); setMirrorStage("entities"); setPatternDraft(null); setPatternSkippedInput(null); setPatternMessage(null); setTrimGesture(null); setTrimMessage(null); setSketchCheck(null); setSketchCheckMessage(null); setDimensionReferences([]); setDiameterEntityId(null); setRadialEntityId(null); setDimensionMessage(null);
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
        <SketchCommandButton active={viewRotated} disabled={false} icon="⟂" label="Normal" title="Snap normal: align the view to the sketch plane" onClick={() => onSnapNormal?.()} />
        <SketchCommandButton active={tool === "sketch-check"} className="sketch-check-tool" disabled={false} icon={<span className="sketch-check-icon">⌁</span>} label="SketchCheck" title="SketchCheck: first click highlights open endpoints; second click trims dangling geometry or deletes isolated open segments" onClick={runSketchCheck} />
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
        <SketchCommandButton active={tool === "corner"} icon="⌜" label="Corner" title="Select two lines, or a line and spline, to trim or extend them into a corner" onClick={() => chooseTool("corner", { clear: true })} />
        <SketchCommandButton active={tool === "radius"} className="radius-tool" icon={<span className="sketch-radius-icon">R</span>} label="Radius" title="Sketch radius: select two line segments, set the radius, and create a tangent fillet" onClick={startRadius} />
        {activeEntity?.type === "spline" && <SketchCommandButton icon="≈" label="Relax" title="Relax spline: reset tangent handles to a relaxed automatic curve" onClick={() => commit(entities.map((entity) => entity.id === activeEntity.id ? { ...activeEntity, handles: undefined } : entity))} />}</div>
      </div>
      <div className="sketch-command-group pattern-group" aria-label="Sketch pattern tools"><b>Patterns</b><div className="sketch-command-tools">
        <SketchCommandButton active={tool === "mirror"} icon={<span className="mirror-pattern-icon"><i/><i/></span>} label="Mirror" title="Mirror selected sketch geometry about a straight line and keep both sides linked" onClick={startMirror} />
        <SketchCommandButton active={tool === "linear-pattern"} icon={<span className="linear-pattern-icon">•••</span>} label="Linear" title="Linear sketch pattern: select seed geometry, a direction, spacing, and instance count" onClick={() => startPattern("linear-pattern")} />
        <SketchCommandButton active={tool === "rectangular-pattern"} icon={<span className="rectangular-pattern-icon">⠿</span>} label="Rect" title="Rectangular sketch pattern: repeat selected geometry along two referenced directions" onClick={() => startPattern("rectangular-pattern")} />
        <SketchCommandButton active={tool === "circular-pattern"} icon={<span className="circular-pattern-icon">◌</span>} label="Circular" title="Circular sketch pattern: select seed geometry, a center, angular span, and instance count" onClick={() => startPattern("circular-pattern")} />
      </div></div>
      <div className="sketch-command-group constraint-group" aria-label="Sketch constraint tools"><b>Constraints</b><div className="sketch-command-tools">
        <SketchCommandButton active={tool === "linear-dimension"} className="constraint-tool" icon={<span className="linear-dimension-icon">↔</span>} label="Linear" title="Linear dimension constraint: select two nodes or lines, press Tab to change orientation, then click to place" onClick={() => chooseTool("linear-dimension", { selected: null })} />
        <SketchCommandButton active={tool === "angular-dimension"} className="constraint-tool" icon={<span className="angular-dimension-icon">∠</span>} label="Angle" title="Angular dimension constraint: select two non-parallel lines, then click to place" onClick={() => chooseTool("angular-dimension", { selected: null })} />
        <SketchCommandButton active={tool === "diameter-dimension"} className="constraint-tool diameter-constraint-tool" icon={<span className="diameter-dimension-icon">⌀</span>} label="Diameter" title="Diameter dimension constraint: select a circle, then click to place its driving diameter" onClick={() => chooseTool("diameter-dimension", { selected: null })} />
        <SketchCommandButton active={tool === "radial-dimension"} className="constraint-tool radial-constraint-tool" icon={<span className="radial-dimension-icon">R</span>} label="Radial" title="Radial dimension constraint: select a circle or arc, then click to place its driving radius" onClick={() => chooseTool("radial-dimension", { selected: null })} />
        <SketchCommandButton active={tool === "perpendicular-constraint"} className="constraint-tool perpendicular-constraint-tool" icon={<span className="perpendicular-constraint-icon" />} label="Perp" title="Perpendicular constraint: select two lines to make them meet at 90 degrees" onClick={() => chooseTool("perpendicular-constraint", { clear: true })} />
        <SketchCommandButton active={tool === "horizontal-constraint"} className="constraint-tool axis-constraint-tool" icon={<span className="axis-constraint-icon horizontal" />} label="Horiz" title="Lock a line horizontal" onClick={() => chooseTool("horizontal-constraint", { clear: true })} />
        <SketchCommandButton active={tool === "vertical-constraint"} className="constraint-tool axis-constraint-tool" icon={<span className="axis-constraint-icon vertical" />} label="Vert" title="Lock a line vertical" onClick={() => chooseTool("vertical-constraint", { clear: true })} /></div>
      </div>
    </div>
    {tool === "radius" && <aside className="sketch-pattern-manager sketch-radius-manager" aria-label="Sketch radius options">
      <header><div><small>SKETCH MODIFY</small><strong>Radius</strong></div><button type="button" aria-label="Cancel radius" title="Cancel" onClick={() => chooseTool("select")}>×</button></header>
      <div className={`pattern-manager-section ${radiusSelections.length < 2 ? "active-step" : ""}`}><b>1 · Lines to Fillet</b><div className="pattern-reference-row"><span>{radiusSelections.length ? `${radiusSelections.length} of 2 selected` : "Select in sketch"}</span><button type="button" onClick={() => { setRadiusSelections([]); setSelectedEntityIds([]); setRadiusMessage("Select the first line segment"); }}>Reselect</button></div></div>
      <div className={`pattern-manager-section ${radiusSelections.length === 2 ? "active-step" : ""}`}><b>2 · Fillet Radius</b><div className="pattern-field-grid radius-field"><label>Radius<BufferedNumberInput aria-label="Sketch fillet radius" min={0.001} step="any" value={Number(fromMillimeters(radiusValue, unitSystem).toFixed(4))} onValidValue={(value) => setRadiusValue(toMillimeters(value, unitSystem))}/><em>{unitSystem === "imperial" ? "in" : "mm"}</em></label></div><small>{radiusMessage ?? "The cyan preview updates as the radius changes."}</small></div>
      <footer><button type="button" className="cancel" onClick={() => chooseTool("select")}>Cancel</button><button type="button" className="apply" disabled={!radiusPreview} onClick={applyRadius}>✓ Create Radius</button></footer>
    </aside>}
    {tool === "mirror" && <aside className="sketch-pattern-manager sketch-mirror-manager" aria-label="Mirror pattern options">
      <header><div><small>SKETCH PATTERN</small><strong>Mirror</strong></div><button type="button" aria-label="Cancel mirror" title="Cancel" onClick={() => chooseTool("select")}>×</button></header>
      <div className={`pattern-manager-section ${mirrorStage === "entities" ? "active-step" : ""}`}><b>1 · Entities to Mirror</b><div className="pattern-reference-row"><span>{selectedEntityIds.length ? `${selectedEntityIds.length} selected` : "Select in sketch"}</span><button type="button" onClick={() => { setSelectedEntityIds([]); setMirrorStage("entities"); setMirrorMessage("Select geometry to mirror · Shift-click to add more"); }}>Reselect</button></div></div>
      <div className={`pattern-manager-section ${mirrorStage === "axis" ? "active-step" : ""}`}><b>2 · Mirror Line</b><div className="pattern-reference-row"><span>{mirrorStage === "axis" ? "Select a straight sketch line" : "Waiting for geometry"}</span></div><small>The mirrored geometry stays linked to its source through the mirror constraint.</small></div>
      <footer><button type="button" className="cancel" onClick={() => chooseTool("select")}>Cancel</button></footer>
    </aside>}
    {patternDraft && <aside className="sketch-pattern-manager" aria-label={`${patternDraft.kind.replace("-pattern", "")} pattern options`}>
      <header><div><small>SKETCH PATTERN</small><strong>{patternDraft.kind === "linear-pattern" ? "Linear Pattern" : patternDraft.kind === "rectangular-pattern" ? "Rectangular Pattern" : "Circular Pattern"}</strong></div><button type="button" aria-label="Cancel pattern" title="Cancel" onClick={() => chooseTool("select")}>×</button></header>
      <div className={`pattern-manager-section ${patternDraft.stage === "entities" ? "active-step" : ""}`}><b>1 · Entities to Pattern</b><div className="pattern-reference-row"><span>{patternDraft.seedIds.length ? `${patternDraft.seedIds.length} selected` : "Select in sketch"}</span><button type="button" onClick={() => { setSelectedEntityIds([]); updatePatternDraft({ seedIds: [], stage: "entities" }); setPatternMessage("Select seed geometry · Shift-click to add, then click the reference"); }}>Reselect</button></div></div>
      {patternDraft.kind !== "circular-pattern" ? <>
        <div className={`pattern-manager-section ${patternDraft.stage === "direction-1" ? "active-step" : ""}`}><b>2 · Direction 1</b><div className="pattern-reference-row"><span>{patternDraft.direction1 ? patternDraft.direction1.kind === "entity" ? "Sketch line" : "Reference edge / axis" : patternDraft.seedIds.length ? "Select in sketch" : "Waiting for geometry"}</span><button type="button" disabled={!patternDraft.seedIds.length} onClick={() => { updatePatternDraft({ stage: "direction-1" }); setPatternMessage("Select Direction 1"); }}>Select</button></div><div className="pattern-field-grid"><label>Spacing<BufferedNumberInput min={0.001} step="any" value={Number(fromMillimeters(patternDraft.spacing1, unitSystem).toFixed(4))} onValidValue={(value) => updatePatternDraft({ spacing1: toMillimeters(value, unitSystem) })}/><em>{unitSystem === "imperial" ? "in" : "mm"}</em></label><label>Instances<BufferedNumberInput min={2} max={100} step="1" value={patternDraft.count1} onValidValue={(value) => updatePatternDraft({ count1: Math.round(value) })}/></label></div><label className="pattern-check"><input type="checkbox" checked={patternDraft.flip1} onChange={(event) => updatePatternDraft({ flip1: event.target.checked })}/> Reverse Direction 1</label></div>
        {patternDraft.kind === "rectangular-pattern" && <div className={`pattern-manager-section ${patternDraft.stage === "direction-2" ? "active-step" : ""}`}><b>3 · Direction 2</b><div className="pattern-reference-row"><span>{patternDraft.direction2 ? patternDraft.direction2.kind === "entity" ? "Sketch line" : "Reference edge / axis" : patternDraft.direction1 ? "Select in sketch" : "Waiting for Direction 1"}</span><button type="button" disabled={!patternDraft.direction1} onClick={() => { updatePatternDraft({ stage: "direction-2" }); setPatternMessage("Select Direction 2"); }}>Select</button></div><div className="pattern-field-grid"><label>Spacing<BufferedNumberInput min={0.001} step="any" value={Number(fromMillimeters(patternDraft.spacing2, unitSystem).toFixed(4))} onValidValue={(value) => updatePatternDraft({ spacing2: toMillimeters(value, unitSystem) })}/><em>{unitSystem === "imperial" ? "in" : "mm"}</em></label><label>Instances<BufferedNumberInput min={2} max={100} step="1" value={patternDraft.count2} onValidValue={(value) => updatePatternDraft({ count2: Math.round(value) })}/></label></div><label className="pattern-check"><input type="checkbox" checked={patternDraft.flip2} onChange={(event) => updatePatternDraft({ flip2: event.target.checked })}/> Reverse Direction 2</label></div>}
      </> : <div className={`pattern-manager-section ${patternDraft.stage === "center" ? "active-step" : ""}`}><b>2 · Pattern Center</b><div className="pattern-reference-row"><span>{patternDraft.center ? "Center selected" : patternDraft.seedIds.length ? "Select in sketch" : "Waiting for geometry"}</span><button type="button" disabled={!patternDraft.seedIds.length} onClick={() => { updatePatternDraft({ stage: "center" }); setPatternMessage("Select a node, origin, background point, or free center"); }}>Select</button></div><div className="pattern-field-grid"><label>Instances<BufferedNumberInput min={2} max={100} step="1" value={patternDraft.circularCount} onValidValue={(value) => updatePatternDraft({ circularCount: Math.round(value) })}/></label><label>{patternDraft.equalSpacing ? "Total span" : "Angle between"}<BufferedNumberInput min={0.1} max={360} step="any" value={patternDraft.span} onValidValue={(value) => updatePatternDraft({ span: value })}/><em>deg</em></label></div><div className="pattern-field-grid"><label>Radius<BufferedNumberInput min={0.001} step="any" value={Number(fromMillimeters(patternDraft.radius, unitSystem).toFixed(4))} onValidValue={(value) => updatePatternDraft({ radius: toMillimeters(value, unitSystem) })}/><em>{unitSystem === "imperial" ? "in" : "mm"}</em></label><label>Arc angle<BufferedNumberInput min={-360} max={360} step="any" value={Number(patternDraft.arcAngle.toFixed(3))} onValidValue={(value) => updatePatternDraft({ arcAngle: value })}/><em>deg</em></label></div><label className="pattern-check"><input type="checkbox" checked={patternDraft.equalSpacing} onChange={(event) => updatePatternDraft({ equalSpacing: event.target.checked })}/> Equal spacing across angular span</label><label className="pattern-check"><input type="checkbox" checked={patternDraft.reverse} onChange={(event) => updatePatternDraft({ reverse: event.target.checked })}/> Reverse direction</label><label className="pattern-check"><input type="checkbox" checked={patternDraft.rotateInstances} onChange={(event) => updatePatternDraft({ rotateInstances: event.target.checked })}/> Rotate instances about center</label></div>}
      <div className="pattern-manager-section"><b>Instances to Skip</b><label className="pattern-skip-field">Instance numbers<input type="text" placeholder="e.g. 3, 5" value={patternSkippedInput ?? patternDraft.skipped.map((index) => index + 1).join(", ")} onFocus={(event) => { setPatternSkippedInput(event.currentTarget.value); event.currentTarget.select(); }} onChange={(event) => { setPatternSkippedInput(event.target.value); updatePatternDraft({ skipped: parseSkippedInstances(event.target.value) }); }} onBlur={() => setPatternSkippedInput(null)}/></label><small>Instance 1 is the seed and cannot be skipped.</small></div>
      <footer><button type="button" className="cancel" onClick={() => chooseTool("select")}>Cancel</button><button type="button" className="apply" disabled={!patternDraft.seedIds.length || (patternDraft.kind === "circular-pattern" ? !patternDraft.center : !patternDraft.direction1 || patternDraft.kind === "rectangular-pattern" && !patternDraft.direction2)} onClick={applyPattern}>✓ Create Pattern</button></footer>
    </aside>}
    <svg ref={svgRef} className={`sketch-canvas tool-${tool} ${dragging ? "dragging-point" : ""} ${draggingDimension ? "dragging-dimension" : ""} ${selectionMarquee ? "marquee-selecting" : ""} ${draggingSelection ? "dragging-selection" : ""} ${trimGesture ? "trimming-gesture" : ""}`} viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} preserveAspectRatio="xMidYMid slice" onPointerMove={onMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onPointerDown={onCanvasPointerDown} onDoubleClick={() => tool === "spline" && finishSpline()} onContextMenu={(event) => event.preventDefault()}>
      <defs><pattern id="minor-grid" width={gridSquareSize} height={gridSquareSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSquareSize} 0 L 0 0 0 ${gridSquareSize}`} className="minor-grid-line" /></pattern><pattern id="major-grid" width={gridSquareSize * 5} height={gridSquareSize * 5} patternUnits="userSpaceOnUse"><rect width={gridSquareSize * 5} height={gridSquareSize * 5} fill="url(#minor-grid)"/><path d={`M ${gridSquareSize * 5} 0 L 0 0 0 ${gridSquareSize * 5}`} className="major-grid-line" /></pattern></defs>
      {showGrid && <rect x={viewX} y={viewY} width={viewWidth} height={viewHeight} fill="url(#major-grid)" />}
      <line x1={viewX} y1="0" x2={viewX + viewWidth} y2="0" className={`sketch-axis x ${hoveredReferenceId === "sketch-axis:x" || xAxisChosen ? "reference-highlighted" : ""}`}/><line x1="0" y1={viewY} x2="0" y2={viewY + viewHeight} className={`sketch-axis y ${hoveredReferenceId === "sketch-axis:y" || yAxisChosen ? "reference-highlighted" : ""}`}/>
      {(tool === "linear-dimension" || tool === "angular-dimension" || isPatternTool(tool) && (patternDraft?.stage === "direction-1" || patternDraft?.stage === "direction-2" || patternDraft?.stage === "center")) && externalReferences.map((reference) => {
        if (reference.points.length < 2) return null;
        const collapsed = reference.kind === "body-edge" && reference.points.every((point) => distance(point, reference.points[0]) < 0.05);
        const chooseExternalReference = (event: React.PointerEvent<SVGElement>) => { event.stopPropagation(); const position = pointFromEvent(event); if (isPatternTool(tool) && patternDraft) { if (patternDraft.kind === "circular-pattern" && patternDraft.stage === "center") choosePatternCenter({ kind: "external-point", referenceId: reference.id, fallback: nearestPointOnPath(position, reference.points) }); else { const direction = directionReferenceForExternal(reference); if (direction) choosePatternDirection(direction); } return; } if (reference.kind === "plane-intersection") chooseDimensionReference({ kind: "external-line", referenceId: reference.id, a: reference.points[0], b: reference.points.at(-1)!, source: "plane-intersection" }, position); else if (tool === "linear-dimension") chooseDimensionReference({ kind: "external-point", referenceId: reference.id, point: nearestPointOnPath(position, reference.points), source: "body-edge" }, position); };
        return collapsed ? <circle key={reference.id} className="external-reference-point" aria-label={reference.label} cx={reference.points[0].x} cy={reference.points[0].y} r={nodeRadius * 1.25} onPointerDown={chooseExternalReference}/> : <polyline key={reference.id} className={`external-reference ${reference.kind}`} aria-label={reference.label} points={reference.points.map((point) => `${point.x},${point.y}`).join(" ")} onPointerDown={chooseExternalReference}/>;
      })}
      {entities.map((entity) => { const referenceId = `line:${entity.id}`; const dimensionLineTool = tool === "linear-dimension" || tool === "angular-dimension" || tool === "perpendicular-constraint" || tool === "mirror" || isPatternTool(tool) && patternDraft?.stage.startsWith("direction"); const referenceChosen = dimensionReferences.some((reference) => reference.kind === "line" && reference.entityId === entity.id); const checkOpen = sketchCheck?.affectedEntityIds.includes(entity.id); return <g key={entity.id} className={`sketch-entity ${selectedEntityIds.includes(entity.id) ? "selected" : ""} ${checkOpen ? "sketch-check-open" : ""} ${extendSource?.entityId === entity.id || cornerSource?.entityId === entity.id || radiusSelections.some((selection) => selection.entityId === entity.id) || perpendicularSource === entity.id ? "extend-source" : ""} ${entity.construction ? "construction" : ""} ${dimensionLineTool && entity.type === "line" || tool === "diameter-dimension" && entity.type === "circle" || tool === "radial-dimension" && (entity.type === "circle" || entity.type === "arc") ? "constraint-selectable" : ""}`} onContextMenu={(event) => openConstraintShortcut(event, entity)} onPointerDown={(event) => handleEntityPointerDown(event, entity)}>
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
        {(tool === "trim" || tool === "corner") && entity.type === "spline" && <path className="trim-hit" d={splinePath(entity.points, entity.handles)} />}
        {entitySnapPoints(entity).map((candidate, index) => <circle key={index} className={`sketch-point ${candidate.kind}`} cx={candidate.point.x} cy={candidate.point.y} r={nodeRadius} />)}
      </g>; })}
      {patternPreviewEntities.length > 0 && <g className="sketch-pattern-preview" aria-label="Pattern preview">{patternPreviewEntities.map((entity) => <g key={entity.id}>
        {entity.type === "line" && <line x1={entity.a.x} y1={entity.a.y} x2={entity.b.x} y2={entity.b.y}/>}
        {entity.type === "circle" && <circle cx={entity.c.x} cy={entity.c.y} r={entity.r}/>}
        {entity.type === "ellipse" && <ellipse cx={entity.c.x} cy={entity.c.y} rx={entity.rx} ry={entity.ry} transform={entity.rotation ? `rotate(${entity.rotation * 180 / Math.PI} ${entity.c.x} ${entity.c.y})` : undefined}/>}
        {entity.type === "arc" && <path d={arcPath(entity.a, entity.b, entity.through)}/>}
        {entity.type === "spline" && <path d={splinePath(entity.points, entity.handles)}/>}
      </g>)}</g>}
      {sketchCheck?.openEndpoints.map((endpoint, index) => <g key={`sketch-check-endpoint-${index}`} className="sketch-check-endpoint" transform={`translate(${endpoint.point.x} ${endpoint.point.y}) scale(${1 / safeZoom})`} aria-label={`Open endpoint ${index + 1}`}><circle r="7"/><path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5"/></g>)}
      {tool === "select" && entities.map((entity) => <g key={`controls-${entity.id}`} className={`control-layer ${selectedEntityIds.includes(entity.id) ? "active" : "inactive"}`}>{controlPointsForEntity(entity).map((control) => <circle key={control.handle} className="control-point" cx={control.point.x} cy={control.point.y} r={nodeRadius * (selectedEntityIds.includes(entity.id) ? 1.25 : 1)} onPointerDown={(event) => beginDrag(event, entity.id, control.handle, control.point)} onContextMenu={entity.type === "spline" ? (event) => openConstraintShortcut(event, entity) : undefined} />)}</g>)}
      {tool === "select" && entities.filter((entity): entity is Extract<SketchEntity, { type: "spline" }> => entity.type === "spline" && selectedEntityIds.includes(entity.id)).map((entity) => { const handles = entity.handles?.length === entity.points.length ? entity.handles : automaticSplineHandles(entity.points); return <g key={`spline-handles-${entity.id}`} className="spline-handle-layer">{entity.points.flatMap((point, index) => ([<line key={`${index}-in-line`} x1={point.x} y1={point.y} x2={handles[index].in.x} y2={handles[index].in.y}/>, <line key={`${index}-out-line`} x1={point.x} y1={point.y} x2={handles[index].out.x} y2={handles[index].out.y}/>, <circle key={`${index}-in`} cx={handles[index].in.x} cy={handles[index].in.y} r={nodeRadius * .9} onPointerDown={(event) => beginSplineHandleDrag(event, entity.id, index, "in")}/>, <circle key={`${index}-out`} cx={handles[index].out.x} cy={handles[index].out.y} r={nodeRadius * .9} onPointerDown={(event) => beginSplineHandleDrag(event, entity.id, index, "out")}/>]))}</g>; })}
      {(tool === "linear-dimension" || tool === "angular-dimension" || isPatternTool(tool) && patternDraft?.stage.startsWith("direction")) && <g className="axis-reference-layer">
        <rect x={viewX} y={-11 / safeZoom} width={viewWidth} height={22 / safeZoom} className="axis-reference-hit x" role="button" tabIndex={0} aria-label="Red sketch X axis" onPointerEnter={(event) => hoverAxisOrLine("x", event)} onPointerMove={(event) => hoverAxisOrLine("x", event)} onPointerLeave={() => setHoveredReferenceId(null)} onPointerDown={(event) => isPatternTool(tool) ? choosePatternAxisOrLine("x", event) : chooseAxisOrLine("x", event)}/>
        <rect x={-11 / safeZoom} y={viewY} width={22 / safeZoom} height={viewHeight} className="axis-reference-hit y" role="button" tabIndex={0} aria-label="Green sketch Y axis" onPointerEnter={(event) => hoverAxisOrLine("y", event)} onPointerMove={(event) => hoverAxisOrLine("y", event)} onPointerLeave={() => setHoveredReferenceId(null)} onPointerDown={(event) => isPatternTool(tool) ? choosePatternAxisOrLine("y", event) : chooseAxisOrLine("y", event)}/>
      </g>}
      {tool === "linear-dimension" && entities.map((entity) => <g key={`constraint-nodes-${entity.id}`} className="constraint-node-layer">{controlPointsForEntity(entity).map((control) => { const reference: SketchReference = { kind: "node", entityId: entity.id, handle: control.handle }; const referenceId = `node:${entity.id}:${control.handle}`; const chosen = dimensionReferences.some((candidate) => candidate.kind === "node" && candidate.entityId === reference.entityId && candidate.handle === reference.handle); const otherPoints = dimensionControlPoints.filter((candidate) => candidate.entityId !== entity.id || candidate.handle !== control.handle).map((candidate) => candidate.point); const preferredHitRadius = Math.max(nodeRadius, (entity.type === "line" ? 10 : 16) / safeZoom); const hitRadius = nonOverlappingReferenceHitRadius(control.point, otherPoints, preferredHitRadius, entity.type === "line" ? 0.22 : 0.45); const chooseNode = (event: React.PointerEvent<SVGCircleElement>) => { event.stopPropagation(); chooseDimensionReference(reference, pointFromEvent(event)); }; return <g key={control.handle}><circle className="constraint-node-hit" role="button" tabIndex={0} aria-label={`Dimension node ${entity.id} ${control.handle}`} cx={control.point.x} cy={control.point.y} r={hitRadius} onPointerEnter={() => setHoveredReferenceId(referenceId)} onPointerLeave={() => setHoveredReferenceId((current) => current === referenceId ? null : current)} onPointerDown={chooseNode} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseDimensionReference(reference, control.point); } }} /><circle className={`constraint-node ${hoveredReferenceId === referenceId || chosen ? "reference-highlighted" : ""}`} cx={control.point.x} cy={control.point.y} r={nodeRadius} /></g>; })}</g>)}
      {trimGesture && trimGesture.points.length > 1 && <polyline className="trim-gesture-trail" points={trimGesture.points.map((point) => `${point.x},${point.y}`).join(" ")} />}
      {preview.length > 1 && <g className="sketch-preview">{tool === "circle" && draft[0] ? <circle cx={draft[0].x} cy={draft[0].y} r={distance(draft[0], cursor)} /> : tool === "ellipse" && draft.length === 2 ? <ellipse cx={draft[0].x} cy={draft[0].y} rx={Math.abs(draft[1].x - draft[0].x) || distance(draft[0], draft[1])} ry={Math.abs(cursor.y - draft[0].y)} /> : tool === "arc" && draft.length === 2 ? <path d={arcPath(draft[0], draft[1], cursor)} /> : tool === "rectangle" && draft[0] ? <rect x={Math.min(draft[0].x, cursor.x)} y={Math.min(draft[0].y, cursor.y)} width={Math.abs(cursor.x - draft[0].x)} height={Math.abs(cursor.y - draft[0].y)} /> : tool === "spline" ? <path d={splinePath(preview)} /> : <line x1={draft.at(-1)!.x} y1={draft.at(-1)!.y} x2={cursor.x} y2={cursor.y} />}</g>}
      {radiusPreview && <g className="sketch-radius-preview" aria-label="Sketch radius preview"><line x1={radiusPreview.first.a.x} y1={radiusPreview.first.a.y} x2={radiusPreview.first.b.x} y2={radiusPreview.first.b.y}/><line x1={radiusPreview.second.a.x} y1={radiusPreview.second.a.y} x2={radiusPreview.second.b.x} y2={radiusPreview.second.b.y}/><path d={arcPath(radiusPreview.arc.a, radiusPreview.arc.b, radiusPreview.arc.through)}/></g>}
      {constraints.map((constraint) => {
        if (constraint.type === "mirror" || isPatternConstraint(constraint)) return null;
        if (constraint.type === "diameter") {
          const layout = diameterDimensionLayout(constraint.entityId, constraint.position, entities);
          const actualValue = diameterDimensionValue(constraint.entityId, entities); const displayedValue = constraint.conflicted ? actualValue : constraint.value;
          const text = `⌀ ${formatLength(displayedValue, unitSystem)}`; const editableValue = fromMillimeters(displayedValue, unitSystem); const labelWidth = Math.max(42, text.length * 4.3 + 13);
          return <g key={constraint.id} className={`linear-constraint diameter-constraint ${constraint.conflicted ? "conflicted" : ""} ${selectedConstraintIds.includes(constraint.id) ? "selected" : ""}`}><line className="constraint-measure" x1={layout.first.x} y1={layout.first.y} x2={layout.second.x} y2={layout.second.y}/><path className="constraint-arrow" d={dimensionArrowPath(layout.first, layout.second, dimensionScale)}/><line className="constraint-extension" x1={layout.second.x} y1={layout.second.y} x2={layout.label.x} y2={layout.label.y}/><g className="constraint-label" role="button" tabIndex={0} aria-label={`Diameter dimension ${text}${constraint.conflicted ? ", over defined" : ""}`} transform={`translate(${layout.label.x} ${layout.label.y}) scale(${dimensionLabelScale})`} onPointerDown={(event) => beginConstraintDrag(event, constraint)} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedConstraintId(constraint.id); setEditingDimension(null); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(editableValue.toFixed(4)))); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(editableValue.toFixed(4)))); } }}><rect x={-labelWidth / 2} y="-7" width={labelWidth} height="14" rx="3"/><text textAnchor="middle" dominantBaseline="central">{text}</text></g></g>;
        }
        if (constraint.type === "radial") {
          const layout = radialDimensionLayout(constraint.entityId, constraint.position, entities);
          const actualValue = radialDimensionValue(constraint.entityId, entities); const displayedValue = constraint.conflicted ? actualValue : constraint.value;
          const text = `R ${formatLength(displayedValue, unitSystem)}`; const editableValue = fromMillimeters(displayedValue, unitSystem); const labelWidth = Math.max(42, text.length * 4.3 + 13);
          return <g key={constraint.id} className={`linear-constraint radial-constraint ${constraint.conflicted ? "conflicted" : ""} ${selectedConstraintIds.includes(constraint.id) ? "selected" : ""}`}><line className="constraint-measure" x1={layout.first.x} y1={layout.first.y} x2={layout.second.x} y2={layout.second.y}/><path className="constraint-arrow" d={dimensionArrowPath(layout.first, layout.second, dimensionScale)}/><line className="constraint-extension" x1={layout.second.x} y1={layout.second.y} x2={layout.label.x} y2={layout.label.y}/><g className="constraint-label" role="button" tabIndex={0} aria-label={`Radial dimension ${text}${constraint.conflicted ? ", over defined" : ""}`} transform={`translate(${layout.label.x} ${layout.label.y}) scale(${dimensionLabelScale})`} onPointerDown={(event) => beginConstraintDrag(event, constraint)} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedConstraintId(constraint.id); setEditingDimension(null); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(editableValue.toFixed(4)))); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(editableValue.toFixed(4)))); } }}><rect x={-labelWidth / 2} y="-7" width={labelWidth} height="14" rx="3"/><text textAnchor="middle" dominantBaseline="central">{text}</text></g></g>;
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
      {radialPreview && <g className="linear-constraint radial-constraint preview"><line className="constraint-measure" x1={radialPreview.first.x} y1={radialPreview.first.y} x2={radialPreview.second.x} y2={radialPreview.second.y}/><path className="constraint-arrow" d={dimensionArrowPath(radialPreview.first, radialPreview.second, dimensionScale)}/><line className="constraint-extension" x1={radialPreview.second.x} y1={radialPreview.second.y} x2={radialPreview.label.x} y2={radialPreview.label.y}/><g className="constraint-preview-label" transform={`translate(${radialPreview.label.x} ${radialPreview.label.y}) scale(${dimensionLabelScale})`}><rect x="-32" y="-10" width="64" height="20" rx="4"/><text textAnchor="middle" dominantBaseline="central">{`R ${formatLength(radialPreview.value, unitSystem)}`}</text></g></g>}
      {visibleDimensions.map((dimension) => { const position = dimensionPosition(dimension); const text = dimensionTextFor(dimension); const editableValue = fromMillimeters(dimension.value, unitSystem); const labelWidth = Math.max(36, text.length * 4.3 + 13); const moved = dimensionOffsets[dimension.key] && (Math.abs(dimensionOffsets[dimension.key].x) > 0.1 || Math.abs(dimensionOffsets[dimension.key].y) > 0.1); return <g key={dimension.key} className={`dimension-annotation ${selectedDimensionKeys.includes(dimension.key) ? "selected" : ""}`}>{moved && <line className="dimension-leader" x1={dimension.anchor.x} y1={dimension.anchor.y} x2={position.x} y2={position.y}/>}<g className="sketch-dimension" role="button" tabIndex={0} aria-label={`Edit dimension ${text}`} transform={`translate(${position.x} ${position.y}) scale(${dimensionLabelScale})`} onPointerDown={(event) => beginDimensionDrag(event, dimension)} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setTool("select"); setEditingConstraintId(null); setSelectedConstraintId(null); setEditingDimension(dimension); setDimensionValue(String(Number(editableValue.toFixed(4)))); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setEditingConstraintId(null); setSelectedConstraintId(null); setEditingDimension(dimension); setDimensionValue(String(Number(editableValue.toFixed(4)))); } }}><line x1={-labelWidth / 2 - 5} y1="0" x2={labelWidth / 2 + 5} y2="0"/><path d={`M${-labelWidth / 2 - 5} 0 l4 -2 v4z M${labelWidth / 2 + 5} 0 l-4 -2 v4z`}/><rect x={-labelWidth / 2} y="-7" width={labelWidth} height="14" rx="3"/><text textAnchor="middle" dominantBaseline="central">{text}</text></g></g>; })}
      {selectionMarquee && marqueeBox && <rect className={`sketch-selection-box ${selectionMarquee.current.x < selectionMarquee.start.x ? "crossing" : "window"}`} x={marqueeBox.left} y={marqueeBox.top} width={marqueeBox.right - marqueeBox.left} height={marqueeBox.bottom - marqueeBox.top}/>}
      {entities.filter((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.type === "line" && Boolean(entity.axisConstraint)).map((entity) => { const relation = entity.axisConstraint!; const center = midpoint(entity.a, entity.b); const dx = entity.b.x - entity.a.x; const dy = entity.b.y - entity.a.y; const length = Math.max(distance(entity.a, entity.b), 0.001); const position = { x: center.x - dy / length * 10 / safeZoom, y: center.y + dx / length * 10 / safeZoom }; const selectedRelation = selectedAxisConstraint?.entityId === entity.id && selectedAxisConstraint.relation === relation; return <g key={`locked-${entity.id}`} role="button" tabIndex={0} aria-label={`${relation} constraint; select and press Delete to remove`} transform={`translate(${position.x} ${position.y}) scale(${1 / safeZoom})`} className={`locked-axis-constraint ${selectedRelation ? "selected" : ""}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); clearSelection(); setSelectedAxisConstraint({ entityId: entity.id, relation }); setTool("select"); }}><rect x="-5" y="-5" width="10" height="10" rx="2"/><text textAnchor="middle" dominantBaseline="central">{relation === "Horizontal" ? "H" : "V"}</text></g>; })}
      {constraints.filter((constraint): constraint is MirrorConstraint => constraint.type === "mirror").flatMap((constraint) => constraint.pairs.map((pair, index) => {
        const mirrored = entities.find((entity) => entity.id === pair.mirroredId); if (!mirrored) return null;
        const anchor = entityBadgePoint(mirrored); const selectedMirror = selectedConstraintIds.includes(constraint.id);
        return <g key={`${constraint.id}-${index}`} role="button" tabIndex={0} aria-label="Mirror constraint; select and press Delete to unlink" transform={`translate(${anchor.x + 8 / safeZoom} ${anchor.y - 8 / safeZoom}) scale(${1 / safeZoom})`} className={`mirror-constraint-badge ${selectedMirror ? "selected" : ""}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); clearSelection(); setSelectedConstraintId(constraint.id); setTool("select"); }}><rect x="-4" y="-4" width="8" height="8" rx="1.5"/><text textAnchor="middle" dominantBaseline="central">M</text></g>;
      }))}
      {constraints.filter(isPatternConstraint).flatMap((constraint) => constraint.pairs.flatMap((pair) => pair.instances.map((instance, index) => {
        const patterned = entities.find((entity) => entity.id === instance.entityId); if (!patterned) return null;
        const anchor = entityBadgePoint(patterned); const selectedPattern = selectedConstraintIds.includes(constraint.id); const glyph = constraint.type === "linear-pattern" ? "L" : constraint.type === "rectangular-pattern" ? "R" : "C";
        return <g key={`${constraint.id}-${pair.sourceId}-${index}`} role="button" tabIndex={0} aria-label={`${constraint.type.replace("-pattern", "")} pattern constraint; select and press Delete to unlink`} transform={`translate(${anchor.x + 7 / safeZoom} ${anchor.y - 7 / safeZoom}) scale(${1 / safeZoom})`} className={`pattern-constraint-badge ${selectedPattern ? "selected" : ""}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); clearSelection(); setSelectedConstraintId(constraint.id); setTool("select"); }}><circle r="3.2"/><text textAnchor="middle" dominantBaseline="central">{glyph}</text></g>;
      })))}
      {entities.flatMap((entity) => entity.type === "spline" ? [] : entity.relations?.map((relation, index) => ({ entity, relation, index })).filter(({ relation }) => entity.axisConstraint !== relation && sketchRelationIsSatisfied(entity, relation) && (relation === "Horizontal" || relation === "Vertical" || relation === "Concentric" || relation === "Perpendicular")) ?? []).map(({ entity, relation, index }) => { const point = entity.type === "line" ? midpoint(entity.a, entity.b) : entity.type === "circle" || entity.type === "ellipse" ? entity.c : (entity as Extract<SketchEntity, { type: "arc" }>).through; return <text key={`${entity.id}-${index}`} x={point.x + 5 + index * 8} y={point.y + 9} className="relation-glyph">{relation === "Horizontal" ? "H" : relation === "Vertical" ? "V" : relation === "Perpendicular" ? "⊥" : "◎"}</text>; })}
      {coincidentMarkers.map((point, index) => <g key={`coincident-${index}`} className="coincident-relation-glyph" transform={`translate(${point.x} ${point.y}) scale(${1 / safeZoom})`} aria-label="Coincident endpoints"><circle r="3.2"/><circle r="1.1"/></g>)}
      {snap && (sketchingToolActive || Boolean(dragging) && snap.kind === "endpoint") && <g className={`snap-marker ${snap.kind} ${dragging ? "drag-snap" : ""}`}><circle cx={snap.point.x} cy={snap.point.y} r={nodeRadius}/><text x={snap.point.x + 7 / safeZoom} y={snap.point.y - 7 / safeZoom}>{dragging ? "coincident" : snap.kind}</text></g>}
      {editingDimension && editingDimensionPosition && <foreignObject x="-36" y="-16" width="72" height="32" transform={`translate(${editingDimensionPosition.x} ${editingDimensionPosition.y}) scale(${dimensionLabelScale})`}><input ref={dimensionInputRef} className="dimension-editor" aria-label="Dimension value" value={dimensionValue} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => setDimensionValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { event.preventDefault(); cancelDimensionEditOnBlur.current = true; setEditingDimension(null); } }} onBlur={() => { if (cancelDimensionEditOnBlur.current) cancelDimensionEditOnBlur.current = false; else applyDimension(); }} /></foreignObject>}
      {editingConstraint && editingConstraintPosition && <foreignObject x="-38" y="-16" width="76" height="32" transform={`translate(${editingConstraintPosition.x} ${editingConstraintPosition.y}) scale(${dimensionLabelScale})`}><input ref={dimensionInputRef} className="dimension-editor constraint-editor" aria-label={editingConstraint.type === "angular" ? "Angular constraint value" : editingConstraint.type === "diameter" ? "Diameter constraint value" : editingConstraint.type === "radial" ? "Radial constraint value" : "Linear constraint value"} value={dimensionValue} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => setDimensionValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { event.preventDefault(); cancelDimensionEditOnBlur.current = true; setEditingConstraintId(null); } }} onBlur={() => { if (cancelDimensionEditOnBlur.current) cancelDimensionEditOnBlur.current = false; else applyConstraintDimension(); }} /></foreignObject>}
    </svg>
    {constraintShortcut && <div className="sketch-constraint-shortcut" style={{ left: constraintShortcut.x, top: constraintShortcut.y }} role="menu" aria-label="Suggested line constraint"><button role="menuitem" title={`Apply ${constraintShortcut.relation.toLowerCase()} constraint`} onClick={() => applyAxisConstraint(constraintShortcut.entityId, constraintShortcut.relation)}><span className={`axis-constraint-icon ${constraintShortcut.relation.toLowerCase()}`} />{constraintShortcut.relation}</button></div>}
    {splineContextMenu && <div className="sketch-constraint-shortcut sketch-spline-context" style={{ left: splineContextMenu.x, top: splineContextMenu.y }} role="menu" aria-label="Spline point editing">{splineContextMenu.kind === "point" ? <button className="delete" role="menuitem" onClick={deleteSplinePointFromMenu}>Delete spline point</button> : <button className="add" role="menuitem" onClick={addSplinePointFromMenu}>Add spline point</button>}</div>}
    <div className={`sketch-status ${hasConstraintConflict ? "over-defined" : ""} ${tool === "sketch-check" && sketchCheck && !sketchCheck.viable ? "check-failed" : ""}`}><span>{viewRotated ? "Sketch view rotated · middle-drag orbit · right-drag pan · wheel zoom · Snap normal to edit" : tool === "sketch-check" ? sketchCheckMessage ?? "SketchCheck · checking profile viability" : tool === "trim" ? trimMessage ?? "Trim · click one segment, or press and drag a dotted cutter across several segments" : tool === "mirror" ? mirrorMessage ?? "Mirror · select geometry, then select a separate straight line as the mirror axis" : isPatternTool(tool) ? patternMessage ?? "Pattern · select seed geometry and its reference" : tool === "extend" ? extendMessage ?? "Extend · select the line, arc, or circle to extend, then select its target geometry" : tool === "corner" ? cornerMessage ?? "Corner · select the first line segment, then the second non-parallel line segment" : tool === "radius" ? radiusMessage ?? "Radius · select two line segments and set the tangent fillet radius" : tool === "perpendicular-constraint" ? perpendicularSource ? perpendicularMessage ?? "Perpendicular · select the second line segment" : perpendicularMessage ?? "Perpendicular · select the first line segment" : tool === "linear-dimension" ? dimensionReferences.length === 0 ? "Linear dimension · select references · double-click a line for its segment length" : dimensionReferences.length === 1 ? dimensionMessage ?? "Linear dimension · select the second reference · line references measure perpendicular distance" : `Linear dimension · move to position · Tab cycles ${dimensionOptions.join(" / ")} · click to place` : tool === "angular-dimension" ? dimensionReferences.length === 0 ? "Angular dimension · select the first line" : dimensionReferences.length === 1 ? dimensionMessage ?? "Angular dimension · select a second non-parallel line" : "Angular dimension · move to choose angle side · click to place" : tool === "diameter-dimension" ? diameterEntityId ? "Diameter dimension · move the label and click to place" : dimensionMessage ?? "Diameter dimension · select a circle" : tool === "radial-dimension" ? radialEntityId ? "Radial dimension · move the label and click to place" : dimensionMessage ?? "Radial dimension · select a circle or arc" : "Wheel zoom · right-drag pan · middle-drag orbit · " + (tool === "select" ? sketchCheckMessage ?? "Shift-click adds/removes geometry · left-drag selection box · drag any selected item to move the group · Delete removes selection" : tool === "spline" ? "click control points · Enter or double-click to finish" : `${tool}: click to place points · Esc to finish`)}</span><span>{selectionCount ? `${selectionCount} selected` : activeEntity ? `${activeEntity.type} · ${activeEntity.relations?.join(", ")}` : `${entities.length} entities · ${constraints.length} constraints`}</span><span>{tool === "sketch-check" && sketchCheck ? sketchCheck.viable ? "Profile viable" : `${sketchCheck.openEndpoints.length} open` : hasConstraintConflict ? "Over defined" : viewRotated ? "3D inspection" : snapEnabled ? "Snap on" : "Free drag"} <i /></span></div>
  </div>;
}
