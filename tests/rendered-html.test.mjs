import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("modeling ribbon starts sketches and validates profiles before features", async () => {
  const page = await source("app/page.tsx");

  assert.match(page, /setPlaneDialog\(\{ mode: "new" \}\)/);
  assert.match(page, /sketchSupportPicking/);
  assert.match(page, /startSketchOnPlane/);
  assert.match(page, /Select sketch support/);
  assert.match(page, /api\/sketch\/validate/);
  assert.match(page, /eligibleProfileSketchIds/);
  assert.match(page, /profile-choice/);
  assert.match(page, /selectableSketchIds=/);
  assert.doesNotMatch(page, /className="cad-dialog profile-dialog"/);
  assert.match(page, /MODEL_GRID_STORAGE_KEY/);
  assert.match(page, /aria-pressed=\{showModelGrid\}/);
  assert.match(page, /model-grid-toggle/);
  assert.match(page, /showModelGrid=\{showModelGrid\}/);
  assert.match(page, /updateExtrusionDistanceFromArrow/);
  assert.match(page, /onFeaturePreviewDistanceChange=\{updateExtrusionDistanceFromArrow\}/);
  assert.match(page, /liveExtrusionDrag/);
  assert.match(page, /phase === "preview"/);
  assert.match(page, /displayedFeatureDraft/);
  assert.match(page, /toggleSketchVisibility/);
  assert.match(page, /toggleFeatureVisibility/);
  assert.match(page, /className="tree-visibility"/);
  assert.match(page, /checked=\{sketch\.visible !== false\}/);
  assert.match(page, /checked=\{feature\.visible !== false\}/);
  assert.match(page, /Sketch is not closed/);
  assert.match(page, /New body/);
  assert.match(page, /Union with body/);
  assert.match(page, /Cut body/);
  assert.match(page, /Into target body/);
  assert.match(page, /Flip extrusion direction/);
  assert.match(page, /Symmetric/);
  assert.match(page, /Bidirectional/);
  assert.match(page, /distancePlus/);
  assert.match(page, /distanceMinus/);
  assert.match(page, /feature-flyout/);
  assert.match(page, /Solid Bodies/);
  assert.match(page, /selectedBodyId/);
  assert.match(page, /Delete \{contextMenu\.type\}/);
  assert.match(page, /Edit feature/);
  assert.match(page, /editingFeatureId/);
  assert.match(page, /features\.slice\(0, editingFeatureIndex\)/);
  assert.match(page, /Apply changes/);
  assert.match(page, /items\.map\(\(item\) => item\.id === id \? feature : item\)/);
  assert.match(page, /aria-label="Settings"/);
  assert.match(page, /Sketch dimension text &amp; boxes/);
  assert.match(page, /GLOBAL_SETTINGS_STORAGE_KEY/);
  assert.match(page, /dimensionTextScale=\{globalSettings\.sketchDimensionTextScale\}/);
  assert.match(page, /Sketch node diameter/);
  assert.match(page, /Sketch hover highlight/);
  assert.match(page, /highlightWidthPx=\{globalSettings\.sketchHighlightWidthPx\}/);
  assert.match(page, /Default grid square/);
  assert.match(page, /Display units/);
  assert.match(page, /id="grid-square-size"/);
  assert.match(page, /<BufferedNumberInput id="grid-square-size"/);
  assert.match(page, /sketchGridSizeMm: Math\.max/);
  assert.match(page, /externalReferences=\{externalSketchReferences\}/);
});

test("sketcher exposes profile tools, editable dimensions, and draggable controls", async () => {
  const sketcher = await source("app/components/Sketcher.tsx");

  for (const tool of ["line", "rectangle", "circle", "ellipse", "arc", "spline", "trim", "corner"]) {
    assert.match(sketcher, new RegExp(`\\"${tool}\\"`));
  }
  assert.match(sketcher, /onDoubleClick=.*setEditingDimension/);
  assert.match(sketcher, /beginDimensionDrag/);
  assert.match(sketcher, /dimensionScreenScale/);
  assert.match(sketcher, /dimensionOffsets/);
  assert.match(sketcher, /onDimensionOffsetsChange/);
  assert.match(sketcher, /aria-label="Dimension value"/);
  assert.match(sketcher, /snapEnabled/);
  assert.match(sketcher, /className="control-point"/);
  assert.match(sketcher, /replaceConnectedPoint/);
  assert.match(sketcher, /trimEntityAtPoint/);
  assert.match(sketcher, /cornerEntities/);
  assert.match(sketcher, /Snap normal/);
  assert.match(sketcher, /viewWidth/);
  assert.match(sketcher, /trim-hit/);
  assert.match(sketcher, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(sketcher, /distance\(draft\[0\], point\) < 0\.01/);
  assert.match(sketcher, /closesProfile/);
  assert.match(sketcher, /draft\.length >= 3/);
  assert.match(sketcher, /Linear dimension constraint/);
  assert.match(sketcher, /Angular dimension constraint/);
  assert.match(sketcher, /Diameter dimension constraint/);
  assert.match(sketcher, /diameterDimensionLayout/);
  assert.match(sketcher, /Diameter constraint value/);
  assert.match(sketcher, /Perpendicular constraint/);
  assert.match(sketcher, /sketch-command-group admin-group/);
  assert.match(sketcher, /sketch-command-group geometry-group/);
  assert.match(sketcher, /sketch-command-group modify-group/);
  assert.match(sketcher, /sketch-command-group constraint-group/);
  assert.match(sketcher, /SketchCommandButton/);
  assert.match(sketcher, /angularDimensionLayout/);
  assert.match(sketcher, /targetPointForAngularValue/);
  assert.match(sketcher, /perpendicularLineToReference/);
  assert.match(sketcher, /Angular dimension · select the first line/);
  assert.match(sketcher, /Perpendicular · select the first line segment/);
  assert.match(sketcher, /cycleLinearOrientation/);
  assert.match(sketcher, /onConstraintsChange/);
  assert.match(sketcher, /conflicted/);
  assert.match(sketcher, /Linear constraint value/);
  assert.match(sketcher, /Angular constraint value/);
  assert.match(sketcher, /dimensionLabelScale = dimensionScale \* dimensionTextScale/);
  assert.match(sketcher, /external-reference/);
  assert.match(sketcher, /gridSquareSize/);
  assert.match(sketcher, /nodeDiameterPx/);
  assert.match(sketcher, /Red sketch X axis/);
  assert.match(sketcher, /Green sketch Y axis/);
  assert.match(sketcher, /sketch-axis:x/);
  assert.match(sketcher, /line references measure perpendicular distance/);
  assert.match(sketcher, /validLinearDimensionPair/);
  assert.match(sketcher, /createLineLengthDimension/);
  assert.match(sketcher, /constraintSupersedesSegmentDimension/);
  assert.match(sketcher, /lineClickRef/);
  assert.match(sketcher, /now - previous\.at <= 500/);
  assert.match(sketcher, /double-click a line for its segment length/);
  assert.match(sketcher, /defaultLinearDimensionPosition/);
  assert.match(sketcher, /height=\{22 \/ safeZoom\}/);
  assert.match(sketcher, /width=\{22 \/ safeZoom\}/);
  assert.match(sketcher, /constraint-node-hit/);
  assert.match(sketcher, /entity\.type === "line" \? 10 : 16/);
  assert.match(sketcher, /entity\.type === "line" \? 0\.22 : 0\.45/);
  assert.match(sketcher, /nearestGridVertex/);
  assert.match(sketcher, /gridDistance \+ 1e-6/);
  assert.match(sketcher, /className=\{`snap-marker \$\{snap\.kind\}`\}[\s\S]*?r=\{gridSquareSize \/ 2\}/);
  assert.match(sketcher, /snap && sketchingToolActive/);
  assert.doesNotMatch(sketcher, /snap\.kind === "grid" \? gridSquareSize \/ 2 : 5/);
  assert.match(sketcher, /constraint-line-hit/);
  assert.match(sketcher, /--sketch-highlight-width/);
  assert.match(sketcher, /selectionMarquee/);
  assert.match(sketcher, /entityInSelectionBox/);
  assert.match(sketcher, /selectedEntityIds/);
  assert.match(sketcher, /selectedConstraintIds/);
  assert.match(sketcher, /selectedDimensionKeys/);
  assert.match(sketcher, /Delete removes selection/);
  assert.match(sketcher, /draggingSelection/);
  assert.match(sketcher, /translateSketchEntity/);
  assert.match(sketcher, /drag any selected item to move the group/);

  const modelingCss = await source("app/modeling.css");
  assert.match(modelingCss, /\.sketch-selection-box\.window/);
  assert.match(modelingCss, /\.sketch-selection-box\.crossing/);
  assert.match(modelingCss, /\.dimension-annotation\.selected/);
  assert.match(modelingCss, /\.dimension-annotation:not\(\.selected\)[\s\S]*?opacity: 0\.38/);
  assert.match(modelingCss, /\.dimension-annotation:not\(\.selected\) \.sketch-dimension text[\s\S]*?fill: #7baabb/);
  assert.match(modelingCss, /\.sketch-canvas\.dragging-selection/);
  assert.match(modelingCss, /\.sketch-line-hit[\s\S]*?stroke-width: 20/);
  assert.match(modelingCss, /\.constraint-line-hit[\s\S]*?stroke-width: 28/);
  assert.match(modelingCss, /\.linear-constraint\.selected \.constraint-measure/);
  assert.match(modelingCss, /\.perpendicular-constraint-icon/);

  const globalsCss = await source("app/globals.css");
  assert.match(globalsCss, /sketch-entity:hover[\s\S]*?--sketch-highlight-width/);
  assert.match(globalsCss, /sketch-dimension:hover rect[\s\S]*?--sketch-highlight-width/);

  const page = await source("app/page.tsx");
  assert.match(page, /Highlight width for all hovered and selected sketch geometry/);
  assert.match(page, /constraints\?: SketchConstraint\[\]/);
  assert.match(page, /onConstraintsChange=\{updateSketchConstraints\}/);
});

test("LucasCad exposes SolidWorks-style fillet, chamfer, neutral-plane draft, and shell features", async () => {
  const [page, viewport, server, layout, css] = await Promise.all([
    source("app/page.tsx"),
    source("app/components/CadViewport.tsx"),
    source("backend/server.py"),
    source("app/layout.tsx"),
    source("app/dialogs.css"),
  ]);

  assert.match(page, /<strong>LucasCad<\/strong>/);
  assert.match(layout, /LucasCad — Parametric solid modeling/);
  for (const tool of ["fillet", "chamfer", "draft", "shell"]) {
    assert.match(page, new RegExp(`requestBodyFeature\\(\\"${tool}\\"\\)`));
  }
  assert.match(page, /Constant-radius fillet/);
  assert.match(page, /Edge chamfer/);
  assert.match(page, /Angle \/ distance/);
  assert.match(page, /Distance \/ distance/);
  assert.match(page, /onChamferPreviewParameterChange=\{updateChamferParameterFromArrow\}/);
  assert.match(page, /Neutral-plane draft/);
  assert.match(page, /Uniform wall shell/);
  assert.match(page, /Shell outward/);
  assert.match(page, /Shell wall thickness/);
  assert.match(page, /Faces to remove/);
  assert.match(page, /selectedEdgeIds=/);
  assert.match(page, /sketchSupportPicking=\{sketchSupportPicking\}/);
  assert.match(page, /onSelectPlane=\{startSketchOnPlane\}/);
  assert.match(page, /translucent origin plane in 3D/);
  assert.match(page, /solidSelectionMode=/);
  assert.match(page, /activeFeaturePreview/);
  assert.match(page, /Keep clicking highlighted/);
  assert.match(page, /Draft face selection workflow/);
  assert.match(page, /Select in the 3D view/);
  assert.match(page, /Step 2 is active/);
  assert.match(css, /draft-feature-flyout/);
  assert.match(css, /draft-workflow/);
  assert.match(viewport, /visibleEdgeHit/);
  assert.match(viewport, /originPlaneHits/);
  assert.match(viewport, /visibleOriginPlaneHit/);
  assert.match(viewport, /previewTargetBodyId/);
  assert.match(viewport, /onSelectEdge/);
  assert.match(viewport, /selectedFaceOverlay/);
  assert.match(viewport, /draftCandidate/);
  assert.match(server, /face_selection_metadata/);
  assert.match(viewport, /chamferArrowHits/);
  assert.match(viewport, /refreshChamferPreview/);
  assert.match(viewport, /renderPreviewFaces/);
  assert.match(server, /def apply_body_feature/);
  assert.match(server, /BRepOffsetAPI_DraftAngle/);
  assert.match(server, /selector\.fillet/);
  assert.match(server, /selector\.chamfer/);
  assert.match(server, /\.shell\(signed_thickness\)/);
  assert.match(server, /make_planar_open_shell_fallback/);
});

test("sketch planes can be flipped without moving their existing geometry", async () => {
  const [page, viewport, server, css] = await Promise.all([
    source("app/page.tsx"),
    source("app/components/CadViewport.tsx"),
    source("backend/server.py"),
    source("app/globals.css"),
  ]);

  assert.match(page, /Flip Plane/);
  assert.match(page, /flipSketchPlane/);
  assert.match(page, /flipped: !sketch\.flipped/);
  assert.match(page, /setSnapNormalRequest/);
  assert.match(viewport, /flipped\?: boolean/);
  assert.match(server, /sketch\.get\("flipped"\)/);
  assert.match(css, /flip-plane-action/);
});

test("every feature can be edited and revolve axes are selected directly from geometry", async () => {
  const [page, viewport, server, css] = await Promise.all([
    source("app/page.tsx"),
    source("app/components/CadViewport.tsx"),
    source("backend/server.py"),
    source("app/dialogs.css"),
  ]);

  assert.doesNotMatch(page, /type !== "revolve" && <button[^>]*>Edit feature/);
  assert.match(page, /feature\.type !== "extrude" && feature\.type !== "revolve"/);
  assert.match(page, /Select the revolve axis/);
  assert.match(page, /straight sketch line, straight model edge, or global origin axis/);
  assert.match(page, /onSelectRevolveAxis=\{selectRevolveAxis\}/);
  assert.doesNotMatch(page, /<label>Axis<select/);
  assert.match(viewport, /RevolveAxisReference/);
  assert.match(viewport, /revolveAxisHits/);
  assert.match(viewport, /kind: "origin-axis"/);
  assert.match(viewport, /kind: "sketch-line"/);
  assert.match(viewport, /kind: "model-edge"/);
  assert.match(server, /resolve_revolve_axis/);
  assert.match(server, /selected revolve axis must lie in the profile sketch plane/i);
  assert.match(css, /revolve-axis-selection/);
});

test("the 3D ribbon groups create, modify, and persistent reference geometry tools", async () => {
  const [page, viewport, server, globals, dialogs] = await Promise.all([
    source("app/page.tsx"),
    source("app/components/CadViewport.tsx"),
    source("backend/server.py"),
    source("app/globals.css"),
    source("app/dialogs.css"),
  ]);

  for (const group of ["Create", "Modify", "Geometry"]) assert.match(page, new RegExp(`<b>${group}</b>`));
  for (const tool of ["plane", "axis", "point"]) assert.match(page, new RegExp(`requestReferenceGeometry\\(\\"${tool}\\"\\)`));
  assert.match(page, /Reference Geometry/);
  assert.match(page, /Edit reference geometry/);
  assert.match(page, /New sketch on plane/);
  assert.match(page, /referenceGeometry/);
  assert.match(page, /aria-label="Plane quick reference"/);
  assert.match(page, /aria-pressed=\{active\}/);
  assert.doesNotMatch(page, /<label>Quick reference<div className="reference-quick-options"/);
  assert.match(page, /referenceGeometryForViewport/);
  assert.match(page, /Select any planar reference/);
  assert.match(page, /Signed offset distance/);
  assert.match(page, /livePlaneOffset \?\? referenceDraft\.offset/);
  assert.match(page, /referencePlanePicking=/);
  assert.match(page, /onReferencePlaneOffsetChange=\{updateReferencePlaneOffsetFromArrow\}/);
  assert.match(viewport, /ReferenceGeometryRecord/);
  assert.match(viewport, /referencePlaneHits/);
  assert.match(viewport, /referencePlaneArrowHits/);
  assert.match(viewport, /referencePlanePreviewTargets/);
  assert.match(viewport, /referencePlaneDrag/);
  assert.match(viewport, /!referencePlanePicking \|\| object\.userData\.planar/);
  assert.match(viewport, /onReferencePlaneOffsetChange\?\.\(offset, "preview"\)/);
  assert.match(viewport, /kind: "reference-axis"/);
  assert.match(page, /referenceAxisPicking=/);
  assert.match(page, /cylinders, cones, and toroidal faces use their center axis/);
  assert.match(viewport, /axisOrigin/);
  assert.match(server, /edge_selection_metadata/);
  assert.match(server, /BRepAdaptor_Surface/);
  assert.match(server, /BRepAdaptor_Curve/);
  assert.match(server, /kind"\) == "reference-plane"/);
  assert.match(server, /kind == "reference-axis"/);
  assert.match(globals, /model-command-group/);
  assert.match(globals, /geometry-command-group/);
  assert.match(dialogs, /reference-geometry-flyout/);
  assert.match(dialogs, /reference-quick-options button\.active/);
});

test("placed linear dimensions remain draggable while the dimension tool is active", async () => {
  const css = await readFile(new URL("../app/modeling.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /tool-linear-dimension\s+\.linear-constraint:not\(\.preview\)[^{]*\{[^}]*pointer-events:\s*none/);
});

test("driving linear constraints accept zero distance", async () => {
  const sketcher = await source("app/components/Sketcher.tsx");
  assert.match(sketcher, /if \(enteredValue < 0\)/);
  assert.match(sketcher, /constraint\.type === "diameter"[\s\S]*?!\(enteredValue > 0\)/);
});

test("splines self-snap closed without displaying generic relation glyphs", async () => {
  const sketcher = await source("app/components/Sketcher.tsx");
  assert.match(sketcher, /draftClosureCandidates/);
  assert.match(sketcher, /distance\(point, draft\[index - 1\]\) > 0\.0001/);
  assert.match(sketcher, /entity\.type === "spline" \? \[\] : entity\.relations/);
  assert.doesNotMatch(sketcher, />◇</);
});

test("the sketch modification ribbon groups trim, extend, and corner", async () => {
  const sketcher = await source("app/components/Sketcher.tsx");
  assert.match(sketcher, />Modify</);
  assert.match(sketcher, /sketch-command-tools/);
  assert.match(sketcher, /tool === "trim"/);
  assert.match(sketcher, /tool === "extend"/);
  assert.match(sketcher, /tool === "corner"/);
  assert.match(sketcher, /extendEntityToTarget/);
  assert.match(sketcher, /cornerEntities/);
  assert.match(sketcher, /line and spline/);
});

test("sketch command group titles sit horizontally above their tool palettes", async () => {
  const css = await source("app/modeling.css");
  assert.match(css, /\.sketch-command-group b[\s\S]*?display: flex/);
  assert.match(css, /\.sketch-command-tools \{ display:flex/);
  assert.doesNotMatch(css, /rotate\(-90deg\)/);
});

test("SketchCheck is a two-stage admin tool placed immediately before Finish", async () => {
  const sketcher = await readFile("app/components/Sketcher.tsx", "utf8");
  const css = await readFile("app/modeling.css", "utf8");
  assert.match(sketcher, /label="SketchCheck"[\s\S]*?label="Finish"/);
  assert.match(sketcher, /analyzeSketchContours\(entities\)/);
  assert.match(sketcher, /sketchCheck\?\.openEndpoints\.map/);
  assert.match(sketcher, /click SketchCheck again to repair/);
  assert.match(css, /\.sketch-check-endpoint/);
  assert.match(css, /\.sketch-entity\.sketch-check-open/);
});

test("model navigation uses an unrestricted picked-pivot virtual trackball", async () => {
  const viewport = await readFile("app/components/CadViewport.tsx", "utf8");
  const css = await readFile("app/modeling.css", "utf8");
  assert.doesNotMatch(viewport, /TrackballControls/);
  assert.doesNotMatch(viewport, /OrbitControls/);
  assert.match(viewport, /class PickedPivotControls/);
  assert.match(viewport, /PerspectiveCamera \| THREE\.OrthographicCamera/);
  assert.match(viewport, /const controls = new PickedPivotControls\(camera, navigationElement\)/);
  assert.match(viewport, /this\.camera\.top - this\.camera\.bottom/);
  assert.match(viewport, /this\.camera\.zoom = THREE\.MathUtils\.clamp/);
  assert.match(viewport, /event\.button !== 1 && event\.button !== 2/);
  assert.match(viewport, /middlePressed = \(event\.buttons & 4\) !== 0/);
  assert.match(viewport, /rightPressed = \(event\.buttons & 2\) !== 0/);
  assert.match(viewport, /rightPressed \|\| middlePressed && event\.shiftKey \? "pan" : "rotate"/);
  assert.match(viewport, /const activeMode = this\.dragModeFor\(event\)/);
  assert.match(viewport, /camera\.position\.sub\(this\.target\)\.applyQuaternion\(rotation\)\.add\(this\.target\)/);
  assert.match(viewport, /camera\.quaternion\.premultiply\(rotation\)/);
  assert.match(viewport, /controls\.target\.copy\(point\); showPivot\(point\)/);
  assert.doesNotMatch(viewport, /controls\.target\.copy\(point\); controls\.update\(\)/);
  assert.match(viewport, /controls\.target\.set\(0, 0, 0\)/);
  assert.match(viewport, /Center view on origin/);
  assert.match(viewport, /Snap to nearest planar view/);
  assert.match(viewport, /nearestRenderedPoint/);
  assert.match(viewport, /window\.document\.createElement\("div"\)/);
  assert.doesNotMatch(viewport, /const viewMenu = document\.createElement/);
  assert.match(viewport, /pivotIndicator/);
  assert.match(css, /\.model-view-context-menu/);
});

test("NX-style trim supports spline intersections and drag-across gestures", async () => {
  const sketcher = await readFile("app/components/Sketcher.tsx", "utf8");
  const geometry = await readFile("app/components/sketchGeometry.ts", "utf8");
  const css = await readFile("app/modeling.css", "utf8");
  assert.match(geometry, /function trimSpline/);
  assert.match(geometry, /sketchStrokeHits/);
  assert.match(sketcher, /trim-gesture-trail/);
  assert.match(sketcher, /release to trim/);
  assert.match(css, /\.trim-gesture-trail/);
});

test("sketch patterns support shift selection and persistent mirror constraints", async () => {
  const sketcher = await source("app/components/Sketcher.tsx");
  assert.match(sketcher, /event\.shiftKey/);
  assert.match(sketcher, /<b>Patterns<\/b>/);
  assert.match(sketcher, /label="Mirror"/);
  assert.match(sketcher, /type: "mirror"/);
  assert.match(sketcher, /mirror-constraint-badge/);
  assert.match(sketcher, /synchronizeMirrorLinks/);
});

test("sketch patterns expose linked linear, rectangular, and circular workflows", async () => {
  const sketcher = await source("app/components/Sketcher.tsx");
  const constraints = await source("app/components/sketchConstraints.ts");
  const geometry = await source("app/components/sketchGeometry.ts");
  const css = await source("app/modeling.css");
  assert.match(sketcher, /label="Linear" title="Linear sketch pattern/);
  assert.match(sketcher, /label="Rect" title="Rectangular sketch pattern/);
  assert.match(sketcher, /label="Circular" title="Circular sketch pattern/);
  assert.match(sketcher, /sketch-pattern-manager/);
  assert.match(sketcher, /Instances to Skip/);
  assert.match(sketcher, /Equal spacing across angular span/);
  assert.match(sketcher, />Radius<BufferedNumberInput/);
  assert.match(sketcher, />Arc angle<BufferedNumberInput/);
  assert.match(sketcher, /Rotate instances about center/);
  assert.match(sketcher, /sketch-pattern-preview/);
  assert.match(sketcher, /pattern-constraint-badge/);
  assert.match(constraints, /type: "linear-pattern"/);
  assert.match(constraints, /type: "rectangular-pattern"/);
  assert.match(constraints, /type: "circular-pattern"/);
  assert.match(geometry, /synchronizePatternLinks/);
  assert.match(css, /\.sketch-pattern-manager/);
});

test("pattern managers open before reference picking and ignore background edges as seeds", async () => {
  const sketcher = await source("app/components/Sketcher.tsx");
  assert.match(sketcher, /\{patternDraft && <aside className="sketch-pattern-manager"/);
  assert.match(sketcher, /tool === "mirror" && <aside className="sketch-pattern-manager sketch-mirror-manager"/);
  assert.match(sketcher, /selectedSketchEntityIds/);
  assert.match(sketcher, /patternDraft\?\.stage === "direction-1"[\s\S]*?patternDraft\?\.stage === "center"[\s\S]*?externalReferences\.map/);
  assert.doesNotMatch(sketcher, /patternDraft\?\.stage !== "parameters"\) && externalReferences\.map/);
});

test("focused controls cannot trigger sketch or model picking shortcuts", async () => {
  const [sketcher, page, bufferedInput] = await Promise.all([source("app/components/Sketcher.tsx"), source("app/page.tsx"), source("app/components/BufferedNumberInput.tsx")]);
  assert.match(sketcher, /keyboardEventOwnedByControl\(event\.target\)/);
  assert.match(page, /event\.defaultPrevented \|\| keyboardEventOwnedByControl\(event\.target\)/);
  assert.match(bufferedInput, /input, textarea, select, button/);
});

test("modeling dialogs buffer incomplete numeric edits without mutating geometry", async () => {
  const [sketcher, page, bufferedInput] = await Promise.all([source("app/components/Sketcher.tsx"), source("app/page.tsx"), source("app/components/BufferedNumberInput.tsx")]);
  assert.match(bufferedInput, /if \(!trimmed\)/);
  assert.match(bufferedInput, /Number\.isFinite\(parsed\)/);
  assert.match(bufferedInput, /cancelOnBlur/);
  assert.ok((page.match(/<BufferedNumberInput/g) ?? []).length >= 17);
  assert.ok((sketcher.match(/<BufferedNumberInput/g) ?? []).length >= 8);
  assert.doesNotMatch(page, /<input[^>]*type="number"/);
  assert.match(sketcher, /patternSkippedInput/);
  assert.match(sketcher, /cancelDimensionEditOnBlur/);
});

test("selected splines expose weighted tangent handles and relaxation", async () => {
  const sketcher = await source("app/components/Sketcher.tsx");
  assert.match(sketcher, /spline-handle-layer/);
  assert.match(sketcher, /beginSplineHandleDrag/);
  assert.match(sketcher, /event\.altKey/);
  assert.match(sketcher, /Relax spline/);
});

test("spline context editing can add curve points and delete through points", async () => {
  const sketcher = await source("app/components/Sketcher.tsx");
  assert.match(sketcher, /Add spline point/); assert.match(sketcher, /Delete spline point/);
  assert.match(sketcher, /insertSplinePoint/); assert.match(sketcher, /deleteSplinePoint/);
  assert.match(sketcher, /className="spline-hit"/);
});

test("3D viewport rebuilds the document and displays unconsumed sketches", async () => {
  const viewport = await source("app/components/CadViewport.tsx");

  assert.match(viewport, /api\/document/);
  assert.match(viewport, /data\.sketches\.filter/);
  assert.match(viewport, /OrthographicCamera/);
  assert.match(viewport, /editingSketchId/);
  assert.match(viewport, /onSketchViewChange/);
  assert.match(viewport, /onSketchRotatedChange/);
  assert.match(viewport, /middlePressed = \(event\.buttons & 4\)/);
  assert.match(viewport, /rightPressed = \(event\.buttons & 2\)/);
  assert.match(viewport, /sampleSketchEntity/);
  assert.match(viewport, /ArrowHelper/);
  assert.match(viewport, /previewFaces/);
  assert.match(viewport, /highlightedSketchId/);
  assert.match(viewport, /selectableSketchIds/);
  assert.match(viewport, /onSelectSketch/);
  assert.match(viewport, /selectableSketch/);
  assert.match(viewport, /showModelGrid/);
  assert.match(viewport, /if \(showModelGrid\).*GridHelper/);
  assert.match(viewport, /extrusionArrowHits/);
  assert.match(viewport, /originalDistance.*pendingDistance/);
  assert.match(viewport, /onFeaturePreviewDistanceChange/);
  assert.match(viewport, /deformExtrusionPreview/);
  assert.match(viewport, /extrusionPreviewTargets/);
  assert.match(viewport, /"preview"/);
  assert.match(viewport, /hiddenBodyIds/);
  assert.match(viewport, /feature\.visible === false/);
  assert.match(viewport, /highlightedFeatureBodyId/);
  assert.match(viewport, /PointsMaterial/);
  assert.match(viewport, /selectionPulseMaterials/);
  assert.match(viewport, /PlaneGeometry/);
  assert.match(viewport, /querySelector\("\.sketch-canvas"\)/);
  assert.match(viewport, /depthTest: false/);
  assert.match(viewport, /onSelectFace/);
});

test("model usability pass preserves rebuild context and exposes fit, naming, and consumed visibility", async () => {
  const [page, viewport, css] = await Promise.all([source("app/page.tsx"), source("app/components/CadViewport.tsx"), source("app/modeling.css")]);
  assert.match(page, /aria-label="Fit model to view"/);
  assert.match(page, /event\.key\.toLowerCase\(\) !== "f"/);
  assert.match(page, /features\.filter\(\(feature\) => feature\.type === featureDraft\.type/);
  assert.match(page, /visible: false/);
  assert.match(page, /Rename resulting body/);
  assert.match(page, /operation-body-row/);
  assert.match(page, /Math\.min\(event\.clientY, window\.innerHeight/);
  assert.match(page, /formatLength\(feature\.thickness/);
  assert.match(viewport, /viewport-rebuild-snapshot/);
  assert.match(viewport, /describeRebuildFailure/);
  assert.match(viewport, /fitModelToView/);
  assert.match(viewport, /camera\.up\.copy\(activeFrame\.yDir\);/);
  assert.match(css, /\.operation-body-row/);
});
