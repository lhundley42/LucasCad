"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { circumcircle, distance, entityInSelectionBox, midpoint, nearestGridVertex, normalizedSelectionBox, pointInSelectionBox, sketchRelationIsSatisfied, translateSketchEntity, trimEntityAtPoint, type Point, type SketchEntity } from "./sketchGeometry";
import { constraintSupersedesOrthogonalProfileDimension, constraintSupersedesSegmentDimension, controlPointsForEntity, cycleLinearOrientation, defaultLinearDimensionPosition, defaultLinearOrientation, dimensionReferencePoints, linearDimensionLayout, linearDimensionValue, linearOrientationOptions, nonOverlappingReferenceHitRadius, referencePoint, targetPointForLinearValue, validLinearDimensionPair, type ExternalSketchReference, type LinearDimensionConstraint, type LinearOrientation, type SketchReference } from "./sketchConstraints";
import { formatLength, fromMillimeters, toMillimeters, type UnitSystem } from "./units";
export type { Point, SketchEntity } from "./sketchGeometry";
export type { ExternalSketchReference, LinearDimensionConstraint } from "./sketchConstraints";

type Tool = "select" | "line" | "centerline" | "rectangle" | "circle" | "ellipse" | "arc" | "spline" | "trim" | "linear-dimension" | "horizontal-constraint" | "vertical-constraint";
type Snap = { point: Point; kind: "endpoint" | "midpoint" | "center" | "quadrant" | "grid" | "horizontal" | "vertical" };
type DimensionInfo = { key: string; entityId: string; axis?: "major" | "minor"; anchor: Point; offset: Point; text: string; value: number };
type DimensionDrag = { key: string; pointerId: number; startPoint: Point; originalOffset: Point; captureTarget: SVGGElement };
type ConstraintDrag = { id: string; pointerId: number; captureTarget: SVGGElement };
type SelectionMarquee = { start: Point; current: Point; pointerId: number };
type MultiSelectionDrag = { pointerId: number; start: Point; originalEntities: SketchEntity[]; originalConstraints: LinearDimensionConstraint[]; originalDimensionOffsets: Record<string, Point>; moved: boolean };
type AxisRelation = "Horizontal" | "Vertical";
type ConstraintShortcut = { x: number; y: number; entityId: string; relation: AxisRelation };
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

function splinePath(points: Point[]) {
  if (points.length < 2) return "";
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    path += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
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
  return { ...entity, points: entity.points.map(replace) };
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
    ...[{ x: entity.c.x + entity.rx, y: entity.c.y }, { x: entity.c.x - entity.rx, y: entity.c.y }, { x: entity.c.x, y: entity.c.y + entity.ry }, { x: entity.c.x, y: entity.c.y - entity.ry }].map((point) => ({ point, kind: "quadrant" as const })),
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
    if (handle === "major") return { ...entity, rx: Math.max(0.1, distance(entity.c, point)) };
    return { ...entity, ry: Math.max(0.1, distance(entity.c, point)) };
  }
  if (entity.type === "arc") return { ...entity, [handle]: point } as SketchEntity;
  const index = Number(handle.replace("point-", ""));
  return { ...entity, points: entity.points.map((existing, pointIndex) => pointIndex === index ? point : existing) };
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
    { key: `${entity.id}:major`, entityId: entity.id, axis: "major", anchor: { x: entity.c.x, y: entity.c.y - entity.ry }, offset: { x: 0, y: -13 }, text: `${fmt(entity.rx * 2)} mm`, value: entity.rx * 2 },
    { key: `${entity.id}:minor`, entityId: entity.id, axis: "minor", anchor: { x: entity.c.x + entity.rx, y: entity.c.y }, offset: { x: 15, y: 0 }, text: `${fmt(entity.ry * 2)} mm`, value: entity.ry * 2 },
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

export function Sketcher({ entities: controlledEntities, constraints: controlledConstraints = [], externalReferences = [], dimensionOffsets: controlledDimensionOffsets = {}, dimensionTextScale = 0.5, nodeDiameterPx = 4, highlightWidthPx = 1.2, gridSquareSize = 8, unitSystem = "metric", onChange, onConstraintsChange, onDimensionOffsetsChange, onFinish, view = DEFAULT_VIEW, viewRotated = false, onSnapNormal }: { entities?: SketchEntity[]; constraints?: LinearDimensionConstraint[]; externalReferences?: ExternalSketchReference[]; dimensionOffsets?: Record<string, Point>; dimensionTextScale?: number; nodeDiameterPx?: number; highlightWidthPx?: number; gridSquareSize?: number; unitSystem?: UnitSystem; onChange?: (entities: SketchEntity[]) => void; onConstraintsChange?: (constraints: LinearDimensionConstraint[]) => void; onDimensionOffsetsChange?: (offsets: Record<string, Point>) => void; onFinish: () => void; view?: SketchView; viewRotated?: boolean; onSnapNormal?: () => void }) {
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
  const [constraints, setConstraintsState] = useState<LinearDimensionConstraint[]>(() => controlledConstraints);
  const [dimensionReferences, setDimensionReferences] = useState<SketchReference[]>([]);
  const [hoveredReferenceId, setHoveredReferenceId] = useState<string | null>(null);
  const [dimensionOrientation, setDimensionOrientation] = useState<LinearOrientation>("horizontal");
  const [dimensionOptions, setDimensionOptions] = useState<LinearOrientation[]>(["horizontal", "vertical"]);
  const [dimensionMessage, setDimensionMessage] = useState<string | null>(null);
  const [selectedConstraintIds, setSelectedConstraintIds] = useState<string[]>([]);
  const [selectedDimensionKeys, setSelectedDimensionKeys] = useState<string[]>([]);
  const [hiddenDimensionKeys, setHiddenDimensionKeys] = useState<string[]>([]);
  const [selectionMarquee, setSelectionMarquee] = useState<SelectionMarquee | null>(null);
  const [draggingSelection, setDraggingSelection] = useState<MultiSelectionDrag | null>(null);
  const [draggingConstraint, setDraggingConstraint] = useState<ConstraintDrag | null>(null);
  const [selectedAxisConstraint, setSelectedAxisConstraint] = useState<{ entityId: string; relation: AxisRelation } | null>(null);
  const [constraintShortcut, setConstraintShortcut] = useState<ConstraintShortcut | null>(null);
  const dragStartRef = useRef<SketchEntity[] | null>(null);
  const lineClickRef = useRef<{ entityId: string; at: number } | null>(null);
  const selected = selectedEntityIds.at(-1) ?? null;
  const selectedConstraintId = selectedConstraintIds.at(-1) ?? null;
  const setSelected = (entityId: string | null) => setSelectedEntityIds(entityId ? [entityId] : []);
  const setSelectedConstraintId = (constraintId: string | null) => setSelectedConstraintIds(constraintId ? [constraintId] : []);

  const commit = useCallback((next: SketchEntity[]) => {
    setHistory((items) => [...items.slice(-39), entities]);
    setFuture([]);
    setEntitiesState(next);
    onChange?.(next);
  }, [entities, onChange]);
  const commitConstraints = useCallback((next: LinearDimensionConstraint[]) => { setConstraintsState(next); onConstraintsChange?.(next); }, [onConstraintsChange]);
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((items) => [entities, ...items]); setHistory((items) => items.slice(0, -1)); setEntitiesState(previous); onChange?.(previous); };
  const redo = () => { const next = future[0]; if (!next) return; setHistory((items) => [...items, entities]); setFuture((items) => items.slice(1)); setEntitiesState(next); onChange?.(next); };

  const pointFromEvent = (event: React.PointerEvent<SVGElement>): Point => {
    const svg = svgRef.current!; const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: transformed.x, y: transformed.y };
  };
  const findSnap = (raw: Point, anchor?: Point, excludeEntityId?: string) => {
    if (!snapEnabled) return null;
    const candidates = entities.filter((entity) => entity.id !== excludeEntityId).flatMap(entitySnapPoints);
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
    if (draft.length > 1) commit([...entities, { id: nextId(), type: "spline", points: draft, relations: [snap?.kind === "endpoint" ? "Coincident" : "Free"] }]);
    setDraft([]); setTool("select");
  };
  const finishChain = () => { setDraft([]); setDimensionReferences([]); setDimensionMessage(null); setTool("select"); setSnap(null); };
  const commitLinearDimension = (first: SketchReference, second: SketchReference, orientation: LinearOrientation, position: Point) => {
    const next: LinearDimensionConstraint = { id: `constraint-${crypto.randomUUID()}`, type: "linear", first, second, orientation, position, value: linearDimensionValue(first, second, orientation, entities) };
    commitConstraints([...constraints, next]); setSelectedConstraintId(next.id); setSelected(null); setSelectedDimensionKeys([]); setDimensionReferences([]);
  };
  const placeLinearDimension = (position: Point) => {
    if (dimensionReferences.length !== 2) return;
    commitLinearDimension(dimensionReferences[0], dimensionReferences[1], dimensionOrientation, position);
  };
  const chooseDimensionReference = (reference: SketchReference, position: Point) => {
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
  const constraintReferencesEntity = (constraint: LinearDimensionConstraint, entityIds: Set<string>) => [constraint.first, constraint.second].some((reference) => (reference.kind === "node" || reference.kind === "line") && entityIds.has(reference.entityId));
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
      if (event.key === "Escape") { setEditingConstraintId(null); setConstraintShortcut(null); finishChain(); }
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
      const nextEntities = draggingSelection.originalEntities.map((entity) => entityIds.has(entity.id) ? translateSketchEntity(entity, delta) : entity);
      const modelScale = dimensionModelScale();
      const nextOffsets = { ...draggingSelection.originalDimensionOffsets };
      selectedDimensionKeys.forEach((key) => {
        const dimension = allDimensions.find((candidate) => candidate.key === key);
        if (dimension && entityIds.has(dimension.entityId)) return;
        const original = draggingSelection.originalDimensionOffsets[key] ?? { x: 0, y: 0 };
        nextOffsets[key] = { x: original.x + delta.x / modelScale, y: original.y + delta.y / modelScale };
      });
      const nextConstraints = draggingSelection.originalConstraints.map((constraint) => {
        const positioned = selectedConstraintIds.includes(constraint.id) ? { ...constraint, position: { x: constraint.position.x + delta.x, y: constraint.position.y + delta.y } } : constraint;
        const actual = linearDimensionValue(positioned.first, positioned.second, positioned.orientation, nextEntities);
        return { ...positioned, conflicted: Math.abs(actual - positioned.value) > 0.01 };
      });
      setEntitiesState(nextEntities); onChange?.(nextEntities); setDimensionOffsets(nextOffsets); onDimensionOffsetsChange?.(nextOffsets); setConstraintsState(nextConstraints); onConstraintsChange?.(nextConstraints);
      setDraggingSelection({ ...draggingSelection, moved: true }); setCursor(current); setSnap(null); return;
    }
    if (draggingConstraint) {
      const position = pointFromEvent(event); const next = constraints.map((constraint) => constraint.id === draggingConstraint.id ? { ...constraint, position } : constraint);
      setConstraintsState(next); onConstraintsChange?.(next); return;
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
      setEntitiesState(next); onChange?.(next); const nextConstraints = constraintsForGeometry(next); setConstraintsState(nextConstraints); onConstraintsChange?.(nextConstraints); setCursor(nextPoint); setSnap(activeSnap); return;
    }
    const raw = pointFromEvent(event);
    if (tool === "linear-dimension" && dimensionReferences.length === 2) { setCursor(raw); setSnap(null); return; }
    const nextSnap = findSnap(raw, draft.at(-1)); setSnap(nextSnap); setCursor(nextSnap?.point ?? raw);
  };
  const beginDrag = (event: React.PointerEvent<SVGCircleElement>, entityId: string, handle: string, originalPoint: Point) => {
    if (tool !== "select") return;
    event.preventDefault(); event.stopPropagation();
    dragStartRef.current = entities;
    setSelected(entityId); setSelectedConstraintId(null); setSelectedDimensionKeys([]); setEditingConstraintId(null);
    setDragging({ entityId, handle, pointerId: event.pointerId, originalPoint });
    svgRef.current?.setPointerCapture(event.pointerId);
  };
  const beginDimensionDrag = (event: React.PointerEvent<SVGGElement>, dimension: DimensionInfo) => {
    if (event.button !== 0) return;
    if (selectedDimensionKeys.includes(dimension.key) && selectedEntityIds.length + selectedConstraintIds.length + selectedDimensionKeys.length > 1) { beginSelectionDrag(event); return; }
    event.stopPropagation();
    setTool("select"); setSelected(null); setSelectedConstraintId(null); setSelectedDimensionKeys([dimension.key]); setEditingConstraintId(null); setEditingDimension(null);
    setDraggingDimension({ key: dimension.key, pointerId: event.pointerId, startPoint: pointFromEvent(event), originalOffset: dimensionOffsets[dimension.key] ?? { x: 0, y: 0 }, captureTarget: event.currentTarget });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const beginConstraintDrag = (event: React.PointerEvent<SVGGElement>, constraint: LinearDimensionConstraint) => {
    if (event.button !== 0) return;
    if (selectedConstraintIds.includes(constraint.id) && selectedEntityIds.length + selectedConstraintIds.length + selectedDimensionKeys.length > 1) { beginSelectionDrag(event); return; }
    event.stopPropagation(); setTool("select"); setSelected(null); setSelectedConstraintId(constraint.id); setSelectedDimensionKeys([]); setEditingDimension(null); setEditingConstraintId(null);
    setDraggingConstraint({ id: constraint.id, pointerId: event.pointerId, captureTarget: event.currentTarget }); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const finishDrag = (event?: React.PointerEvent<SVGSVGElement>) => {
    if (selectionMarquee) {
      const end = event ? pointFromEvent(event) : selectionMarquee.current; const box = normalizedSelectionBox(selectionMarquee.start, end);
      setSelectedEntityIds(entities.filter((entity) => entityInSelectionBox(entity, selectionMarquee.start, end)).map((entity) => entity.id));
      setSelectedConstraintIds(constraints.filter((constraint) => pointInSelectionBox(linearDimensionLayout(constraint.first, constraint.second, constraint.orientation, constraint.position, entities).label, box)).map((constraint) => constraint.id));
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
  const openConstraintShortcut = (event: React.MouseEvent<SVGGElement>, entity: SketchEntity) => {
    if (entity.type !== "line") return;
    event.preventDefault(); event.stopPropagation();
    const relation: AxisRelation = Math.abs(entity.b.x - entity.a.x) >= Math.abs(entity.b.y - entity.a.y) ? "Horizontal" : "Vertical";
    setConstraintShortcut({ x: event.clientX, y: event.clientY, entityId: entity.id, relation });
  };
  const onCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    setConstraintShortcut(null);
    if (tool === "select") {
      const start = pointFromEvent(event); event.preventDefault(); clearSelection(); setSelectionMarquee({ start, current: start, pointerId: event.pointerId }); setSnap(null); event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    if (tool === "trim") return;
    if (tool === "linear-dimension") { if (dimensionReferences.length === 2) placeLinearDimension(pointFromEvent(event)); return; }
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
    if (constraint.id === drivingId) return { ...constraint, value: drivingValue ?? constraint.value, conflicted: false };
    const actual = linearDimensionValue(constraint.first, constraint.second, constraint.orientation, nextEntities);
    return { ...constraint, conflicted: Math.abs(actual - constraint.value) > 0.01 };
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
    if (!constraint || !(enteredValue > 0)) { setEditingConstraintId(null); return; }
    const value = toMillimeters(enteredValue, unitSystem);
    const [firstPoint, secondPoint] = dimensionReferencePoints(constraint.first, constraint.second, entities);
    const secondFixed = constraint.second.kind === "external-point" || constraint.second.kind === "external-line";
    const firstFixed = constraint.first.kind === "external-point" || constraint.first.kind === "external-line";
    if (firstFixed && secondFixed) { setEditingConstraintId(null); return; }
    const target = secondFixed ? targetPointForLinearValue(secondPoint, firstPoint, constraint.orientation, value) : targetPointForLinearValue(firstPoint, secondPoint, constraint.orientation, value);
    const nextEntities = moveConstraintReference(entities, secondFixed ? constraint.first : constraint.second, target);
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
  const createLineLengthDimension = (entity: Extract<SketchEntity, { type: "line" }>) => {
    const existing = constraints.find((constraint) => constraintSupersedesSegmentDimension(constraint, entity));
    setDraft([]); setDimensionReferences([]); setDimensionMessage(null); setSnap(null); setEditingConstraintId(null); setEditingDimension(null); setSelected(null); setSelectedDimensionKeys([]);
    if (existing) { setSelectedConstraintId(existing.id); return; }
    const first: SketchReference = { kind: "node", entityId: entity.id, handle: "a" }; const second: SketchReference = { kind: "node", entityId: entity.id, handle: "b" };
    const offset = 34 / safeZoom; const position = defaultLinearDimensionPosition(first, second, "aligned", entities, offset);
    commitLinearDimension(first, second, "aligned", position);
  };
  const visibleDimensions = allDimensions.filter((dimension) => {
    if (hiddenDimensionKeys.includes(dimension.key)) return false;
    const entity = entities.find((candidate) => candidate.id === dimension.entityId);
    return !entity || !constraints.some((constraint) => constraintSupersedesOrthogonalProfileDimension(constraint, entity, entities));
  });
  const selectionCount = selectedEntityIds.length + selectedConstraintIds.length + selectedDimensionKeys.length;
  const marqueeBox = selectionMarquee ? normalizedSelectionBox(selectionMarquee.start, selectionMarquee.current) : null;
  const editingDimensionPosition = editingDimension ? dimensionPosition(editingDimension) : null;
  const editingConstraint = constraints.find((constraint) => constraint.id === editingConstraintId) ?? null;
  const editingConstraintPosition = editingConstraint ? linearDimensionLayout(editingConstraint.first, editingConstraint.second, editingConstraint.orientation, editingConstraint.position, entities).label : null;
  const linearPreview = dimensionReferences.length === 2 ? linearDimensionLayout(dimensionReferences[0], dimensionReferences[1], dimensionOrientation, cursor, entities) : null;
  const hasConstraintConflict = constraints.some((constraint) => constraint.conflicted);
  const viewWidth = VIEW.width / safeZoom; const viewHeight = VIEW.height / safeZoom;
  const viewX = view.center.x - viewWidth / 2; const viewY = view.center.y - viewHeight / 2;
  const highlightStyle = { "--sketch-highlight-width": `${highlightWidthPx}px` } as CSSProperties;
  const xAxisChosen = dimensionReferences.some((reference) => reference.kind === "external-line" && reference.referenceId === "sketch-axis:x");
  const yAxisChosen = dimensionReferences.some((reference) => reference.kind === "external-line" && reference.referenceId === "sketch-axis:y");

  return <div className={`sketcher-shell ${viewRotated ? "view-rotated" : ""}`} style={highlightStyle}>
    <div className="sketch-commandbar">
      {(["select", "line", "centerline", "rectangle", "circle", "ellipse", "arc", "spline", "trim"] as Tool[]).map((item) => <button key={item} disabled={viewRotated} className={tool === item && !viewRotated ? "active" : ""} onClick={() => { setTool(item); setDraft([]); setDimensionReferences([]); setDimensionMessage(null); }} title={item === "arc" ? "3 point arc" : item}>{item === "centerline" ? "Centerline" : item[0].toUpperCase() + item.slice(1)}</button>)}
      <i className="sketch-ribbon-divider" />
      <b className="constraint-menu-label">Constraints</b>
      <button disabled={viewRotated} className={`constraint-tool ${tool === "linear-dimension" && !viewRotated ? "active" : ""}`} aria-label="Linear dimension constraint" title="Linear dimension: select two nodes or lines, press Tab to change orientation, then click to place" onClick={() => { setTool("linear-dimension"); setDraft([]); setDimensionReferences([]); setDimensionMessage(null); setSelected(null); }}><span className="linear-dimension-icon">↔</span>Linear dimension</button>
      <button disabled={viewRotated} className={`constraint-tool axis-constraint-tool ${tool === "horizontal-constraint" && !viewRotated ? "active" : ""}`} aria-label="Horizontal constraint" title="Lock a line horizontal" onClick={() => { setTool("horizontal-constraint"); setDraft([]); clearSelection(); }}><span className="axis-constraint-icon horizontal" />Horizontal</button>
      <button disabled={viewRotated} className={`constraint-tool axis-constraint-tool ${tool === "vertical-constraint" && !viewRotated ? "active" : ""}`} aria-label="Vertical constraint" title="Lock a line vertical" onClick={() => { setTool("vertical-constraint"); setDraft([]); clearSelection(); }}><span className="axis-constraint-icon vertical" />Vertical</button>
      <button className={viewRotated ? "active" : ""} onClick={onSnapNormal}>Snap normal</button>
      <span />
      <button onClick={undo} disabled={!history.length}>Undo</button><button onClick={redo} disabled={!future.length}>Redo</button>
      <button className={showGrid ? "toggle-on" : ""} onClick={() => setShowGrid(!showGrid)}>Grid</button>
      <button className={snapEnabled ? "toggle-on" : ""} aria-pressed={snapEnabled} title={snapEnabled ? "Snapping enabled: nodes move between geometry and grid snap points" : "Snapping disabled: nodes move freely"} onClick={() => { setSnapEnabled(!snapEnabled); setSnap(null); }}>Snap</button>
      <button className="finish-sketch" onClick={onFinish}>✓ Finish sketch</button>
    </div>
    <svg ref={svgRef} className={`sketch-canvas tool-${tool} ${dragging ? "dragging-point" : ""} ${draggingDimension ? "dragging-dimension" : ""} ${selectionMarquee ? "marquee-selecting" : ""} ${draggingSelection ? "dragging-selection" : ""}`} viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} preserveAspectRatio="xMidYMid slice" onPointerMove={onMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onPointerDown={onCanvasPointerDown} onDoubleClick={() => tool === "spline" && finishSpline()} onContextMenu={(event) => event.preventDefault()}>
      <defs><pattern id="minor-grid" width={gridSquareSize} height={gridSquareSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSquareSize} 0 L 0 0 0 ${gridSquareSize}`} className="minor-grid-line" /></pattern><pattern id="major-grid" width={gridSquareSize * 5} height={gridSquareSize * 5} patternUnits="userSpaceOnUse"><rect width={gridSquareSize * 5} height={gridSquareSize * 5} fill="url(#minor-grid)"/><path d={`M ${gridSquareSize * 5} 0 L 0 0 0 ${gridSquareSize * 5}`} className="major-grid-line" /></pattern></defs>
      {showGrid && <rect x={viewX} y={viewY} width={viewWidth} height={viewHeight} fill="url(#major-grid)" />}
      <line x1={viewX} y1="0" x2={viewX + viewWidth} y2="0" className={`sketch-axis x ${hoveredReferenceId === "sketch-axis:x" || xAxisChosen ? "reference-highlighted" : ""}`}/><line x1="0" y1={viewY} x2="0" y2={viewY + viewHeight} className={`sketch-axis y ${hoveredReferenceId === "sketch-axis:y" || yAxisChosen ? "reference-highlighted" : ""}`}/>
      {tool === "linear-dimension" && externalReferences.map((reference) => {
        if (reference.points.length < 2) return null;
        const collapsed = reference.kind === "body-edge" && reference.points.every((point) => distance(point, reference.points[0]) < 0.05);
        const chooseExternalReference = (event: React.PointerEvent<SVGElement>) => { event.stopPropagation(); const position = pointFromEvent(event); if (reference.kind === "plane-intersection") chooseDimensionReference({ kind: "external-line", referenceId: reference.id, a: reference.points[0], b: reference.points.at(-1)!, source: "plane-intersection" }, position); else chooseDimensionReference({ kind: "external-point", referenceId: reference.id, point: nearestPointOnPath(position, reference.points), source: "body-edge" }, position); };
        return collapsed ? <circle key={reference.id} className="external-reference-point" aria-label={reference.label} cx={reference.points[0].x} cy={reference.points[0].y} r={nodeRadius * 1.25} onPointerDown={chooseExternalReference}/> : <polyline key={reference.id} className={`external-reference ${reference.kind}`} aria-label={reference.label} points={reference.points.map((point) => `${point.x},${point.y}`).join(" ")} onPointerDown={chooseExternalReference}/>;
      })}
      {entities.map((entity) => { const referenceId = `line:${entity.id}`; const referenceChosen = dimensionReferences.some((reference) => reference.kind === "line" && reference.entityId === entity.id); return <g key={entity.id} className={`sketch-entity ${selectedEntityIds.includes(entity.id) ? "selected" : ""} ${entity.construction ? "construction" : ""} ${tool === "linear-dimension" && entity.type === "line" ? "constraint-selectable" : ""}`} onContextMenu={(event) => openConstraintShortcut(event, entity)} onPointerDown={(event) => { if ((tool === "horizontal-constraint" || tool === "vertical-constraint") && entity.type === "line") { event.stopPropagation(); applyAxisConstraint(entity.id, tool === "horizontal-constraint" ? "Horizontal" : "Vertical"); return; } if (tool === "linear-dimension" && entity.type === "line") { event.stopPropagation(); const now = performance.now(); const previous = lineClickRef.current; if (previous?.entityId === entity.id && now - previous.at <= 500) { event.preventDefault(); lineClickRef.current = null; createLineLengthDimension(entity); return; } lineClickRef.current = { entityId: entity.id, at: now }; chooseDimensionReference({ kind: "line", entityId: entity.id }, pointFromEvent(event)); return; } if (tool !== "select" && tool !== "trim") return; event.stopPropagation(); if (tool === "trim") { const replacements = trimEntityAtPoint(entity, pointFromEvent(event), entities); commit(entities.flatMap((item) => item.id === entity.id ? replacements : [item])); setSelected(null); return; } if (selectedEntityIds.includes(entity.id) && selectionCount > 1) { beginSelectionDrag(event); return; } setSelected(entity.id); setSelectedAxisConstraint(null); setSelectedConstraintId(null); setSelectedDimensionKeys([]); setTool("select"); }}>
        {entity.type === "line" && <line className={hoveredReferenceId === referenceId || referenceChosen ? "reference-highlighted" : ""} x1={entity.a.x} y1={entity.a.y} x2={entity.b.x} y2={entity.b.y} />}
        {entity.type === "circle" && <circle cx={entity.c.x} cy={entity.c.y} r={entity.r} />}
        {entity.type === "ellipse" && <ellipse cx={entity.c.x} cy={entity.c.y} rx={entity.rx} ry={entity.ry} />}
        {entity.type === "arc" && <path d={arcPath(entity.a, entity.b, entity.through)} />}
        {entity.type === "spline" && <path d={splinePath(entity.points)} />}
        {entity.type === "line" && <line className={`sketch-line-hit ${tool === "linear-dimension" ? "constraint-line-hit" : ""}`} x1={entity.a.x} y1={entity.a.y} x2={entity.b.x} y2={entity.b.y} onPointerEnter={() => { if (tool === "linear-dimension") setHoveredReferenceId(referenceId); }} onPointerLeave={() => { if (tool === "linear-dimension") setHoveredReferenceId((current) => current === referenceId ? null : current); }} />}
        {tool === "trim" && entity.type === "line" && <line className="trim-hit" x1={entity.a.x} y1={entity.a.y} x2={entity.b.x} y2={entity.b.y} />}
        {tool === "trim" && entity.type === "circle" && <circle className="trim-hit" cx={entity.c.x} cy={entity.c.y} r={entity.r} />}
        {tool === "trim" && entity.type === "ellipse" && <ellipse className="trim-hit" cx={entity.c.x} cy={entity.c.y} rx={entity.rx} ry={entity.ry} />}
        {tool === "trim" && entity.type === "arc" && <path className="trim-hit" d={arcPath(entity.a, entity.b, entity.through)} />}
        {tool === "trim" && entity.type === "spline" && <path className="trim-hit" d={splinePath(entity.points)} />}
        {entitySnapPoints(entity).map((candidate, index) => <circle key={index} className={`sketch-point ${candidate.kind}`} cx={candidate.point.x} cy={candidate.point.y} r={nodeRadius} />)}
      </g>; })}
      {tool === "select" && entities.map((entity) => <g key={`controls-${entity.id}`} className={`control-layer ${selectedEntityIds.includes(entity.id) ? "active" : "inactive"}`}>{controlPointsForEntity(entity).map((control) => <circle key={control.handle} className="control-point" cx={control.point.x} cy={control.point.y} r={nodeRadius * (selectedEntityIds.includes(entity.id) ? 1.25 : 1)} onPointerDown={(event) => beginDrag(event, entity.id, control.handle, control.point)} />)}</g>)}
      {tool === "linear-dimension" && <g className="axis-reference-layer">
        <rect x={viewX} y={-11 / safeZoom} width={viewWidth} height={22 / safeZoom} className="axis-reference-hit x" role="button" tabIndex={0} aria-label="Red sketch X axis" onPointerEnter={() => setHoveredReferenceId("sketch-axis:x")} onPointerLeave={() => setHoveredReferenceId((current) => current === "sketch-axis:x" ? null : current)} onPointerDown={(event) => { event.stopPropagation(); chooseDimensionReference({ kind: "external-line", referenceId: "sketch-axis:x", a: { x: viewX, y: 0 }, b: { x: viewX + viewWidth, y: 0 }, source: "sketch-axis" }, pointFromEvent(event)); }}/>
        <rect x={-11 / safeZoom} y={viewY} width={22 / safeZoom} height={viewHeight} className="axis-reference-hit y" role="button" tabIndex={0} aria-label="Green sketch Y axis" onPointerEnter={() => setHoveredReferenceId("sketch-axis:y")} onPointerLeave={() => setHoveredReferenceId((current) => current === "sketch-axis:y" ? null : current)} onPointerDown={(event) => { event.stopPropagation(); chooseDimensionReference({ kind: "external-line", referenceId: "sketch-axis:y", a: { x: 0, y: viewY }, b: { x: 0, y: viewY + viewHeight }, source: "sketch-axis" }, pointFromEvent(event)); }}/>
      </g>}
      {tool === "linear-dimension" && entities.map((entity) => <g key={`constraint-nodes-${entity.id}`} className="constraint-node-layer">{controlPointsForEntity(entity).map((control) => { const reference: SketchReference = { kind: "node", entityId: entity.id, handle: control.handle }; const referenceId = `node:${entity.id}:${control.handle}`; const chosen = dimensionReferences.some((candidate) => candidate.kind === "node" && candidate.entityId === reference.entityId && candidate.handle === reference.handle); const otherPoints = dimensionControlPoints.filter((candidate) => candidate.entityId !== entity.id || candidate.handle !== control.handle).map((candidate) => candidate.point); const preferredHitRadius = Math.max(nodeRadius, (entity.type === "line" ? 10 : 16) / safeZoom); const hitRadius = nonOverlappingReferenceHitRadius(control.point, otherPoints, preferredHitRadius, entity.type === "line" ? 0.22 : 0.45); const chooseNode = (event: React.PointerEvent<SVGCircleElement>) => { event.stopPropagation(); chooseDimensionReference(reference, pointFromEvent(event)); }; return <g key={control.handle}><circle className="constraint-node-hit" role="button" tabIndex={0} aria-label={`Dimension node ${entity.id} ${control.handle}`} cx={control.point.x} cy={control.point.y} r={hitRadius} onPointerEnter={() => setHoveredReferenceId(referenceId)} onPointerLeave={() => setHoveredReferenceId((current) => current === referenceId ? null : current)} onPointerDown={chooseNode} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseDimensionReference(reference, control.point); } }} /><circle className={`constraint-node ${hoveredReferenceId === referenceId || chosen ? "reference-highlighted" : ""}`} cx={control.point.x} cy={control.point.y} r={nodeRadius} /></g>; })}</g>)}
      {preview.length > 1 && <g className="sketch-preview">{tool === "circle" && draft[0] ? <circle cx={draft[0].x} cy={draft[0].y} r={distance(draft[0], cursor)} /> : tool === "ellipse" && draft.length === 2 ? <ellipse cx={draft[0].x} cy={draft[0].y} rx={Math.abs(draft[1].x - draft[0].x) || distance(draft[0], draft[1])} ry={Math.abs(cursor.y - draft[0].y)} /> : tool === "arc" && draft.length === 2 ? <path d={arcPath(draft[0], draft[1], cursor)} /> : tool === "rectangle" && draft[0] ? <rect x={Math.min(draft[0].x, cursor.x)} y={Math.min(draft[0].y, cursor.y)} width={Math.abs(cursor.x - draft[0].x)} height={Math.abs(cursor.y - draft[0].y)} /> : tool === "spline" ? <path d={splinePath(preview)} /> : <line x1={draft.at(-1)!.x} y1={draft.at(-1)!.y} x2={cursor.x} y2={cursor.y} />}</g>}
      {constraints.map((constraint) => { const layout = linearDimensionLayout(constraint.first, constraint.second, constraint.orientation, constraint.position, entities); const actualValue = linearDimensionValue(constraint.first, constraint.second, constraint.orientation, entities); const displayedValue = constraint.conflicted ? actualValue : constraint.value; const text = formatLength(displayedValue, unitSystem); const editableValue = fromMillimeters(displayedValue, unitSystem); const labelWidth = Math.max(38, text.length * 4.3 + 13); return <g key={constraint.id} className={`linear-constraint ${constraint.conflicted ? "conflicted" : ""} ${selectedConstraintIds.includes(constraint.id) ? "selected" : ""}`}><line className="constraint-extension" x1={layout.first.x} y1={layout.first.y} x2={layout.dimensionFirst.x} y2={layout.dimensionFirst.y}/><line className="constraint-extension" x1={layout.second.x} y1={layout.second.y} x2={layout.dimensionSecond.x} y2={layout.dimensionSecond.y}/><line className="constraint-measure" x1={layout.dimensionFirst.x} y1={layout.dimensionFirst.y} x2={layout.dimensionSecond.x} y2={layout.dimensionSecond.y}/><path className="constraint-arrow" d={dimensionArrowPath(layout.dimensionFirst, layout.dimensionSecond, dimensionScale)}/><g className="constraint-label" role="button" tabIndex={0} aria-label={`Linear dimension ${text}${constraint.conflicted ? ", over defined" : ""}`} transform={`translate(${layout.label.x} ${layout.label.y}) scale(${dimensionLabelScale})`} onPointerDown={(event) => beginConstraintDrag(event, constraint)} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedConstraintId(constraint.id); setEditingDimension(null); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(editableValue.toFixed(4)))); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setEditingConstraintId(constraint.id); setDimensionValue(String(Number(editableValue.toFixed(4)))); } }}><rect x={-labelWidth / 2} y="-7" width={labelWidth} height="14" rx="3"/><text textAnchor="middle" dominantBaseline="central">{text}</text></g></g>; })}
      {linearPreview && <g className="linear-constraint preview"><line className="constraint-extension" x1={linearPreview.first.x} y1={linearPreview.first.y} x2={linearPreview.dimensionFirst.x} y2={linearPreview.dimensionFirst.y}/><line className="constraint-extension" x1={linearPreview.second.x} y1={linearPreview.second.y} x2={linearPreview.dimensionSecond.x} y2={linearPreview.dimensionSecond.y}/><line className="constraint-measure" x1={linearPreview.dimensionFirst.x} y1={linearPreview.dimensionFirst.y} x2={linearPreview.dimensionSecond.x} y2={linearPreview.dimensionSecond.y}/><path className="constraint-arrow" d={dimensionArrowPath(linearPreview.dimensionFirst, linearPreview.dimensionSecond, dimensionScale)}/><g className="constraint-preview-label" transform={`translate(${linearPreview.label.x} ${linearPreview.label.y}) scale(${dimensionLabelScale})`}><rect x="-32" y="-12" width="64" height="24" rx="4"/><text y="-2" textAnchor="middle">{formatLength(linearPreview.value, unitSystem)}</text><text y="7" textAnchor="middle" className="orientation-hint">{dimensionOrientation} · Tab</text></g></g>}
      {visibleDimensions.map((dimension) => { const position = dimensionPosition(dimension); const text = dimensionTextFor(dimension); const editableValue = fromMillimeters(dimension.value, unitSystem); const labelWidth = Math.max(36, text.length * 4.3 + 13); const moved = dimensionOffsets[dimension.key] && (Math.abs(dimensionOffsets[dimension.key].x) > 0.1 || Math.abs(dimensionOffsets[dimension.key].y) > 0.1); return <g key={dimension.key} className={`dimension-annotation ${selectedDimensionKeys.includes(dimension.key) ? "selected" : ""}`}>{moved && <line className="dimension-leader" x1={dimension.anchor.x} y1={dimension.anchor.y} x2={position.x} y2={position.y}/>}<g className="sketch-dimension" role="button" tabIndex={0} aria-label={`Edit dimension ${text}`} transform={`translate(${position.x} ${position.y}) scale(${dimensionLabelScale})`} onPointerDown={(event) => beginDimensionDrag(event, dimension)} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); setTool("select"); setEditingConstraintId(null); setSelectedConstraintId(null); setEditingDimension(dimension); setDimensionValue(String(Number(editableValue.toFixed(4)))); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setEditingConstraintId(null); setSelectedConstraintId(null); setEditingDimension(dimension); setDimensionValue(String(Number(editableValue.toFixed(4)))); } }}><line x1={-labelWidth / 2 - 5} y1="0" x2={labelWidth / 2 + 5} y2="0"/><path d={`M${-labelWidth / 2 - 5} 0 l4 -2 v4z M${labelWidth / 2 + 5} 0 l-4 -2 v4z`}/><rect x={-labelWidth / 2} y="-7" width={labelWidth} height="14" rx="3"/><text textAnchor="middle" dominantBaseline="central">{text}</text></g></g>; })}
      {selectionMarquee && marqueeBox && <rect className={`sketch-selection-box ${selectionMarquee.current.x < selectionMarquee.start.x ? "crossing" : "window"}`} x={marqueeBox.left} y={marqueeBox.top} width={marqueeBox.right - marqueeBox.left} height={marqueeBox.bottom - marqueeBox.top}/>}
      {entities.filter((entity): entity is Extract<SketchEntity, { type: "line" }> => entity.type === "line" && Boolean(entity.axisConstraint)).map((entity) => { const relation = entity.axisConstraint!; const center = midpoint(entity.a, entity.b); const dx = entity.b.x - entity.a.x; const dy = entity.b.y - entity.a.y; const length = Math.max(distance(entity.a, entity.b), 0.001); const position = { x: center.x - dy / length * 10 / safeZoom, y: center.y + dx / length * 10 / safeZoom }; const selectedRelation = selectedAxisConstraint?.entityId === entity.id && selectedAxisConstraint.relation === relation; return <g key={`locked-${entity.id}`} role="button" tabIndex={0} aria-label={`${relation} constraint; select and press Delete to remove`} transform={`translate(${position.x} ${position.y}) scale(${1 / safeZoom})`} className={`locked-axis-constraint ${selectedRelation ? "selected" : ""}`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); clearSelection(); setSelectedAxisConstraint({ entityId: entity.id, relation }); setTool("select"); }}><rect x="-5" y="-5" width="10" height="10" rx="2"/><text textAnchor="middle" dominantBaseline="central">{relation === "Horizontal" ? "H" : "V"}</text></g>; })}
      {entities.flatMap((entity) => entity.relations?.map((relation, index) => ({ entity, relation, index })).filter(({ relation }) => entity.axisConstraint !== relation && sketchRelationIsSatisfied(entity, relation)) ?? []).map(({ entity, relation, index }) => { const point = entity.type === "line" ? midpoint(entity.a, entity.b) : entity.type === "circle" || entity.type === "ellipse" ? entity.c : entity.type === "arc" ? entity.through : entity.points[0]; return <text key={`${entity.id}-${index}`} x={point.x + 5 + index * 8} y={point.y + 9} className="relation-glyph">{relation === "Horizontal" ? "H" : relation === "Vertical" ? "V" : relation === "Coincident" ? "●" : relation === "Concentric" ? "◎" : "◇"}</text>; })}
      {snap && <g className={`snap-marker ${snap.kind}`}><circle cx={snap.point.x} cy={snap.point.y} r={gridSquareSize / 2}/><text x={snap.point.x + 7} y={snap.point.y - 7}>{snap.kind}</text></g>}
      {editingDimension && editingDimensionPosition && <foreignObject x="-36" y="-16" width="72" height="32" transform={`translate(${editingDimensionPosition.x} ${editingDimensionPosition.y}) scale(${dimensionLabelScale})`}><input ref={dimensionInputRef} className="dimension-editor" aria-label="Dimension value" value={dimensionValue} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => setDimensionValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyDimension(); if (event.key === "Escape") setEditingDimension(null); }} onBlur={applyDimension} /></foreignObject>}
      {editingConstraint && editingConstraintPosition && <foreignObject x="-38" y="-16" width="76" height="32" transform={`translate(${editingConstraintPosition.x} ${editingConstraintPosition.y}) scale(${dimensionLabelScale})`}><input ref={dimensionInputRef} className="dimension-editor constraint-editor" aria-label="Linear constraint value" value={dimensionValue} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => setDimensionValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyConstraintDimension(); if (event.key === "Escape") setEditingConstraintId(null); }} onBlur={applyConstraintDimension} /></foreignObject>}
    </svg>
    {constraintShortcut && <div className="sketch-constraint-shortcut" style={{ left: constraintShortcut.x, top: constraintShortcut.y }} role="menu" aria-label="Suggested line constraint"><button role="menuitem" title={`Apply ${constraintShortcut.relation.toLowerCase()} constraint`} onClick={() => applyAxisConstraint(constraintShortcut.entityId, constraintShortcut.relation)}><span className={`axis-constraint-icon ${constraintShortcut.relation.toLowerCase()}`} />{constraintShortcut.relation}</button></div>}
    <div className={`sketch-status ${hasConstraintConflict ? "over-defined" : ""}`}><span>{viewRotated ? "Sketch view rotated · middle-drag orbit · right-drag pan · wheel zoom · Snap normal to edit" : tool === "linear-dimension" ? dimensionReferences.length === 0 ? "Linear dimension · select references · double-click a line for its segment length" : dimensionReferences.length === 1 ? dimensionMessage ?? "Linear dimension · select the second reference · line references measure perpendicular distance" : `Linear dimension · move to position · Tab cycles ${dimensionOptions.join(" / ")} · click to place` : "Wheel zoom · right-drag pan · middle-drag orbit · " + (tool === "select" ? "left-drag selection box · drag any selected item to move the group · Delete removes selection" : tool === "spline" ? "click control points · Enter or double-click to finish" : `${tool}: click to place points · Esc to finish`)}</span><span>{selectionCount ? `${selectionCount} selected` : activeEntity ? `${activeEntity.type} · ${activeEntity.relations?.join(", ")}` : `${entities.length} entities · ${constraints.length} constraints`}</span><span>{hasConstraintConflict ? "Over defined" : viewRotated ? "3D inspection" : snapEnabled ? "Snap on" : "Free drag"} <i /></span></div>
  </div>;
}
