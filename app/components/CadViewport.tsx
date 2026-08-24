"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { sampleSketchEntity, type SketchEntity } from "./sketchGeometry";
import type { ExternalSketchReference, SketchView } from "./Sketcher";

type VectorTuple = [number, number, number];
type AxisSelectionMetadata = { geometryType?: string; axisOrigin?: VectorTuple; axisDirection?: VectorTuple; axisKind?: "center" | "coincident" | "tangent" };
type FacePayload = AxisSelectionMetadata & { id: string; bodyId: string; faceIndex: number; vertices: VectorTuple[]; triangles: VectorTuple[]; center?: VectorTuple; normal?: VectorTuple; planar?: boolean };
type EdgePayload = AxisSelectionMetadata & { id: string; bodyId: string; edgeIndex: number; points: VectorTuple[]; linear?: boolean };
type SketchFrame = { origin: VectorTuple; xDir: VectorTuple; yDir: VectorTuple; normal: VectorTuple };
type SketchPayload = { id: string; name: string; visible: boolean; frame: SketchFrame; paths: { id: string; type?: string; construction: boolean; points: VectorTuple[] }[] };
type DocumentPayload = {
  faces: FacePayload[];
  edges?: EdgePayload[];
  previewFaces?: FacePayload[];
  previewTargetBodyId?: string | null;
  sketches: SketchPayload[];
  properties: { valid: boolean; solidCount: number; bodyCount: number; faceCount: number; edgeCount: number; volume: number; bounds: { x: number; y: number; z: number } };
};
export type ReferencePlaneRecord = { id: string; name: string; type: "plane"; origin: VectorTuple; normal: VectorTuple; xDir: VectorTuple; sourceLabel: string; visible?: boolean };
export type ReferenceAxisRecord = { id: string; name: string; type: "axis"; origin: VectorTuple; direction: VectorTuple; sourceLabel: string; visible?: boolean };
export type ReferencePointRecord = { id: string; name: string; type: "point"; position: VectorTuple; sourceLabel: string; visible?: boolean };
export type ReferenceGeometryRecord = ReferencePlaneRecord | ReferenceAxisRecord | ReferencePointRecord;
export type SketchPlane = "XY" | "XZ" | "YZ" | { kind: "face"; bodyId: string; faceIndex: number; faceId: string } | { kind: "reference-plane"; referenceId: string };
export type SketchRecord = { id: string; name: string; plane: SketchPlane; entities: unknown[]; flipped?: boolean; visible?: boolean };
export type FeatureType = "extrude" | "revolve" | "fillet" | "chamfer" | "draft";
export type RevolveAxisReference =
  | { kind: "origin-axis"; axis: "x" | "y" | "z"; label: string }
  | { kind: "sketch-line"; sketchId: string; entityId: string; label: string }
  | { kind: "model-edge"; bodyId: string; edgeIndex: number; label: string }
  | { kind: "reference-axis"; referenceId: string; label: string };
export type ChamferMethod = "symmetric" | "angle-distance" | "distance-distance";
export type ChamferParameter = "distance" | "distance2" | "angle";
export type FeatureRecord = { id: string; name: string; type: FeatureType; sketchId?: string; combine?: "new" | "union" | "cut"; bodyId?: string; targetBodyId?: string; extent?: "one-sided" | "symmetric" | "bidirectional"; distance?: number; distance2?: number; distancePlus?: number; distanceMinus?: number; direction?: 1 | -1; angle?: number; axis?: RevolveAxisReference | "construction" | "origin-x" | "origin-y" | "profile-left"; edgeIndices?: number[]; radius?: number; method?: ChamferMethod; flip?: boolean; neutralFaceIndex?: number; faceIndices?: number[]; reverse?: boolean; visible?: boolean };
export type DocumentRequest = { sketches: SketchRecord[]; features: FeatureRecord[]; referenceGeometry?: ReferenceGeometryRecord[] };
export type SelectedFace = AxisSelectionMetadata & { id: string; bodyId: string; faceIndex: number; center?: VectorTuple; normal?: VectorTuple; planar?: boolean };
export type SelectedEdge = AxisSelectionMetadata & { id: string; bodyId: string; edgeIndex: number; points?: VectorTuple[]; linear?: boolean };
export type SolidSelectionMode = "edges" | "draft-neutral" | "draft-faces" | null;
export type FeaturePreview =
  | { type: "extrude"; sketchId: string; combine: "new" | "union" | "cut"; targetBodyId?: string; extent: "one-sided" | "symmetric" | "bidirectional"; distance: number; distancePlus: number; distanceMinus: number; direction: 1 | -1 }
  | { type: "fillet"; targetBodyId: string; edgeIndices: number[]; radius: number }
  | { type: "chamfer"; targetBodyId: string; edgeIndices: number[]; method: ChamferMethod; distance: number; distance2: number; angle: number; flip: boolean }
  | { type: "draft"; targetBodyId: string; neutralFaceIndex: number; faceIndices: number[]; angle: number; reverse: boolean };
type DocumentStatus = "idle" | "connecting" | "ready" | "offline" | "error";
type SavedView = { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 };

type Props = {
  document: DocumentRequest;
  editingSketchId?: string | null;
  editingSketch?: { id: string; entities: SketchEntity[] } | null;
  sketchView?: SketchView;
  snapNormalRequest?: number;
  sketchSupportPicking?: boolean;
  featurePreview?: FeaturePreview | null;
  selectedBodyId?: string | null;
  selectedEdgeIds?: string[];
  selectedFaceIds?: string[];
  solidSelectionMode?: SolidSelectionMode;
  selectedPlane?: "XY" | "XZ" | "YZ" | null;
  showModelGrid?: boolean;
  originCsyVisible?: boolean;
  originPlanesVisible?: Record<"XY" | "XZ" | "YZ", boolean>;
  highlightedSketchId?: string | null;
  selectableSketchIds?: string[] | null;
  revolveAxisPicking?: boolean;
  selectedRevolveAxis?: RevolveAxisReference | null;
  highlightedFeatureId?: string | null;
  selectedReferenceId?: string | null;
  referencePlanePicking?: boolean;
  referenceAxisPicking?: boolean;
  referencePlanePreview?: { referenceId: string; baseOrigin: VectorTuple; normal: VectorTuple; offset: number } | null;
  onSketchViewChange?: (view: SketchView) => void;
  onSketchRotatedChange?: (rotated: boolean) => void;
  onExternalReferencesChange?: (references: ExternalSketchReference[]) => void;
  onSelectSketch?: (sketchId: string) => void;
  onSelectPlane?: (plane: "XY" | "XZ" | "YZ") => void;
  onSelectRevolveAxis?: (axis: RevolveAxisReference) => void;
  onSelectReferencePlane?: (referenceId: string) => void;
  onSelectReference?: (referenceId: string) => void;
  onReferencePlaneOffsetChange?: (offset: number, phase: "preview" | "commit" | "cancel") => void;
  onFeaturePreviewDistanceChange?: (direction: 1 | -1, distance: number, phase: "preview" | "commit" | "cancel") => void;
  onChamferPreviewParameterChange?: (parameter: ChamferParameter, value: number, phase: "preview" | "commit" | "cancel") => void;
  onSelectEdge?: (edge: SelectedEdge, additive: boolean) => void;
  onSelectFace: (face: SelectedFace | null, additive?: boolean) => void;
  onStatus: (status: DocumentStatus, properties?: DocumentPayload["properties"], message?: string) => void;
};

type WorldSketchFrame = { origin: THREE.Vector3; xDir: THREE.Vector3; yDir: THREE.Vector3; normal: THREE.Vector3 };
const API = typeof window === "undefined" ? "http://127.0.0.1:4311" : `${window.location.protocol}//${window.location.hostname}:4311`;
const ORIGIN_PLANE_COLORS = { XY: 0x3b82f6, XZ: 0x22c55e, YZ: 0xef4444 } as const;

function disposeSketchGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Line) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }
}

function drawEditingSketch(group: THREE.Group, frame: WorldSketchFrame, entities: SketchEntity[]) {
  disposeSketchGroup(group);
  const toWorld = (point: { x: number; y: number }) => frame.origin.clone().addScaledVector(frame.xDir, point.x).addScaledVector(frame.yDir, point.y);
  for (const entity of entities) {
    const points = sampleSketchEntity(entity);
    if (points.length < 2) continue;
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(toWorld));
    const material = entity.construction
      ? new THREE.LineDashedMaterial({ color: 0xc084fc, dashSize: 4, gapSize: 2, depthTest: false })
      : new THREE.LineBasicMaterial({ color: 0x55c7f3, depthTest: false });
    const line = new THREE.Line(geometry, material);
    if (entity.construction) line.computeLineDistances();
    line.renderOrder = 6;
    group.add(line);
  }
}

function sketchExternalReferences(data: DocumentPayload, frame: WorldSketchFrame, selectedPlane: "XY" | "XZ" | "YZ" | null): ExternalSketchReference[] {
  const toLocal = (world: THREE.Vector3) => { const offset = world.clone().sub(frame.origin); return { x: offset.dot(frame.xDir), y: offset.dot(frame.yDir) }; };
  const references: ExternalSketchReference[] = (data.edges ?? []).map((edge) => ({ id: edge.id, kind: "body-edge", label: `${edge.bodyId} edge ${edge.edgeIndex}`, points: edge.points.map((point) => toLocal(new THREE.Vector3(...point))) }));
  if (!selectedPlane) return references;
  const originPlaneNormal = { XY: new THREE.Vector3(0, 0, 1), XZ: new THREE.Vector3(0, 1, 0), YZ: new THREE.Vector3(1, 0, 0) }[selectedPlane];
  const direction = frame.normal.clone().cross(originPlaneNormal);
  const denominator = direction.lengthSq();
  if (denominator < 1e-10) return references;
  const sketchOffset = frame.normal.dot(frame.origin);
  const pointOnLine = originPlaneNormal.clone().cross(direction).multiplyScalar(sketchOffset / denominator);
  const unitDirection = direction.normalize();
  references.push({ id: `origin-plane:${selectedPlane}`, kind: "plane-intersection", label: `${selectedPlane} Plane intersection`, points: [toLocal(pointOnLine.clone().addScaledVector(unitDirection, -10000)), toLocal(pointOnLine.clone().addScaledVector(unitDirection, 10000))] });
  return references;
}

function addOriginCsy(scene: THREE.Scene, size: number, selectable = false, selectedAxis?: "x" | "y" | "z") {
  const length = Math.max(size * 0.72, 64);
  const axes = [
    { axis: "x" as const, direction: new THREE.Vector3(1, 0, 0), color: 0xef4444 },
    { axis: "y" as const, direction: new THREE.Vector3(0, 1, 0), color: 0x22c55e },
    { axis: "z" as const, direction: new THREE.Vector3(0, 0, 1), color: 0x3b82f6 },
  ];
  const result: THREE.Line[] = [];
  for (const { axis, direction, color } of axes) {
    const geometry = new THREE.BufferGeometry().setFromPoints([direction.clone().multiplyScalar(-length), direction.clone().multiplyScalar(length)]);
    const selected = selectedAxis === axis;
    const material = new THREE.LineBasicMaterial({ color: selected ? 0xffd36a : color, transparent: true, opacity: selected ? 1 : 0.82, depthTest: false });
    const line = new THREE.Line(geometry, material);
    line.userData = { revolveAxis: selectable ? { kind: "origin-axis", axis, label: `Origin ${axis.toUpperCase()} axis` } satisfies RevolveAxisReference : null, baseColor: selected ? 0xffd36a : color, baseOpacity: material.opacity };
    line.renderOrder = selected ? 7 : 2;
    scene.add(line);
    result.push(line);
  }
  return result;
}

function addOriginPlane(scene: THREE.Scene, plane: "XY" | "XZ" | "YZ", size: number, selectable = false) {
  const planeSize = Math.max(size * 1.8, 140);
  const geometry = new THREE.PlaneGeometry(planeSize, planeSize);
  const planeMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: ORIGIN_PLANE_COLORS[plane], transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide }));
  if (plane === "XZ") planeMesh.rotation.x = Math.PI / 2;
  if (plane === "YZ") planeMesh.rotation.y = Math.PI / 2;
  planeMesh.renderOrder = selectable ? 5 : 1;
  planeMesh.userData = { originPlane: plane, selectableOriginPlane: selectable, baseOpacity: selectable ? 0.16 : 0.11 };
  (planeMesh.material as THREE.MeshBasicMaterial).opacity = planeMesh.userData.baseOpacity;
  scene.add(planeMesh);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: ORIGIN_PLANE_COLORS[plane], transparent: true, opacity: 0.78, depthTest: false }));
  outline.rotation.copy(planeMesh.rotation);
  outline.renderOrder = 7;
  scene.add(outline);
  return planeMesh;
}

export function CadViewport({ document, editingSketchId = null, editingSketch = null, sketchView, snapNormalRequest = 0, sketchSupportPicking = false, featurePreview = null, selectedBodyId = null, selectedEdgeIds = [], selectedFaceIds = [], solidSelectionMode = null, selectedPlane = null, showModelGrid = true, originCsyVisible = true, originPlanesVisible = { XY: false, XZ: false, YZ: false }, highlightedSketchId = null, selectableSketchIds = null, revolveAxisPicking = false, selectedRevolveAxis = null, highlightedFeatureId = null, selectedReferenceId = null, referencePlanePicking = false, referenceAxisPicking = false, referencePlanePreview = null, onSketchViewChange, onSketchRotatedChange, onExternalReferencesChange, onSelectSketch, onSelectPlane, onSelectRevolveAxis, onSelectReferencePlane, onSelectReference, onReferencePlaneOffsetChange, onFeaturePreviewDistanceChange, onChamferPreviewParameterChange, onSelectEdge, onSelectFace, onStatus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const savedViewRef = useRef<SavedView | null>(null);
  const liveSketchGroupRef = useRef<THREE.Group | null>(null);
  const sketchFrameRef = useRef<WorldSketchFrame | null>(null);
  const editingEntitiesRef = useRef<SketchEntity[]>(editingSketch?.entities ?? []);
  const sketchViewRef = useRef<SketchView>(sketchView ?? { center: { x: 0, y: 0 }, zoom: 1 });
  const documentRequestKey = JSON.stringify(featurePreview ? { ...document, previewFeature: featurePreview } : document);
  const editingGeometryKey = JSON.stringify(editingSketch?.entities ?? []);
  const highlightedFeature = document.features.find((feature) => feature.id === highlightedFeatureId);
  const highlightedFeatureBodyId = highlightedFeature?.bodyId ?? highlightedFeature?.targetBodyId ?? null;
  const highlightedFeatureSketchId = highlightedFeature?.sketchId ?? null;
  const selectableSketchKey = selectableSketchIds?.join("|") ?? "";
  const revolveAxisKey = JSON.stringify(selectedRevolveAxis);
  const referencePlanePreviewKey = JSON.stringify(referencePlanePreview);
  const selectedEdgeKey = [...selectedEdgeIds].sort().join("|");
  const selectedFaceKey = [...selectedFaceIds].sort().join("|");
  const hiddenBodyIds = new Set(document.features.filter((feature) => feature.visible === false).map((feature) => feature.bodyId ?? feature.targetBodyId).filter((bodyId): bodyId is string => Boolean(bodyId)));
  const hiddenBodyKey = [...hiddenBodyIds].sort().join("|");

  useEffect(() => {
    editingEntitiesRef.current = editingSketch?.entities ?? [];
    sketchViewRef.current = sketchView ?? { center: { x: 0, y: 0 }, zoom: 1 };
  }, [editingSketch?.entities, sketchView]);

  useEffect(() => {
    const group = liveSketchGroupRef.current;
    const frame = sketchFrameRef.current;
    if (group && frame) drawEditingSketch(group, frame, editingEntitiesRef.current);
  }, [editingGeometryKey]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const scene = new THREE.Scene();
    const sketchMode = Boolean(editingSketchId);
    const camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = sketchMode
      ? new THREE.OrthographicCamera(-260, 260, 180, -180, 0.1, 10000)
      : new THREE.PerspectiveCamera(38, 1, 0.1, 10000);
    if (!sketchMode) {
      const saved = savedViewRef.current;
      camera.position.copy(saved?.position ?? new THREE.Vector3(155, -175, 135));
      camera.up.copy(saved?.up ?? new THREE.Vector3(0, 0, 1));
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const sketchCanvas = sketchMode ? host.parentElement?.querySelector(".sketch-canvas") : null;
    const navigationElement = (sketchCanvas ?? renderer.domElement) as HTMLElement;
    const controls = new OrbitControls(camera, navigationElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.copy(savedViewRef.current?.target ?? new THREE.Vector3(0, 0, 10));
    controls.mouseButtons.LEFT = sketchMode ? null : THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    if (camera instanceof THREE.OrthographicCamera) {
      controls.minZoom = 0.05;
      controls.maxZoom = 40;
    }
    const preventContextMenu = (event: Event) => event.preventDefault();
    navigationElement.addEventListener("contextmenu", preventContextMenu);

    scene.add(new THREE.HemisphereLight(0xdaf3ff, 0x17202a, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(120, -100, 180); scene.add(key);
    if (!sketchMode) {
      if (showModelGrid) { const grid = new THREE.GridHelper(520, 34, 0x3e5264, 0x263644); grid.rotation.x = Math.PI / 2; grid.position.z = -0.08; scene.add(grid); }
    }

    const model = new THREE.Group();
    const selectableEdges = new THREE.Group();
    const selectedFaceOverlay = new THREE.Group();
    const sketchLayer = new THREE.Group();
    const liveSketchLayer = new THREE.Group();
    const previewLayer = new THREE.Group();
    liveSketchGroupRef.current = liveSketchLayer;
    scene.add(model, selectableEdges, selectedFaceOverlay, sketchLayer, liveSketchLayer, previewLayer);
    let selected: THREE.Mesh | null = null;
    let disposed = false;
    let activeFrame: WorldSketchFrame | null = null;
    let draftNeutralNormal: THREE.Vector3 | null = null;
    let lastRotated: boolean | null = null;
    let lastView = sketchViewRef.current;
    const selectionPulseMaterials: THREE.PointsMaterial[] = [];
    const originPlaneHits: THREE.Mesh[] = [];
    const referencePlaneHits: THREE.Mesh[] = [];
    const referenceHits: THREE.Object3D[] = [];
    const referencePlaneArrowHits: THREE.Mesh[] = [];
    const referencePlanePreviewTargets: THREE.Object3D[] = [];
    const revolveAxisHits: THREE.Line[] = [];
    const extrusionArrowHits: THREE.Mesh[] = [];
    const chamferArrowHits: THREE.Mesh[] = [];
    const extrusionPreviewTargets: { geometry: THREE.BufferGeometry; original: Float32Array; surface: boolean }[] = [];
    let extrusionDeformation: { origin: THREE.Vector3; normal: THREE.Vector3; plus: number; minus: number } | null = null;
    const deformExtrusionPreview = (direction: 1 | -1, distance: number) => {
      if (!featurePreview || featurePreview.type !== "extrude" || !extrusionDeformation) return;
      let plus = extrusionDeformation.plus; let minus = extrusionDeformation.minus;
      if (featurePreview.extent === "one-sided") { if (direction > 0) plus = distance; else minus = distance; }
      else if (featurePreview.extent === "symmetric") { plus = distance; minus = distance; }
      else if (direction > 0) plus = distance; else minus = distance;
      const { origin, normal } = extrusionDeformation;
      for (const target of extrusionPreviewTargets) {
        const position = target.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let index = 0; index < position.count; index++) {
          const offsetX = target.original[index * 3] - origin.x; const offsetY = target.original[index * 3 + 1] - origin.y; const offsetZ = target.original[index * 3 + 2] - origin.z;
          const signed = offsetX * normal.x + offsetY * normal.y + offsetZ * normal.z;
          const scale = signed >= 0 ? (extrusionDeformation.plus > 1e-6 ? plus / extrusionDeformation.plus : 1) : (extrusionDeformation.minus > 1e-6 ? minus / extrusionDeformation.minus : 1);
          const change = signed * (scale - 1); position.setXYZ(index, target.original[index * 3] + normal.x * change, target.original[index * 3 + 1] + normal.y * change, target.original[index * 3 + 2] + normal.z * change);
        }
        position.needsUpdate = true; target.geometry.computeBoundingSphere(); if (target.surface) target.geometry.computeVertexNormals();
      }
    };
    const disposePreviewLayer = () => {
      previewLayer.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Line) {
          object.geometry.dispose(); (object.material as THREE.Material).dispose();
        }
      });
      previewLayer.clear();
    };
    const renderPreviewFaces = (faces: FacePayload[]) => {
      if (!featurePreview) return;
      disposePreviewLayer();
      const previewColor = featurePreview.type === "extrude" && featurePreview.combine === "cut" ? 0xff5264 : featurePreview.type === "draft" ? 0xf3b34b : 0x52e3a0;
      for (const face of faces) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(face.vertices.flat(), 3));
        geometry.setIndex(face.triangles.flat());
        geometry.computeVertexNormals();
        const phantom = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
          color: previewColor, emissive: previewColor, emissiveIntensity: 0.18, roughness: 0.38, metalness: 0,
          transparent: true, opacity: featurePreview.type === "extrude" && featurePreview.combine === "cut" ? 0.34 : featurePreview.type === "extrude" ? 0.28 : 0.62,
          depthWrite: false, side: THREE.DoubleSide,
        }));
        phantom.renderOrder = 5; previewLayer.add(phantom);
        if (featurePreview.type === "extrude") extrusionPreviewTargets.push({ geometry, original: new Float32Array((geometry.getAttribute("position") as THREE.BufferAttribute).array), surface: true });
        const outlineGeometry = new THREE.EdgesGeometry(geometry, 18);
        const outline = new THREE.LineSegments(outlineGeometry, new THREE.LineBasicMaterial({ color: previewColor, transparent: true, opacity: 0.9, depthWrite: false }));
        outline.renderOrder = 6; previewLayer.add(outline);
        if (featurePreview.type === "extrude") extrusionPreviewTargets.push({ geometry: outlineGeometry, original: new Float32Array((outlineGeometry.getAttribute("position") as THREE.BufferAttribute).array), surface: false });
      }
    };

    const bodyColor = (bodyId: string) => highlightedFeatureBodyId === bodyId ? 0xe7a63d : selectedBodyId === bodyId ? 0x4fb9df : 0x3097bd;
    const faceColor = (faceId: string, bodyId: string) => selectedFaceIds.indexOf(faceId) === 0 ? 0xf6b94d : selectedFaceIds.includes(faceId) ? 0x66d9ff : bodyColor(bodyId);
    const setSelected = (mesh: THREE.Mesh | null, additive = false) => {
      if (selected) (selected.material as THREE.MeshStandardMaterial).color.set(faceColor(selected.userData.faceId, selected.userData.bodyId));
      selected = mesh;
      if (selected) (selected.material as THREE.MeshStandardMaterial).color.set(0x8cddf7);
      onSelectFace(mesh ? { id: mesh.userData.faceId, bodyId: mesh.userData.bodyId, faceIndex: mesh.userData.faceIndex, center: mesh.userData.center, normal: mesh.userData.normal, planar: mesh.userData.planar, geometryType: mesh.userData.geometryType, axisOrigin: mesh.userData.axisOrigin, axisDirection: mesh.userData.axisDirection, axisKind: mesh.userData.axisKind } : null, additive);
    };

    const syncSketchView = () => {
      if (!sketchMode || !activeFrame || !(camera instanceof THREE.OrthographicCamera)) return;
      const direction = new THREE.Vector3(); camera.getWorldDirection(direction);
      const rotated = direction.dot(activeFrame.normal) < 0.9995;
      if (rotated !== lastRotated) { lastRotated = rotated; onSketchRotatedChange?.(rotated); }
      if (rotated) return;
      const offset = controls.target.clone().sub(activeFrame.origin);
      const next: SketchView = { center: { x: offset.dot(activeFrame.xDir), y: offset.dot(activeFrame.yDir) }, zoom: camera.zoom };
      if (Math.abs(next.center.x - lastView.center.x) > 0.001 || Math.abs(next.center.y - lastView.center.y) > 0.001 || Math.abs(next.zoom - lastView.zoom) > 0.0001) {
        lastView = next;
        onSketchViewChange?.(next);
      }
    };
    controls.addEventListener("change", syncSketchView);

    async function loadDocument() {
      onStatus("connecting");
      try {
        const response = await fetch(`${API}/api/document`, { method: "POST", headers: { "Content-Type": "application/json" }, body: documentRequestKey });
        if (!response.ok) { const detail = await response.json().catch(() => null) as { detail?: string } | null; throw new Error(detail?.detail || "The document could not be rebuilt."); }
        const data = (await response.json()) as DocumentPayload;
        if (disposed) return;
        const neutralFacePayload = solidSelectionMode === "draft-faces" ? data.faces.find((face) => face.id === selectedFaceIds[0]) : null;
        draftNeutralNormal = neutralFacePayload?.normal ? new THREE.Vector3(...neutralFacePayload.normal).normalize() : null;
        for (const face of data.faces) {
          if (hiddenBodyIds.has(face.bodyId)) continue;
          const targetReplacedByPreview = Boolean(featurePreview && featurePreview.type !== "extrude" && data.previewTargetBodyId === face.bodyId);
          const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(face.vertices.flat(), 3)); geometry.setIndex(face.triangles.flat()); geometry.computeVertexNormals();
          const bodyHighlighted = selectedBodyId === face.bodyId;
          const featureHighlighted = highlightedFeatureBodyId === face.bodyId;
          const faceSelected = selectedFaceIds.includes(face.id);
          const faceNormal = face.normal ? new THREE.Vector3(...face.normal).normalize() : null;
          const draftCandidate = solidSelectionMode !== "draft-faces" || faceSelected || (face.bodyId === neutralFacePayload?.bodyId && face.id !== selectedFaceIds[0] && Boolean(draftNeutralNormal && faceNormal && Math.abs(draftNeutralNormal.dot(faceNormal)) < 0.985));
          const baseOpacity = targetReplacedByPreview ? faceSelected ? 0.16 : 0.001 : sketchMode ? 0.42 : 1;
          const material = new THREE.MeshStandardMaterial({ color: faceColor(face.id, face.bodyId), emissive: featureHighlighted ? 0x4a2500 : faceSelected ? 0x49310a : 0x000000, emissiveIntensity: featureHighlighted ? 0.45 : faceSelected ? 0.35 : 0, roughness: 0.55, metalness: 0.06, side: THREE.DoubleSide, transparent: sketchMode || targetReplacedByPreview, opacity: baseOpacity, depthWrite: !sketchMode && !targetReplacedByPreview });
          const mesh = new THREE.Mesh(geometry, material); mesh.userData = { faceId: face.id, bodyId: face.bodyId, faceIndex: face.faceIndex, center: face.center, normal: face.normal, baseOpacity, draftCandidate, planar: face.planar !== false, geometryType: face.geometryType, axisOrigin: face.axisOrigin, axisDirection: face.axisDirection, axisKind: face.axisKind }; model.add(mesh);
          if (faceSelected && (solidSelectionMode === "draft-neutral" || solidSelectionMode === "draft-faces")) {
            const overlay = new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial({ color: faceColor(face.id, face.bodyId), transparent: true, opacity: selectedFaceIds.indexOf(face.id) === 0 ? 0.48 : 0.38, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
            overlay.renderOrder = 8; selectedFaceOverlay.add(overlay);
            const overlayEdges = new THREE.LineSegments(new THREE.EdgesGeometry(overlay.geometry, 18), new THREE.LineBasicMaterial({ color: selectedFaceIds.indexOf(face.id) === 0 ? 0xffd36a : 0x72dcff, transparent: true, opacity: 1, depthTest: false, depthWrite: false }));
            overlayEdges.renderOrder = 9; selectedFaceOverlay.add(overlayEdges);
          }
          if (!targetReplacedByPreview || faceSelected) model.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), new THREE.LineBasicMaterial({ color: faceSelected ? faceColor(face.id, face.bodyId) : featureHighlighted ? 0xffdc8a : bodyHighlighted ? 0xd2f4ff : 0x9edcf2, transparent: true, opacity: faceSelected ? 1 : sketchMode ? 0.4 : featureHighlighted ? 1 : 0.65, depthTest: !targetReplacedByPreview })));
        }
        for (const edge of data.edges ?? []) {
          if (hiddenBodyIds.has(edge.bodyId)) continue;
          const targetReplacedByPreview = Boolean(featurePreview && featurePreview.type !== "extrude" && data.previewTargetBodyId === edge.bodyId);
          const axisSelected = selectedRevolveAxis?.kind === "model-edge" && selectedRevolveAxis.bodyId === edge.bodyId && selectedRevolveAxis.edgeIndex === edge.edgeIndex;
          const edgeSelected = selectedEdgeIds.includes(edge.id) || axisSelected;
          const geometry = new THREE.BufferGeometry().setFromPoints(edge.points.map((point) => new THREE.Vector3(...point)));
          const material = new THREE.LineBasicMaterial({ color: edgeSelected ? 0xf6b94d : 0xc4e9f6, transparent: true, opacity: edgeSelected ? 1 : targetReplacedByPreview ? 0.001 : solidSelectionMode === "edges" || referenceAxisPicking || revolveAxisPicking && edge.linear ? 0.38 : 0.04, depthTest: !targetReplacedByPreview || !edgeSelected });
          const line = new THREE.Line(geometry, material);
          line.userData = { edgeId: edge.id, bodyId: edge.bodyId, edgeIndex: edge.edgeIndex, points: edge.points, linear: edge.linear, geometryType: edge.geometryType, axisOrigin: edge.axisOrigin, axisDirection: edge.axisDirection, axisKind: edge.axisKind, baseOpacity: material.opacity, baseColor: edgeSelected ? 0xf6b94d : 0xc4e9f6, selected: edgeSelected, revolveAxis: edge.linear ? { kind: "model-edge", bodyId: edge.bodyId, edgeIndex: edge.edgeIndex, label: `${edge.bodyId} · edge ${edge.edgeIndex}` } satisfies RevolveAxisReference : null };
          line.renderOrder = edgeSelected ? 6 : 3;
          selectableEdges.add(line); if (revolveAxisPicking && edge.linear) revolveAxisHits.push(line);
        }
        for (const sketch of data.sketches.filter((item) => item.visible && item.id !== editingSketchId)) {
          for (const path of sketch.paths) {
            if (path.points.length < 2) continue;
            const geometry = new THREE.BufferGeometry().setFromPoints(path.points.map((point) => new THREE.Vector3(...point)));
            const sketchHighlighted = sketch.id === highlightedSketchId;
            const sketchSelectable = selectableSketchIds?.includes(sketch.id) ?? false;
            const featureProfileHighlighted = sketch.id === highlightedFeatureSketchId;
            const highlightColor = sketchHighlighted ? 0xe9fcff : sketchSelectable ? 0x72e6ff : featureProfileHighlighted ? 0xfff0ae : path.construction ? 0xc084fc : 0xf6b94d;
            const material = path.construction ? new THREE.LineDashedMaterial({ color: highlightColor, dashSize: 4, gapSize: 2, depthTest: false }) : new THREE.LineBasicMaterial({ color: highlightColor, depthTest: false, transparent: true, opacity: 0.95 });
            const axisSelected = selectedRevolveAxis?.kind === "sketch-line" && selectedRevolveAxis.sketchId === sketch.id && selectedRevolveAxis.entityId === path.id;
            if (axisSelected) { material.color.set(0xffd36a); material.opacity = 1; }
            const line = new THREE.Line(geometry, material); line.userData = { sketchId: sketch.id, selectableSketch: sketchSelectable, revolveAxis: path.type === "line" ? { kind: "sketch-line", sketchId: sketch.id, entityId: path.id, label: `${sketch.name} · line` } satisfies RevolveAxisReference : null, baseOpacity: material.opacity, baseColor: material.color.getHex() }; if (path.construction) line.computeLineDistances(); line.renderOrder = axisSelected ? 7 : 4; sketchLayer.add(line);
            if (revolveAxisPicking && path.type === "line") revolveAxisHits.push(line);
            if (sketchHighlighted || sketchSelectable || featureProfileHighlighted) {
              const sourcePoints = path.points.map((point) => new THREE.Vector3(...point));
              const haloPoints: THREE.Vector3[] = [];
              for (let index = 1; index < sourcePoints.length; index++) {
                const start = sourcePoints[index - 1]; const end = sourcePoints[index];
                const steps = Math.max(2, Math.min(28, Math.ceil(start.distanceTo(end) / 4)));
                for (let step = 0; step < steps; step++) haloPoints.push(start.clone().lerp(end, step / steps));
              }
              if (sourcePoints.length) haloPoints.push(sourcePoints.at(-1)!.clone());
              const haloMaterial = new THREE.PointsMaterial({ color: sketchHighlighted || sketchSelectable ? 0x48dcff : 0xffc84a, size: sketchSelectable ? 6.5 : 7.5, sizeAttenuation: false, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
              const halo = new THREE.Points(new THREE.BufferGeometry().setFromPoints(haloPoints), haloMaterial); halo.renderOrder = 7; sketchLayer.add(halo); selectionPulseMaterials.push(haloMaterial);
            }
          }
        }

        if (featurePreview) {
          renderPreviewFaces(data.previewFaces ?? []);

          if (featurePreview.type === "extrude") {
            const previewSketch = data.sketches.find((sketch) => sketch.id === featurePreview.sketchId);
            if (previewSketch) {
            const sketchNormal = new THREE.Vector3(...previewSketch.frame.normal).normalize();
            const originalPlus = featurePreview.extent === "one-sided" ? featurePreview.direction > 0 ? featurePreview.distance : 0 : featurePreview.distancePlus;
            const originalMinus = featurePreview.extent === "one-sided" ? featurePreview.direction < 0 ? featurePreview.distance : 0 : featurePreview.extent === "symmetric" ? featurePreview.distancePlus : featurePreview.distanceMinus;
            extrusionDeformation = { origin: new THREE.Vector3(...previewSketch.frame.origin), normal: sketchNormal.clone(), plus: originalPlus, minus: originalMinus };
            const previewPoints = previewSketch.paths.flatMap((path) => path.points).map((point) => new THREE.Vector3(...point));
            const arrowOrigin = previewPoints.length
              ? new THREE.Box3().setFromPoints(previewPoints).getCenter(new THREE.Vector3())
              : new THREE.Vector3(...previewSketch.frame.origin);
            const arrowColor = featurePreview.combine === "cut" ? 0xff6b6b : 0x5ee6a8;
            const arrowSpecs = featurePreview.extent === "one-sided"
              ? [{ sign: featurePreview.direction, distance: featurePreview.distance }]
              : [
                  { sign: 1, distance: featurePreview.distancePlus },
                  { sign: -1, distance: featurePreview.extent === "symmetric" ? featurePreview.distancePlus : featurePreview.distanceMinus },
                ];
            arrowSpecs.forEach(({ sign, distance }) => {
              const normal = sketchNormal.clone().multiplyScalar(sign);
              const arrowLength = Math.max(18, Math.min(Math.abs(distance), 80));
              const arrow = new THREE.ArrowHelper(normal, arrowOrigin, arrowLength, arrowColor, Math.min(10, arrowLength * 0.35), Math.min(6, arrowLength * 0.22));
              arrow.traverse((child) => {
                if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
                  child.renderOrder = 8;
                  (child.material as THREE.Material).depthTest = false;
                  (child.material as THREE.Material).depthWrite = false;
                }
              });
              scene.add(arrow);
              const hitGeometry = new THREE.CylinderGeometry(4.5, 4.5, 1, 8);
              const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false });
              const hitHandle = new THREE.Mesh(hitGeometry, hitMaterial);
              hitHandle.scale.y = arrowLength + 8; hitHandle.position.copy(arrowOrigin).addScaledVector(normal, arrowLength / 2);
              hitHandle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
              hitHandle.userData = { extrusionDirection: sign as 1 | -1, extrusionDistance: distance, arrowDirection: normal.clone(), arrowOrigin: arrowOrigin.clone(), arrowHelper: arrow };
              hitHandle.renderOrder = 9; scene.add(hitHandle); extrusionArrowHits.push(hitHandle);
            });
            }
          }
          if (featurePreview.type === "chamfer") {
            const selectedEdge = (data.edges ?? []).find((edge) => edge.bodyId === featurePreview.targetBodyId && featurePreview.edgeIndices.includes(edge.edgeIndex));
            if (selectedEdge && selectedEdge.points.length > 1) {
              const edgePoints = selectedEdge.points.map((point) => new THREE.Vector3(...point));
              const arrowOrigin = new THREE.Box3().setFromPoints(edgePoints).getCenter(new THREE.Vector3());
              const tangent = edgePoints.at(-1)!.clone().sub(edgePoints[0]).normalize();
              const reference = Math.abs(tangent.z) < 0.85 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
              const firstAxis = tangent.clone().cross(reference).normalize();
              const secondAxis = tangent.clone().cross(firstAxis).normalize();
              const specs: { parameter: ChamferParameter; value: number; axis: THREE.Vector3; color: number; dragScale: number }[] = [
                { parameter: "distance", value: featurePreview.distance, axis: firstAxis, color: 0x58d6ff, dragScale: 1 },
              ];
              if (featurePreview.method === "distance-distance") specs.push({ parameter: "distance2", value: featurePreview.distance2, axis: secondAxis, color: 0xffc85a, dragScale: 1 });
              if (featurePreview.method === "angle-distance") specs.push({ parameter: "angle", value: featurePreview.angle, axis: secondAxis, color: 0xc084fc, dragScale: 1.5 });
              specs.forEach(({ parameter, value, axis, color, dragScale }) => {
                const displayedValue = parameter === "angle" ? value * 0.8 : value;
                const arrowLength = Math.max(18, Math.min(displayedValue, 80));
                const arrow = new THREE.ArrowHelper(axis, arrowOrigin, arrowLength, color, Math.min(10, arrowLength * 0.35), Math.min(6, arrowLength * 0.22));
                arrow.traverse((child) => {
                  if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
                    child.renderOrder = 8; (child.material as THREE.Material).depthTest = false; (child.material as THREE.Material).depthWrite = false;
                  }
                });
                scene.add(arrow);
                const hitHandle = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 1, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false }));
                hitHandle.scale.y = arrowLength + 8; hitHandle.position.copy(arrowOrigin).addScaledVector(axis, arrowLength / 2);
                hitHandle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
                hitHandle.userData = { chamferParameter: parameter, chamferValue: value, dragScale, arrowDirection: axis.clone(), arrowOrigin: arrowOrigin.clone(), arrowHelper: arrow };
                hitHandle.renderOrder = 9; scene.add(hitHandle); chamferArrowHits.push(hitHandle);
              });
            }
          }
        }

        const size = Math.max(data.properties.bounds.x, data.properties.bounds.y, data.properties.bounds.z, 80);
        if (!sketchMode) {
          for (const reference of document.referenceGeometry ?? []) {
            if (reference.visible === false) continue;
            const selectedReference = reference.id === selectedReferenceId || referencePlanePreview?.referenceId === reference.id || selectedRevolveAxis?.kind === "reference-axis" && selectedRevolveAxis.referenceId === reference.id;
            if (reference.type === "plane") {
              const origin = new THREE.Vector3(...reference.origin); const normal = new THREE.Vector3(...reference.normal).normalize(); const xDir = new THREE.Vector3(...reference.xDir).normalize(); const yDir = normal.clone().cross(xDir).normalize(); const half = Math.max(size * 0.58, 44);
              const corners = [origin.clone().addScaledVector(xDir, -half).addScaledVector(yDir, -half), origin.clone().addScaledVector(xDir, half).addScaledVector(yDir, -half), origin.clone().addScaledVector(xDir, half).addScaledVector(yDir, half), origin.clone().addScaledVector(xDir, -half).addScaledVector(yDir, half)];
              const geometry = new THREE.BufferGeometry().setFromPoints(corners); geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
              const material = new THREE.MeshBasicMaterial({ color: selectedReference ? 0xffd36a : 0xa970ff, transparent: true, opacity: selectedReference ? 0.24 : sketchSupportPicking ? 0.18 : 0.09, depthWrite: false, side: THREE.DoubleSide });
              const plane = new THREE.Mesh(geometry, material); plane.userData = { referenceId: reference.id, referencePlaneId: reference.id, referencePlanePreview: referencePlanePreview?.referenceId === reference.id, baseOpacity: material.opacity, baseColor: material.color.getHex() }; plane.renderOrder = selectedReference ? 7 : 2; scene.add(plane); referenceHits.push(plane); if (sketchSupportPicking) referencePlaneHits.push(plane);
              const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: selectedReference ? 0xffd36a : 0xbc8cff, transparent: true, opacity: selectedReference ? 1 : 0.72, depthTest: false })); outline.renderOrder = 6; scene.add(outline);
              if (referencePlanePreview?.referenceId === reference.id) {
                const arrowColor = 0x63ddff; const arrowLength = Math.max(size * 0.22, 24);
                const positive = new THREE.ArrowHelper(normal, origin, arrowLength, arrowColor, 8, 5); const negative = new THREE.ArrowHelper(normal.clone().multiplyScalar(-1), origin, arrowLength, arrowColor, 8, 5);
                [positive, negative].forEach((arrow) => { arrow.traverse((child) => { if (child instanceof THREE.Line || child instanceof THREE.Mesh) { child.renderOrder = 10; (child.material as THREE.Material).depthTest = false; (child.material as THREE.Material).depthWrite = false; } }); scene.add(arrow); });
                const hit = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, arrowLength * 2.5, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false })); hit.position.copy(origin); hit.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal); hit.userData = { referencePlaneOffset: referencePlanePreview.offset, arrowDirection: normal.clone(), arrowOrigin: origin.clone() }; hit.renderOrder = 11; scene.add(hit); referencePlaneArrowHits.push(hit); referencePlanePreviewTargets.push(plane, outline, positive, negative, hit);
              }
            } else if (reference.type === "axis") {
              const origin = new THREE.Vector3(...reference.origin); const direction = new THREE.Vector3(...reference.direction).normalize(); const length = Math.max(size * 0.9, 72); const geometry = new THREE.BufferGeometry().setFromPoints([origin.clone().addScaledVector(direction, -length), origin.clone().addScaledVector(direction, length)]); const material = new THREE.LineDashedMaterial({ color: selectedReference ? 0xffd36a : 0xf3b34b, dashSize: 5, gapSize: 3, transparent: true, opacity: 0.95, depthTest: false });
              const axis = new THREE.Line(geometry, material); axis.computeLineDistances(); axis.userData = { referenceId: reference.id, baseOpacity: material.opacity, baseColor: material.color.getHex(), revolveAxis: { kind: "reference-axis", referenceId: reference.id, label: reference.name } satisfies RevolveAxisReference }; axis.renderOrder = selectedReference ? 8 : 5; scene.add(axis); referenceHits.push(axis); if (revolveAxisPicking) revolveAxisHits.push(axis);
            } else {
              const material = new THREE.MeshBasicMaterial({ color: selectedReference ? 0xffd36a : 0xf7d154, depthTest: false }); const point = new THREE.Mesh(new THREE.SphereGeometry(Math.max(size * 0.018, 1.7), 14, 10), material); point.position.set(...reference.position); point.userData = { referenceId: reference.id, baseOpacity: 1, baseColor: material.color.getHex() }; point.renderOrder = 8; scene.add(point); referenceHits.push(point);
            }
          }
          if (originCsyVisible || revolveAxisPicking) {
            const selectedOriginAxis = selectedRevolveAxis?.kind === "origin-axis" ? selectedRevolveAxis.axis : undefined;
            const originAxes = addOriginCsy(scene, size, revolveAxisPicking, selectedOriginAxis);
            if (revolveAxisPicking) revolveAxisHits.push(...originAxes);
          }
          (["XY", "XZ", "YZ"] as const).forEach((plane) => {
            if (originPlanesVisible[plane] || sketchSupportPicking) {
              const planeMesh = addOriginPlane(scene, plane, size, sketchSupportPicking);
              if (sketchSupportPicking) originPlaneHits.push(planeMesh);
            }
          });
        }
        if (sketchMode) {
          const frame = data.sketches.find((sketch) => sketch.id === editingSketchId)?.frame;
          if (frame) {
            activeFrame = {
              origin: new THREE.Vector3(...frame.origin),
              xDir: new THREE.Vector3(...frame.xDir).normalize(),
              yDir: new THREE.Vector3(...frame.yDir).normalize(),
              normal: new THREE.Vector3(...frame.normal).normalize(),
            };
            sketchFrameRef.current = activeFrame;
            const initialView = sketchViewRef.current;
            const target = activeFrame.origin.clone().addScaledVector(activeFrame.xDir, initialView.center.x).addScaledVector(activeFrame.yDir, initialView.center.y);
            camera.position.copy(target).addScaledVector(activeFrame.normal, -1000);
            camera.up.copy(activeFrame.yDir).multiplyScalar(-1);
            camera.lookAt(target);
            camera.zoom = Math.max(0.05, Math.min(40, initialView.zoom));
            controls.target.copy(target);
            drawEditingSketch(liveSketchLayer, activeFrame, editingEntitiesRef.current);
            onExternalReferencesChange?.(sketchExternalReferences(data, activeFrame, selectedPlane));
          }
        } else if (!savedViewRef.current) {
          onExternalReferencesChange?.([]);
          controls.target.set(0, 0, data.properties.bounds.z / 2);
          camera.position.set(size * 1.5, -size * 1.7, size * 1.25);
        }
        camera.near = Math.max(0.01, size / 1000); camera.far = Math.max(10000, size * 100); camera.updateProjectionMatrix(); controls.update(); syncSketchView();
        onStatus("ready", data.properties);
      } catch (error) {
        if (!disposed) onStatus(error instanceof TypeError ? "offline" : "error", undefined, error instanceof Error ? error.message : "Document rebuild failed");
      }
    }
    loadDocument();

    const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let pointerDown = { x: 0, y: 0 };
    let hoveredEdge: THREE.Line | null = null;
    let hoveredAxis: THREE.Line | null = null;
    let hoveredReference: THREE.Object3D | null = null;
    let hoveredFace: THREE.Mesh | null = null;
    let hoveredOriginPlane: THREE.Mesh | null = null;
    let arrowDrag: { pointerId: number; direction: 1 | -1; originalDistance: number; pendingDistance: number; axis: THREE.Vector3; origin: THREE.Vector3; plane: THREE.Plane; start: THREE.Vector3; helper: THREE.ArrowHelper; hitHandle: THREE.Mesh } | null = null;
    let chamferDrag: { pointerId: number; parameter: ChamferParameter; originalValue: number; pendingValue: number; dragScale: number; axis: THREE.Vector3; origin: THREE.Vector3; plane: THREE.Plane; start: THREE.Vector3; helper: THREE.ArrowHelper; hitHandle: THREE.Mesh } | null = null;
    let referencePlaneDrag: { pointerId: number; originalOffset: number; pendingOffset: number; lastOffset: number; axis: THREE.Vector3; plane: THREE.Plane; start: THREE.Vector3 } | null = null;
    let chamferPreviewFrame = 0;
    let chamferPreviewAbort: AbortController | null = null;
    let pendingChamferPreview: { parameter: ChamferParameter; value: number } | null = null;
    const refreshChamferPreview = (parameter: ChamferParameter, value: number) => {
      if (!featurePreview || featurePreview.type !== "chamfer") return;
      pendingChamferPreview = { parameter, value };
      if (chamferPreviewFrame) return;
      chamferPreviewFrame = requestAnimationFrame(async () => {
        chamferPreviewFrame = 0;
        const pending = pendingChamferPreview; pendingChamferPreview = null;
        if (!pending || disposed) return;
        chamferPreviewAbort?.abort(); chamferPreviewAbort = new AbortController();
        const request = JSON.parse(documentRequestKey) as DocumentRequest & { previewFeature?: FeaturePreview };
        if (!request.previewFeature || request.previewFeature.type !== "chamfer") return;
        request.previewFeature = { ...request.previewFeature, [pending.parameter]: pending.value };
        try {
          const response = await fetch(`${API}/api/document`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: chamferPreviewAbort.signal });
          if (!response.ok) return;
          const data = await response.json() as DocumentPayload;
          if (!disposed) renderPreviewFaces(data.previewFaces ?? []);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) { /* Keep the last valid preview while the drag crosses an invalid value. */ }
        }
      });
    };
    raycaster.params.Line = { threshold: referenceAxisPicking ? 1.25 : 4 };
    const pointRayAt = (event: PointerEvent) => { const bounds = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1; pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1; raycaster.setFromCamera(pointer, camera); };
    const meshHits = () => raycaster.intersectObjects(model.children.filter((object) => object instanceof THREE.Mesh && (!referencePlanePicking || object.userData.planar) && (!referenceAxisPicking || object.userData.axisDirection) && (solidSelectionMode !== "draft-neutral" || object.userData.planar) && (solidSelectionMode !== "draft-faces" || object.userData.draftCandidate)), false);
    const visibleOriginPlaneHit = () => {
      if (!sketchSupportPicking || !originPlaneHits.length) return null;
      const planeHit = raycaster.intersectObjects(originPlaneHits, false)[0];
      if (!planeHit) return null;
      const faceHit = meshHits()[0];
      return !faceHit || planeHit.distance < faceHit.distance - 0.5 ? planeHit : null;
    };
    const visibleReferencePlaneHit = () => {
      if (!sketchSupportPicking || !referencePlaneHits.length) return null;
      const planeHit = raycaster.intersectObjects(referencePlaneHits, false)[0]; if (!planeHit) return null;
      const faceHit = meshHits()[0]; return !faceHit || planeHit.distance < faceHit.distance - 0.5 ? planeHit : null;
    };
    const visibleReferenceHit = () => {
      if (sketchSupportPicking || revolveAxisPicking || !referenceHits.length) return null;
      const referenceHit = raycaster.intersectObjects(referenceHits.filter((object) => !object.userData.referencePlanePreview), false)[0]; if (!referenceHit) return null;
      const faceHit = meshHits()[0]; return !faceHit || referenceHit.distance <= faceHit.distance + raycaster.params.Line.threshold ? referenceHit : null;
    };
    const visibleEdgeHit = () => {
      const edgeHit = raycaster.intersectObjects(selectableEdges.children, false)[0];
      if (!edgeHit) return null;
      const faceHit = meshHits()[0];
      return !faceHit || edgeHit.distance <= faceHit.distance + raycaster.params.Line.threshold ? edgeHit : null;
    };
    const visibleRevolveAxisHit = () => {
      if (!revolveAxisPicking) return null;
      const axisHit = raycaster.intersectObjects(revolveAxisHits, false)[0];
      if (!axisHit) return null;
      const faceHit = meshHits()[0];
      return !faceHit || axisHit.distance <= faceHit.distance + raycaster.params.Line.threshold ? axisHit : null;
    };
    const onDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY };
      if (event.button !== 0 || (!extrusionArrowHits.length && !chamferArrowHits.length && !referencePlaneArrowHits.length)) return;
      pointRayAt(event);
      const hit = raycaster.intersectObjects([...extrusionArrowHits, ...chamferArrowHits, ...referencePlaneArrowHits], false)[0]; if (!hit) return;
      const handle = hit.object as THREE.Mesh; const axis = (handle.userData.arrowDirection as THREE.Vector3).clone(); const cameraDirection = new THREE.Vector3(); camera.getWorldDirection(cameraDirection);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDirection, hit.point); const start = raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? hit.point.clone();
      if (handle.userData.referencePlaneOffset !== undefined) {
        referencePlaneDrag = { pointerId: event.pointerId, originalOffset: handle.userData.referencePlaneOffset, pendingOffset: handle.userData.referencePlaneOffset, lastOffset: handle.userData.referencePlaneOffset, axis, plane, start };
      } else if (handle.userData.chamferParameter) {
        chamferDrag = { pointerId: event.pointerId, parameter: handle.userData.chamferParameter, originalValue: handle.userData.chamferValue, pendingValue: handle.userData.chamferValue, dragScale: handle.userData.dragScale, axis, origin: (handle.userData.arrowOrigin as THREE.Vector3).clone(), plane, start, helper: handle.userData.arrowHelper, hitHandle: handle };
      } else {
        arrowDrag = { pointerId: event.pointerId, direction: handle.userData.extrusionDirection, originalDistance: handle.userData.extrusionDistance, pendingDistance: handle.userData.extrusionDistance, axis, origin: (handle.userData.arrowOrigin as THREE.Vector3).clone(), plane, start, helper: handle.userData.arrowHelper, hitHandle: handle };
      }
      controls.enabled = false; renderer.domElement.setPointerCapture(event.pointerId); renderer.domElement.style.cursor = "grabbing"; event.preventDefault(); event.stopPropagation();
    };
    const onMove = (event: PointerEvent) => {
      pointRayAt(event);
      if (referencePlaneDrag) {
        const current = raycaster.ray.intersectPlane(referencePlaneDrag.plane, new THREE.Vector3()); if (!current) return;
        const offset = referencePlaneDrag.originalOffset + current.sub(referencePlaneDrag.start).dot(referencePlaneDrag.axis); const delta = offset - referencePlaneDrag.lastOffset; referencePlaneDrag.lastOffset = offset; referencePlaneDrag.pendingOffset = offset;
        referencePlanePreviewTargets.forEach((target) => target.position.addScaledVector(referencePlaneDrag!.axis, delta)); onReferencePlaneOffsetChange?.(offset, "preview"); return;
      }
      if (arrowDrag) {
        const current = raycaster.ray.intersectPlane(arrowDrag.plane, new THREE.Vector3()); if (!current) return;
        const distance = Math.max(0.1, arrowDrag.originalDistance + current.sub(arrowDrag.start).dot(arrowDrag.axis)); arrowDrag.pendingDistance = distance;
        const visibleLength = Math.max(18, Math.min(distance, 80)); arrowDrag.helper.setLength(visibleLength, Math.min(10, visibleLength * 0.35), Math.min(6, visibleLength * 0.22));
        arrowDrag.hitHandle.scale.y = visibleLength + 8; arrowDrag.hitHandle.position.copy(arrowDrag.origin).addScaledVector(arrowDrag.axis, visibleLength / 2); deformExtrusionPreview(arrowDrag.direction, distance); onFeaturePreviewDistanceChange?.(arrowDrag.direction, distance, "preview"); return;
      }
      if (chamferDrag) {
        const current = raycaster.ray.intersectPlane(chamferDrag.plane, new THREE.Vector3()); if (!current) return;
        const rawValue = chamferDrag.originalValue + current.sub(chamferDrag.start).dot(chamferDrag.axis) * chamferDrag.dragScale;
        const value = chamferDrag.parameter === "angle" ? Math.max(1, Math.min(89, rawValue)) : Math.max(0.1, rawValue);
        chamferDrag.pendingValue = value;
        const displayedValue = chamferDrag.parameter === "angle" ? value * 0.8 : value;
        const visibleLength = Math.max(18, Math.min(displayedValue, 80));
        chamferDrag.helper.setLength(visibleLength, Math.min(10, visibleLength * 0.35), Math.min(6, visibleLength * 0.22));
        chamferDrag.hitHandle.scale.y = visibleLength + 8; chamferDrag.hitHandle.position.copy(chamferDrag.origin).addScaledVector(chamferDrag.axis, visibleLength / 2);
        refreshChamferPreview(chamferDrag.parameter, value); onChamferPreviewParameterChange?.(chamferDrag.parameter, value, "preview"); return;
      }
      const arrowHovered = (extrusionArrowHits.length > 0 || chamferArrowHits.length > 0 || referencePlaneArrowHits.length > 0) && raycaster.intersectObjects([...extrusionArrowHits, ...chamferArrowHits, ...referencePlaneArrowHits], false).length > 0;
      if (hoveredEdge) {
        const material = hoveredEdge.material as THREE.LineBasicMaterial;
        material.opacity = hoveredEdge.userData.baseOpacity; material.color.set(hoveredEdge.userData.selected ? 0xf6b94d : 0xc4e9f6); hoveredEdge = null;
      }
      if (hoveredAxis) {
        const material = hoveredAxis.material as THREE.LineBasicMaterial;
        material.opacity = hoveredAxis.userData.baseOpacity ?? 0.82; material.color.set(hoveredAxis.userData.baseColor ?? 0xc4e9f6); hoveredAxis = null;
      }
      if (hoveredReference) {
        const material = (hoveredReference as THREE.Mesh | THREE.Line).material as THREE.MeshBasicMaterial;
        material.opacity = hoveredReference.userData.baseOpacity ?? 1; material.color.set(hoveredReference.userData.baseColor ?? 0xa970ff); hoveredReference = null;
      }
      if (hoveredFace) {
        const material = hoveredFace.material as THREE.MeshStandardMaterial; material.color.set(faceColor(hoveredFace.userData.faceId, hoveredFace.userData.bodyId)); material.opacity = hoveredFace.userData.baseOpacity; hoveredFace = null;
      }
      if (hoveredOriginPlane) {
        (hoveredOriginPlane.material as THREE.MeshBasicMaterial).opacity = hoveredOriginPlane.userData.baseOpacity; hoveredOriginPlane = null;
      }
      const axisHit = visibleRevolveAxisHit();
      if (axisHit?.object instanceof THREE.Line) {
        hoveredAxis = axisHit.object; const material = hoveredAxis.material as THREE.LineBasicMaterial; material.opacity = 1; material.color.set(0xffd36a);
      }
      const planeHit = revolveAxisPicking ? null : visibleReferencePlaneHit() ?? visibleOriginPlaneHit();
      if (planeHit?.object instanceof THREE.Mesh) {
        hoveredOriginPlane = planeHit.object; const material = hoveredOriginPlane.material as THREE.MeshBasicMaterial; material.opacity = 0.42;
      }
      const referenceHit = visibleReferenceHit();
      if (!axisHit && !planeHit && referenceHit?.object) {
        hoveredReference = referenceHit.object; const material = (hoveredReference as THREE.Mesh | THREE.Line).material as THREE.MeshBasicMaterial; material.opacity = 1; material.color.set(0xffd36a);
      }
      const edgeHit = referencePlanePicking || revolveAxisPicking || solidSelectionMode === "draft-neutral" || solidSelectionMode === "draft-faces" ? null : visibleEdgeHit();
      if (edgeHit?.object instanceof THREE.Line) {
        hoveredEdge = edgeHit.object; const material = hoveredEdge.material as THREE.LineBasicMaterial; material.opacity = 1; material.color.set(0xffd36a);
      } else if (!edgeHit && !planeHit && (referenceAxisPicking || referencePlanePicking || sketchSupportPicking || solidSelectionMode === "draft-neutral" || solidSelectionMode === "draft-faces")) {
        const faceHit = meshHits()[0]; if (faceHit?.object instanceof THREE.Mesh) { hoveredFace = faceHit.object; const material = hoveredFace.material as THREE.MeshStandardMaterial; material.color.set(0xffd36a); material.opacity = Math.max(material.opacity, 0.22); }
      }
      renderer.domElement.style.cursor = arrowHovered ? "grab" : selectableSketchIds !== null || hoveredReference || hoveredAxis || hoveredOriginPlane || hoveredEdge || hoveredFace || referenceAxisPicking || referencePlanePicking || solidSelectionMode || sketchSupportPicking ? "pointer" : "";
    };
    const finishArrowDrag = (commit: boolean) => {
      if (!arrowDrag) return false;
      const completed = arrowDrag; arrowDrag = null; controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(completed.pointerId)) renderer.domElement.releasePointerCapture(completed.pointerId);
      renderer.domElement.style.cursor = "grab";
      if (commit) onFeaturePreviewDistanceChange?.(completed.direction, completed.pendingDistance, "commit");
      else { const visibleLength = Math.max(18, Math.min(completed.originalDistance, 80)); completed.helper.setLength(visibleLength, Math.min(10, visibleLength * 0.35), Math.min(6, visibleLength * 0.22)); completed.hitHandle.scale.y = visibleLength + 8; completed.hitHandle.position.copy(completed.origin).addScaledVector(completed.axis, visibleLength / 2); deformExtrusionPreview(completed.direction, completed.originalDistance); onFeaturePreviewDistanceChange?.(completed.direction, completed.originalDistance, "cancel"); }
      return true;
    };
    const finishChamferDrag = (commit: boolean) => {
      if (!chamferDrag) return false;
      const completed = chamferDrag; chamferDrag = null; controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(completed.pointerId)) renderer.domElement.releasePointerCapture(completed.pointerId);
      renderer.domElement.style.cursor = "grab";
      if (commit) onChamferPreviewParameterChange?.(completed.parameter, completed.pendingValue, "commit");
      else {
        const displayedValue = completed.parameter === "angle" ? completed.originalValue * 0.8 : completed.originalValue;
        const visibleLength = Math.max(18, Math.min(displayedValue, 80)); completed.helper.setLength(visibleLength, Math.min(10, visibleLength * 0.35), Math.min(6, visibleLength * 0.22));
        completed.hitHandle.scale.y = visibleLength + 8; completed.hitHandle.position.copy(completed.origin).addScaledVector(completed.axis, visibleLength / 2);
        refreshChamferPreview(completed.parameter, completed.originalValue); onChamferPreviewParameterChange?.(completed.parameter, completed.originalValue, "cancel");
      }
      return true;
    };
    const finishReferencePlaneDrag = (commit: boolean) => {
      if (!referencePlaneDrag) return false;
      const completed = referencePlaneDrag; referencePlaneDrag = null; controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(completed.pointerId)) renderer.domElement.releasePointerCapture(completed.pointerId);
      renderer.domElement.style.cursor = "grab";
      if (commit) onReferencePlaneOffsetChange?.(completed.pendingOffset, "commit");
      else { const delta = completed.originalOffset - completed.lastOffset; referencePlanePreviewTargets.forEach((target) => target.position.addScaledVector(completed.axis, delta)); onReferencePlaneOffsetChange?.(completed.originalOffset, "cancel"); }
      return true;
    };
    const onUp = (event: PointerEvent) => {
      if (finishArrowDrag(true) || finishChamferDrag(true) || finishReferencePlaneDrag(true)) return;
      if (sketchMode || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) return;
      pointRayAt(event);
      if (selectableSketchIds !== null) {
        const sketchHit = raycaster.intersectObjects(sketchLayer.children.filter((object) => object instanceof THREE.Line && object.userData.selectableSketch), false)[0];
        if (sketchHit?.object.userData.sketchId) onSelectSketch?.(sketchHit.object.userData.sketchId);
        return;
      }
      const revolveAxisHit = visibleRevolveAxisHit();
      if (revolveAxisHit?.object.userData.revolveAxis) {
        onSelectRevolveAxis?.(revolveAxisHit.object.userData.revolveAxis as RevolveAxisReference); return;
      }
      const referencePlaneHit = visibleReferencePlaneHit();
      if (referencePlaneHit?.object.userData.referencePlaneId) {
        onSelectReferencePlane?.(referencePlaneHit.object.userData.referencePlaneId); return;
      }
      const originPlaneHit = visibleOriginPlaneHit();
      if (originPlaneHit?.object.userData.originPlane) {
        onSelectPlane?.(originPlaneHit.object.userData.originPlane); return;
      }
      const referenceHit = visibleReferenceHit();
      if (referenceHit?.object.userData.referenceId) {
        onSelectReference?.(referenceHit.object.userData.referenceId); return;
      }
      if (!referencePlanePicking && solidSelectionMode !== "draft-neutral" && solidSelectionMode !== "draft-faces") {
        const edgeHit = visibleEdgeHit();
        if (edgeHit?.object.userData.edgeId) {
          onSelectEdge?.({ id: edgeHit.object.userData.edgeId, bodyId: edgeHit.object.userData.bodyId, edgeIndex: edgeHit.object.userData.edgeIndex, points: edgeHit.object.userData.points, linear: edgeHit.object.userData.linear, geometryType: edgeHit.object.userData.geometryType, axisOrigin: edgeHit.object.userData.axisOrigin, axisDirection: edgeHit.object.userData.axisDirection, axisKind: edgeHit.object.userData.axisKind }, event.shiftKey);
          return;
        }
        if (solidSelectionMode === "edges") return;
      }
      const hit = meshHits()[0]; setSelected((hit?.object as THREE.Mesh) ?? null, event.shiftKey);
    };
    const onCancel = () => { finishArrowDrag(false); finishChamferDrag(false); finishReferencePlaneDrag(false); };
    renderer.domElement.addEventListener("pointerdown", onDown); renderer.domElement.addEventListener("pointermove", onMove); renderer.domElement.addEventListener("pointerup", onUp); renderer.domElement.addEventListener("pointercancel", onCancel);

    const resize = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect(); const aspect = width / Math.max(height, 1); renderer.setSize(width, height, false);
      if (camera instanceof THREE.PerspectiveCamera) camera.aspect = aspect;
      else if (aspect >= 520 / 360) { camera.left = -260; camera.right = 260; camera.top = 260 / aspect; camera.bottom = -260 / aspect; }
      else { camera.left = -180 * aspect; camera.right = 180 * aspect; camera.top = 180; camera.bottom = -180; }
      camera.updateProjectionMatrix();
    });
    resize.observe(host);
    let animation = 0; const render = () => { const pulse = 0.58 + Math.sin(performance.now() / 170) * 0.4; selectionPulseMaterials.forEach((material) => { material.opacity = pulse; }); controls.update(); renderer.render(scene, camera); animation = requestAnimationFrame(render); }; render();

    return () => {
      if (!sketchMode && camera instanceof THREE.PerspectiveCamera) savedViewRef.current = { position: camera.position.clone(), target: controls.target.clone(), up: camera.up.clone() };
      disposed = true; cancelAnimationFrame(animation); if (chamferPreviewFrame) cancelAnimationFrame(chamferPreviewFrame); chamferPreviewAbort?.abort(); resize.disconnect(); renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointermove", onMove); renderer.domElement.removeEventListener("pointerup", onUp); renderer.domElement.removeEventListener("pointercancel", onCancel);
      controls.removeEventListener("change", syncSketchView); controls.dispose(); navigationElement.removeEventListener("contextmenu", preventContextMenu);
      if (liveSketchGroupRef.current === liveSketchLayer) liveSketchGroupRef.current = null;
      if (sketchFrameRef.current === activeFrame) sketchFrameRef.current = null;
      scene.traverse((object) => { if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Line || object instanceof THREE.Points) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [documentRequestKey, editingSketchId, featurePreview, hiddenBodyKey, highlightedFeatureBodyId, highlightedFeatureSketchId, highlightedSketchId, selectableSketchKey, selectedEdgeKey, selectedFaceKey, sketchSupportPicking, solidSelectionMode, selectedPlane, showModelGrid, originCsyVisible, originPlanesVisible, snapNormalRequest, selectedBodyId, selectedReferenceId, referenceAxisPicking, referencePlanePicking, referencePlanePreviewKey, revolveAxisPicking, revolveAxisKey, onChamferPreviewParameterChange, onExternalReferencesChange, onFeaturePreviewDistanceChange, onReferencePlaneOffsetChange, onSelectEdge, onSelectFace, onSelectPlane, onSelectReference, onSelectReferencePlane, onSelectRevolveAxis, onSelectSketch, onSketchRotatedChange, onSketchViewChange, onStatus]);

  return <div ref={hostRef} className={`webgl-host ${selectableSketchIds !== null ? "sketch-profile-picking" : ""} ${referencePlanePicking ? "reference-plane-picking" : ""} ${referenceAxisPicking ? "reference-axis-picking" : ""} ${revolveAxisPicking ? "revolve-axis-picking" : ""} ${solidSelectionMode ? `solid-${solidSelectionMode}` : ""}`} />;
}
