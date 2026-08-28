import assert from "node:assert/strict";
import test from "node:test";

import {
  angularDimensionLayout,
  angularDimensionValue,
  constraintSupersedesOrthogonalProfileDimension,
  constraintSupersedesSegmentDimension,
  controlPointsForEntity,
  cycleLinearOrientation,
  defaultLinearDimensionPosition,
  defaultLinearOrientation,
  diameterDimensionLayout,
  diameterDimensionValue,
  linearDimensionLayout,
  linearDimensionValue,
  linearOrientationOptions,
  nonOverlappingReferenceHitRadius,
  preferredAxisOrSketchLineTarget,
  radialDimensionLayout,
  radialDimensionValue,
  targetPointForLinearValue,
  validLinearDimensionPair,
} from "../app/components/sketchConstraints.ts";

test("diameter dimensions span the selected circle and report its driving value", () => {
  const geometry = [{ id: "circle-1", type: "circle", c: { x: 5, y: -3 }, r: 12 }];
  const layout = diameterDimensionLayout("circle-1", { x: 30, y: -3 }, geometry);
  assert.equal(diameterDimensionValue("circle-1", geometry), 24);
  assert.deepEqual(layout.first, { x: -7, y: -3 });
  assert.deepEqual(layout.second, { x: 17, y: -3 });
  assert.deepEqual(layout.label, { x: 30, y: -3 });
});

test("radial dimensions drive circles and arcs from center to edge", () => {
  const geometry = [
    { id: "circle", type: "circle", c: { x: 5, y: -3 }, r: 12 },
    { id: "arc", type: "arc", a: { x: 20, y: 0 }, b: { x: 0, y: 20 }, through: { x: 14.1421356, y: 14.1421356 } },
  ];
  const circleLayout = radialDimensionLayout("circle", { x: 30, y: -3 }, geometry);
  assert.equal(radialDimensionValue("circle", geometry), 12);
  assert.deepEqual(circleLayout.first, { x: 5, y: -3 });
  assert.deepEqual(circleLayout.second, { x: 17, y: -3 });
  assert.ok(Math.abs(radialDimensionValue("arc", geometry) - 20) < 1e-5);
  const arcLayout = radialDimensionLayout("arc", { x: 30, y: 30 }, geometry);
  assert.ok(Math.hypot(arcLayout.first.x, arcLayout.first.y) < 1e-5);
});

test("the closest visible target wins when a sketch line overlaps an axis hit area", () => {
  const horizontal = { id: "bottom", type: "line", a: { x: -30, y: -8 }, b: { x: 30, y: -8 } };
  assert.deepEqual(preferredAxisOrSketchLineTarget({ x: 10, y: -8 }, "x", [horizontal], 14), { kind: "line", entityId: "bottom" });
  assert.deepEqual(preferredAxisOrSketchLineTarget({ x: 10, y: 0 }, "x", [horizontal], 14), { kind: "axis", axis: "x" });
  assert.deepEqual(preferredAxisOrSketchLineTarget({ x: 10, y: -3 }, "x", [horizontal], 14), { kind: "axis", axis: "x" });
  assert.deepEqual(preferredAxisOrSketchLineTarget({ x: 10, y: -5 }, "x", [horizontal], 14), { kind: "line", entityId: "bottom" });
});

test("the same proximity rule works beside the green vertical axis", () => {
  const vertical = { id: "left", type: "line", a: { x: 8, y: -30 }, b: { x: 8, y: 30 } };
  assert.deepEqual(preferredAxisOrSketchLineTarget({ x: 8, y: 10 }, "y", [vertical], 14), { kind: "line", entityId: "left" });
  assert.deepEqual(preferredAxisOrSketchLineTarget({ x: 0, y: 10 }, "y", [vertical], 14), { kind: "axis", axis: "y" });
});

const triangle = [
  { id: "base", type: "line", a: { x: -30, y: 0 }, b: { x: 30, y: 0 } },
  { id: "left", type: "line", a: { x: -30, y: 0 }, b: { x: 0, y: -50 } },
  { id: "right", type: "line", a: { x: 0, y: -50 }, b: { x: 30, y: 0 } },
];

test("circles expose their center and four tangent quadrant references", () => {
  const points = controlPointsForEntity({ id: "circle", type: "circle", c: { x: 10, y: 20 }, r: 5 });
  assert.deepEqual(points, [
    { handle: "center", point: { x: 10, y: 20 } },
    { handle: "radius", point: { x: 15, y: 20 } },
    { handle: "left", point: { x: 5, y: 20 } },
    { handle: "top", point: { x: 10, y: 15 } },
    { handle: "bottom", point: { x: 10, y: 25 } },
  ]);
});

test("lines expose endpoint and midpoint node references", () => {
  assert.deepEqual(controlPointsForEntity({ id: "line", type: "line", a: { x: -10, y: 4 }, b: { x: 20, y: 10 } }), [
    { handle: "a", point: { x: -10, y: 4 } },
    { handle: "midpoint", point: { x: 5, y: 7 } },
    { handle: "b", point: { x: 20, y: 10 } },
  ]);
});

test("a full segment length constraint supersedes only that segment's automatic dimension", () => {
  const line = { id: "line", type: "line", a: { x: 0, y: 0 }, b: { x: 30, y: 40 } };
  const aligned = { id: "length", type: "linear", first: { kind: "node", entityId: "line", handle: "a" }, second: { kind: "node", entityId: "line", handle: "b" }, orientation: "aligned", position: { x: 0, y: 0 }, value: 50 };
  const partial = { ...aligned, id: "horizontal", orientation: "horizontal" };
  assert.equal(constraintSupersedesSegmentDimension(aligned, line), true);
  assert.equal(constraintSupersedesSegmentDimension(partial, line), false);
  assert.equal(constraintSupersedesSegmentDimension(aligned, { ...line, id: "other" }), false);
});

test("axis-aligned endpoint dimensions supersede matching segment labels", () => {
  const horizontal = { id: "horizontal", type: "line", a: { x: 0, y: 5 }, b: { x: 30, y: 5 } };
  const constraint = { id: "width", type: "linear", first: { kind: "node", entityId: "horizontal", handle: "a" }, second: { kind: "node", entityId: "horizontal", handle: "b" }, orientation: "horizontal", position: { x: 0, y: 0 }, value: 30 };
  assert.equal(constraintSupersedesSegmentDimension(constraint, horizontal), true);
});

test("a circle center hit target cannot overlap its quadrant targets", () => {
  const points = controlPointsForEntity({ id: "circle", type: "circle", c: { x: 10, y: 20 }, r: 5 });
  const center = points[0];
  const centerHitRadius = nonOverlappingReferenceHitRadius(center.point, points.slice(1).map((candidate) => candidate.point), 16);
  const rightHitRadius = nonOverlappingReferenceHitRadius(points[1].point, points.filter((_, index) => index !== 1).map((candidate) => candidate.point), 16);
  assert.equal(centerHitRadius, 2.25);
  assert.equal(rightHitRadius, 2.25);
  assert.ok(centerHitRadius + rightHitRadius < 5);
  assert.equal(nonOverlappingReferenceHitRadius(center.point, points.slice(1).map((candidate) => candidate.point), 16, 0.22), 1.1);
});

test("axis dimensions distinguish a circle center from its right quadrant", () => {
  const circle = [{ id: "circle", type: "circle", c: { x: 10, y: 20 }, r: 5 }];
  const greenAxis = { kind: "external-line", referenceId: "sketch-axis:y", a: { x: 0, y: -100 }, b: { x: 0, y: 100 }, source: "sketch-axis" };
  assert.equal(linearDimensionValue(greenAxis, { kind: "node", entityId: "circle", handle: "center" }, "horizontal", circle), 10);
  assert.equal(linearDimensionValue(greenAxis, { kind: "node", entityId: "circle", handle: "radius" }, "horizontal", circle), 15);
});

test("a line followed by a point defaults to the perpendicular aligned distance", () => {
  const base = { kind: "line", entityId: "base" };
  const top = { kind: "node", entityId: "left", handle: "b" };
  assert.deepEqual(linearOrientationOptions(base, top, triangle), ["aligned"]);
  assert.equal(defaultLinearOrientation(base, top, triangle), "aligned");
  assert.equal(linearDimensionValue(base, top, "aligned", triangle), 50);
});

test("line-to-point dimensions project perpendicular to a diagonal line", () => {
  const geometry = [
    { id: "diagonal", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
    { id: "point", type: "circle", c: { x: 0, y: 10 }, r: 1 },
  ];
  const line = { kind: "line", entityId: "diagonal" };
  const point = { kind: "node", entityId: "point", handle: "center" };
  assert.equal(defaultLinearOrientation(line, point, geometry), "aligned");
  assert.ok(Math.abs(linearDimensionValue(line, point, "aligned", geometry) - Math.sqrt(50)) < 1e-9);
});

test("line-to-line dimensions accept parallel lines and measure perpendicular spacing", () => {
  const geometry = [
    { id: "first", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
    { id: "parallel", type: "line", a: { x: -2, y: 2 }, b: { x: 8, y: 12 } },
    { id: "crossing", type: "line", a: { x: 0, y: 10 }, b: { x: 10, y: 0 } },
  ];
  const first = { kind: "line", entityId: "first" };
  const parallel = { kind: "line", entityId: "parallel" };
  const crossing = { kind: "line", entityId: "crossing" };
  assert.equal(validLinearDimensionPair(first, parallel, geometry), true);
  assert.equal(validLinearDimensionPair(first, crossing, geometry), false);
  assert.ok(Math.abs(linearDimensionValue(first, parallel, "aligned", geometry) - Math.sqrt(8)) < 1e-9);
});

test("left-to-right endpoints default horizontal and can cycle through aligned", () => {
  const left = { kind: "node", entityId: "base", handle: "a" };
  const right = { kind: "node", entityId: "base", handle: "b" };
  const options = linearOrientationOptions(left, right, triangle);
  assert.deepEqual(options, ["horizontal", "vertical", "aligned"]);
  assert.equal(defaultLinearOrientation(left, right, triangle), "horizontal");
  assert.equal(cycleLinearOrientation("horizontal", options), "vertical");
  assert.equal(cycleLinearOrientation("vertical", options), "aligned");
});

test("unconnected point references can tab to their true diagonal distance", () => {
  const circles = [
    { id: "first", type: "circle", c: { x: 0, y: 0 }, r: 2 },
    { id: "second", type: "circle", c: { x: 3, y: 4 }, r: 2 },
  ];
  const first = { kind: "node", entityId: "first", handle: "center" };
  const second = { kind: "node", entityId: "second", handle: "center" };
  const options = linearOrientationOptions(first, second, circles);
  assert.deepEqual(options, ["horizontal", "vertical", "aligned"]);
  assert.equal(cycleLinearOrientation("vertical", options), "aligned");
  assert.equal(linearDimensionValue(first, second, "aligned", circles), 5);
});

test("dimension placement follows the selected grid axis", () => {
  const left = { kind: "node", entityId: "base", handle: "a" };
  const right = { kind: "node", entityId: "base", handle: "b" };
  const horizontal = linearDimensionLayout(left, right, "horizontal", { x: 0, y: 20 }, triangle);
  assert.equal(horizontal.dimensionFirst.y, 20);
  assert.equal(horizontal.dimensionSecond.y, 20);
  assert.equal(horizontal.value, 60);
});

test("editing a vertical dimension produces the correct target node", () => {
  assert.deepEqual(targetPointForLinearValue({ x: 0, y: 0 }, { x: 20, y: -50 }, "vertical", 35), { x: 20, y: -35 });
  assert.deepEqual(targetPointForLinearValue({ x: 0, y: 0 }, { x: 20, y: -50 }, "vertical", 0), { x: 20, y: 0 });
});

test("a projected plane intersection behaves as a fixed dimension line", () => {
  const plane = { kind: "external-line", referenceId: "XZ", a: { x: 0, y: -100 }, b: { x: 0, y: 100 }, source: "plane-intersection" };
  const vertex = { kind: "node", entityId: "base", handle: "b" };
  assert.equal(defaultLinearOrientation(plane, vertex, triangle), "horizontal");
  assert.equal(linearDimensionValue(plane, vertex, "horizontal", triangle), 30);
});

test("the red and green sketch axes can be used as fixed dimension references", () => {
  const redAxis = { kind: "external-line", referenceId: "sketch-axis:x", a: { x: -100, y: 0 }, b: { x: 100, y: 0 }, source: "sketch-axis" };
  const greenAxis = { kind: "external-line", referenceId: "sketch-axis:y", a: { x: 0, y: -100 }, b: { x: 0, y: 100 }, source: "sketch-axis" };
  const top = { kind: "node", entityId: "left", handle: "b" };
  const right = { kind: "node", entityId: "base", handle: "b" };
  assert.equal(linearDimensionValue(redAxis, top, "vertical", triangle), 50);
  assert.equal(linearDimensionValue(greenAxis, right, "horizontal", triangle), 30);
  assert.deepEqual(defaultLinearDimensionPosition(greenAxis, right, "horizontal", triangle, 10), { x: 15, y: -10 });
  assert.deepEqual(defaultLinearDimensionPosition(redAxis, top, "vertical", triangle, 10), { x: -10, y: -25 });
});

test("angular dimensions measure the placed sector between non-parallel lines", () => {
  const diagonalEnd = { x: 20, y: Math.sqrt(1200) };
  const geometry = [
    { id: "horizontal", type: "line", a: { x: 0, y: 0 }, b: { x: 40, y: 0 } },
    { id: "diagonal", type: "line", a: { x: 0, y: 0 }, b: diagonalEnd },
  ];
  const horizontal = { kind: "line", entityId: "horizontal" };
  const diagonal = { kind: "line", entityId: "diagonal" };
  assert.ok(Math.abs(angularDimensionValue(horizontal, diagonal, { x: 12, y: 8 }, geometry) - 60) < 1e-9);
  assert.ok(Math.abs(angularDimensionValue(horizontal, diagonal, { x: -12, y: 8 }, geometry) - 120) < 1e-9);
  const layout = angularDimensionLayout(horizontal, diagonal, { x: 10, y: 10 }, geometry);
  assert.deepEqual(layout.vertex, { x: 0, y: 0 });
  assert.equal(layout.largeArc, false);
  assert.equal(layout.sweep, true);
  assert.ok(Math.abs(layout.value - 60) < 1e-9);
});

test("one driven side suppresses both redundant segment labels in a constrained rectangle", () => {
  const rectangle = [
    { id: "top", type: "line", a: { x: 0, y: 0 }, b: { x: 50, y: 0 }, axisConstraint: "Horizontal" },
    { id: "right", type: "line", a: { x: 50, y: 0 }, b: { x: 50, y: 30 }, axisConstraint: "Vertical" },
    { id: "bottom", type: "line", a: { x: 50, y: 30 }, b: { x: 0, y: 30 }, axisConstraint: "Horizontal" },
    { id: "left", type: "line", a: { x: 0, y: 30 }, b: { x: 0, y: 0 }, axisConstraint: "Vertical" },
  ];
  const width = { id: "width", type: "linear", first: { kind: "node", entityId: "top", handle: "a" }, second: { kind: "node", entityId: "top", handle: "b" }, orientation: "horizontal", position: { x: 25, y: -10 }, value: 50 };
  assert.equal(constraintSupersedesOrthogonalProfileDimension(width, rectangle[0], rectangle), true);
  assert.equal(constraintSupersedesOrthogonalProfileDimension(width, rectangle[2], rectangle), true);
  assert.equal(constraintSupersedesOrthogonalProfileDimension(width, rectangle[1], rectangle), false);
});
