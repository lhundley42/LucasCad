"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CadViewport, type DocumentRequest, type FeatureRecord, type SelectedFace, type SketchPlane, type SketchRecord } from "./components/CadViewport";
import { Sketcher, type ExternalSketchReference, type LinearDimensionConstraint, type SketchEntity, type SketchView } from "./components/Sketcher";
import { DEFAULT_GLOBAL_SETTINGS, GLOBAL_SETTINGS_STORAGE_KEY, parseGlobalSettings, type GlobalAppSettings } from "./components/appSettings";
import { fromMillimeters, toMillimeters, unitSuffix } from "./components/units";

type LocalSketch = Omit<SketchRecord, "entities"> & { entities: SketchEntity[]; constraints?: LinearDimensionConstraint[]; dimensionOffsets?: Record<string, { x: number; y: number }> };
type KernelStatus = "idle" | "connecting" | "ready" | "offline" | "error";
type Properties = { valid: boolean; solidCount: number; bodyCount: number; faceCount: number; edgeCount: number; volume: number; bounds: { x: number; y: number; z: number } };
type FeatureDraft = { type: "extrude" | "revolve"; sketchId: string; combine: "new" | "union" | "cut"; targetBodyId: string; extent: "one-sided" | "symmetric" | "bidirectional"; distance: number; distancePlus: number; distanceMinus: number; direction: 1 | -1; angle: number; axis: "construction" | "origin-x" | "origin-y" | "profile-left" };
type ValidationResult = { closed: boolean; profileCount: number; openEndpoints: { x: number; y: number }[]; issues: string[] };

const API = typeof window === "undefined" ? "http://127.0.0.1:8000" : `${window.location.protocol}//${window.location.hostname}:8000`;
const planeLabel = (plane: SketchPlane) => typeof plane === "string" ? `${plane} origin plane` : `${plane.bodyId}, face ${plane.faceIndex}`;
const defaultSketchView = (): SketchView => ({ center: { x: 0, y: 0 }, zoom: 1 });

function download(name: string, content: string, type: string) {
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); URL.revokeObjectURL(link.href);
}

export default function Home() {
  const [sketches, setSketches] = useState<LocalSketch[]>([]);
  const [features, setFeatures] = useState<FeatureRecord[]>([]);
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
  const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);
  const [validationDialog, setValidationDialog] = useState<{ sketch: LocalSketch; result: ValidationResult } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: "sketch" | "feature"; id: string } | null>(null);
  const [kernelStatus, setKernelStatus] = useState<KernelStatus>("idle");
  const [kernelMessage, setKernelMessage] = useState<string | null>(null);
  const [properties, setProperties] = useState<Properties | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<GlobalAppSettings>(DEFAULT_GLOBAL_SETTINGS);
  const [externalSketchReferences, setExternalSketchReferences] = useState<ExternalSketchReference[]>([]);

  const cadDocument = useMemo<DocumentRequest>(() => ({ sketches, features }), [sketches, features]);
  const bodyIds = useMemo(() => features.filter((feature) => feature.combine === "new" && feature.bodyId).map((feature) => feature.bodyId!), [features]);
  const editingSketch = sketches.find((sketch) => sketch.id === editingSketchId) ?? null;
  const selectedSketch = sketches.find((sketch) => sketch.id === selectedSketchId) ?? null;
  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId) ?? null;
  const selectedBodyIndex = selectedBodyId ? bodyIds.indexOf(selectedBodyId) : -1;
  const selectedBodyFeatures = selectedBodyId ? features.filter((feature) => feature.bodyId === selectedBodyId || feature.targetBodyId === selectedBodyId) : [];
  const editingFeatureIndex = editingFeatureId ? features.findIndex((feature) => feature.id === editingFeatureId) : -1;
  const featureBaseFeatures = editingFeatureIndex >= 0 ? features.slice(0, editingFeatureIndex) : features;
  const featureTargetBodyIds = featureBaseFeatures.filter((feature) => feature.combine === "new" && feature.bodyId).map((feature) => feature.bodyId!);
  const featurePreviewDocument = useMemo<DocumentRequest>(() => ({ sketches, features: featureBaseFeatures }), [featureBaseFeatures, sketches]);
  const extrusionPreview = useMemo(() => featureDraft?.type === "extrude" ? { type: "extrude" as const, sketchId: featureDraft.sketchId, combine: featureDraft.combine, targetBodyId: featureDraft.combine === "new" ? undefined : featureDraft.targetBodyId, extent: featureDraft.extent, distance: featureDraft.distance, distancePlus: featureDraft.distancePlus, distanceMinus: featureDraft.distanceMinus, direction: featureDraft.direction } : null, [featureDraft]);

  const onStatus = useCallback((status: KernelStatus, next?: Properties, message?: string) => {
    setKernelStatus(status); setKernelMessage(message ?? null); if (next) setProperties(next); if (status === "error" || status === "offline") setProperties(null);
  }, []);

  const startSketchOnPlane = useCallback((plane: SketchPlane) => {
    const id = `sketch-${crypto.randomUUID()}`;
    const sketch: LocalSketch = { id, name: `Sketch ${sketches.length + 1}`, plane, entities: [], visible: true };
    const nextSketches = [...sketches, sketch];
    setSketches(nextSketches); setSketchViewDocument({ sketches: nextSketches, features }); setSketchView(defaultSketchView()); setSketchViewRotated(false); setSelectedSketchId(id); setSelectedFeatureId(null); setSelectedPlane(null); setSketchSupportPicking(false); if (typeof plane === "string") setSelectedBodyId(null); else setSelectedBodyId(plane.bodyId); setEditingSketchId(id); setPlaneDialog(null);
  }, [features, sketches]);

  const onSelectFace = useCallback((face: SelectedFace | null) => {
    setSelectedFace(face);
    if (!face) { if (!sketchSupportPicking) { setSelectedBodyId(null); setSelectedSketchId(null); setSelectedFeatureId(null); setSelectedPlane(null); } return; }
    if (sketchSupportPicking) { startSketchOnPlane({ kind: "face", bodyId: face.bodyId, faceIndex: face.faceIndex, faceId: face.id }); return; }
    setSelectedBodyId(face.bodyId); setSelectedSketchId(null); setSelectedFeatureId(null); setSelectedPlane(null);
  }, [sketchSupportPicking, startSketchOnPlane]);

  useEffect(() => {
    if (!sketchSupportPicking) return;
    const cancelPicking = (event: KeyboardEvent) => { if (event.key === "Escape") setSketchSupportPicking(false); };
    window.addEventListener("keydown", cancelPicking);
    return () => window.removeEventListener("keydown", cancelPicking);
  }, [sketchSupportPicking]);

  useEffect(() => {
    let stored = DEFAULT_GLOBAL_SETTINGS;
    try { stored = parseGlobalSettings(window.localStorage.getItem(GLOBAL_SETTINGS_STORAGE_KEY)); }
    catch { /* Use defaults when browser storage is unavailable. */ }
    const frame = requestAnimationFrame(() => setGlobalSettings(stored));
    return () => cancelAnimationFrame(frame);
  }, []);

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
      if (editingSketchId === planeDialog.sketchId) setSketchViewDocument({ sketches: nextSketches, features });
      setSelectedSketchId(planeDialog.sketchId); setPlaneDialog(null); return;
    }
    startSketchOnPlane(plane);
  };
  const editSketch = (id: string) => { const sketch = sketches.find((item) => item.id === id); setSketchViewDocument(cadDocument); setSketchView(defaultSketchView()); setSketchViewRotated(false); setEditingSketchId(id); setSelectedSketchId(id); setSelectedFeatureId(null); setSelectedPlane(null); setSketchSupportPicking(false); setSelectedBodyId(sketch && typeof sketch.plane !== "string" ? sketch.plane.bodyId : null); setSelectedFace(null); };
  const finishSketch = () => { setEditingSketchId(null); setSketchViewDocument(null); setSketchView(defaultSketchView()); setSketchViewRotated(false); setExternalSketchReferences([]); setSelectedFeatureId(null); };
  const snapSketchNormal = () => { setSketchViewRotated(false); setSnapNormalRequest((request) => request + 1); };
  const updateEditingSketch = (entities: SketchEntity[]) => setSketches((items) => items.map((sketch) => sketch.id === editingSketchId ? { ...sketch, entities } : sketch));
  const updateSketchConstraints = (constraints: LinearDimensionConstraint[]) => setSketches((items) => items.map((sketch) => sketch.id === editingSketchId ? { ...sketch, constraints } : sketch));
  const updateDimensionOffsets = (dimensionOffsets: Record<string, { x: number; y: number }>) => setSketches((items) => items.map((sketch) => sketch.id === editingSketchId ? { ...sketch, dimensionOffsets } : sketch));

  const closeFeatureEditor = () => { setFeatureDraft(null); setEditingFeatureId(null); };
  const requestFeature = (type: "extrude" | "revolve") => { setSketchSupportPicking(false); setProfileDialog(type); setValidationDialog(null); closeFeatureEditor(); };
  const selectProfile = async (sketch: LocalSketch, type: "extrude" | "revolve") => {
    try {
      const response = await fetch(`${API}/api/sketch/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entities: sketch.entities }) });
      if (!response.ok) throw new Error(`Sketch validation failed (${response.status})`);
      const result = await response.json() as ValidationResult;
      setProfileDialog(null);
      if (!result.closed) { setValidationDialog({ sketch, result }); setSelectedSketchId(sketch.id); return; }
      setFeatureDraft({ type, sketchId: sketch.id, combine: "new", targetBodyId: typeof sketch.plane === "string" ? selectedBodyId ?? bodyIds[0] ?? "" : sketch.plane.bodyId, extent: "one-sided", distance: 20, distancePlus: 20, distanceMinus: 20, direction: 1, angle: 360, axis: "profile-left" });
    } catch (error) {
      setProfileDialog(null);
      setKernelStatus("offline");
      setKernelMessage(error instanceof Error ? error.message : "Sketch validation service is unavailable");
    }
  };
  const editFeature = (id: string) => {
    const feature = features.find((item) => item.id === id);
    if (!feature || feature.type !== "extrude") return;
    const distance = Math.abs(feature.distance ?? 20);
    const distancePlus = Math.abs(feature.distancePlus ?? distance);
    const precedingBodies = features.slice(0, features.findIndex((item) => item.id === id)).filter((item) => item.combine === "new" && item.bodyId).map((item) => item.bodyId!);
    setEditingFeatureId(id);
    setFeatureDraft({
      type: "extrude",
      sketchId: feature.sketchId,
      combine: feature.combine,
      targetBodyId: feature.targetBodyId ?? precedingBodies[0] ?? "",
      extent: feature.extent ?? "one-sided",
      distance,
      distancePlus,
      distanceMinus: Math.abs(feature.distanceMinus ?? distancePlus),
      direction: feature.direction ?? 1,
      angle: 360,
      axis: "profile-left",
    });
    setProfileDialog(null); setValidationDialog(null); setContextMenu(null); setSelectedFeatureId(id); setSelectedSketchId(null); setSelectedBodyId(null); setSelectedPlane(null); setSketchSupportPicking(false); setKernelMessage(null);
  };
  const createFeature = () => {
    if (!featureDraft) return;
    const existingFeature = editingFeatureId ? features.find((feature) => feature.id === editingFeatureId) : undefined;
    const index = existingFeature ? features.findIndex((feature) => feature.id === existingFeature.id) + 1 : features.length + 1;
    const id = existingFeature?.id ?? `${featureDraft.type}-${crypto.randomUUID()}`;
    const feature: FeatureRecord = {
      id, name: existingFeature?.name ?? `${featureDraft.type === "extrude" ? "Extrude" : "Revolve"} ${index}`, type: featureDraft.type, sketchId: featureDraft.sketchId, combine: featureDraft.combine,
      ...(featureDraft.combine === "new" ? { bodyId: existingFeature?.bodyId ?? `body-${crypto.randomUUID()}` } : { targetBodyId: featureDraft.targetBodyId }),
      ...(featureDraft.type === "extrude" ? { extent: featureDraft.extent, distance: featureDraft.distance, distancePlus: featureDraft.distancePlus, distanceMinus: featureDraft.distanceMinus, direction: featureDraft.direction } : { angle: featureDraft.angle, axis: featureDraft.axis }),
    };
    setFeatures((items) => existingFeature ? items.map((item) => item.id === id ? feature : item) : [...items, feature]); setSelectedFeatureId(id); setSelectedSketchId(null); closeFeatureEditor(); setKernelMessage(null);
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
  const openContext = (event: React.MouseEvent, type: "sketch" | "feature", id: string) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ x: event.clientX, y: event.clientY, type, id }); };

  const saveProject = () => download("untitled.basiccad.json", JSON.stringify({ schemaVersion: 2, units: "mm", ...cadDocument }, null, 2), "application/json");
  const exportStep = async () => {
    try {
      const response = await fetch(`${API}/api/export/document.step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cadDocument) });
      if (!response.ok) { const error = await response.json().catch(() => null) as { detail?: string } | null; setKernelMessage(error?.detail ?? "STEP export failed"); return; }
      const link = document.createElement("a"); link.href = URL.createObjectURL(await response.blob()); link.download = "basic-cad-document.step"; link.click(); URL.revokeObjectURL(link.href);
    } catch (error) {
      setKernelStatus("offline");
      setKernelMessage(error instanceof Error ? error.message : "STEP export service is unavailable");
    }
  };

  return <main className="cad-shell" onPointerDown={() => { if (contextMenu) setContextMenu(null); if (settingsOpen) setSettingsOpen(false); }}>
    <header className="titlebar">
      <div className="brand-mark">B</div><strong>Basic CAD</strong><span className="document-name">Untitled Part</span>
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
              <label htmlFor="grid-square-size"><span>Default grid square</span><div className="setting-number"><input id="grid-square-size" aria-label="Default grid square size" type="number" min={globalSettings.unitSystem === "imperial" ? 0.01 : 0.1} step={globalSettings.unitSystem === "imperial" ? 0.05 : 1} value={Number(fromMillimeters(globalSettings.sketchGridSizeMm, globalSettings.unitSystem).toFixed(4))} onChange={(event) => updateGlobalSettings({ ...globalSettings, sketchGridSizeMm: Math.max(0.1, toMillimeters(Number(event.target.value), globalSettings.unitSystem)) })}/><span>{unitSuffix(globalSettings.unitSystem)}</span></div></label>
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
      <button className={`tool ${editingSketchId || sketchSupportPicking ? "active" : ""}`} onClick={requestNewSketch}><span className="tool-icon sketch-icon" />{sketchSupportPicking ? "Select Support" : "New Sketch"}</button>
      <button className="tool" onClick={() => requestFeature("extrude")}><span className="tool-icon extrude-icon" />Extrude</button>
      <button className="tool" onClick={() => requestFeature("revolve")}><span className="tool-icon revolve-icon" />Revolve</button>
      <span className="ribbon-rule" /><button className="tool muted" disabled>Undo</button><button className="tool muted" disabled>Redo</button>
    </nav>
    <section className="workspace">
      <aside className="feature-panel"><div className="panel-heading"><strong>Feature tree</strong><button aria-label="Tree options">•••</button></div><div className="tree-row root"><span className="twisty">⌄</span><span className="part-icon">◩</span>Untitled Part</div><div className="tree-row child"><span className="twisty">⌄</span><span className="origin-icon">⊕</span>Origin</div>{(["XY", "XZ", "YZ"] as const).map((plane, index) => <button key={plane} className={`tree-row grandchild tree-button ${selectedPlane === plane ? "selected" : ""} ${sketchSupportPicking ? "support-choice" : ""}`} onClick={() => { if (sketchSupportPicking) startSketchOnPlane(plane); else { setSelectedPlane(plane); setSelectedFace(null); setSelectedBodyId(null); setSelectedSketchId(null); setSelectedFeatureId(null); } }}><span className={`plane plane-${index === 0 ? "blue" : index === 1 ? "green" : "red"}`} />{plane} Plane</button>)}
        {bodyIds.length > 0 && <div className="tree-row child body-folder"><span className="twisty">⌄</span><span className="body-icon">◫</span>Solid Bodies <small className="tree-support">{bodyIds.length}</small></div>}
        {bodyIds.map((bodyId, index) => <button key={bodyId} className={`tree-row grandchild tree-button body-row ${selectedBodyId === bodyId ? "selected" : ""}`} aria-label={`Body ${index + 1}`} onClick={() => { setSelectedBodyId(bodyId); setSelectedFace(null); setSelectedPlane(null); setSelectedSketchId(null); setSelectedFeatureId(null); setSketchSupportPicking(false); }}><span className="body-icon">▰</span>Body {index + 1}</button>)}
        {sketches.map((sketch) => <button type="button" key={sketch.id} className={`tree-row tree-button child context-enabled ${selectedSketchId === sketch.id || editingSketchId === sketch.id ? "selected" : ""}`} onClick={() => { setSelectedSketchId(sketch.id); setSelectedFeatureId(null); setSelectedBodyId(null); setSelectedPlane(null); setSketchSupportPicking(false); }} onDoubleClick={() => editSketch(sketch.id)} onContextMenu={(event) => openContext(event, "sketch", sketch.id)}><span className="feature-icon">▱</span>{sketch.name}<small className="tree-support">{typeof sketch.plane === "string" ? sketch.plane : `F${sketch.plane.faceIndex}`}</small></button>)}
        {features.map((feature) => <button type="button" key={feature.id} className={`tree-row tree-button child context-enabled ${selectedFeatureId === feature.id ? "selected" : ""}`} onClick={() => { setSelectedFeatureId(feature.id); setSelectedSketchId(null); setSelectedBodyId(null); setSelectedPlane(null); setSketchSupportPicking(false); }} onDoubleClick={() => feature.type === "extrude" && editFeature(feature.id)} onContextMenu={(event) => openContext(event, "feature", feature.id)}><span className={`feature-icon ${feature.type === "extrude" ? "extrude-small" : "revolve-small"}`}>{feature.type === "extrude" ? "▰" : "◉"}</span>{feature.name}<small className="tree-support">{feature.combine}</small></button>)}
      </aside>
      <section className={`viewport ${editingSketch ? "sketch-mode" : ""}`} aria-label={editingSketch ? "Parametric 2D sketcher" : "Interactive 3D viewport"}>
        <div className="view-label">{editingSketch ? sketchViewRotated ? "SKETCH 3D VIEW · SNAP NORMAL TO CONTINUE EDITING" : `NORMAL TO ${planeLabel(editingSketch.plane).toUpperCase()} · BODIES VISIBLE` : "ISOMETRIC · SKETCHES SHOWN IN AMBER"}</div>
        <CadViewport document={editingSketch ? sketchViewDocument ?? cadDocument : editingFeatureId ? featurePreviewDocument : cadDocument} editingSketchId={editingSketchId} editingSketch={editingSketch} sketchView={sketchView} snapNormalRequest={snapNormalRequest} featurePreview={extrusionPreview} selectedBodyId={selectedBodyId} selectedPlane={selectedPlane} highlightedSketchId={selectedSketchId} highlightedFeatureId={editingFeatureId ? null : selectedFeatureId} onSketchViewChange={setSketchView} onSketchRotatedChange={setSketchViewRotated} onExternalReferencesChange={setExternalSketchReferences} onSelectFace={onSelectFace} onStatus={onStatus} />
        {editingSketch && <Sketcher key={editingSketch.id} entities={editingSketch.entities} constraints={editingSketch.constraints} externalReferences={externalSketchReferences} dimensionOffsets={editingSketch.dimensionOffsets} dimensionTextScale={globalSettings.sketchDimensionTextScale} nodeDiameterPx={globalSettings.sketchNodeDiameterPx} highlightWidthPx={globalSettings.sketchHighlightWidthPx} gridSquareSize={globalSettings.sketchGridSizeMm} unitSystem={globalSettings.unitSystem} onChange={updateEditingSketch} onConstraintsChange={updateSketchConstraints} onDimensionOffsetsChange={updateDimensionOffsets} onFinish={finishSketch} view={sketchView} viewRotated={sketchViewRotated} onSnapNormal={snapSketchNormal} />}
        {!editingSketch && sketchSupportPicking && <div className="support-pick-callout"><strong>Select sketch support</strong><span>Click a planar body face or an origin plane in the feature tree · Esc to cancel</span></div>}
        {!editingSketch && !sketchSupportPicking && selectedFace && <div className="selection-callout">Selected planar face <span>{selectedFace.bodyId} · face {selectedFace.faceIndex}</span></div>}
        {!editingSketch && kernelMessage && <div className="model-error"><strong>Document rebuild failed</strong><span>{kernelMessage}</span></div>}
        {!editingSketch && <div className="viewport-help">{sketchSupportPicking ? "Planar faces and origin planes are ready for sketch placement" : "Click New Sketch, then choose a face or origin plane"}</div>}
      </section>
      <aside className="properties-panel">
        {editingSketch && <><div className="panel-heading"><strong>{editingSketch.name}</strong><span className="feature-state">Editing</span></div><div className="sketch-inspector"><h3>Sketch support</h3><div><span>▱</span>{planeLabel(editingSketch.plane)}</div><button className="edit-profile" onClick={() => setPlaneDialog({ mode: "edit", sketchId: editingSketch.id })}>Change plane or face</button><h3>Editing</h3><p>Select an entity to expose its control points, then drag those points to reshape the profile.</p><strong>{editingSketch.entities.length} sketch entities</strong><button className="primary-wide" onClick={finishSketch}>✓ Exit sketch</button></div></>}
        {!editingSketch && selectedSketch && <><div className="panel-heading"><strong>{selectedSketch.name}</strong><span className="feature-state">3D sketch</span></div><div className="sketch-inspector"><h3>Support</h3><div><span>▱</span>{planeLabel(selectedSketch.plane)}</div><button className="edit-profile" onClick={() => setPlaneDialog({ mode: "edit", sketchId: selectedSketch.id })}>Change plane or face</button><button className="edit-profile" onClick={() => editSketch(selectedSketch.id)}>Edit sketch geometry</button><button className="primary-wide" onClick={() => requestFeature("extrude")}>Create feature</button></div></>}
        {!editingSketch && selectedFeature && <><div className="panel-heading"><strong>{selectedFeature.name}</strong><span className="feature-state">{selectedFeature.combine}</span></div><div className="sketch-inspector"><h3>Profile</h3><p>{sketches.find((sketch) => sketch.id === selectedFeature.sketchId)?.name}</p><h3>Result</h3><p>{selectedFeature.combine === "new" ? "New solid body" : `${selectedFeature.combine} with ${selectedFeature.targetBodyId}`}</p></div></>}
        {!editingSketch && !selectedSketch && !selectedFeature && selectedBodyId && <><div className="panel-heading"><strong>Body {selectedBodyIndex + 1}</strong><span className="feature-state">Solid body</span></div><div className="body-properties"><h3>Body contents</h3><div className="body-stat"><span>Features</span><strong>{selectedBodyFeatures.length}</strong></div><div className="body-stat"><span>Status</span><strong>Selectable solid</strong></div><p>{selectedFace ? `Face ${selectedFace.faceIndex} is selected. Create a sketch to attach it to that planar surface.` : "Select a planar face in the 3D viewport to create a supported sketch."}</p>{selectedFace && <button className="primary-wide" onClick={() => startSketchOnPlane({ kind: "face", bodyId: selectedFace.bodyId, faceIndex: selectedFace.faceIndex, faceId: selectedFace.id })}>New sketch on selected face</button>}</div></>}
        {!editingSketch && !selectedSketch && !selectedFeature && !selectedBodyId && <div className="empty-tool"><h2>Model workspace</h2><p>Create a sketch, draw a profile, exit the sketch, then choose Extrude or Revolve.</p></div>}
      </aside>
    </section>
    <footer className="statusbar"><span>{kernelMessage ?? (editingSketch ? `Editing ${editingSketch.name}` : sketchSupportPicking ? "Select a planar face or origin plane for the new sketch" : "Ready")}</span><span>{properties ? `${properties.bodyCount} bodies · ${properties.solidCount} solids · ${sketches.length} sketches` : `${sketches.length} sketches`}</span><span>{globalSettings.unitSystem === "imperial" ? "IPS (inch)" : "MMGS (millimeter)"}</span></footer>

    {planeDialog && <div className="modal-backdrop"><div className="cad-dialog plane-dialog"><header><strong>{planeDialog.mode === "new" ? "Create new sketch" : "Change sketch support"}</strong><button onClick={() => setPlaneDialog(null)}>×</button></header><p>Choose an origin plane or a selected planar body surface.</p><div className="plane-options"><button onClick={() => choosePlane("XY")}><i className="plane plane-blue"/>XY Plane<small>Top</small></button><button onClick={() => choosePlane("XZ")}><i className="plane plane-green"/>XZ Plane<small>Front</small></button><button onClick={() => choosePlane("YZ")}><i className="plane plane-red"/>YZ Plane<small>Right</small></button>{selectedFace && <button className="face-choice" onClick={() => choosePlane({ kind: "face", bodyId: selectedFace.bodyId, faceIndex: selectedFace.faceIndex, faceId: selectedFace.id })}><i>▰</i>Selected face<small>{selectedFace.bodyId} · F{selectedFace.faceIndex}</small></button>}</div>{!selectedFace && <div className="dialog-hint">To use a body surface, cancel this dialog, select a planar face in 3D, then click New Sketch again.</div>}</div></div>}
    {profileDialog && <div className="modal-backdrop"><div className="cad-dialog profile-dialog"><header><strong>Select sketch to {profileDialog}</strong><button onClick={() => setProfileDialog(null)}>×</button></header><p>The sketch will be checked for closed profiles before feature settings are shown.</p><div className="profile-list">{sketches.map((sketch) => <button key={sketch.id} onClick={() => selectProfile(sketch, profileDialog)}><span className="feature-icon">▱</span><strong>{sketch.name}</strong><small>{planeLabel(sketch.plane)} · {sketch.entities.length} entities</small></button>)}{!sketches.length && <div className="dialog-empty">No sketches exist. Create and exit a sketch first.</div>}</div></div></div>}
    {validationDialog && <div className="modal-backdrop"><div className="cad-dialog validation-dialog"><header><strong>Sketch is not closed</strong><button onClick={() => setValidationDialog(null)}>×</button></header><div className="validation-mark">!</div><p><strong>{validationDialog.sketch.name}</strong> cannot create a solid feature.</p><ul>{validationDialog.result.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>{validationDialog.result.openEndpoints.length > 0 && <div className="endpoint-list"><strong>Open endpoints</strong>{validationDialog.result.openEndpoints.map((point, index) => <span key={index}>#{index + 1}: X {point.x.toFixed(2)}, Y {point.y.toFixed(2)}</span>)}</div>}<div className="dialog-actions"><button onClick={() => setValidationDialog(null)}>Cancel</button><button className="primary" onClick={() => { editSketch(validationDialog.sketch.id); setValidationDialog(null); }}>Show and repair sketch</button></div></div></div>}
    {featureDraft && <div className="cad-dialog feature-dialog feature-flyout" onPointerDown={(event) => event.stopPropagation()}>
      <header><strong>{editingFeatureId ? `Edit ${features.find((feature) => feature.id === editingFeatureId)?.name ?? "feature"}` : `${featureDraft.type === "extrude" ? "Extrude" : "Revolve"} closed sketch`}</strong><button onClick={closeFeatureEditor}>×</button></header>
      <div className="validated-profile"><span>✓</span><div><strong>{sketches.find((sketch) => sketch.id === featureDraft.sketchId)?.name}</strong><small>Closed profile verified</small></div></div>
      <label>Result<select value={featureDraft.combine} onChange={(event) => { const combine = event.target.value as FeatureDraft["combine"]; setFeatureDraft({ ...featureDraft, combine, targetBodyId: featureTargetBodyIds.includes(featureDraft.targetBodyId) ? featureDraft.targetBodyId : featureTargetBodyIds[0] ?? "", direction: combine === "cut" ? -1 : 1 }); }}><option value="new">New body</option><option value="union" disabled={!featureTargetBodyIds.length}>Union with body</option><option value="cut" disabled={!featureTargetBodyIds.length}>Cut body</option></select></label>
      {featureDraft.combine !== "new" && <label>Target body<select value={featureDraft.targetBodyId} onChange={(event) => setFeatureDraft({ ...featureDraft, targetBodyId: event.target.value })}>{featureTargetBodyIds.map((body) => <option key={body} value={body}>{body}</option>)}</select></label>}
      {featureDraft.type === "extrude" ? <>
        <label>Extent<select value={featureDraft.extent} onChange={(event) => setFeatureDraft({ ...featureDraft, extent: event.target.value as FeatureDraft["extent"] })}><option value="one-sided">One direction</option><option value="symmetric">Symmetric</option><option value="bidirectional">Bidirectional</option></select></label>
        {featureDraft.extent === "one-sided" && <>
          <label>Distance<div className="input-with-unit"><input type="number" min="0.001" value={displayedLength(featureDraft.distance)} onChange={(event) => setFeatureDraft({ ...featureDraft, distance: enteredLength(event.target.value) })}/><span>{lengthUnit}</span></div></label>
          <div className={`direction-control ${featureDraft.combine === "cut" ? "cut-direction" : "add-direction"}`}>
            <span className={`direction-arrow ${featureDraft.direction < 0 ? "reversed" : ""}`}>➜</span>
            <div><strong>{featureDraft.combine === "cut" && featureDraft.direction < 0 ? "Into target body" : featureDraft.combine === "cut" ? "Flipped away from target" : featureDraft.direction > 0 ? "Away from sketch" : "Reverse sketch normal"}</strong><small>{featureDraft.direction > 0 ? "+ sketch normal" : "− sketch normal"}</small></div>
            <button type="button" className="flip-direction" aria-label="Flip extrusion direction" title="Flip extrusion direction" onClick={() => setFeatureDraft({ ...featureDraft, direction: featureDraft.direction === 1 ? -1 : 1 })}><span>⇅</span>Flip</button>
          </div>
        </>}
        {featureDraft.extent === "symmetric" && <>
          <label>Distance each side<div className="input-with-unit"><input type="number" min="0.001" value={displayedLength(featureDraft.distancePlus)} onChange={(event) => { const distance = enteredLength(event.target.value); setFeatureDraft({ ...featureDraft, distancePlus: distance, distanceMinus: distance }); }}/><span>{lengthUnit}</span></div></label>
          <div className="extent-summary"><span>− {displayedLength(featureDraft.distancePlus)} {lengthUnit}</span><i>Sketch plane</i><span>+ {displayedLength(featureDraft.distancePlus)} {lengthUnit}</span></div>
        </>}
        {featureDraft.extent === "bidirectional" && <>
          <div className="bidirectional-distances">
            <label>Plus direction<div className="input-with-unit"><input type="number" min="0.001" value={displayedLength(featureDraft.distancePlus)} onChange={(event) => setFeatureDraft({ ...featureDraft, distancePlus: enteredLength(event.target.value) })}/><span>{lengthUnit}</span></div></label>
            <label>Minus direction<div className="input-with-unit"><input type="number" min="0.001" value={displayedLength(featureDraft.distanceMinus)} onChange={(event) => setFeatureDraft({ ...featureDraft, distanceMinus: enteredLength(event.target.value) })}/><span>{lengthUnit}</span></div></label>
          </div>
          <div className="extent-summary"><span>− {displayedLength(featureDraft.distanceMinus)} {lengthUnit}</span><i>Sketch plane</i><span>+ {displayedLength(featureDraft.distancePlus)} {lengthUnit}</span></div>
        </>}
      </> : <><label>Axis<select value={featureDraft.axis} onChange={(event) => setFeatureDraft({ ...featureDraft, axis: event.target.value as FeatureDraft["axis"] })}><option value="profile-left">Left profile edge</option><option value="construction" disabled={!sketches.find((sketch) => sketch.id === featureDraft.sketchId)?.entities.some((entity) => entity.type === "line" && entity.construction)}>First construction line</option><option value="origin-x">Origin X axis</option><option value="origin-y">Origin Y axis</option></select></label><label>Angle<div className="input-with-unit"><input type="number" min="1" max="360" value={featureDraft.angle} onChange={(event) => setFeatureDraft({ ...featureDraft, angle: Number(event.target.value) })}/><span>deg</span></div></label></>}
      <div className="dialog-actions"><button onClick={closeFeatureEditor}>Cancel</button><button className="primary" onClick={createFeature}>{editingFeatureId ? "Apply changes" : "Create feature"}</button></div>
    </div>}
    {contextMenu && <div className="feature-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}><div className="context-title">{contextMenu.type === "sketch" ? sketches.find((sketch) => sketch.id === contextMenu.id)?.name : features.find((feature) => feature.id === contextMenu.id)?.name}</div>{contextMenu.type === "sketch" && <><button onClick={() => { editSketch(contextMenu.id); setContextMenu(null); }}>Edit sketch</button><button onClick={() => { setPlaneDialog({ mode: "edit", sketchId: contextMenu.id }); setContextMenu(null); }}>Change plane or face</button></>}{contextMenu.type === "feature" && features.find((feature) => feature.id === contextMenu.id)?.type === "extrude" && <button onClick={() => editFeature(contextMenu.id)}>Edit feature</button>}<button className="delete-action" onClick={() => deleteFromTree(contextMenu.type, contextMenu.id)}>Delete {contextMenu.type}{contextMenu.type === "feature" ? " and later features" : " and dependents"}</button></div>}
  </main>;
}
