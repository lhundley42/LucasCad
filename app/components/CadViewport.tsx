"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { sampleSketchEntity, type SketchEntity } from "./sketchGeometry";
import type { ExternalSketchReference, SketchView } from "./Sketcher";

type VectorTuple = [number, number, number];
type FacePayload = { id: string; bodyId: string; faceIndex: number; vertices: VectorTuple[]; triangles: VectorTuple[] };
type EdgePayload = { id: string; bodyId: string; edgeIndex: number; points: VectorTuple[] };
type SketchFrame = { origin: VectorTuple; xDir: VectorTuple; yDir: VectorTuple; normal: VectorTuple };
type SketchPayload = { id: string; name: string; visible: boolean; frame: SketchFrame; paths: { id: string; construction: boolean; points: VectorTuple[] }[] };
type DocumentPayload = {
  faces: FacePayload[];
  edges?: EdgePayload[];
  previewFaces?: FacePayload[];
  sketches: SketchPayload[];
  properties: { valid: boolean; solidCount: number; bodyCount: number; faceCount: number; edgeCount: number; volume: number; bounds: { x: number; y: number; z: number } };
};
export type SketchPlane = "XY" | "XZ" | "YZ" | { kind: "face"; bodyId: string; faceIndex: number; faceId: string };
export type SketchRecord = { id: string; name: string; plane: SketchPlane; entities: unknown[]; visible?: boolean };
export type FeatureRecord = { id: string; name: string; type: "extrude" | "revolve"; sketchId: string; combine: "new" | "union" | "cut"; bodyId?: string; targetBodyId?: string; extent?: "one-sided" | "symmetric" | "bidirectional"; distance?: number; distancePlus?: number; distanceMinus?: number; direction?: 1 | -1; angle?: number; axis?: "construction" | "origin-x" | "origin-y" | "profile-left" };
export type DocumentRequest = { sketches: SketchRecord[]; features: FeatureRecord[] };
export type SelectedFace = { id: string; bodyId: string; faceIndex: number };
type DocumentStatus = "idle" | "connecting" | "ready" | "offline" | "error";
type SavedView = { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 };

type Props = {
  document: DocumentRequest;
  editingSketchId?: string | null;
  editingSketch?: { id: string; entities: SketchEntity[] } | null;
  sketchView?: SketchView;
  snapNormalRequest?: number;
  featurePreview?: { type: "extrude"; sketchId: string; combine: "new" | "union" | "cut"; targetBodyId?: string; extent: "one-sided" | "symmetric" | "bidirectional"; distance: number; distancePlus: number; distanceMinus: number; direction: 1 | -1 } | null;
  selectedBodyId?: string | null;
  selectedPlane?: "XY" | "XZ" | "YZ" | null;
  highlightedSketchId?: string | null;
  highlightedFeatureId?: string | null;
  onSketchViewChange?: (view: SketchView) => void;
  onSketchRotatedChange?: (rotated: boolean) => void;
  onExternalReferencesChange?: (references: ExternalSketchReference[]) => void;
  onSelectFace: (face: SelectedFace | null) => void;
  onStatus: (status: DocumentStatus, properties?: DocumentPayload["properties"], message?: string) => void;
};

type WorldSketchFrame = { origin: THREE.Vector3; xDir: THREE.Vector3; yDir: THREE.Vector3; normal: THREE.Vector3 };
const API = typeof window === "undefined" ? "http://127.0.0.1:8000" : `${window.location.protocol}//${window.location.hostname}:8000`;

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

export function CadViewport({ document, editingSketchId = null, editingSketch = null, sketchView, snapNormalRequest = 0, featurePreview = null, selectedBodyId = null, selectedPlane = null, highlightedSketchId = null, highlightedFeatureId = null, onSketchViewChange, onSketchRotatedChange, onExternalReferencesChange, onSelectFace, onStatus }: Props) {
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
      const grid = new THREE.GridHelper(520, 34, 0x3e5264, 0x263644); grid.rotation.x = Math.PI / 2; grid.position.z = -0.08; scene.add(grid, new THREE.AxesHelper(45));
    }

    const model = new THREE.Group();
    const sketchLayer = new THREE.Group();
    const liveSketchLayer = new THREE.Group();
    liveSketchGroupRef.current = liveSketchLayer;
    scene.add(model, sketchLayer, liveSketchLayer);
    let selected: THREE.Mesh | null = null;
    let disposed = false;
    let activeFrame: WorldSketchFrame | null = null;
    let lastRotated: boolean | null = null;
    let lastView = sketchViewRef.current;
    const selectionPulseMaterials: THREE.PointsMaterial[] = [];

    const bodyColor = (bodyId: string) => highlightedFeatureBodyId === bodyId ? 0xe7a63d : selectedBodyId === bodyId ? 0x4fb9df : 0x3097bd;
    const setSelected = (mesh: THREE.Mesh | null) => {
      if (selected) (selected.material as THREE.MeshStandardMaterial).color.set(bodyColor(selected.userData.bodyId));
      selected = mesh;
      if (selected) (selected.material as THREE.MeshStandardMaterial).color.set(0x8cddf7);
      onSelectFace(mesh ? { id: mesh.userData.faceId, bodyId: mesh.userData.bodyId, faceIndex: mesh.userData.faceIndex } : null);
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
        for (const face of data.faces) {
          const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(face.vertices.flat(), 3)); geometry.setIndex(face.triangles.flat()); geometry.computeVertexNormals();
          const bodyHighlighted = selectedBodyId === face.bodyId;
          const featureHighlighted = highlightedFeatureBodyId === face.bodyId;
          const material = new THREE.MeshStandardMaterial({ color: bodyColor(face.bodyId), emissive: featureHighlighted ? 0x4a2500 : 0x000000, emissiveIntensity: featureHighlighted ? 0.45 : 0, roughness: 0.55, metalness: 0.06, side: THREE.DoubleSide, transparent: sketchMode, opacity: sketchMode ? 0.42 : 1, depthWrite: !sketchMode });
          const mesh = new THREE.Mesh(geometry, material); mesh.userData = { faceId: face.id, bodyId: face.bodyId, faceIndex: face.faceIndex }; model.add(mesh);
          model.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), new THREE.LineBasicMaterial({ color: featureHighlighted ? 0xffdc8a : bodyHighlighted ? 0xd2f4ff : 0x9edcf2, transparent: true, opacity: sketchMode ? 0.4 : featureHighlighted ? 1 : 0.65 })));
        }
        for (const sketch of data.sketches.filter((item) => item.visible && item.id !== editingSketchId)) {
          for (const path of sketch.paths) {
            if (path.points.length < 2) continue;
            const geometry = new THREE.BufferGeometry().setFromPoints(path.points.map((point) => new THREE.Vector3(...point)));
            const sketchHighlighted = sketch.id === highlightedSketchId;
            const featureProfileHighlighted = sketch.id === highlightedFeatureSketchId;
            const highlightColor = sketchHighlighted ? 0xe9fcff : featureProfileHighlighted ? 0xfff0ae : path.construction ? 0xc084fc : 0xf6b94d;
            const material = path.construction ? new THREE.LineDashedMaterial({ color: highlightColor, dashSize: 4, gapSize: 2, depthTest: false }) : new THREE.LineBasicMaterial({ color: highlightColor, depthTest: false, transparent: true, opacity: 0.95 });
            const line = new THREE.Line(geometry, material); if (path.construction) line.computeLineDistances(); line.renderOrder = 4; sketchLayer.add(line);
            if (sketchHighlighted || featureProfileHighlighted) {
              const sourcePoints = path.points.map((point) => new THREE.Vector3(...point));
              const haloPoints: THREE.Vector3[] = [];
              for (let index = 1; index < sourcePoints.length; index++) {
                const start = sourcePoints[index - 1]; const end = sourcePoints[index];
                const steps = Math.max(2, Math.min(28, Math.ceil(start.distanceTo(end) / 4)));
                for (let step = 0; step < steps; step++) haloPoints.push(start.clone().lerp(end, step / steps));
              }
              if (sourcePoints.length) haloPoints.push(sourcePoints.at(-1)!.clone());
              const haloMaterial = new THREE.PointsMaterial({ color: sketchHighlighted ? 0x48dcff : 0xffc84a, size: 7.5, sizeAttenuation: false, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
              const halo = new THREE.Points(new THREE.BufferGeometry().setFromPoints(haloPoints), haloMaterial); halo.renderOrder = 7; sketchLayer.add(halo); selectionPulseMaterials.push(haloMaterial);
            }
          }
        }

        if (featurePreview) {
          const previewColor = featurePreview.combine === "cut" ? 0xff5264 : 0x52e3a0;
          for (const face of data.previewFaces ?? []) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.Float32BufferAttribute(face.vertices.flat(), 3));
            geometry.setIndex(face.triangles.flat());
            geometry.computeVertexNormals();
            const phantom = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
              color: previewColor,
              emissive: previewColor,
              emissiveIntensity: 0.18,
              roughness: 0.38,
              metalness: 0,
              transparent: true,
              opacity: featurePreview.combine === "cut" ? 0.34 : 0.28,
              depthWrite: false,
              side: THREE.DoubleSide,
            }));
            phantom.renderOrder = 5;
            scene.add(phantom);
            const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 18), new THREE.LineBasicMaterial({ color: previewColor, transparent: true, opacity: 0.9, depthWrite: false }));
            outline.renderOrder = 6;
            scene.add(outline);
          }

          const previewSketch = data.sketches.find((sketch) => sketch.id === featurePreview.sketchId);
          if (previewSketch) {
            const sketchNormal = new THREE.Vector3(...previewSketch.frame.normal).normalize();
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
            });
          }
        }

        const size = Math.max(data.properties.bounds.x, data.properties.bounds.y, data.properties.bounds.z, 80);
        if (selectedPlane && !sketchMode) {
          const planeSize = Math.max(size * 1.8, 140);
          const geometry = new THREE.PlaneGeometry(planeSize, planeSize);
          const colors = { XY: 0x3b82f6, XZ: 0x22c55e, YZ: 0xef4444 } as const;
          const planeMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: colors[selectedPlane], transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
          if (selectedPlane === "XZ") planeMesh.rotation.x = Math.PI / 2;
          if (selectedPlane === "YZ") planeMesh.rotation.y = Math.PI / 2;
          scene.add(planeMesh);
          const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: colors[selectedPlane], transparent: true, opacity: 0.9, depthTest: false }));
          outline.rotation.copy(planeMesh.rotation); outline.renderOrder = 7; scene.add(outline);
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
    const onDown = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY }; };
    const onUp = (event: PointerEvent) => {
      if (sketchMode || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) return;
      const bounds = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1; pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(model.children.filter((object) => object instanceof THREE.Mesh), false)[0]; setSelected((hit?.object as THREE.Mesh) ?? null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown); renderer.domElement.addEventListener("pointerup", onUp);

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
      disposed = true; cancelAnimationFrame(animation); resize.disconnect(); renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp);
      controls.removeEventListener("change", syncSketchView); controls.dispose(); navigationElement.removeEventListener("contextmenu", preventContextMenu);
      if (liveSketchGroupRef.current === liveSketchLayer) liveSketchGroupRef.current = null;
      if (sketchFrameRef.current === activeFrame) sketchFrameRef.current = null;
      scene.traverse((object) => { if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Line || object instanceof THREE.Points) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [documentRequestKey, editingSketchId, featurePreview, highlightedFeatureBodyId, highlightedFeatureSketchId, highlightedSketchId, selectedPlane, snapNormalRequest, selectedBodyId, onExternalReferencesChange, onSelectFace, onSketchRotatedChange, onSketchViewChange, onStatus]);

  return <div ref={hostRef} className="webgl-host" />;
}
