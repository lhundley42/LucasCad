"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CadViewport, type ChamferMethod, type ChamferParameter, type DocumentRequest, type FeaturePreview, type FeatureRecord, type ReferenceAxisRecord, type ReferenceGeometryRecord, type ReferencePlaneRecord, type RevolveAxisReference, type SelectedEdge, type SelectedFace, type SketchPlane, type SketchRecord, type SolidSelectionMode } from "./components/CadViewport";
import { Sketcher, type ExternalSketchReference, type SketchConstraint, type SketchEntity, type SketchView } from "./components/Sketcher";
import type { PatternCenterReference, PatternDirectionReference, SketchReference } from "./components/sketchConstraints";
import { DEFAULT_GLOBAL_SETTINGS, GLOBAL_SETTINGS_STORAGE_KEY, parseGlobalSettings, type GlobalAppSettings } from "./components/appSettings";
import { formatLength, fromMillimeters, toMillimeters, unitSuffix, type UnitSystem } from "./components/units";
import { BufferedNumberInput, keyboardEventOwnedByControl } from "./components/BufferedNumberInput";

type LocalSketch = Omit<SketchRecord, "entities"> & { entities: SketchEntity[]; constraints?: SketchConstraint[]; dimensionOffsets?: Record<string, { x: number; y: number }> };
type KernelStatus = "idle" | "connecting" | "ready" | "offline" | "error";
type Properties = { valid: boolean; solidCount: number; bodyCount: number; faceCount: number; edgeCount: number; volume: number; bounds: { x: number; y: number; z: number } };
type FeatureDraft = { type: "extrude" | "revolve"; sketchId: string; combine: "new" | "union" | "cut"; targetBodyId: string; extent: "one-sided" | "symmetric" | "bidirectional"; distance: number; distancePlus: number; distanceMinus: number; direction: 1 | -1; angle: number; axis: FeatureRecord["axis"] | null };
type BodyFeatureDraft =
  | { type: "fillet"; targetBodyId: string; edgeIndices: number[]; radius: number }
  | { type: "chamfer"; targetBodyId: string; edgeIndices: number[]; method: ChamferMethod; distance: number; distance2: number; angle: number; flip: boolean }
  | { type: "draft"; targetBodyId: string; neutralFaceIndex: number; neutralFaceId: string; faceIndices: number[]; angle: number; reverse: boolean }
  | { type: "shell"; targetBodyId: string; faceIndices: number[]; thickness: number; outward: boolean };
type BodyFeatureTool = BodyFeatureDraft["type"];
type ValidationResult = { closed: boolean; profileCount: number; openEndpoints: { x: number; y: number }[]; issues: string[]; warnings?: string[] };
type OriginPlaneVisibility = Record<"XY" | "XZ" | "YZ", boolean>;
type ReferenceTool = ReferenceGeometryRecord["type"];
type ReferenceDraft =
  | { type: "plane"; baseOrigin: [number, number, number]; normal: [number, number, number]; xDir: [number, number, number]; sourceLabel: string; offset: number; flip: boolean }
  | { type: "axis"; origin: [number, number, number]; direction: [number, number, number]; sourceLabel: string }
  | { type: "point"; position: [number, number, number]; sourceLabel: string };

const API = typeof window === "undefined" ? "http://127.0.0.1:4311" : `${window.location.protocol}//${window.location.hostname}:4311`;
const MODEL_GRID_STORAGE_KEY = "lucascad.model-grid-visible";
const planeLabel = (plane: SketchPlane) => typeof plane === "string" ? `${plane} origin plane` : plane.kind === "reference-plane" ? "reference plane" : `${plane.bodyId}, face ${plane.faceIndex}`;
const defaultSketchView = (): SketchView => ({ center: { x: 0, y: 0 }, zoom: 1 });
const featureGlyph = (feature: FeatureRecord) => feature.type === "extrude" ? "▰" : feature.type === "revolve" ? "◉" : feature.type === "fillet" ? "◜" : feature.type === "chamfer" ? "◩" : feature.type === "shell" ? "▣" : "⌁";
const featureSummary = (feature: FeatureRecord, units: UnitSystem) => feature.type === "fillet" ? `R ${formatLength(feature.radius ?? 0, units)}` : feature.type === "chamfer" ? feature.method === "angle-distance" ? `${formatLength(feature.distance ?? 0, units)} · ${feature.angle ?? 45}°` : feature.method === "distance-distance" ? `${formatLength(feature.distance ?? 0, units)} × ${formatLength(feature.distance2 ?? feature.distance ?? 0, units)}` : formatLength(feature.distance ?? 0, units) : feature.type === "draft" ? `${feature.angle ?? 0}°` : feature.type === "shell" ? `${formatLength(feature.thickness ?? 0, units)} ${feature.outward ? "outward" : "inward"}` : feature.combine ?? "solid";
const flipPoint = (point: { x: number; y: number }) => ({ x: point.x, y: -point.y });
const flipSketchEntity = (entity: SketchEntity): SketchEntity => {
  if (entity.type === "line") return { ...entity, a: flipPoint(entity.a), b: flipPoint(entity.b) };
  if (entity.type === "circle") return { ...entity, c: flipPoint(entity.c) };
  if (entity.type === "ellipse") return { ...entity, c: flipPoint(entity.c), rotation: -(entity.rotation ?? 0) };
  if (entity.type === "arc") return { ...entity, a: flipPoint(entity.a), b: flipPoint(entity.b), through: flipPoint(entity.through) };
  return { ...entity, points: entity.points.map(flipPoint), handles: entity.handles?.map((handle) => ({ in: flipPoint(handle.in), out: flipPoint(handle.out) })) };
};
const flipSketchReference = (reference: SketchReference): SketchReference => reference.kind === "external-point" ? { ...reference, point: flipPoint(reference.point) } : reference.kind === "external-line" ? { ...reference, a: flipPoint(reference.a), b: flipPoint(reference.b) } : reference;
const flipPatternDirection = (reference: PatternDirectionReference): PatternDirectionReference => ({ ...reference, fallback: flipPoint(reference.fallback) });
const flipPatternCenter = (reference: PatternCenterReference): PatternCenterReference => reference.kind === "fixed" ? { ...reference, point: flipPoint(reference.point) } : reference.kind === "origin" ? reference : { ...reference, fallback: flipPoint(reference.fallback) };
const flipSketchConstraint = (constraint: SketchConstraint): SketchConstraint => {
  if (constraint.type === "mirror") return constraint;
  if (constraint.type === "linear-pattern") return { ...constraint, direction1: flipPatternDirection(constraint.direction1), direction2: constraint.direction2 ? flipPatternDirection(constraint.direction2) : undefined };
  if (constraint.type === "rectangular-pattern") return { ...constraint, direction1: flipPatternDirection(constraint.direction1), direction2: flipPatternDirection(constraint.direction2) };
  if (constraint.type === "circular-pattern") return { ...constraint, center: flipPatternCenter(constraint.center), reverse: !constraint.reverse };
  if (constraint.type === "diameter") return { ...constraint, position: flipPoint(constraint.position) };
  if (constraint.type === "angular") return { ...constraint, first: flipSketchReference(constraint.first) as typeof constraint.first, second: flipSketchReference(constraint.second) as typeof constraint.second, position: flipPoint(constraint.position) };
  return { ...constraint, first: flipSketchReference(constraint.first), second: flipSketchReference(constraint.second), position: flipPoint(constraint.position) };
};
const normalizeVector = (value: [number, number, number]): [number, number, number] => { const length = Math.hypot(...value) || 1; return [value[0] / length, value[1] / length, value[2] / length]; };
const offsetVector = (origin: [number, number, number], direction: [number, number, number], distance: number): [number, number, number] => [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance, origin[2] + direction[2] * distance];
const originPlaneFrame = (plane: "XY" | "XZ" | "YZ"): Pick<ReferencePlaneRecord, "origin" | "normal" | "xDir"> => plane === "XY" ? { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] } : plane === "XZ" ? { origin: [0, 0, 0], normal: [0, 1, 0], xDir: [1, 0, 0] } : { origin: [0, 0, 0], normal: [1, 0, 0], xDir: [0, 1, 0] };
const planeXDirection = (normal: [number, number, number]): [number, number, number] => Math.abs(normal[0]) < 0.9 ? normalizeVector([1 - normal[0] * normal[0], -normal[0] * normal[1], -normal[0] * normal[2]]) : normalizeVector([-normal[1] * normal[0], 1 - normal[1] * normal[1], -normal[1] * normal[2]]);

function download(name: string, content: string, type: string) {
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); URL.revokeObjectURL(link.href);
}

export default function Home() {
  const [sketches, setSketches] = useState<LocalSketch[]>([]);
  const [features, setFeatures] = useState<FeatureRecord[]>([]);
  const [referenceGeometry, setReferenceGeometry] = useState<ReferenceGeometryRecord[]>([]);
  const [referenceDraft, setReferenceDraft] = useState<ReferenceDraft | null>(null);
  const [editingReferenceId, setEditingReferenceId] = useState<string | null>(null);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [editingSketchId, setEditingSketchId] = useState<string | null>(null);
  const [sketchViewDocument, setSketchViewDocument] = useState<DocumentRequest | null>(null);
  const [sketchView, setSketchView] = useState<SketchView>(defaultSketchView);
  const [sketchViewRotated, setSketchViewRotated] = useState(false);
  const [snapNormalRequest, setSnapNormalRequest] = useState(0);
  const [selectedSketchId, setSelectedSketchId] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(null);
  const [selectedFace, setSelectedFace] = useState<SelectedFace | null>(null);
  const [selectedPlane, setSelectedPlane] = useState<"XY" | "XZ" | "YZ" | null>(null);
  const [sketchSupportPicking, setSketchSupportPicking] = useState(false);
  const [planeDialog, setPlaneDialog] = useState<{ mode: "new" | "edit"; sketchId?: string } | null>(null);
  const [profileDialog, setProfileDialog] = useState<"extrude" | "revolve" | null>(null);
  const [featureDraft, setFeatureDraft] = useState<FeatureDraft | null>(null);
  const [revolveAxisPicking, setRevolveAxisPicking] = useState(false);
  const [bodyFeatureDraft, setBodyFeatureDraft] = useState<BodyFeatureDraft | null>(null);
  const [bodyFeatureTool, setBodyFeatureTool] = useState<BodyFeatureTool | null>(null);
  const [solidSelectionMode, setSolidSelectionMode] = useState<SolidSelectionMode>(null);
  const [selectedEdges, setSelectedEdges] = useState<SelectedEdge[]>([]);
  const [selectedDraftFaceIds, setSelectedDraftFaceIds] = useState<string[]>([]);
  const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);
  const [validationDialog, setValidationDialog] = useState<{ sketch: LocalSketch; result: ValidationResult } | null>(null);
  const [profileWarning, setProfileWarning] = useState<{ sketch: LocalSketch; type: "extrude" | "revolve"; warnings: string[] } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: "sketch" | "feature" | "reference" | "body"; id: string } | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ type: "feature" | "body"; id: string; value: string } | null>(null);
  const [kernelStatus, setKernelStatus] = useState<KernelStatus>("idle");
  const [kernelMessage, setKernelMessage] = useState<string | null>(null);
  const [properties, setProperties] = useState<Properties | null>(null);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<GlobalAppSettings>(DEFAULT_GLOBAL_SETTINGS);
  const [externalSketchReferences, setExternalSketchReferences] = useState<ExternalSketchReference[]>([]);
  const [showModelGrid, setShowModelGrid] = useState(true);
  const [originCsyVisible, setOriginCsyVisible] = useState(true);
  const [originPlanesVisible, setOriginPlanesVisible] = useState<OriginPlaneVisibility>({ XY: false, XZ: false, YZ: false });
  const [liveExtrusionDrag, setLiveExtrusionDrag] = useState<{ direction: 1 | -1; distance: number } | null>(null);
  const [liveChamferDrag, setLiveChamferDrag] = useState<{ parameter: ChamferParameter; value: number } | null>(null);
  const [livePlaneOffset, setLivePlaneOffset] = useState<number | null>(null);
  const [fitViewRequest, setFitViewRequest] = useState(0);
  const sketchSupportVisibilityRef = useRef<{ referenceId?: string; referenceVisible?: boolean; originPlane?: keyof OriginPlaneVisibility; originVisible?: boolean } | null>(null);

  const cadDocument = useMemo<DocumentRequest>(() => ({ sketches, features, referenceGeometry }), [features, referenceGeometry, sketches]);
  const referenceGeometryForViewport = useMemo<ReferenceGeometryRecord[]>(() => {
    if (!referenceDraft) return referenceGeometry;
    const id = editingReferenceId ?? `reference-${referenceDraft.type}-preview`;
    if (referenceDraft.type === "plane") {
      const normal = referenceDraft.flip ? referenceDraft.normal.map((value) => -value) as [number, number, number] : referenceDraft.normal;
      const preview: ReferencePlaneRecord = { id, name: editingReferenceId ? referenceGeometry.find((reference) => reference.id === editingReferenceId)?.name ?? "Plane preview" : "Plane preview", type: "plane", origin: offsetVector(referenceDraft.baseOrigin, referenceDraft.normal, referenceDraft.offset), normal, xDir: referenceDraft.xDir, sourceLabel: referenceDraft.sourceLabel, visible: true };
      return editingReferenceId ? referenceGeometry.map((reference) => reference.id === editingReferenceId ? preview : reference) : [...referenceGeometry, preview];
    }
    if (referenceDraft.type === "axis") {
      const preview: ReferenceAxisRecord = { id, name: editingReferenceId ? referenceGeometry.find((reference) => reference.id === editingReferenceId)?.name ?? "Axis preview" : "Axis preview", type: "axis", origin: referenceDraft.origin, direction: normalizeVector(referenceDraft.direction), sourceLabel: referenceDraft.sourceLabel, visible: true };
      return editingReferenceId ? referenceGeometry.map((reference) => reference.id === editingReferenceId ? preview : reference) : [...referenceGeometry, preview];
    }
    return referenceGeometry;
  }, [editingReferenceId, referenceDraft, referenceGeometry]);
  const bodyIds = useMemo(() => features.filter((feature) => feature.combine === "new" && feature.bodyId).map((feature) => feature.bodyId!), [features]);
  const bodyName = useCallback((bodyId: string) => {
    const creator = features.find((feature) => feature.bodyId === bodyId);
    return creator?.bodyName?.trim() || `Body ${Math.max(1, bodyIds.indexOf(bodyId) + 1)}`;
  }, [bodyIds, features]);
  const editingSketch = sketches.find((sketch) => sketch.id === editingSketchId) ?? null;
  const selectedSketch = sketches.find((sketch) => sketch.id === selectedSketchId) ?? null;
  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId) ?? null;
  const selectedReference = referenceGeometry.find((reference) => reference.id === selectedReferenceId) ?? null;
  const selectedBodyFeatures = selectedBodyId ? features.filter((feature) => feature.bodyId === selectedBodyId || feature.targetBodyId === selectedBodyId) : [];
  const editingFeatureIndex = editingFeatureId ? features.findIndex((feature) => feature.id === editingFeatureId) : -1;
  const featureBaseFeatures = editingFeatureIndex >= 0 ? features.slice(0, editingFeatureIndex) : features;
  const featureTargetBodyIds = featureBaseFeatures.filter((feature) => feature.combine === "new" && feature.bodyId).map((feature) => feature.bodyId!);
  const featurePreviewDocument = useMemo<DocumentRequest>(() => ({ sketches, features: featureBaseFeatures, referenceGeometry }), [featureBaseFeatures, referenceGeometry, sketches]);
  const extrusionPreview = useMemo<FeaturePreview | null>(() => featureDraft?.type === "extrude" ? { type: "extrude", sketchId: featureDraft.sketchId, combine: featureDraft.combine, targetBodyId: featureDraft.combine === "new" ? undefined : featureDraft.targetBodyId, extent: featureDraft.extent, distance: featureDraft.distance, distancePlus: featureDraft.distancePlus, distanceMinus: featureDraft.distanceMinus, direction: featureDraft.direction } : null, [featureDraft]);
  const bodyFeaturePreview = useMemo<FeaturePreview | null>(() => {
    if (!bodyFeatureDraft) return null;
    if ((bodyFeatureDraft.type === "draft" || bodyFeatureDraft.type === "shell") && !bodyFeatureDraft.faceIndices.length) return null;
    return bodyFeatureDraft;
  }, [bodyFeatureDraft]);
  const activeFeaturePreview = extrusionPreview ?? bodyFeaturePreview;
  const displayedFeatureDraft = useMemo(() => {
    if (!featureDraft || featureDraft.type !== "extrude" || !liveExtrusionDrag) return featureDraft;
    if (featureDraft.extent === "one-sided") return { ...featureDraft, distance: liveExtrusionDrag.distance };
    if (featureDraft.extent === "symmetric") return { ...featureDraft, distancePlus: liveExtrusionDrag.distance, distanceMinus: liveExtrusionDrag.distance };
    return liveExtrusionDrag.direction > 0 ? { ...featureDraft, distancePlus: liveExtrusionDrag.distance } : { ...featureDraft, distanceMinus: liveExtrusionDrag.distance };
  }, [featureDraft, liveExtrusionDrag]);
  const displayedBodyFeatureDraft = useMemo(() => {
    if (!bodyFeatureDraft || bodyFeatureDraft.type !== "chamfer" || !liveChamferDrag) return bodyFeatureDraft;
    return { ...bodyFeatureDraft, [liveChamferDrag.parameter]: liveChamferDrag.value };
  }, [bodyFeatureDraft, liveChamferDrag]);
  const eligibleProfileSketchIds = useMemo(() => sketches.filter((sketch) => sketch.entities.some((entity) => !entity.construction)).map((sketch) => sketch.id), [sketches]);

  const onStatus = useCallback((status: KernelStatus, next?: Properties, message?: string) => {
    setKernelStatus(status); setKernelMessage(message ?? null); if (next) setProperties(next);
  }, []);

  const startSketchOnPlane = useCallback((plane: SketchPlane) => {
    if (typeof plane === "string") {
      sketchSupportVisibilityRef.current = { originPlane: plane, originVisible: originPlanesVisible[plane] };
      setOriginPlanesVisible((visible) => ({ ...visible, [plane]: true }));
    } else if (plane.kind === "reference-plane") {
      const reference = referenceGeometry.find((item) => item.id === plane.referenceId);
      sketchSupportVisibilityRef.current = { referenceId: plane.referenceId, referenceVisible: reference?.visible !== false };
      setReferenceGeometry((items) => items.map((item) => item.id === plane.referenceId ? { ...item, visible: true } : item));
    } else sketchSupportVisibilityRef.current = null;
    const id = `sketch-${crypto.randomUUID()}`;
    const sketch: LocalSketch = { id, name: `Sketch ${sketches.length + 1}`, plane, entities: [], visible: true };
    const nextSketches = [...sketches, sketch];
    setSketches(nextSketches); setSketchViewDocument({ sketches: nextSketches, features, referenceGeometry }); setSketchView(defaultSketchView()); setSketchViewRotated(false); setSelectedSketchId(id); setSelectedFeatureId(null); setSelectedPlane(null); setSketchSupportPicking(false); if (typeof plane !== "string" && plane.kind === "face") setSelectedBodyId(plane.bodyId); else setSelectedBodyId(null); setEditingSketchId(id); setPlaneDialog(null);
  }, [features, originPlanesVisible, referenceGeometry, sketches]);

  const onSelectFace = useCallback((face: SelectedFace | null) => {
    if (face) setSelectedReferenceId(null);
    if (referenceDraft?.type === "axis" && face) {
      if (!face.axisOrigin || !face.axisDirection) { setKernelMessage("Select a cylindrical, conical, or toroidal surface with a center axis."); return; }
      setReferenceDraft({ type: "axis", origin: face.axisOrigin, direction: normalizeVector(face.axisDirection), sourceLabel: `${face.bodyId} · ${face.geometryType?.toLowerCase() ?? "curved"} face center axis` }); setSelectedFace(face); setSelectedBodyId(face.bodyId); setSelectedEdges([]); setKernelMessage(null); return;
    }
    if (referenceDraft?.type === "plane" && face) {
      if (face.planar === false || !face.center || !face.normal) { setKernelMessage("Reference planes require a planar face."); return; }
      const normal = normalizeVector(face.normal); setLivePlaneOffset(null); setReferenceDraft({ type: "plane", baseOrigin: face.center, normal, xDir: planeXDirection(normal), sourceLabel: `${face.bodyId} · face ${face.faceIndex}`, offset: 0, flip: false }); setSelectedFace(face); setSelectedBodyId(face.bodyId); setKernelMessage(null); return;
    }
    if (bodyFeatureTool === "draft") {
      if (!face) return;
      if (solidSelectionMode === "draft-neutral") {
        setSelectedFace(face); setSelectedBodyId(face.bodyId); setSelectedEdges([]); setSelectedDraftFaceIds([face.id]);
        setBodyFeatureDraft({ type: "draft", targetBodyId: face.bodyId, neutralFaceIndex: face.faceIndex, neutralFaceId: face.id, faceIndices: [], angle: bodyFeatureDraft?.type === "draft" ? bodyFeatureDraft.angle : 3, reverse: bodyFeatureDraft?.type === "draft" ? bodyFeatureDraft.reverse : false });
        setSolidSelectionMode("draft-faces"); return;
      }
      if (solidSelectionMode === "draft-faces") {
        setBodyFeatureDraft((draft) => {
          if (!draft || draft.type !== "draft" || draft.targetBodyId !== face.bodyId || draft.neutralFaceId === face.id) return draft;
          const faceIndices = draft.faceIndices.includes(face.faceIndex) ? draft.faceIndices.filter((index) => index !== face.faceIndex) : [...draft.faceIndices, face.faceIndex];
          setSelectedDraftFaceIds([draft.neutralFaceId, ...faceIndices.map((index) => `${draft.targetBodyId}:face-${index}`)]);
          return { ...draft, faceIndices };
        });
        return;
      }
    }
    if (bodyFeatureTool === "shell" && solidSelectionMode === "shell-faces") {
      if (!face) return;
      setSelectedFace(face); setSelectedBodyId(face.bodyId); setSelectedEdges([]);
      setBodyFeatureDraft((draft) => {
        const current = draft?.type === "shell" && draft.targetBodyId === face.bodyId ? draft : { type: "shell" as const, targetBodyId: face.bodyId, faceIndices: [], thickness: 2, outward: false };
        const faceIndices = current.faceIndices.includes(face.faceIndex) ? current.faceIndices.filter((index) => index !== face.faceIndex) : [...current.faceIndices, face.faceIndex];
        setSelectedDraftFaceIds(faceIndices.map((index) => `${face.bodyId}:face-${index}`));
        return { ...current, faceIndices };
      });
      return;
    }
    setSelectedFace(face);
    if (!face) { if (!sketchSupportPicking) { setSelectedBodyId(null); setSelectedSketchId(null); setSelectedFeatureId(null); setSelectedPlane(null); } return; }
    if (sketchSupportPicking) { startSketchOnPlane({ kind: "face", bodyId: face.bodyId, faceIndex: face.faceIndex, faceId: face.id }); return; }
    setSelectedEdges([]); setSelectedBodyId(face.bodyId); setSelectedSketchId(null); setSelectedFeatureId(null); setSelectedPlane(null);
  }, [bodyFeatureDraft, bodyFeatureTool, referenceDraft, sketchSupportPicking, solidSelectionMode, startSketchOnPlane]);

  const onSelectEdge = useCallback((edge: SelectedEdge, additive: boolean) => {
    if (referenceDraft?.type === "axis") {
      if (!edge.axisOrigin || !edge.axisDirection) { setKernelMessage("That edge cannot define an axis."); return; }
      const description = edge.axisKind === "center" ? "center axis" : edge.axisKind === "tangent" ? "midpoint tangent axis" : "coincident axis";
      setReferenceDraft({ type: "axis", origin: edge.axisOrigin, direction: normalizeVector(edge.axisDirection), sourceLabel: `${edge.bodyId} · edge ${edge.edgeIndex} ${description}` }); setSelectedReferenceId(null); setSelectedFace(null); setSelectedEdges([edge]); setSelectedBodyId(edge.bodyId); setKernelMessage(null); return;
    }
    setSelectedReferenceId(null); setSelectedFace(null); setSelectedDraftFaceIds([]); setSelectedBodyId(edge.bodyId); setSelectedSketchId(null); setSelectedFeatureId(null); setSelectedPlane(null);
    setSelectedEdges((current) => {
      const compatible = current.filter((item) => item.bodyId === edge.bodyId);
      const exists = compatible.some((item) => item.id === edge.id);
      const next = exists ? compatible.filter((item) => item.id !== edge.id) : additive || bodyFeatureTool === "fillet" || bodyFeatureTool === "chamfer" ? [...compatible, edge] : [edge];
      if (bodyFeatureTool === "fillet") setBodyFeatureDraft({ type: "fillet", targetBodyId: edge.bodyId, edgeIndices: next.map((item) => item.edgeIndex), radius: bodyFeatureDraft?.type === "fillet" ? bodyFeatureDraft.radius : 2 });
      if (bodyFeatureTool === "chamfer") setBodyFeatureDraft({ type: "chamfer", targetBodyId: edge.bodyId, edgeIndices: next.map((item) => item.edgeIndex), method: bodyFeatureDraft?.type === "chamfer" ? bodyFeatureDraft.method : "symmetric", distance: bodyFeatureDraft?.type === "chamfer" ? bodyFeatureDraft.distance : 2, distance2: bodyFeatureDraft?.type === "chamfer" ? bodyFeatureDraft.distance2 : 2, angle: bodyFeatureDraft?.type === "chamfer" ? bodyFeatureDraft.angle : 45, flip: bodyFeatureDraft?.type === "chamfer" ? bodyFeatureDraft.flip : false });
      return next;
    });
  }, [bodyFeatureDraft, bodyFeatureTool, referenceDraft]);

  useEffect(() => {
    if (!sketchSupportPicking && !profileDialog && !bodyFeatureTool && !revolveAxisPicking) return;
    const cancelPicking = (event: KeyboardEvent) => { if (event.defaultPrevented || keyboardEventOwnedByControl(event.target)) return; if (event.key === "Escape") { setSketchSupportPicking(false); setProfileDialog(null); setRevolveAxisPicking(false); setBodyFeatureTool(null); setBodyFeatureDraft(null); setSolidSelectionMode(null); setSelectedDraftFaceIds([]); } };
    window.addEventListener("keydown", cancelPicking);
    return () => window.removeEventListener("keydown", cancelPicking);
  }, [bodyFeatureTool, profileDialog, revolveAxisPicking, sketchSupportPicking]);

  useEffect(() => {
    const fitShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || editingSketchId || keyboardEventOwnedByControl(event.target) || event.key.toLowerCase() !== "f") return;
      event.preventDefault(); setFitViewRequest((request) => request + 1);
    };
    window.addEventListener("keydown", fitShortcut);
    return () => window.removeEventListener("keydown", fitShortcut);
  }, [editingSketchId]);

  useEffect(() => {
    let stored = DEFAULT_GLOBAL_SETTINGS;
    try { stored = parseGlobalSettings(window.localStorage.getItem(GLOBAL_SETTINGS_STORAGE_KEY)); }
    catch { /* Use defaults when browser storage is unavailable. */ }
    const frame = requestAnimationFrame(() => setGlobalSettings(stored));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    let visible = true;
    try { const stored = window.localStorage.getItem(MODEL_GRID_STORAGE_KEY); if (stored !== null) visible = stored !== "false"; }
    catch { /* Keep the model grid visible when browser storage is unavailable. */ }
    const frame = requestAnimationFrame(() => setShowModelGrid(visible));
    return () => cancelAnimationFrame(frame);
  }, []);
  const toggleModelGrid = () => setShowModelGrid((visible) => { const next = !visible; try { window.localStorage.setItem(MODEL_GRID_STORAGE_KEY, String(next)); } catch { /* Session state still works. */ } return next; });

  const updateGlobalSettings = (next: GlobalAppSettings) => {
    setGlobalSettings(next);
    try { window.localStorage.setItem(GLOBAL_SETTINGS_STORAGE_KEY, JSON.stringify(next)); }
    catch { /* Preferences still apply for this session when storage is unavailable. */ }
  };
  const displayedLength = (millimeters: number) => Number(fromMillimeters(millimeters, globalSettings.unitSystem).toFixed(4));
  const enteredLength = (value: string) => Math.max(0.1, toMillimeters(Number(value), globalSettings.unitSystem));
  const lengthUnit = unitSuffix(globalSettings.unitSystem);

  const requestNewSketch = () => {
    if (sketchSupportPicking) { setSketchSupportPicking(false); return; }
    if (!sketches.length) { setPlaneDialog({ mode: "new" }); return; }
    setSketchSupportPicking(true); setSelectedFace(null); setSelectedPlane(null); setSelectedSketchId(null); setSelectedFeatureId(null); setKernelMessage(null);
  };

  const choosePlane = (plane: SketchPlane) => {
    if (planeDialog?.mode === "edit" && planeDialog.sketchId) {
      const nextSketches = sketches.map((sketch) => sketch.id === planeDialog.sketchId ? { ...sketch, plane } : sketch);
      setSketches(nextSketches);
      if (editingSketchId === planeDialog.sketchId) setSketchViewDocument({ sketches: nextSketches, features, referenceGeometry });
      setSelectedSketchId(planeDialog.sketchId); setPlaneDialog(null); return;
    }
    startSketchOnPlane(plane);
  };
  const editSketch = (id: string) => {
    const sketch = sketches.find((item) => item.id === id);
    if (sketch && typeof sketch.plane === "string") {
      sketchSupportVisibilityRef.current = { originPlane: sketch.plane, originVisible: originPlanesVisible[sketch.plane] };
      setOriginPlanesVisible((visible) => ({ ...visible, [sketch.plane as keyof OriginPlaneVisibility]: true }));
    } else if (sketch && typeof sketch.plane !== "string" && sketch.plane.kind === "reference-plane") {
      const reference = referenceGeometry.find((item) => item.id === sketch.plane.referenceId);
      sketchSupportVisibilityRef.current = { referenceId: sketch.plane.referenceId, referenceVisible: reference?.visible !== false };
      setReferenceGeometry((items) => items.map((item) => item.id === sketch.plane.referenceId ? { ...item, visible: true } : item));
    } else sketchSupportVisibilityRef.current = null;
    setSketchViewDocument(cadDocument); setSketchView(defaultSketchView()); setSketchViewRotated(false); setEditingSketchId(id); setSelectedSketchId(id); setSelectedFeatureId(null); setSelectedPlane(null); setSketchSupportPicking(false); setSelectedBodyId(sketch && typeof sketch.plane !== "string" && sketch.plane.kind === "face" ? sketch.plane.bodyId : null); setSelectedFace(null);
  };
  const finishSketch = () => {
    const support = sketchSupportVisibilityRef.current;
    if (support?.originPlane) setOriginPlanesVisible((visible) => ({ ...visible, [support.originPlane!]: support.originVisible ?? false }));
    if (support?.referenceId) setReferenceGeometry((items) => items.map((item) => item.id === support.referenceId ? { ...item, visible: support.referenceVisible ?? false } : item));
    sketchSupportVisibilityRef.current = null;
    setEditingSketchId(null); setSketchViewDocument(null); setSketchView(defaultSketchView()); setSketchViewRotated(false); setExternalSketchReferences([]); setSelectedFeatureId(null);
  };
  const snapSketchNormal = () => { setSketchViewRotated(false); setSnapNormalRequest((request) => request + 1); };
  const flipSketchPlane = (id: string) => {
    const nextSketches = sketches.map((sketch) => sketch.id !== id ? sketch : {
      ...sketch,
      flipped: !sketch.flipped,
      entities: sketch.entities.map(flipSketchEntity),
      constraints: sketch.constraints?.map(flipSketchConstraint),
      dimensionOffsets: sketch.dimensionOffsets ? Object.fromEntries(Object.entries(sketch.dimensionOffsets).map(([key, offset]) => [key, { x: offset.x, y: -offset.y }])) : undefined,
    });
    const nextFeatures = features.map((feature) => {
      if (feature.sketchId !== id || feature.type !== "extrude") return feature;
      if (feature.extent === "bidirectional") return { ...feature, distancePlus: feature.distanceMinus ?? feature.distancePlus, distanceMinus: feature.distancePlus ?? feature.distanceMinus };
      if (feature.extent === "symmetric") return feature;
      return { ...feature, direction: feature.direction === -1 ? 1 as const : -1 as const };
    });
    setSketches(nextSketches); setFeatures(nextFeatures); setKernelMessage(null);
    if (editingSketchId === id) {
      setSketchViewDocument({ sketches: nextSketches, features: nextFeatures, referenceGeometry });
      setSketchView((view) => ({ ...view, center: flipPoint(view.center) }));
      setSketchViewRotated(false); setExternalSketchReferences([]); setSnapNormalRequest((request) => request + 1);
    }
  };
  const updateEditingSketch = (entities: SketchEntity[]) => setSketches((items) => items.map((sketch) => sketch.id === editingSketchId ? { ...sketch, entities } : sketch));
  const updateSketchConstraints = (constraints: SketchConstraint[]) => setSketches((items) => items.map((sketch) => sketch.id === editingSketchId ? { ...sketch, constraints } : sketch));
  const updateDimensionOffsets = (dimensionOffsets: Record<string, { x: number; y: number }>) => setSketches((items) => items.map((sketch) => sketch.id === editingSketchId ? { ...sketch, dimensionOffsets } : sketch));
  const toggleSketchVisibility = (id: string) => setSketches((items) => items.map((sketch) => sketch.id === id ? { ...sketch, visible: sketch.visible === false } : sketch));
  const toggleFeatureVisibility = (id: string) => setFeatures((items) => items.map((feature) => feature.id === id ? { ...feature, visible: feature.visible === false } : feature));
  const toggleOriginPlaneVisibility = (plane: "XY" | "XZ" | "YZ") => setOriginPlanesVisible((visible) => ({ ...visible, [plane]: !visible[plane] }));
  const toggleReferenceVisibility = (id: string) => setReferenceGeometry((items) => items.map((reference) => reference.id === id ? { ...reference, visible: reference.visible === false } : reference));
  const requestReferenceGeometry = (type: ReferenceTool) => {
    setEditingReferenceId(null); setSelectedReferenceId(null); setLivePlaneOffset(null); setKernelMessage(null); closeFeatureEditor(); setProfileDialog(null); setSketchSupportPicking(false);
    const selectedReference = referenceGeometry.find((reference) => reference.id === selectedReferenceId);
    if (type === "plane") {
      if (selectedFace?.center && selectedFace.normal) {
        const normal = normalizeVector(selectedFace.normal); setReferenceDraft({ type, baseOrigin: selectedFace.center, normal, xDir: planeXDirection(normal), sourceLabel: `${selectedFace.bodyId} · face ${selectedFace.faceIndex}`, offset: 0, flip: false }); return;
      }
      if (selectedReference?.type === "plane") { setReferenceDraft({ type, baseOrigin: selectedReference.origin, normal: selectedReference.normal, xDir: selectedReference.xDir, sourceLabel: selectedReference.name, offset: 0, flip: false }); return; }
      const base = originPlaneFrame(selectedPlane ?? "XY"); setReferenceDraft({ type, baseOrigin: base.origin, normal: base.normal, xDir: base.xDir, sourceLabel: `${selectedPlane ?? "XY"} origin plane`, offset: 0, flip: false }); return;
    }
    if (type === "axis") {
      const edge = selectedEdges.length === 1 && selectedEdges[0].axisOrigin && selectedEdges[0].axisDirection ? selectedEdges[0] : null;
      if (edge?.axisOrigin && edge.axisDirection) { setReferenceDraft({ type, origin: edge.axisOrigin, direction: normalizeVector(edge.axisDirection), sourceLabel: `${edge.bodyId} · edge ${edge.edgeIndex} ${edge.axisKind === "center" ? "center axis" : edge.axisKind === "tangent" ? "midpoint tangent axis" : "coincident axis"}` }); return; }
      if (selectedFace?.axisOrigin && selectedFace.axisDirection) { setReferenceDraft({ type, origin: selectedFace.axisOrigin, direction: normalizeVector(selectedFace.axisDirection), sourceLabel: `${selectedFace.bodyId} · ${selectedFace.geometryType?.toLowerCase() ?? "curved"} face center axis` }); return; }
      if (selectedReference?.type === "axis") { setReferenceDraft({ type, origin: selectedReference.origin, direction: selectedReference.direction, sourceLabel: selectedReference.name }); return; }
      setReferenceDraft({ type, origin: [0, 0, 0], direction: [0, 0, 1], sourceLabel: "Origin Z axis" }); return;
    }
    const edge = selectedEdges.length === 1 && selectedEdges[0].points?.length ? selectedEdges[0] : null;
    if (selectedFace?.center) setReferenceDraft({ type, position: selectedFace.center, sourceLabel: `${selectedFace.bodyId} · face center` });
    else if (edge?.points) { const start = edge.points[0]; const end = edge.points.at(-1)!; setReferenceDraft({ type, position: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2], sourceLabel: `${edge.bodyId} · edge midpoint` }); }
    else if (selectedReference?.type === "point") setReferenceDraft({ type, position: selectedReference.position, sourceLabel: selectedReference.name });
    else setReferenceDraft({ type, position: [0, 0, 0], sourceLabel: "XYZ coordinates" });
  };
  const editReferenceGeometry = (id: string) => {
    const reference = referenceGeometry.find((item) => item.id === id); if (!reference) return;
    setEditingReferenceId(id); setSelectedReferenceId(id); setLivePlaneOffset(null);
    if (reference.type === "plane") setReferenceDraft({ type: "plane", baseOrigin: reference.origin, normal: reference.normal, xDir: reference.xDir, sourceLabel: reference.sourceLabel, offset: 0, flip: false });
    else if (reference.type === "axis") setReferenceDraft({ type: "axis", origin: reference.origin, direction: reference.direction, sourceLabel: reference.sourceLabel });
    else setReferenceDraft({ type: "point", position: reference.position, sourceLabel: reference.sourceLabel });
  };
  const saveReferenceGeometry = () => {
    if (!referenceDraft) return;
    const existing = editingReferenceId ? referenceGeometry.find((reference) => reference.id === editingReferenceId) : undefined;
    const count = referenceGeometry.filter((reference) => reference.type === referenceDraft.type).length + 1; const label = referenceDraft.type === "plane" ? "Plane" : referenceDraft.type === "axis" ? "Axis" : "Point";
    const common = { id: existing?.id ?? `${referenceDraft.type}-${crypto.randomUUID()}`, name: existing?.name ?? `${label} ${count}`, sourceLabel: referenceDraft.sourceLabel, visible: existing?.visible ?? true };
    const reference: ReferenceGeometryRecord = referenceDraft.type === "plane" ? { ...common, type: "plane", origin: offsetVector(referenceDraft.baseOrigin, referenceDraft.normal, referenceDraft.offset), normal: referenceDraft.flip ? referenceDraft.normal.map((value) => -value) as [number, number, number] : referenceDraft.normal, xDir: referenceDraft.xDir } : referenceDraft.type === "axis" ? { ...common, type: "axis", origin: referenceDraft.origin, direction: normalizeVector(referenceDraft.direction) } : { ...common, type: "point", position: referenceDraft.position };
    setReferenceGeometry((items) => existing ? items.map((item) => item.id === existing.id ? reference : item) : [...items, reference]); setSelectedReferenceId(reference.id); setReferenceDraft(null); setEditingReferenceId(null); setLivePlaneOffset(null);
  };
  const deleteReferenceGeometry = (id: string) => {
    const dependentSketchIds = new Set(sketches.filter((sketch) => typeof sketch.plane !== "string" && sketch.plane.kind === "reference-plane" && sketch.plane.referenceId === id).map((sketch) => sketch.id));
    const firstDependent = features.findIndex((feature) => dependentSketchIds.has(feature.sketchId ?? "") || typeof feature.axis === "object" && feature.axis.kind === "reference-axis" && feature.axis.referenceId === id);
    setReferenceGeometry((items) => items.filter((reference) => reference.id !== id)); setSketches((items) => items.filter((sketch) => !dependentSketchIds.has(sketch.id))); if (firstDependent >= 0) setFeatures((items) => items.slice(0, firstDependent)); setSelectedReferenceId(null); setReferenceDraft(null); setEditingReferenceId(null);
  };

  const closeFeatureEditor = () => { setFeatureDraft(null); setRevolveAxisPicking(false); setBodyFeatureDraft(null); setBodyFeatureTool(null); setSolidSelectionMode(null); setSelectedDraftFaceIds([]); setEditingFeatureId(null); setLiveExtrusionDrag(null); setLiveChamferDrag(null); };
  const requestFeature = (type: "extrude" | "revolve") => { setSketchSupportPicking(false); setProfileDialog((current) => current === type ? null : type); setValidationDialog(null); setSelectedSketchId(null); setSelectedFeatureId(null); setSelectedBodyId(null); setSelectedPlane(null); closeFeatureEditor(); };
  const requestBodyFeature = (type: BodyFeatureTool) => {
    if (bodyFeatureTool === type) { closeFeatureEditor(); return; }
    const preselectedEdges = selectedEdges.length && selectedEdges.every((edge) => edge.bodyId === selectedEdges[0].bodyId) ? selectedEdges : [];
    const preselectedFace = selectedFace;
    closeFeatureEditor(); setProfileDialog(null); setSketchSupportPicking(false); setSelectedFeatureId(null); setKernelMessage(null); setBodyFeatureTool(type);
    if (type === "fillet" || type === "chamfer") {
      setSolidSelectionMode("edges"); setSelectedDraftFaceIds([]);
      if (preselectedEdges.length) setBodyFeatureDraft(type === "fillet"
        ? { type, targetBodyId: preselectedEdges[0].bodyId, edgeIndices: preselectedEdges.map((edge) => edge.edgeIndex), radius: 2 }
        : { type, targetBodyId: preselectedEdges[0].bodyId, edgeIndices: preselectedEdges.map((edge) => edge.edgeIndex), method: "symmetric", distance: 2, distance2: 2, angle: 45, flip: false });
      return;
    }
    setSelectedEdges([]);
    if (type === "shell") {
      setSolidSelectionMode("shell-faces");
      if (preselectedFace) {
        setSelectedBodyId(preselectedFace.bodyId); setSelectedDraftFaceIds([preselectedFace.id]);
        setBodyFeatureDraft({ type: "shell", targetBodyId: preselectedFace.bodyId, faceIndices: [preselectedFace.faceIndex], thickness: 2, outward: false });
      } else setSelectedDraftFaceIds([]);
      return;
    }
    if (preselectedFace) {
      setSelectedBodyId(preselectedFace.bodyId); setSelectedDraftFaceIds([preselectedFace.id]); setSolidSelectionMode("draft-faces");
      setBodyFeatureDraft({ type: "draft", targetBodyId: preselectedFace.bodyId, neutralFaceIndex: preselectedFace.faceIndex, neutralFaceId: preselectedFace.id, faceIndices: [], angle: 3, reverse: false });
    } else setSolidSelectionMode("draft-neutral");
  };
  const beginFeatureDraft = (sketch: LocalSketch, type: "extrude" | "revolve") => {
    setFeatureDraft({ type, sketchId: sketch.id, combine: "new", targetBodyId: typeof sketch.plane !== "string" && sketch.plane.kind === "face" ? sketch.plane.bodyId : selectedBodyId ?? bodyIds[0] ?? "", extent: "one-sided", distance: 20, distancePlus: 20, distanceMinus: 20, direction: 1, angle: 360, axis: null });
    setRevolveAxisPicking(type === "revolve");
  };
  const selectProfile = async (sketch: LocalSketch, type: "extrude" | "revolve") => {
    setSelectedSketchId(sketch.id);
    try {
      const response = await fetch(`${API}/api/sketch/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entities: sketch.entities }) });
      if (!response.ok) throw new Error(`Sketch validation failed (${response.status})`);
      const result = await response.json() as ValidationResult;
      setProfileDialog(null);
      if (!result.closed) { setValidationDialog({ sketch, result }); setSelectedSketchId(sketch.id); return; }
      if (result.warnings?.length) { setProfileWarning({ sketch, type, warnings: result.warnings }); return; }
      beginFeatureDraft(sketch, type);
    } catch (error) {
      setProfileDialog(null);
      setKernelStatus("offline");
      setKernelMessage(error instanceof Error ? error.message : "Sketch validation service is unavailable");
    }
  };
  const selectProfileById = useCallback((sketchId: string) => { const sketch = sketches.find((item) => item.id === sketchId); if (sketch && profileDialog && eligibleProfileSketchIds.includes(sketch.id)) void selectProfile(sketch, profileDialog); }, [eligibleProfileSketchIds, profileDialog, sketches]);
  const updateExtrusionDistanceFromArrow = useCallback((direction: 1 | -1, distance: number, phase: "preview" | "commit" | "cancel") => {
    if (phase === "preview") { setLiveExtrusionDrag({ direction, distance }); return; }
    setLiveExtrusionDrag(null); if (phase === "cancel") return;
    setFeatureDraft((draft) => {
      if (!draft || draft.type !== "extrude") return draft;
      if (draft.extent === "one-sided") return { ...draft, distance };
      if (draft.extent === "symmetric") return { ...draft, distancePlus: distance, distanceMinus: distance };
      return direction > 0 ? { ...draft, distancePlus: distance } : { ...draft, distanceMinus: distance };
    });
  }, []);
  const updateChamferParameterFromArrow = useCallback((parameter: ChamferParameter, value: number, phase: "preview" | "commit" | "cancel") => {
    if (phase === "preview") { setLiveChamferDrag({ parameter, value }); return; }
    setLiveChamferDrag(null); if (phase === "cancel") return;
    setBodyFeatureDraft((draft) => draft?.type === "chamfer" ? { ...draft, [parameter]: value } : draft);
  }, []);
  const selectRevolveAxis = useCallback((axis: RevolveAxisReference) => {
    setFeatureDraft((draft) => draft?.type === "revolve" ? { ...draft, axis } : draft);
    setRevolveAxisPicking(false); setKernelMessage(null);
  }, []);
  const selectReferencePlaneForSketch = useCallback((referenceId: string) => startSketchOnPlane({ kind: "reference-plane", referenceId }), [startSketchOnPlane]);
  const selectReferenceInModel = useCallback((referenceId: string) => {
    const reference = referenceGeometry.find((item) => item.id === referenceId);
    if (referenceDraft?.type === "plane" && reference?.type === "plane") { setLivePlaneOffset(null); setReferenceDraft({ type: "plane", baseOrigin: reference.origin, normal: reference.normal, xDir: reference.xDir, sourceLabel: reference.name, offset: 0, flip: false }); setKernelMessage(null); return; }
    setSelectedReferenceId(referenceId); setSelectedSketchId(null); setSelectedFeatureId(null); setSelectedBodyId(null); setSelectedPlane(null); setSelectedFace(null);
  }, [referenceDraft, referenceGeometry]);
  const updateReferencePlaneOffsetFromArrow = useCallback((offset: number, phase: "preview" | "commit" | "cancel") => {
    if (phase === "preview") { setLivePlaneOffset(offset); return; }
    setLivePlaneOffset(null); if (phase === "cancel") return; setReferenceDraft((draft) => draft?.type === "plane" ? { ...draft, offset } : draft);
  }, []);
  const editFeature = (id: string) => {
    const feature = features.find((item) => item.id === id);
    if (!feature) return;
    if (feature.type === "fillet" || feature.type === "chamfer" || feature.type === "draft" || feature.type === "shell") {
      if (!feature.targetBodyId) return;
      setEditingFeatureId(id); setBodyFeatureTool(feature.type); setProfileDialog(null); setValidationDialog(null); setContextMenu(null); setSelectedFeatureId(id); setSelectedSketchId(null); setSelectedBodyId(feature.targetBodyId); setSelectedPlane(null); setSketchSupportPicking(false); setKernelMessage(null);
      if (feature.type === "fillet") {
        const edgeIndices = feature.edgeIndices ?? []; setSelectedEdges(edgeIndices.map((edgeIndex) => ({ id: `${feature.targetBodyId}:edge-${edgeIndex}`, bodyId: feature.targetBodyId!, edgeIndex }))); setSolidSelectionMode("edges"); setSelectedDraftFaceIds([]); setBodyFeatureDraft({ type: "fillet", targetBodyId: feature.targetBodyId, edgeIndices, radius: feature.radius ?? 2 });
      } else if (feature.type === "chamfer") {
        const edgeIndices = feature.edgeIndices ?? []; setSelectedEdges(edgeIndices.map((edgeIndex) => ({ id: `${feature.targetBodyId}:edge-${edgeIndex}`, bodyId: feature.targetBodyId!, edgeIndex }))); setSolidSelectionMode("edges"); setSelectedDraftFaceIds([]); setBodyFeatureDraft({ type: "chamfer", targetBodyId: feature.targetBodyId, edgeIndices, method: feature.method ?? "symmetric", distance: feature.distance ?? 2, distance2: feature.distance2 ?? feature.distance ?? 2, angle: feature.angle ?? 45, flip: feature.flip ?? false });
      } else if (feature.type === "draft") {
        const neutralFaceIndex = feature.neutralFaceIndex ?? 1; const neutralFaceId = `${feature.targetBodyId}:face-${neutralFaceIndex}`; const faceIndices = feature.faceIndices ?? [];
        setSelectedEdges([]); setSelectedDraftFaceIds([neutralFaceId, ...faceIndices.map((faceIndex) => `${feature.targetBodyId}:face-${faceIndex}`)]); setSolidSelectionMode("draft-faces"); setBodyFeatureDraft({ type: "draft", targetBodyId: feature.targetBodyId, neutralFaceIndex, neutralFaceId, faceIndices, angle: feature.angle ?? 3, reverse: feature.reverse ?? false });
      } else {
        const faceIndices = feature.faceIndices ?? [];
        setSelectedEdges([]); setSelectedDraftFaceIds(faceIndices.map((faceIndex) => `${feature.targetBodyId}:face-${faceIndex}`)); setSolidSelectionMode("shell-faces"); setBodyFeatureDraft({ type: "shell", targetBodyId: feature.targetBodyId, faceIndices, thickness: feature.thickness ?? 2, outward: feature.outward ?? false });
      }
      return;
    }
    if (feature.type !== "extrude" && feature.type !== "revolve") return;
    const distance = Math.abs(feature.distance ?? 20);
    const distancePlus = Math.abs(feature.distancePlus ?? distance);
    const precedingBodies = features.slice(0, features.findIndex((item) => item.id === id)).filter((item) => item.combine === "new" && item.bodyId).map((item) => item.bodyId!);
    setEditingFeatureId(id);
    setFeatureDraft({
      type: feature.type,
      sketchId: feature.sketchId!,
      combine: feature.combine ?? "new",
      targetBodyId: feature.targetBodyId ?? precedingBodies[0] ?? "",
      extent: feature.extent ?? "one-sided",
      distance,
      distancePlus,
      distanceMinus: Math.abs(feature.distanceMinus ?? distancePlus),
      direction: feature.direction ?? 1,
      angle: 360,
      axis: feature.type === "revolve" ? feature.axis ?? null : null,
    });
    setRevolveAxisPicking(feature.type === "revolve" && !feature.axis);
    setProfileDialog(null); setValidationDialog(null); setContextMenu(null); setSelectedFeatureId(id); setSelectedSketchId(null); setSelectedBodyId(null); setSelectedPlane(null); setSketchSupportPicking(false); setKernelMessage(null);
  };
  const createFeature = () => {
    if (!featureDraft) return;
    const existingFeature = editingFeatureId ? features.find((feature) => feature.id === editingFeatureId) : undefined;
    const index = features.filter((feature) => feature.type === featureDraft.type && feature.id !== existingFeature?.id).length + 1;
    const id = existingFeature?.id ?? `${featureDraft.type}-${crypto.randomUUID()}`;
    const feature: FeatureRecord = {
      id, name: existingFeature?.name ?? `${featureDraft.type === "extrude" ? "Extrude" : "Revolve"} ${index}`, type: featureDraft.type, sketchId: featureDraft.sketchId, combine: featureDraft.combine,
      ...(featureDraft.combine === "new" ? { bodyId: existingFeature?.bodyId ?? `body-${crypto.randomUUID()}`, bodyName: existingFeature?.bodyName } : { targetBodyId: featureDraft.targetBodyId }),
      ...(featureDraft.type === "extrude" ? { extent: featureDraft.extent, distance: featureDraft.distance, distancePlus: featureDraft.distancePlus, distanceMinus: featureDraft.distanceMinus, direction: featureDraft.direction } : { angle: featureDraft.angle, axis: featureDraft.axis ?? undefined }),
    };
    setFeatures((items) => existingFeature ? items.map((item) => item.id === id ? feature : item) : [...items, feature]);
    setSketches((items) => items.map((sketch) => sketch.id === featureDraft.sketchId ? { ...sketch, visible: false } : sketch));
    setSelectedFeatureId(id); setSelectedSketchId(null); closeFeatureEditor(); setKernelMessage(null);
  };

  const createBodyFeature = () => {
    if (!bodyFeatureDraft) return;
    if ((bodyFeatureDraft.type === "fillet" || bodyFeatureDraft.type === "chamfer") && !bodyFeatureDraft.edgeIndices.length) return;
    if (bodyFeatureDraft.type === "draft" && !bodyFeatureDraft.faceIndices.length) return;
    if (bodyFeatureDraft.type === "shell" && !bodyFeatureDraft.faceIndices.length) return;
    const existingFeature = editingFeatureId ? features.find((feature) => feature.id === editingFeatureId) : undefined;
    const index = existingFeature ? features.findIndex((feature) => feature.id === existingFeature.id) + 1 : features.filter((feature) => feature.type === bodyFeatureDraft.type).length + 1;
    const label = bodyFeatureDraft.type === "fillet" ? "Fillet" : bodyFeatureDraft.type === "chamfer" ? "Chamfer" : bodyFeatureDraft.type === "draft" ? "Draft" : "Shell";
    const feature: FeatureRecord = {
      id: existingFeature?.id ?? `${bodyFeatureDraft.type}-${crypto.randomUUID()}`,
      name: existingFeature?.name ?? `${label} ${index}`,
      type: bodyFeatureDraft.type,
      targetBodyId: bodyFeatureDraft.targetBodyId,
      ...(bodyFeatureDraft.type === "fillet" ? { edgeIndices: bodyFeatureDraft.edgeIndices, radius: bodyFeatureDraft.radius }
        : bodyFeatureDraft.type === "chamfer" ? { edgeIndices: bodyFeatureDraft.edgeIndices, method: bodyFeatureDraft.method, distance: bodyFeatureDraft.distance, distance2: bodyFeatureDraft.distance2, angle: bodyFeatureDraft.angle, flip: bodyFeatureDraft.flip }
        : bodyFeatureDraft.type === "draft" ? { neutralFaceIndex: bodyFeatureDraft.neutralFaceIndex, faceIndices: bodyFeatureDraft.faceIndices, angle: bodyFeatureDraft.angle, reverse: bodyFeatureDraft.reverse }
        : { faceIndices: bodyFeatureDraft.faceIndices, thickness: bodyFeatureDraft.thickness, outward: bodyFeatureDraft.outward }),
    };
    setFeatures((items) => existingFeature ? items.map((item) => item.id === feature.id ? feature : item) : [...items, feature]);
    setSelectedFeatureId(feature.id); setSelectedSketchId(null); setSelectedEdges([]); setSelectedFace(null); closeFeatureEditor(); setKernelMessage(null);
  };

  const deleteFromTree = (type: "sketch" | "feature", id: string) => {
    if (type === "feature") {
      const index = features.findIndex((feature) => feature.id === id); const removed = features.slice(index); const removedBodies = new Set(removed.map((feature) => feature.bodyId).filter(Boolean));
      setFeatures((items) => items.slice(0, index)); setSketches((items) => items.filter((sketch) => !(typeof sketch.plane !== "string" && removedBodies.has(sketch.plane.bodyId))));
      setSelectedFeatureId(null); if (selectedBodyId && removedBodies.has(selectedBodyId)) setSelectedBodyId(null);
    } else {
      const firstDependent = features.findIndex((feature) => feature.sketchId === id);
      setSketches((items) => items.filter((sketch) => sketch.id !== id)); if (firstDependent >= 0) setFeatures((items) => items.slice(0, firstDependent)); setSelectedSketchId(null); if (editingSketchId === id) setEditingSketchId(null);
    }
    setContextMenu(null);
  };
  const saveRename = () => {
    if (!renameDialog?.value.trim()) return;
    if (renameDialog.type === "feature") setFeatures((items) => items.map((feature) => feature.id === renameDialog.id ? { ...feature, name: renameDialog.value.trim() } : feature));
    else setFeatures((items) => items.map((feature) => feature.bodyId === renameDialog.id ? { ...feature, bodyName: renameDialog.value.trim() } : feature));
    setRenameDialog(null);
  };
  const openContext = (event: React.MouseEvent, type: "sketch" | "feature" | "reference" | "body", id: string) => {
    event.preventDefault(); event.stopPropagation();
    const width = 224; const height = type === "sketch" || type === "feature" ? 190 : 150;
    setContextMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)), type, id });
  };

  const saveProject = () => download("untitled.lucascad.json", JSON.stringify({ schemaVersion: 2, units: "mm", ...cadDocument }, null, 2), "application/json");
  const exportStep = async () => {
    try {
      const response = await fetch(`${API}/api/export/document.step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cadDocument) });
      if (!response.ok) { const error = await response.json().catch(() => null) as { detail?: string } | null; setKernelMessage(error?.detail ?? "STEP export failed"); return; }
      const link = document.createElement("a"); link.href = URL.createObjectURL(await response.blob()); link.download = "lucascad-document.step"; link.click(); URL.revokeObjectURL(link.href);
    } catch (error) {
      setKernelStatus("offline");
      setKernelMessage(error instanceof Error ? error.message : "STEP export service is unavailable");
    }
  };

  return <main className="cad-shell" onPointerDown={() => { if (contextMenu) setContextMenu(null); if (settingsOpen) setSettingsOpen(false); }}>
    <header className="titlebar">
      <div className="brand-mark">L</div><strong>LucasCad</strong><span className="document-name">Untitled Part</span>
      <span className={`kernel-pill ${kernelStatus}`}><i />{kernelStatus === "ready" ? "Document ready" : kernelStatus === "error" ? "Rebuild failed" : kernelStatus === "offline" ? "Kernel offline" : "Rebuilding"}</span>
      <div className="title-actions">
        <div className="settings-control" onPointerDown={(event) => event.stopPropagation()}>
          <button className={`settings-button ${settingsOpen ? "active" : ""}`} aria-label="Settings" aria-haspopup="dialog" aria-expanded={settingsOpen} title="Global settings" onClick={() => setSettingsOpen((open) => !open)}><span aria-hidden="true">⚙</span></button>
          {settingsOpen && <div className="settings-menu" role="dialog" aria-label="Global settings">
            <header><div><strong>Settings</strong><small>Global application preferences</small></div><button aria-label="Close settings" onClick={() => setSettingsOpen(false)}>×</button></header>
            <section className="settings-section">
              <label htmlFor="dimension-text-scale"><span>Sketch dimension text &amp; boxes</span><output>{Math.round(globalSettings.sketchDimensionTextScale * 100)}%</output></label>
              <input id="dimension-text-scale" aria-label="Sketch dimension text size" type="range" min="25" max="150" step="5" value={Math.round(globalSettings.sketchDimensionTextScale * 100)} onChange={(event) => updateGlobalSettings({ ...globalSettings, sketchDimensionTextScale: Number(event.target.value) / 100 })}/>
              <p>Dimension labels, value text, and editing boxes.</p>
            </section>
            <section className="settings-section">
              <label htmlFor="node-diameter"><span>Sketch node diameter</span><output>{globalSettings.sketchNodeDiameterPx.toFixed(1)} px</output></label>
              <input id="node-diameter" aria-label="Sketch node diameter" type="range" min="2" max="12" step="0.5" value={globalSettings.sketchNodeDiameterPx} onChange={(event) => updateGlobalSettings({ ...globalSettings, sketchNodeDiameterPx: Number(event.target.value) })}/>
              <p>Diameter of the orange and blue sketch nodes.</p>
            </section>
            <section className="settings-section">
              <label htmlFor="highlight-width"><span>Sketch hover highlight</span><output>{globalSettings.sketchHighlightWidthPx.toFixed(1)} px</output></label>
              <input id="highlight-width" aria-label="Sketch highlight width" type="range" min="0.5" max="4" step="0.1" value={globalSettings.sketchHighlightWidthPx} onChange={(event) => updateGlobalSettings({ ...globalSettings, sketchHighlightWidthPx: Number(event.target.value) })}/>
              <p>Highlight width for all hovered and selected sketch geometry, nodes, dimensions, constraints, references, and axes. Click targets remain generous.</p>
            </section>
            <section className="settings-section compact-setting">
              <label htmlFor="grid-square-size"><span>Default grid square</span><div className="setting-number"><BufferedNumberInput id="grid-square-size" aria-label="Default grid square size" inputMode="decimal" min={globalSettings.unitSystem === "imperial" ? 0.01 : 0.1} step={globalSettings.unitSystem === "imperial" ? 0.01 : 0.1} value={Number(fromMillimeters(globalSettings.sketchGridSizeMm, globalSettings.unitSystem).toFixed(4))} onValidValue={(value) => updateGlobalSettings({ ...globalSettings, sketchGridSizeMm: Math.max(0.1, toMillimeters(value, globalSettings.unitSystem)) })}/><span>{unitSuffix(globalSettings.unitSystem)}</span></div></label>
              <p>Sets both the visible minor grid and grid snapping interval.</p>
            </section>
            <section className="settings-section compact-setting"><div className="setting-label"><span>Display units</span><div className="unit-switch" role="group" aria-label="Display units"><button className={globalSettings.unitSystem === "metric" ? "active" : ""} aria-pressed={globalSettings.unitSystem === "metric"} onClick={() => updateGlobalSettings({ ...globalSettings, unitSystem: "metric" })}>Metric</button><button className={globalSettings.unitSystem === "imperial" ? "active" : ""} aria-pressed={globalSettings.unitSystem === "imperial"} onClick={() => updateGlobalSettings({ ...globalSettings, unitSystem: "imperial" })}>Imperial</button></div></div><p>Changes displayed and entered lengths; model geometry remains exact.</p></section>
            <footer><button onClick={() => updateGlobalSettings(DEFAULT_GLOBAL_SETTINGS)}>Reset defaults</button></footer>
          </div>}
        </div>
        <button onClick={saveProject}>Save</button><button className="export-action" disabled={!properties?.solidCount} onClick={exportStep}>Export STEP</button>
      </div>
    </header>
    <nav className="ribbon" aria-label="Modeling tools">
      <section className="model-command-group"><b>Create</b><div><button className={`tool ${editingSketchId || sketchSupportPicking ? "active" : ""}`} onClick={requestNewSketch}><span className="tool-icon sketch-icon" />{sketchSupportPicking ? "Select Support" : "New Sketch"}</button><button className={`tool ${profileDialog === "extrude" ? "active" : ""}`} onClick={() => requestFeature("extrude")}><span className="tool-icon extrude-icon" />Extrude</button><button className={`tool ${profileDialog === "revolve" ? "active" : ""}`} onClick={() => requestFeature("revolve")}><span className="tool-icon revolve-icon" />Revolve</button></div></section>
      <section className="model-command-group"><b>Modify</b><div><button className={`tool ${bodyFeatureTool === "fillet" ? "active" : ""}`} disabled={!bodyIds.length} title="Round selected solid edges" onClick={() => requestBodyFeature("fillet")}><span className="tool-icon fillet-icon" />Fillet</button><button className={`tool ${bodyFeatureTool === "chamfer" ? "active" : ""}`} disabled={!bodyIds.length} title="Bevel selected solid edges" onClick={() => requestBodyFeature("chamfer")}><span className="tool-icon chamfer-icon" />Chamfer</button><button className={`tool ${bodyFeatureTool === "draft" ? "active" : ""}`} disabled={!bodyIds.length} title="Taper faces from a neutral plane" onClick={() => requestBodyFeature("draft")}><span className="tool-icon draft-icon" />Draft</button><button className={`tool ${bodyFeatureTool === "shell" ? "active" : ""}`} disabled={!bodyIds.length} title="Hollow a solid and remove selected opening faces" onClick={() => requestBodyFeature("shell")}><span className="tool-icon shell-icon" />Shell</button></div></section>
      <section className="model-command-group geometry-command-group"><b>Geometry</b><div><button className={`tool ${referenceDraft?.type === "plane" ? "active" : ""}`} title="Create an offset or coincident reference plane" onClick={() => requestReferenceGeometry("plane")}><span className="tool-icon ref-plane-icon" />Plane</button><button className={`tool ${referenceDraft?.type === "axis" ? "active" : ""}`} title="Create an axis from any edge or the center of a circular or toroidal face" onClick={() => requestReferenceGeometry("axis")}><span className="tool-icon ref-axis-icon" />Axis</button><button className={`tool ${referenceDraft?.type === "point" ? "active" : ""}`} title="Create a point from a face center, edge midpoint, or XYZ values" onClick={() => requestReferenceGeometry("point")}><span className="tool-icon ref-point-icon" />Point</button></div></section>
      <section className="model-command-group view-command-group"><b>View</b><div><button className="tool" title="Fit the complete model to the current view (F)" aria-label="Fit model to view" onClick={() => setFitViewRequest((request) => request + 1)}><span className="tool-icon fit-view-icon">⌗</span>Fit <kbd>F</kbd></button></div></section>
      <span className="ribbon-rule" /><button className="tool muted" disabled>Undo</button><button className="tool muted" disabled>Redo</button>
    </nav>
    <section className={`workspace ${propertiesCollapsed ? "properties-collapsed" : ""}`}>
      <aside className="feature-panel"><div className="panel-heading"><strong>Feature tree</strong><button aria-label="Tree options">•••</button></div><div className="tree-row root"><span className="twisty">⌄</span><span className="part-icon">◩</span>Untitled Part</div><div className="tree-row child"><span className="twisty">⌄</span><span className="origin-icon">⊕</span>Origin</div><div className={`tree-row grandchild tree-feature-item origin-display-item ${originCsyVisible ? "" : "hidden-feature"}`}><input className="tree-visibility" type="checkbox" checked={originCsyVisible} aria-label={`${originCsyVisible ? "Hide" : "Show"} CSY`} title={`${originCsyVisible ? "Hide" : "Show"} CSY`} onChange={() => setOriginCsyVisible((visible) => !visible)} /><button type="button" className="tree-button" onClick={() => { setSelectedPlane(null); setSelectedFace(null); setSelectedBodyId(null); setSelectedSketchId(null); setSelectedFeatureId(null); setSketchSupportPicking(false); }}><span className="csy-icon">⊹</span>CSY</button></div>{(["XY", "XZ", "YZ"] as const).map((plane, index) => <div key={plane} className={`tree-row grandchild tree-feature-item origin-display-item ${selectedPlane === plane ? "selected" : ""} ${sketchSupportPicking ? "support-choice" : ""} ${originPlanesVisible[plane] ? "" : "hidden-feature"}`}><input className="tree-visibility" type="checkbox" checked={originPlanesVisible[plane]} aria-label={`${originPlanesVisible[plane] ? "Hide" : "Show"} ${plane} Plane`} title={`${originPlanesVisible[plane] ? "Hide" : "Show"} ${plane} Plane`} onChange={() => toggleOriginPlaneVisibility(plane)} /><button type="button" className="tree-button" onClick={() => { if (sketchSupportPicking) startSketchOnPlane(plane); else { setSelectedPlane(plane); setSelectedFace(null); setSelectedBodyId(null); setSelectedSketchId(null); setSelectedFeatureId(null); } }}><span className={`plane plane-${index === 0 ? "blue" : index === 1 ? "green" : "red"}`} />{plane} Plane</button></div>)}
        {referenceGeometry.length > 0 && <div className="tree-row child reference-folder"><span className="twisty">⌄</span><span className="reference-folder-icon">⌖</span>Reference Geometry <small className="tree-support">{referenceGeometry.length}</small></div>}
        {referenceGeometry.map((reference) => <div key={reference.id} className={`tree-row grandchild tree-feature-item reference-tree-item ${selectedReferenceId === reference.id ? "selected" : ""} ${sketchSupportPicking && reference.type === "plane" ? "support-choice" : ""} ${reference.visible === false ? "hidden-feature" : ""}`}><input className="tree-visibility" type="checkbox" checked={reference.visible !== false} aria-label={`${reference.visible === false ? "Show" : "Hide"} ${reference.name}`} title={`${reference.visible === false ? "Show" : "Hide"} ${reference.name}`} onChange={() => toggleReferenceVisibility(reference.id)} /><button type="button" className="tree-button context-enabled" onClick={() => { if (sketchSupportPicking && reference.type === "plane") { startSketchOnPlane({ kind: "reference-plane", referenceId: reference.id }); return; } selectReferenceInModel(reference.id); }} onDoubleClick={() => editReferenceGeometry(reference.id)} onContextMenu={(event) => openContext(event, "reference", reference.id)}><span className={`reference-tree-icon reference-${reference.type}`}>{reference.type === "plane" ? "▱" : reference.type === "axis" ? "╎" : "•"}</span>{reference.name}<small className="tree-support">{reference.sourceLabel}</small></button></div>)}
        {bodyIds.length > 0 && <div className="tree-row child body-folder"><span className="twisty">⌄</span><span className="body-icon">◫</span>Solid Bodies <small className="tree-support">{bodyIds.length}</small></div>}
        {sketches.map((sketch) => { const profileCandidate = Boolean(profileDialog) && eligibleProfileSketchIds.includes(sketch.id); const selectedRow = selectedSketchId === sketch.id || editingSketchId === sketch.id; return <div key={sketch.id} className={`tree-row child tree-feature-item ${selectedRow ? "selected" : ""} ${profileCandidate ? "profile-choice" : ""} ${sketch.visible === false ? "hidden-feature" : ""}`}><input className="tree-visibility" type="checkbox" checked={sketch.visible !== false} aria-label={`${sketch.visible === false ? "Show" : "Hide"} ${sketch.name}`} title={`${sketch.visible === false ? "Show" : "Hide"} ${sketch.name}`} onChange={() => toggleSketchVisibility(sketch.id)} /><button type="button" className="tree-button context-enabled" aria-label={profileCandidate ? `${sketch.name}, select for ${profileDialog}` : sketch.name} onClick={() => { if (profileDialog) { if (profileCandidate) void selectProfile(sketch, profileDialog); return; } setSelectedReferenceId(null); setSelectedSketchId(sketch.id); setSelectedFeatureId(null); setSelectedBodyId(null); setSelectedPlane(null); setSketchSupportPicking(false); }} onDoubleClick={() => { if (!profileDialog) editSketch(sketch.id); }} onContextMenu={(event) => openContext(event, "sketch", sketch.id)}><span className="feature-icon">▱</span>{sketch.name}<small className="tree-support">{typeof sketch.plane === "string" ? sketch.plane : sketch.plane.kind === "reference-plane" ? referenceGeometry.find((reference) => reference.id === sketch.plane.referenceId)?.name ?? "Plane" : `F${sketch.plane.faceIndex}`}</small></button></div>; })}
        {features.map((feature) => <div key={feature.id} className="feature-tree-block">
          <div className={`tree-row child tree-feature-item ${selectedFeatureId === feature.id ? "selected" : ""} ${feature.visible === false ? "hidden-feature" : ""}`}>
            <input className="tree-visibility" type="checkbox" checked={feature.visible !== false} aria-label={`${feature.visible === false ? "Show" : "Hide"} ${feature.name}`} title={`${feature.visible === false ? "Show" : "Hide"} ${feature.name}`} onChange={() => toggleFeatureVisibility(feature.id)} />
            <button type="button" className="tree-button context-enabled" onClick={() => { setSelectedFeatureId(feature.id); setSelectedReferenceId(null); setSelectedSketchId(null); setSelectedEdges([]); setSelectedBodyId(null); setSelectedPlane(null); setSketchSupportPicking(false); }} onDoubleClick={() => editFeature(feature.id)} onContextMenu={(event) => openContext(event, "feature", feature.id)}><span className={`feature-icon feature-${feature.type}`}>{featureGlyph(feature)}</span>{feature.name}<small className="tree-support">{featureSummary(feature, globalSettings.unitSystem)}</small></button>
          </div>
          {feature.combine === "new" && feature.bodyId && <button className={`tree-row grandchild tree-button body-row operation-body-row ${selectedBodyId === feature.bodyId ? "selected" : ""}`} aria-label={bodyName(feature.bodyId)} onClick={() => { setSelectedBodyId(feature.bodyId!); setSelectedReferenceId(null); setSelectedFace(null); setSelectedPlane(null); setSelectedSketchId(null); setSelectedFeatureId(null); setSketchSupportPicking(false); }} onContextMenu={(event) => openContext(event, "body", feature.bodyId!)}><span className="body-icon">▰</span>{bodyName(feature.bodyId)}<small className="tree-support">from {feature.name}</small></button>}
        </div>)}
      </aside>
      <section className={`viewport ${editingSketch ? "sketch-mode" : ""}`} aria-label={editingSketch ? "Parametric 2D sketcher" : "Interactive 3D viewport"}>
        <div className="view-label">{editingSketch ? sketchViewRotated ? "SKETCH 3D VIEW · SNAP NORMAL TO CONTINUE EDITING" : `NORMAL TO ${planeLabel(editingSketch.plane).toUpperCase()} · BODIES VISIBLE` : "ISOMETRIC · SKETCHES SHOWN IN AMBER"}</div>
        <CadViewport document={{ ...(editingSketch ? sketchViewDocument ?? cadDocument : editingFeatureId ? featurePreviewDocument : cadDocument), referenceGeometry: referenceGeometryForViewport }} editingSketchId={editingSketchId} editingSketch={editingSketch} sketchView={sketchView} snapNormalRequest={snapNormalRequest} fitViewRequest={fitViewRequest} sketchSupportPicking={sketchSupportPicking} featurePreview={activeFeaturePreview} selectedBodyId={selectedBodyId} selectedEdgeIds={selectedEdges.map((edge) => edge.id)} selectedFaceIds={selectedDraftFaceIds.length ? selectedDraftFaceIds : selectedFace ? [selectedFace.id] : []} solidSelectionMode={solidSelectionMode} selectedPlane={selectedPlane} showModelGrid={showModelGrid} originCsyVisible={originCsyVisible} originPlanesVisible={originPlanesVisible} highlightedSketchId={selectedSketchId} selectableSketchIds={!editingSketch && profileDialog ? eligibleProfileSketchIds : null} revolveAxisPicking={revolveAxisPicking} selectedRevolveAxis={featureDraft?.type === "revolve" && featureDraft.axis && typeof featureDraft.axis === "object" ? featureDraft.axis : null} highlightedFeatureId={editingFeatureId ? null : selectedFeatureId} selectedReferenceId={referenceDraft?.type === "axis" ? editingReferenceId ?? "reference-axis-preview" : selectedReferenceId} referencePlanePicking={!editingSketch && referenceDraft?.type === "plane"} referenceAxisPicking={!editingSketch && referenceDraft?.type === "axis"} referencePlanePreview={referenceDraft?.type === "plane" ? { referenceId: editingReferenceId ?? "reference-plane-preview", baseOrigin: referenceDraft.baseOrigin, normal: referenceDraft.normal, offset: referenceDraft.offset } : null} onSketchViewChange={setSketchView} onSketchRotatedChange={setSketchViewRotated} onExternalReferencesChange={setExternalSketchReferences} onSelectSketch={selectProfileById} onSelectPlane={startSketchOnPlane} onSelectReferencePlane={selectReferencePlaneForSketch} onSelectReference={selectReferenceInModel} onSelectRevolveAxis={selectRevolveAxis} onReferencePlaneOffsetChange={updateReferencePlaneOffsetFromArrow} onFeaturePreviewDistanceChange={updateExtrusionDistanceFromArrow} onChamferPreviewParameterChange={updateChamferParameterFromArrow} onSelectEdge={onSelectEdge} onSelectFace={onSelectFace} onStatus={onStatus} />
        {editingSketch && <Sketcher key={editingSketch.id} entities={editingSketch.entities} constraints={editingSketch.constraints} externalReferences={externalSketchReferences} dimensionOffsets={editingSketch.dimensionOffsets} dimensionTextScale={globalSettings.sketchDimensionTextScale} nodeDiameterPx={globalSettings.sketchNodeDiameterPx} highlightWidthPx={globalSettings.sketchHighlightWidthPx} gridSquareSize={globalSettings.sketchGridSizeMm} unitSystem={globalSettings.unitSystem} onChange={updateEditingSketch} onConstraintsChange={updateSketchConstraints} onDimensionOffsetsChange={updateDimensionOffsets} onFinish={finishSketch} view={sketchView} viewRotated={sketchViewRotated} onSnapNormal={snapSketchNormal} />}
        {!editingSketch && sketchSupportPicking && <div className="support-pick-callout"><strong>Select sketch support</strong><span>Click a translucent origin plane in 3D, reference plane, or planar body face in 3D or the feature tree · Esc to cancel</span></div>}
        {!editingSketch && profileDialog && <div className="support-pick-callout profile-pick-callout"><strong>Select a highlighted sketch to {profileDialog}</strong><span>Click its geometry in 3D or its highlighted feature-tree row · Esc to cancel</span></div>}
        {!editingSketch && revolveAxisPicking && <div className="support-pick-callout profile-pick-callout axis-pick-callout"><strong>Select the revolve axis</strong><span>Click a highlighted straight sketch line, straight solid edge, or red/green/blue origin axis</span></div>}
        {!editingSketch && referenceDraft?.type === "plane" && <div className="support-pick-callout reference-plane-pick-callout"><strong>Select any planar reference</strong><span>Click any highlighted flat body face or existing reference plane · drag the cyan arrows for signed offset</span></div>}
        {!editingSketch && referenceDraft?.type === "axis" && <div className="support-pick-callout reference-plane-pick-callout axis-reference-pick-callout"><strong>Select an edge or axial surface</strong><span>Any edge defines an axis · cylinders, cones, and toroidal faces use their center axis</span></div>}
        {!editingSketch && bodyFeatureTool && <div className="support-pick-callout solid-feature-callout"><strong>{bodyFeatureTool === "draft" ? solidSelectionMode === "draft-neutral" ? "Select neutral face" : "Select faces to draft" : bodyFeatureTool === "shell" ? "Select faces to remove" : `Select edges to ${bodyFeatureTool}`}</strong><span>{bodyFeatureTool === "draft" ? solidSelectionMode === "draft-neutral" ? "Click a planar face that stays fixed" : "Click one or more side faces · selected faces turn cyan · parallel faces are excluded" : bodyFeatureTool === "shell" ? "Click one or more opening faces · click again to remove · preview updates immediately" : "Click edges; Shift-click or keep clicking to add more"} · Esc to cancel</span></div>}
        {!editingSketch && !sketchSupportPicking && !bodyFeatureTool && selectedFace && <div className="selection-callout">Selected {selectedFace.planar ? "planar" : selectedFace.geometryType?.toLowerCase() ?? "curved"} face <span>{selectedFace.bodyId} · face {selectedFace.faceIndex}</span></div>}
        {!editingSketch && !bodyFeatureTool && selectedEdges.length > 0 && <div className="selection-callout">{selectedEdges.length} selected edge{selectedEdges.length === 1 ? "" : "s"}<span>Choose Fillet or Chamfer</span></div>}
        {!editingSketch && kernelMessage && <div className="model-error"><strong>Document rebuild failed</strong><span>{kernelMessage}</span></div>}
        {!editingSketch && <div className="viewport-help">{bodyFeatureTool ? bodyFeatureTool === "draft" ? solidSelectionMode === "draft-neutral" ? "Neutral plane: choose the fixed planar face" : "Faces to draft: click highlighted side faces; parallel faces are not selectable" : bodyFeatureTool === "shell" ? "Faces to remove: click each opening face; all other faces become uniform walls" : "Edges highlight under the pointer; click to toggle selection" : profileDialog ? eligibleProfileSketchIds.length ? "Highlighted sketches are available for profile selection" : "No sketch geometry is available; create and exit a sketch first" : sketchSupportPicking ? "Planar faces and origin planes are ready for sketch placement" : "Preselect geometry or choose a feature command"}</div>}
        {!editingSketch && <button type="button" className={`model-grid-toggle ${showModelGrid ? "active" : ""}`} aria-label={`${showModelGrid ? "Hide" : "Show"} model space grid`} aria-pressed={showModelGrid} title={`${showModelGrid ? "Hide" : "Show"} model space grid`} onClick={toggleModelGrid}><span className="model-grid-icon" /></button>}
      </section>
      <button type="button" className="properties-collapse-toggle" aria-label={propertiesCollapsed ? "Show properties panel" : "Hide properties panel"} aria-pressed={propertiesCollapsed} title={propertiesCollapsed ? "Show properties panel" : "Hide properties panel"} onClick={() => setPropertiesCollapsed((collapsed) => !collapsed)}>{propertiesCollapsed ? "<<" : ">>"}</button>
      <aside className="properties-panel">
        {editingSketch && <><div className="panel-heading"><strong>{editingSketch.name}</strong><span className="feature-state">Editing</span></div><div className="sketch-inspector"><h3>Sketch support</h3><div><span>▱</span>{planeLabel(editingSketch.plane)}{editingSketch.flipped ? " · flipped" : ""}</div><button className="edit-profile" onClick={() => setPlaneDialog({ mode: "edit", sketchId: editingSketch.id })}>Change plane or face</button><button className={`edit-profile flip-plane-action ${editingSketch.flipped ? "active" : ""}`} aria-pressed={editingSketch.flipped ?? false} title="Reverse the sketch normal without moving its geometry" onClick={() => flipSketchPlane(editingSketch.id)}><span>⇅</span> Flip Plane</button><h3>Editing</h3><p>Select an entity to expose its control points, then drag those points to reshape the profile.</p><strong>{editingSketch.entities.length} sketch entities</strong><button className="primary-wide" onClick={finishSketch}>✓ Exit sketch</button></div></>}
        {!editingSketch && selectedReference && <><div className="panel-heading"><strong>{selectedReference.name}</strong><span className="feature-state">Reference {selectedReference.type}</span></div><div className="sketch-inspector"><h3>Definition</h3><div><span>{selectedReference.type === "plane" ? "▱" : selectedReference.type === "axis" ? "╎" : "•"}</span>{selectedReference.sourceLabel}</div><p>{selectedReference.type === "plane" ? "Available as sketch support." : selectedReference.type === "axis" ? "Available as a revolve axis." : "Persistent construction point in model space."}</p><button className="edit-profile" onClick={() => editReferenceGeometry(selectedReference.id)}>Edit reference geometry</button>{selectedReference.type === "plane" && <button className="primary-wide" onClick={() => startSketchOnPlane({ kind: "reference-plane", referenceId: selectedReference.id })}>New sketch on plane</button>}</div></>}
        {!editingSketch && !selectedReference && selectedSketch && <><div className="panel-heading"><strong>{selectedSketch.name}</strong><span className="feature-state">3D sketch</span></div><div className="sketch-inspector"><h3>Support</h3><div><span>▱</span>{planeLabel(selectedSketch.plane)}{selectedSketch.flipped ? " · flipped" : ""}</div><button className="edit-profile" onClick={() => setPlaneDialog({ mode: "edit", sketchId: selectedSketch.id })}>Change plane or face</button><button className={`edit-profile flip-plane-action ${selectedSketch.flipped ? "active" : ""}`} aria-pressed={selectedSketch.flipped ?? false} title="Reverse the sketch normal without moving its geometry" onClick={() => flipSketchPlane(selectedSketch.id)}><span>⇅</span> Flip Plane</button><button className="edit-profile" onClick={() => editSketch(selectedSketch.id)}>Edit sketch geometry</button><button className="primary-wide" onClick={() => requestFeature("extrude")}>Create feature</button></div></>}
        {!editingSketch && selectedFeature && <><div className="panel-heading"><strong>{selectedFeature.name}</strong><span className="feature-state">{selectedFeature.type}</span></div><div className="sketch-inspector">{selectedFeature.type === "extrude" || selectedFeature.type === "revolve" ? <><h3>Profile</h3><p>{sketches.find((sketch) => sketch.id === selectedFeature.sketchId)?.name}</p><h3>Result</h3><p>{selectedFeature.combine === "new" && selectedFeature.bodyId ? bodyName(selectedFeature.bodyId) : `${selectedFeature.combine} with ${bodyName(selectedFeature.targetBodyId ?? "")}`}</p></> : <><h3>Target</h3><p>{bodyName(selectedFeature.targetBodyId ?? "")}</p><h3>Parameters</h3><p>{selectedFeature.type === "fillet" ? `${selectedFeature.edgeIndices?.length ?? 0} edges · ${featureSummary(selectedFeature, globalSettings.unitSystem)}` : selectedFeature.type === "chamfer" ? `${selectedFeature.edgeIndices?.length ?? 0} edges · ${featureSummary(selectedFeature, globalSettings.unitSystem)}` : selectedFeature.type === "shell" ? `${selectedFeature.faceIndices?.length ?? 0} opening faces · ${featureSummary(selectedFeature, globalSettings.unitSystem)}` : `${selectedFeature.faceIndices?.length ?? 0} faces · ${selectedFeature.angle ?? 0}°`}</p></>}<button className="edit-profile" onClick={() => editFeature(selectedFeature.id)}>Edit feature</button></div></>}
        {!editingSketch && !selectedReference && !selectedSketch && !selectedFeature && selectedBodyId && bodyFeatureTool && <><div className="panel-heading"><strong>{bodyFeatureTool === "fillet" ? "Fillet" : bodyFeatureTool === "chamfer" ? "Chamfer" : bodyFeatureTool === "draft" ? "Draft" : "Shell"} selection</strong><span className="feature-state">{bodyName(selectedBodyId)}</span></div><div className="body-properties"><h3>Graphics selection</h3><div className="body-stat"><span>{bodyFeatureTool === "draft" || bodyFeatureTool === "shell" ? "Faces" : "Edges"}</span><strong>{bodyFeatureTool === "draft" ? bodyFeatureDraft?.type === "draft" ? bodyFeatureDraft.faceIndices.length : 0 : bodyFeatureTool === "shell" ? bodyFeatureDraft?.type === "shell" ? bodyFeatureDraft.faceIndices.length : 0 : selectedEdges.length}</strong></div><p>{bodyFeatureTool === "draft" ? solidSelectionMode === "draft-neutral" ? "Choose the planar face that remains fixed." : "Choose each face that should taper away from the neutral face." : bodyFeatureTool === "shell" ? "Choose each face to remove as an opening. The remaining faces become uniform walls." : "Choose one or more solid edges. Selected edges remain highlighted while the preview is active."}</p></div></>}
        {!editingSketch && !selectedReference && !selectedSketch && !selectedFeature && selectedBodyId && !bodyFeatureTool && <><div className="panel-heading"><strong>{bodyName(selectedBodyId)}</strong><span className="feature-state">Solid body</span></div><div className="body-properties"><h3>Body contents</h3><div className="body-stat"><span>Features</span><strong>{selectedBodyFeatures.length}</strong></div><div className="body-stat"><span>Status</span><strong>Selectable solid</strong></div><p>{selectedFace ? selectedFace.planar ? `Face ${selectedFace.faceIndex} is selected. Create a sketch to attach it to that planar surface.` : `${selectedFace.geometryType?.toLowerCase() ?? "Curved"} face ${selectedFace.faceIndex} is selected. Use Axis to capture its center axis when available.` : "Select a planar face in the 3D viewport to create a supported sketch."}</p>{selectedFace?.planar && <button className="primary-wide" onClick={() => startSketchOnPlane({ kind: "face", bodyId: selectedFace.bodyId, faceIndex: selectedFace.faceIndex, faceId: selectedFace.id })}>New sketch on selected face</button>}</div></>}
        {!editingSketch && !selectedReference && !selectedSketch && !selectedFeature && !selectedBodyId && <div className="empty-tool"><h2>Model workspace</h2><p>Create a sketch, draw a profile, exit the sketch, then choose Extrude or Revolve.</p></div>}
      </aside>
    </section>
    <footer className="statusbar"><span>{kernelMessage ?? (editingSketch ? `Editing ${editingSketch.name}` : bodyFeatureTool ? bodyFeatureTool === "draft" ? solidSelectionMode === "draft-neutral" ? "Draft: select the neutral face" : "Draft: select faces to taper" : bodyFeatureTool === "shell" ? "Shell: select faces to remove" : `${bodyFeatureTool}: select one or more edges` : profileDialog ? `Select a highlighted sketch to ${profileDialog} · 3D or feature tree` : sketchSupportPicking ? "Select a planar face or origin plane for the new sketch" : "Ready")}</span><span>{properties ? `${properties.bodyCount} bodies · ${properties.solidCount} solids · ${sketches.length} sketches` : `${sketches.length} sketches`}</span><span>{globalSettings.unitSystem === "imperial" ? "IPS (inch)" : "MMGS (millimeter)"}</span></footer>

    {planeDialog && <div className="modal-backdrop"><div className="cad-dialog plane-dialog"><header><strong>{planeDialog.mode === "new" ? "Create new sketch" : "Change sketch support"}</strong><button onClick={() => setPlaneDialog(null)}>×</button></header><p>Choose an origin plane, reference plane, or selected planar body surface.</p><div className="plane-options"><button onClick={() => choosePlane("XY")}><i className="plane plane-blue"/>XY Plane<small>Top</small></button><button onClick={() => choosePlane("XZ")}><i className="plane plane-green"/>XZ Plane<small>Front</small></button><button onClick={() => choosePlane("YZ")}><i className="plane plane-red"/>YZ Plane<small>Right</small></button>{referenceGeometry.filter((reference): reference is ReferencePlaneRecord => reference.type === "plane").map((reference) => <button key={reference.id} className="reference-plane-choice" onClick={() => choosePlane({ kind: "reference-plane", referenceId: reference.id })}><i>▱</i>{reference.name}<small>{reference.sourceLabel}</small></button>)}{selectedFace && <button className="face-choice" onClick={() => choosePlane({ kind: "face", bodyId: selectedFace.bodyId, faceIndex: selectedFace.faceIndex, faceId: selectedFace.id })}><i>▰</i>Selected face<small>{selectedFace.bodyId} · F{selectedFace.faceIndex}</small></button>}</div>{!selectedFace && <div className="dialog-hint">To use a body surface, cancel this dialog, select a planar face in 3D, then click New Sketch again.</div>}</div></div>}
    {validationDialog && <div className="modal-backdrop"><div className="cad-dialog validation-dialog"><header><strong>Sketch is not closed</strong><button onClick={() => setValidationDialog(null)}>×</button></header><div className="validation-mark">!</div><p><strong>{validationDialog.sketch.name}</strong> cannot create a solid feature.</p><ul>{validationDialog.result.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>{validationDialog.result.openEndpoints.length > 0 && <div className="endpoint-list"><strong>Open endpoints</strong>{validationDialog.result.openEndpoints.map((point, index) => <span key={index}>#{index + 1}: X {point.x.toFixed(2)}, Y {point.y.toFixed(2)}</span>)}</div>}<div className="dialog-actions"><button onClick={() => setValidationDialog(null)}>Cancel</button><button className="primary" onClick={() => { editSketch(validationDialog.sketch.id); setValidationDialog(null); }}>Show and repair sketch</button></div></div></div>}
    {profileWarning && <div className="modal-backdrop"><div className="cad-dialog validation-dialog profile-warning-dialog"><header><strong>Fragile profile warning</strong><button onClick={() => setProfileWarning(null)}>×</button></header><div className="validation-mark">!</div><p><strong>{profileWarning.sketch.name}</strong> is closed, but may create an unstable or zero-thickness solid.</p><ul>{profileWarning.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><div className="dialog-actions"><button onClick={() => { editSketch(profileWarning.sketch.id); setProfileWarning(null); }}>Repair sketch</button><button className="primary" onClick={() => { beginFeatureDraft(profileWarning.sketch, profileWarning.type); setProfileWarning(null); }}>Continue anyway</button></div></div></div>}
    {renameDialog && <div className="modal-backdrop"><div className="cad-dialog rename-dialog" onPointerDown={(event) => event.stopPropagation()}><header><strong>Rename {renameDialog.type}</strong><button onClick={() => setRenameDialog(null)}>×</button></header><label>Name<input autoFocus value={renameDialog.value} onChange={(event) => setRenameDialog({ ...renameDialog, value: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") saveRename(); if (event.key === "Escape") setRenameDialog(null); }} /></label><div className="dialog-actions"><button onClick={() => setRenameDialog(null)}>Cancel</button><button className="primary" disabled={!renameDialog.value.trim()} onClick={saveRename}>Rename</button></div></div></div>}
    {referenceDraft && <div className="cad-dialog feature-dialog feature-flyout reference-geometry-flyout" onPointerDown={(event) => event.stopPropagation()}><header><strong>{editingReferenceId ? `Edit ${referenceGeometry.find((reference) => reference.id === editingReferenceId)?.name}` : `New reference ${referenceDraft.type}`}</strong><button onClick={() => { setReferenceDraft(null); setEditingReferenceId(null); setLivePlaneOffset(null); }}>×</button></header><div className="reference-definition"><span>{referenceDraft.type === "plane" ? "▱" : referenceDraft.type === "axis" ? "╎" : "•"}</span><div><strong>{referenceDraft.sourceLabel}</strong><small>{referenceDraft.type === "plane" ? "Parallel / coincident plane reference" : referenceDraft.type === "axis" ? "Linear axis reference" : "Model-space construction point"}</small></div></div>
      {referenceDraft.type === "plane" && <><div className="reference-field"><span>Quick reference</span><div className="reference-quick-options" role="group" aria-label="Plane quick reference">{(["XY", "XZ", "YZ"] as const).map((plane) => { const active = referenceDraft.sourceLabel === `${plane} origin plane`; return <button key={plane} type="button" className={active ? "active" : ""} aria-pressed={active} onClick={() => { const base = originPlaneFrame(plane); setLivePlaneOffset(null); setReferenceDraft({ ...referenceDraft, baseOrigin: base.origin, normal: base.normal, xDir: base.xDir, sourceLabel: `${plane} origin plane`, offset: 0, flip: false }); }}>{plane}</button>; })}</div></div><label>Signed offset distance<div className="input-with-unit"><BufferedNumberInput aria-label="Reference plane offset" step={globalSettings.unitSystem === "imperial" ? 0.05 : 1} value={fromMillimeters(livePlaneOffset ?? referenceDraft.offset, globalSettings.unitSystem)} onValidValue={(value) => { setLivePlaneOffset(null); setReferenceDraft({ ...referenceDraft, offset: toMillimeters(value, globalSettings.unitSystem) }); }}/><span>{lengthUnit}</span></div></label><div className="signed-offset-hint"><span>−</span> opposite normal <b>0</b> coincident <span>+</span> along normal</div><button type="button" className={`draft-direction ${referenceDraft.flip ? "reversed" : ""}`} onClick={() => setReferenceDraft({ ...referenceDraft, flip: !referenceDraft.flip })}><span>⇅</span><div><strong>Flip plane normal</strong><small>{referenceDraft.flip ? "Normal reversed" : "Original reference normal"}</small></div></button><div className="dialog-hint">Click any highlighted flat face or existing reference plane. The gold plane is a live preview; drag either cyan arrow to adjust its signed offset before applying.</div></>}
      {referenceDraft.type === "axis" && <><div className="reference-field"><span>Quick origin axis</span><div className="reference-quick-options" role="group" aria-label="Axis quick reference">{(["X", "Y", "Z"] as const).map((axis) => { const active = referenceDraft.sourceLabel === `Origin ${axis} axis`; return <button key={axis} type="button" className={active ? "active" : ""} aria-pressed={active} onClick={() => setReferenceDraft({ ...referenceDraft, origin: [0, 0, 0], direction: axis === "X" ? [1, 0, 0] : axis === "Y" ? [0, 1, 0] : [0, 0, 1], sourceLabel: `Origin ${axis} axis` })}>{axis}</button>; })}</div></div><div className="reference-coordinate-grid"><label>Direction X<BufferedNumberInput step="0.1" value={referenceDraft.direction[0]} onValidValue={(value) => setReferenceDraft({ ...referenceDraft, direction: [value, referenceDraft.direction[1], referenceDraft.direction[2]] })}/></label><label>Y<BufferedNumberInput step="0.1" value={referenceDraft.direction[1]} onValidValue={(value) => setReferenceDraft({ ...referenceDraft, direction: [referenceDraft.direction[0], value, referenceDraft.direction[2]] })}/></label><label>Z<BufferedNumberInput step="0.1" value={referenceDraft.direction[2]} onValidValue={(value) => setReferenceDraft({ ...referenceDraft, direction: [referenceDraft.direction[0], referenceDraft.direction[1], value] })}/></label></div><div className="dialog-hint">Click any highlighted edge for a coincident, center, or midpoint-tangent axis. Click a cylindrical, conical, or toroidal face to use its center axis. The amber line previews the result before creation.</div></>}
      {referenceDraft.type === "point" && <><div className="reference-coordinate-grid"><label>X<BufferedNumberInput value={displayedLength(referenceDraft.position[0])} onValidValue={(value) => setReferenceDraft({ ...referenceDraft, position: [toMillimeters(value, globalSettings.unitSystem), referenceDraft.position[1], referenceDraft.position[2]] })}/></label><label>Y<BufferedNumberInput value={displayedLength(referenceDraft.position[1])} onValidValue={(value) => setReferenceDraft({ ...referenceDraft, position: [referenceDraft.position[0], toMillimeters(value, globalSettings.unitSystem), referenceDraft.position[2]] })}/></label><label>Z<BufferedNumberInput value={displayedLength(referenceDraft.position[2])} onValidValue={(value) => setReferenceDraft({ ...referenceDraft, position: [referenceDraft.position[0], referenceDraft.position[1], toMillimeters(value, globalSettings.unitSystem)] })}/></label></div><div className="dialog-hint">Preselect a face for its center or an edge for its midpoint, or enter an exact XYZ position.</div></>}
      <div className="dialog-actions"><button onClick={() => { setReferenceDraft(null); setEditingReferenceId(null); setLivePlaneOffset(null); }}>Cancel</button><button className="primary" onClick={saveReferenceGeometry}>{editingReferenceId ? "Apply changes" : `Create ${referenceDraft.type}`}</button></div></div>}
    {featureDraft && <div className="cad-dialog feature-dialog feature-flyout" onPointerDown={(event) => event.stopPropagation()}>
      <header><strong>{editingFeatureId ? `Edit ${features.find((feature) => feature.id === editingFeatureId)?.name ?? "feature"}` : `${featureDraft.type === "extrude" ? "Extrude" : "Revolve"} closed sketch`}</strong><button onClick={closeFeatureEditor}>×</button></header>
      <div className="validated-profile"><span>✓</span><div><strong>{sketches.find((sketch) => sketch.id === featureDraft.sketchId)?.name}</strong><small>Closed profile verified</small></div></div>
      <label>Result<select value={featureDraft.combine} onChange={(event) => { const combine = event.target.value as FeatureDraft["combine"]; setFeatureDraft({ ...featureDraft, combine, targetBodyId: featureTargetBodyIds.includes(featureDraft.targetBodyId) ? featureDraft.targetBodyId : featureTargetBodyIds[0] ?? "", direction: combine === "cut" ? -1 : 1 }); }}><option value="new">New body</option><option value="union" disabled={!featureTargetBodyIds.length}>Union with body</option><option value="cut" disabled={!featureTargetBodyIds.length}>Cut body</option></select></label>
      {featureDraft.combine !== "new" && <label>Target body<select value={featureDraft.targetBodyId} onChange={(event) => setFeatureDraft({ ...featureDraft, targetBodyId: event.target.value })}>{featureTargetBodyIds.map((body) => <option key={body} value={body}>{bodyName(body)}</option>)}</select></label>}
      {featureDraft.type === "extrude" ? <>
        <label>Extent<select value={featureDraft.extent} onChange={(event) => setFeatureDraft({ ...featureDraft, extent: event.target.value as FeatureDraft["extent"] })}><option value="one-sided">One direction</option><option value="symmetric">Symmetric</option><option value="bidirectional">Bidirectional</option></select></label>
        {featureDraft.extent === "one-sided" && <>
          <label>Distance<div className="input-with-unit"><BufferedNumberInput min={0.001} value={displayedLength(displayedFeatureDraft?.distance ?? featureDraft.distance)} onValidValue={(value) => setFeatureDraft({ ...featureDraft, distance: enteredLength(String(value)) })}/><span>{lengthUnit}</span></div></label>
          <div className={`direction-control ${featureDraft.combine === "cut" ? "cut-direction" : "add-direction"}`}>
            <span className={`direction-arrow ${featureDraft.direction < 0 ? "reversed" : ""}`}>➜</span>
            <div><strong>{featureDraft.combine === "cut" && featureDraft.direction < 0 ? "Into target body" : featureDraft.combine === "cut" ? "Flipped away from target" : featureDraft.direction > 0 ? "Away from sketch" : "Reverse sketch normal"}</strong><small>{featureDraft.direction > 0 ? "+ sketch normal" : "− sketch normal"}</small></div>
            <button type="button" className="flip-direction" aria-label="Flip extrusion direction" title="Flip extrusion direction" onClick={() => setFeatureDraft({ ...featureDraft, direction: featureDraft.direction === 1 ? -1 : 1 })}><span>⇅</span>Flip</button>
          </div>
        </>}
        {featureDraft.extent === "symmetric" && <>
          <label>Distance each side<div className="input-with-unit"><BufferedNumberInput min={0.001} value={displayedLength(displayedFeatureDraft?.distancePlus ?? featureDraft.distancePlus)} onValidValue={(value) => { const distance = enteredLength(String(value)); setFeatureDraft({ ...featureDraft, distancePlus: distance, distanceMinus: distance }); }}/><span>{lengthUnit}</span></div></label>
          <div className="extent-summary"><span>− {displayedLength(displayedFeatureDraft?.distancePlus ?? featureDraft.distancePlus)} {lengthUnit}</span><i>Sketch plane</i><span>+ {displayedLength(displayedFeatureDraft?.distancePlus ?? featureDraft.distancePlus)} {lengthUnit}</span></div>
        </>}
        {featureDraft.extent === "bidirectional" && <>
          <div className="bidirectional-distances">
            <label>Plus direction<div className="input-with-unit"><BufferedNumberInput min={0.001} value={displayedLength(displayedFeatureDraft?.distancePlus ?? featureDraft.distancePlus)} onValidValue={(value) => setFeatureDraft({ ...featureDraft, distancePlus: enteredLength(String(value)) })}/><span>{lengthUnit}</span></div></label>
            <label>Minus direction<div className="input-with-unit"><BufferedNumberInput min={0.001} value={displayedLength(displayedFeatureDraft?.distanceMinus ?? featureDraft.distanceMinus)} onValidValue={(value) => setFeatureDraft({ ...featureDraft, distanceMinus: enteredLength(String(value)) })}/><span>{lengthUnit}</span></div></label>
          </div>
          <div className="extent-summary"><span>− {displayedLength(displayedFeatureDraft?.distanceMinus ?? featureDraft.distanceMinus)} {lengthUnit}</span><i>Sketch plane</i><span>+ {displayedLength(displayedFeatureDraft?.distancePlus ?? featureDraft.distancePlus)} {lengthUnit}</span></div>
        </>}
      </> : <><div className={`revolve-axis-selection ${revolveAxisPicking ? "picking" : ""}`}><span className="axis-selection-icon">↻</span><div><small>Axis of revolution</small><strong>{featureDraft.axis && typeof featureDraft.axis === "object" ? featureDraft.axis.label : featureDraft.axis ? "Legacy axis reference" : "Select in the model"}</strong><em>{revolveAxisPicking ? "Click highlighted geometry in 3D" : "Axis selected and linked to its geometry"}</em></div><button type="button" onClick={() => setRevolveAxisPicking(true)}>{featureDraft.axis ? "Change" : "Select"}</button></div><div className="dialog-hint">Choose any straight sketch line, straight model edge, or global origin axis directly in the CAD view. The axis remains associated with that geometry when the model rebuilds.</div><label>Angle<div className="input-with-unit"><BufferedNumberInput min={1} max={360} value={featureDraft.angle} onValidValue={(value) => setFeatureDraft({ ...featureDraft, angle: value })}/><span>deg</span></div></label></>}
      <div className="dialog-actions"><button onClick={closeFeatureEditor}>Cancel</button><button className="primary" disabled={featureDraft.type === "revolve" && !featureDraft.axis} onClick={createFeature}>{editingFeatureId ? "Apply changes" : "Create feature"}</button></div>
    </div>}
    {bodyFeatureDraft && <div className={`cad-dialog feature-dialog feature-flyout body-feature-flyout ${bodyFeatureDraft.type === "draft" ? "draft-feature-flyout" : bodyFeatureDraft.type === "shell" ? "shell-feature-flyout" : ""}`} onPointerDown={(event) => event.stopPropagation()}>
      <header><strong>{editingFeatureId ? `Edit ${features.find((feature) => feature.id === editingFeatureId)?.name ?? "feature"}` : bodyFeatureDraft.type === "fillet" ? "Constant-radius fillet" : bodyFeatureDraft.type === "chamfer" ? "Edge chamfer" : bodyFeatureDraft.type === "draft" ? "Neutral-plane draft" : "Uniform wall shell"}</strong><button onClick={closeFeatureEditor}>×</button></header>
      <div className="solid-selection-summary"><span>{bodyFeatureDraft.type === "draft" ? "⌁" : bodyFeatureDraft.type === "shell" ? "▣" : bodyFeatureDraft.type === "fillet" ? "◜" : "◩"}</span><div><strong>{bodyName(bodyFeatureDraft.targetBodyId)}</strong><small>{bodyFeatureDraft.type === "draft" ? `${bodyFeatureDraft.faceIndices.length} face${bodyFeatureDraft.faceIndices.length === 1 ? "" : "s"} to draft` : bodyFeatureDraft.type === "shell" ? `${bodyFeatureDraft.faceIndices.length} opening face${bodyFeatureDraft.faceIndices.length === 1 ? "" : "s"}` : `${bodyFeatureDraft.edgeIndices.length} edge${bodyFeatureDraft.edgeIndices.length === 1 ? "" : "s"} selected`}</small></div></div>
      {bodyFeatureDraft.type === "fillet" && <label>Radius<div className="input-with-unit"><BufferedNumberInput aria-label="Fillet radius" min={0.001} value={displayedLength(bodyFeatureDraft.radius)} onValidValue={(value) => setBodyFeatureDraft({ ...bodyFeatureDraft, radius: enteredLength(String(value)) })}/><span>{lengthUnit}</span></div></label>}
      {bodyFeatureDraft.type === "chamfer" && <>
        <label>Method<select aria-label="Chamfer method" value={bodyFeatureDraft.method} onChange={(event) => { setLiveChamferDrag(null); setBodyFeatureDraft({ ...bodyFeatureDraft, method: event.target.value as ChamferMethod }); }}><option value="symmetric">Symmetric distance</option><option value="angle-distance">Angle / distance</option><option value="distance-distance">Distance / distance</option></select></label>
        <label>{bodyFeatureDraft.method === "distance-distance" ? "Distance 1" : "Distance"}<div className="input-with-unit"><BufferedNumberInput aria-label={bodyFeatureDraft.method === "distance-distance" ? "Chamfer distance 1" : "Chamfer distance"} min={0.001} value={displayedLength(displayedBodyFeatureDraft?.type === "chamfer" ? displayedBodyFeatureDraft.distance : bodyFeatureDraft.distance)} onValidValue={(value) => { setLiveChamferDrag(null); setBodyFeatureDraft({ ...bodyFeatureDraft, distance: enteredLength(String(value)) }); }}/><span>{lengthUnit}</span></div></label>
        {bodyFeatureDraft.method === "distance-distance" && <label>Distance 2<div className="input-with-unit"><BufferedNumberInput aria-label="Chamfer distance 2" min={0.001} value={displayedLength(displayedBodyFeatureDraft?.type === "chamfer" ? displayedBodyFeatureDraft.distance2 : bodyFeatureDraft.distance2)} onValidValue={(value) => { setLiveChamferDrag(null); setBodyFeatureDraft({ ...bodyFeatureDraft, distance2: enteredLength(String(value)) }); }}/><span>{lengthUnit}</span></div></label>}
        {bodyFeatureDraft.method === "angle-distance" && <label>Angle<div className="input-with-unit"><BufferedNumberInput aria-label="Chamfer angle" min={1} max={89} step="1" value={displayedBodyFeatureDraft?.type === "chamfer" ? Number(displayedBodyFeatureDraft.angle.toFixed(2)) : bodyFeatureDraft.angle} onValidValue={(value) => { setLiveChamferDrag(null); setBodyFeatureDraft({ ...bodyFeatureDraft, angle: value }); }}/><span>deg</span></div></label>}
        {bodyFeatureDraft.method !== "symmetric" && <button type="button" className={`draft-direction ${bodyFeatureDraft.flip ? "reversed" : ""}`} onClick={() => setBodyFeatureDraft({ ...bodyFeatureDraft, flip: !bodyFeatureDraft.flip })}><span>⇅</span><div><strong>Flip chamfer sides</strong><small>{bodyFeatureDraft.flip ? "Second value applied to the first side" : "First value applied to the first side"}</small></div></button>}
        <div className="dialog-hint">Drag the cyan arrow in 3D for {bodyFeatureDraft.method === "distance-distance" ? "Distance 1" : "distance"}{bodyFeatureDraft.method === "distance-distance" ? "; drag the amber arrow for Distance 2." : bodyFeatureDraft.method === "angle-distance" ? "; drag the violet arrow for angle." : "."} The solid updates while you pull.</div>
      </>}
      {bodyFeatureDraft.type === "draft" && <>
        <div className="draft-workflow" aria-label="Draft face selection workflow">
          <button type="button" className="draft-step complete" onClick={() => { setSelectedDraftFaceIds([]); setSelectedFace(null); setSolidSelectionMode("draft-neutral"); }}><span>1</span><div><small>Neutral face</small><strong>Face {bodyFeatureDraft.neutralFaceIndex}</strong><em>Click to choose again</em></div><b>✓</b></button>
          <div className="draft-step active" aria-live="polite"><span>2</span><div><small>Faces to draft</small><strong>{bodyFeatureDraft.faceIndices.length ? `${bodyFeatureDraft.faceIndices.length} selected` : "Select in the 3D view"}</strong><em>Click each side face; click again to remove</em></div><b>{bodyFeatureDraft.faceIndices.length}</b></div>
        </div>
        <label>Draft angle<div className="input-with-unit"><BufferedNumberInput aria-label="Draft angle" min={0.1} max={88.9} step="0.5" value={bodyFeatureDraft.angle} onValidValue={(value) => setBodyFeatureDraft({ ...bodyFeatureDraft, angle: value })}/><span>deg</span></div></label><button type="button" className={`draft-direction ${bodyFeatureDraft.reverse ? "reversed" : ""}`} onClick={() => setBodyFeatureDraft({ ...bodyFeatureDraft, reverse: !bodyFeatureDraft.reverse })}><span>⇅</span><div><strong>Reverse direction</strong><small>{bodyFeatureDraft.reverse ? "Reversed from neutral-face normal" : "Along neutral-face normal"}</small></div></button>
      </>}
      {bodyFeatureDraft.type === "shell" && <>
        <div className="draft-workflow shell-workflow" aria-label="Shell opening face selection workflow"><div className="draft-step active" aria-live="polite"><span>1</span><div><small>Faces to remove</small><strong>{bodyFeatureDraft.faceIndices.length ? `${bodyFeatureDraft.faceIndices.length} selected` : "Select in the 3D view"}</strong><em>Click each opening face; click again to remove</em></div><b>{bodyFeatureDraft.faceIndices.length}</b></div></div>
        <label>Wall thickness<div className="input-with-unit"><BufferedNumberInput aria-label="Shell wall thickness" min={0.001} step={globalSettings.unitSystem === "imperial" ? 0.01 : 0.5} value={displayedLength(bodyFeatureDraft.thickness)} onValidValue={(value) => setBodyFeatureDraft({ ...bodyFeatureDraft, thickness: enteredLength(String(value)) })}/><span>{lengthUnit}</span></div></label>
        <button type="button" className={`draft-direction ${bodyFeatureDraft.outward ? "reversed" : ""}`} onClick={() => setBodyFeatureDraft({ ...bodyFeatureDraft, outward: !bodyFeatureDraft.outward })}><span>⇆</span><div><strong>Shell outward</strong><small>{bodyFeatureDraft.outward ? "Outer dimensions increase" : "Preserve the current outer dimensions"}</small></div></button>
      </>}
      <div className="dialog-hint">{bodyFeatureDraft.type === "draft" ? "Step 2 is active: click one or more body faces in 3D. Selected draft faces turn cyan; the neutral face stays amber." : bodyFeatureDraft.type === "shell" ? "Select the face or faces that become openings. All remaining faces offset to create a uniform wall; reduce thickness if tight curves cannot offset." : "Keep clicking highlighted edges to add or remove them."} The model preview updates immediately.</div>
      <div className="dialog-actions"><button onClick={closeFeatureEditor}>Cancel</button><button className="primary" disabled={bodyFeatureDraft.type === "draft" || bodyFeatureDraft.type === "shell" ? !bodyFeatureDraft.faceIndices.length : !bodyFeatureDraft.edgeIndices.length} onClick={createBodyFeature}>{editingFeatureId ? "Apply changes" : `Create ${bodyFeatureDraft.type}`}</button></div>
    </div>}
    {contextMenu && <div className="feature-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="context-title">{contextMenu.type === "sketch" ? sketches.find((sketch) => sketch.id === contextMenu.id)?.name : contextMenu.type === "feature" ? features.find((feature) => feature.id === contextMenu.id)?.name : contextMenu.type === "body" ? bodyName(contextMenu.id) : referenceGeometry.find((reference) => reference.id === contextMenu.id)?.name}</div>
      {contextMenu.type === "sketch" && <><button onClick={() => { editSketch(contextMenu.id); setContextMenu(null); }}>Edit sketch</button><button onClick={() => { setPlaneDialog({ mode: "edit", sketchId: contextMenu.id }); setContextMenu(null); }}>Change plane or face</button></>}
      {contextMenu.type === "feature" && <><button onClick={() => editFeature(contextMenu.id)}>Edit feature</button><button onClick={() => { const feature = features.find((item) => item.id === contextMenu.id); if (feature) setRenameDialog({ type: "feature", id: feature.id, value: feature.name }); setContextMenu(null); }}>Rename feature</button>{features.find((feature) => feature.id === contextMenu.id)?.bodyId && <button onClick={() => { const feature = features.find((item) => item.id === contextMenu.id); if (feature?.bodyId) setRenameDialog({ type: "body", id: feature.bodyId, value: bodyName(feature.bodyId) }); setContextMenu(null); }}>Rename resulting body</button>}</>}
      {contextMenu.type === "body" && <button onClick={() => { setRenameDialog({ type: "body", id: contextMenu.id, value: bodyName(contextMenu.id) }); setContextMenu(null); }}>Rename body</button>}
      {contextMenu.type === "reference" && <><button onClick={() => { editReferenceGeometry(contextMenu.id); setContextMenu(null); }}>Edit reference geometry</button><button className="delete-action" onClick={() => { deleteReferenceGeometry(contextMenu.id); setContextMenu(null); }}>Delete reference and dependents</button></>}
      {(contextMenu.type === "sketch" || contextMenu.type === "feature") && <button className="delete-action" onClick={() => deleteFromTree(contextMenu.type, contextMenu.id)}>Delete {contextMenu.type}{contextMenu.type === "feature" ? " and later features" : " and dependents"}</button>}
    </div>}
  </main>;
}
