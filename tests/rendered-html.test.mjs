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

  for (const tool of ["line", "rectangle", "circle", "ellipse", "arc", "spline", "trim"]) {
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
  assert.match(sketcher, /Snap normal/);
  assert.match(sketcher, /viewWidth/);
  assert.match(sketcher, /trim-hit/);
  assert.match(sketcher, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(sketcher, /distance\(draft\[0\], point\) < 0\.01/);
  assert.match(sketcher, /closesProfile/);
  assert.match(sketcher, /draft\.length >= 3/);
  assert.match(sketcher, /Linear dimension constraint/);
  assert.match(sketcher, /cycleLinearOrientation/);
  assert.match(sketcher, /onConstraintsChange/);
  assert.match(sketcher, /conflicted/);
  assert.match(sketcher, /aria-label="Linear constraint value"/);
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
  assert.match(modelingCss, /\.sketch-canvas\.dragging-selection/);
  assert.match(modelingCss, /\.sketch-line-hit[\s\S]*?stroke-width: 20/);
  assert.match(modelingCss, /\.constraint-line-hit[\s\S]*?stroke-width: 28/);
  assert.match(modelingCss, /\.linear-constraint\.selected \.constraint-measure/);

  const globalsCss = await source("app/globals.css");
  assert.match(globalsCss, /sketch-entity:hover[\s\S]*?--sketch-highlight-width/);
  assert.match(globalsCss, /sketch-dimension:hover rect[\s\S]*?--sketch-highlight-width/);

  const page = await source("app/page.tsx");
  assert.match(page, /Highlight width for all hovered and selected sketch geometry/);
  assert.match(page, /constraints\?: LinearDimensionConstraint\[\]/);
  assert.match(page, /onConstraintsChange=\{updateSketchConstraints\}/);
});

test("placed linear dimensions remain draggable while the dimension tool is active", async () => {
  const css = await readFile(new URL("../app/modeling.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /tool-linear-dimension\s+\.linear-constraint:not\(\.preview\)[^{]*\{[^}]*pointer-events:\s*none/);
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
  assert.match(viewport, /highlightedFeatureBodyId/);
  assert.match(viewport, /PointsMaterial/);
  assert.match(viewport, /selectionPulseMaterials/);
  assert.match(viewport, /PlaneGeometry/);
  assert.match(viewport, /querySelector\("\.sketch-canvas"\)/);
  assert.match(viewport, /depthTest: false/);
  assert.match(viewport, /onSelectFace/);
});
