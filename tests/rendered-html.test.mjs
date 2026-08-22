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
  assert.match(sketcher, /cornerLines/);
  assert.match(sketcher, /Snap normal/);
  assert.match(sketcher, /viewWidth/);
  assert.match(sketcher, /trim-hit/);
  assert.match(sketcher, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(sketcher, /distance\(draft\[0\], point\) < 0\.01/);
  assert.match(sketcher, /closesProfile/);
  assert.match(sketcher, /draft\.length >= 3/);
  assert.match(sketcher, /Linear dimension constraint/);
  assert.match(sketcher, /Angular dimension constraint/);
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

test("placed linear dimensions remain draggable while the dimension tool is active", async () => {
  const css = await readFile(new URL("../app/modeling.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /tool-linear-dimension\s+\.linear-constraint:not\(\.preview\)[^{]*\{[^}]*pointer-events:\s*none/);
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
  assert.match(sketcher, /Select two non-parallel line segments/);
});

test("sketch command group titles sit horizontally above their tool palettes", async () => {
  const css = await source("app/modeling.css");
  assert.match(css, /\.sketch-command-group b[\s\S]*?display: flex/);
  assert.match(css, /\.sketch-command-tools \{ display:flex/);
  assert.doesNotMatch(css, /rotate\(-90deg\)/);
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
  assert.match(viewport, /mouseButtons\.MIDDLE/);
  assert.match(viewport, /mouseButtons\.RIGHT/);
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
