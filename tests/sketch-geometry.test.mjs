import assert from "node:assert/strict";
import test from "node:test";

import { automaticSplineHandles, cornerLines, deleteSplinePoint, entityInSelectionBox, extendEntityToTarget, insertSplinePoint, mirrorSketchEntity, nearestGridVertex, normalizedSelectionBox, perpendicularLineToReference, pointInSelectionBox, sampleSplineEntity, sketchRelationIsSatisfied, synchronizeMirrorLinks, translateSketchEntity, trimEntityAtPoint } from "../app/components/sketchGeometry.ts";

test("every independent grid vertex is reachable without skipping", () => {
  const spacing = 8;
  for (let index = -12; index <= 12; index++) {
    const expected = index * spacing;
    assert.deepEqual(nearestGridVertex({ x: expected + 0.1, y: expected - 0.1 }, spacing), { x: expected, y: expected });
  }
  assert.deepEqual(nearestGridVertex({ x: 4.1, y: -3.9 }, spacing), { x: 8, y: 0 });
});

test("selection boxes normalize in either drag direction", () => {
  const box = normalizedSelectionBox({ x: 20, y: 10 }, { x: -5, y: -10 });
  assert.deepEqual(box, { left: -5, right: 20, top: -10, bottom: 10 });
  assert.equal(pointInSelectionBox({ x: 0, y: 0 }, box), true);
});

test("window selection encloses while crossing selection intersects geometry", () => {
  const line = { id: "line", type: "line", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } };
  assert.equal(entityInSelectionBox(line, { x: -11, y: -2 }, { x: 11, y: 2 }), true);
  assert.equal(entityInSelectionBox(line, { x: -2, y: -2 }, { x: 2, y: 2 }), false);
  assert.equal(entityInSelectionBox(line, { x: 2, y: -2 }, { x: -2, y: 2 }), true);
});

test("group translation preserves the shape of each selected entity", () => {
  const line = { id: "line", type: "line", a: { x: -3, y: 1 }, b: { x: 4, y: 5 } };
  const circle = { id: "circle", type: "circle", c: { x: 10, y: 20 }, r: 6 };
  assert.deepEqual(translateSketchEntity(line, { x: 8, y: -2 }), { ...line, a: { x: 5, y: -1 }, b: { x: 12, y: 3 } });
  assert.deepEqual(translateSketchEntity(circle, { x: 8, y: -2 }), { ...circle, c: { x: 18, y: 18 } });
});

test("mirror reflects sketch geometry across any straight line", () => {
  const axis = { id: "axis", type: "line", a: { x: 0, y: -20 }, b: { x: 0, y: 20 } };
  const source = { id: "source", type: "line", a: { x: 3, y: 2 }, b: { x: 8, y: 7 } };
  assert.deepEqual(mirrorSketchEntity(source, axis, "copy"), { id: "copy", type: "line", a: { x: -3, y: 2 }, b: { x: -8, y: 7 }, construction: undefined, relations: undefined, axisConstraint: undefined });
});

test("mirror links update from either the parent or mirrored geometry", () => {
  const axis = { id: "axis", type: "line", a: { x: 0, y: -20 }, b: { x: 0, y: 20 } };
  const source = { id: "source", type: "circle", c: { x: 5, y: 2 }, r: 3 };
  const mirrored = mirrorSketchEntity(source, axis, "copy");
  const link = { axisEntityId: axis.id, pairs: [{ sourceId: source.id, mirroredId: mirrored.id }] };
  const parentEdited = [{ ...source, c: { x: 9, y: 4 } }, mirrored, axis];
  const fromParent = synchronizeMirrorLinks(parentEdited, [link], new Set([source.id]));
  assert.deepEqual(fromParent.find((entity) => entity.id === "copy").c, { x: -9, y: 4 });
  const childEdited = fromParent.map((entity) => entity.id === "copy" ? { ...entity, c: { x: -12, y: -6 }, r: 5 } : entity);
  const fromChild = synchronizeMirrorLinks(childEdited, [link], new Set(["copy"]));
  assert.deepEqual(fromChild.find((entity) => entity.id === "source").c, { x: 12, y: -6 });
  assert.equal(fromChild.find((entity) => entity.id === "source").r, 5);
});

test("horizontal and vertical relation badges follow the live line geometry", () => {
  const horizontal = { id: "horizontal", type: "line", a: { x: 0, y: 4 }, b: { x: 12, y: 4 }, relations: ["Horizontal"] };
  const vertical = { id: "vertical", type: "line", a: { x: 7, y: -3 }, b: { x: 7, y: 9 }, relations: ["Vertical"] };
  assert.equal(sketchRelationIsSatisfied(horizontal, "Horizontal"), true);
  assert.equal(sketchRelationIsSatisfied({ ...horizontal, b: { x: 12, y: 4.01 } }, "Horizontal"), false);
  assert.equal(sketchRelationIsSatisfied(vertical, "Vertical"), true);
  assert.equal(sketchRelationIsSatisfied({ ...vertical, b: { x: 7.01, y: 9 } }, "Vertical"), false);
  assert.equal(sketchRelationIsSatisfied(horizontal, "Coincident"), true);
});

test("trim splits a circle at rectangle intersections and removes only the clicked arc", () => {
  const circle = { id: "circle", type: "circle", c: { x: 0, y: 0 }, r: 10 };
  const rectangle = [
    { id: "top", type: "line", a: { x: -20, y: -2 }, b: { x: 20, y: -2 } },
    { id: "right", type: "line", a: { x: 20, y: -2 }, b: { x: 20, y: 2 } },
    { id: "bottom", type: "line", a: { x: 20, y: 2 }, b: { x: -20, y: 2 } },
    { id: "left", type: "line", a: { x: -20, y: 2 }, b: { x: -20, y: -2 } },
  ];

  const replacements = trimEntityAtPoint(circle, { x: 10, y: 0 }, [circle, ...rectangle]);

  assert.equal(replacements.length, 3);
  assert.ok(replacements.every((entity) => entity.type === "arc"));
  assert.ok(replacements.every((entity) => entity.relations.includes("Trimmed")));
});

test("trim splits a line at circle intersections and removes only the clicked middle", () => {
  const line = { id: "line", type: "line", a: { x: -20, y: 0 }, b: { x: 20, y: 0 } };
  const circle = { id: "circle", type: "circle", c: { x: 0, y: 0 }, r: 10 };

  const replacements = trimEntityAtPoint(line, { x: 0, y: 0 }, [line, circle]);

  assert.equal(replacements.length, 2);
  assert.deepEqual(replacements.map((entity) => [Math.round(entity.a.x), Math.round(entity.b.x)]), [[-20, -10], [10, 20]]);
});

test("a diameter bisects a circle so either clicked semicircle can be trimmed", () => {
  const circle = { id: "circle", type: "circle", c: { x: 0, y: 0 }, r: 20 };
  const diameter = { id: "diameter", type: "line", a: { x: -20, y: 0 }, b: { x: 20, y: 0 } };

  const lowerHalf = trimEntityAtPoint(circle, { x: 0, y: -20 }, [circle, diameter]);
  const upperHalf = trimEntityAtPoint(circle, { x: 0, y: 20 }, [circle, diameter]);

  assert.equal(lowerHalf.length, 1);
  assert.equal(upperHalf.length, 1);
  assert.equal(lowerHalf[0].type, "arc");
  assert.equal(upperHalf[0].type, "arc");
  assert.ok(lowerHalf[0].through.y > 19);
  assert.ok(upperHalf[0].through.y < -19);
});

test("a bisecting line trims only the clicked half of an ellipse", () => {
  const ellipse = { id: "ellipse", type: "ellipse", c: { x: 0, y: 0 }, rx: 20, ry: 10 };
  const bisector = { id: "bisector", type: "line", a: { x: 0, y: -20 }, b: { x: 0, y: 20 } };
  const remaining = trimEntityAtPoint(ellipse, { x: 20, y: 0 }, [ellipse, bisector]);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].type, "spline");
  assert.ok(remaining[0].points.every((point) => point.x <= 0.001));
  assert.ok(remaining[0].points.some((point) => Math.abs(point.x + 20) < 0.01));
});

test("an ellipse without intersections is preserved when trim is clicked", () => {
  const ellipse = { id: "ellipse", type: "ellipse", c: { x: 0, y: 0 }, rx: 20, ry: 10 };
  assert.deepEqual(trimEntityAtPoint(ellipse, { x: 20, y: 0 }, [ellipse]), [ellipse]);
});

test("extend lengthens the selected end of a line to its target geometry", () => {
  const source = { id: "source", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  const target = { id: "target", type: "line", a: { x: 20, y: -5 }, b: { x: 20, y: 5 } };
  assert.deepEqual(extendEntityToTarget(source, { x: 9, y: 0 }, target), { ...source, b: { x: 20, y: 0 } });
});

test("extend continues an arc along its circle until it meets the target", () => {
  const source = { id: "arc", type: "arc", a: { x: -10, y: 0 }, b: { x: 10, y: 0 }, through: { x: 0, y: 10 } };
  const target = { id: "target", type: "line", a: { x: 0, y: -15 }, b: { x: 0, y: -5 } };
  const extended = extendEntityToTarget(source, { x: 9, y: 0 }, target);
  assert.equal(extended?.type, "arc");
  assert.ok(Math.abs(extended.b.x) < 0.001);
  assert.ok(Math.abs(extended.b.y + 10) < 0.001);
});

test("extend mates a circle to a line by changing its radius", () => {
  const source = { id: "circle", type: "circle", c: { x: 0, y: 0 }, r: 5 };
  const target = { id: "target", type: "line", a: { x: 15, y: -10 }, b: { x: 15, y: 10 } };
  assert.deepEqual(extendEntityToTarget(source, { x: 5, y: 0 }, target), { ...source, r: 15 });
});

test("corner trims intersecting line overhangs to the clicked sides", () => {
  const horizontal = { id: "horizontal", type: "line", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } };
  const vertical = { id: "vertical", type: "line", a: { x: 0, y: -10 }, b: { x: 0, y: 10 } };

  const result = cornerLines(horizontal, { x: -8, y: 0 }, vertical, { x: 0, y: 8 });

  assert.deepEqual(result, [
    { ...horizontal, b: { x: 0, y: 0 }, relations: ["Corner"] },
    { ...vertical, a: { x: 0, y: 0 }, relations: ["Corner"] },
  ]);
});

test("corner extends non-intersecting line segments to their virtual corner", () => {
  const horizontal = { id: "horizontal", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  const vertical = { id: "vertical", type: "line", a: { x: 20, y: 8 }, b: { x: 20, y: 18 } };

  const result = cornerLines(horizontal, { x: 9, y: 0 }, vertical, { x: 20, y: 9 });

  assert.deepEqual(result, [
    { ...horizontal, b: { x: 20, y: 0 }, relations: ["Corner"] },
    { ...vertical, a: { x: 20, y: 0 }, relations: ["Corner"] },
  ]);
});

test("corner rejects parallel line segments", () => {
  const first = { id: "first", type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  const second = { id: "second", type: "line", a: { x: 0, y: 5 }, b: { x: 10, y: 5 } };
  assert.equal(cornerLines(first, { x: 9, y: 0 }, second, { x: 9, y: 5 }), null);
});

test("perpendicular relation rotates the second line to ninety degrees", () => {
  const reference = { id: "reference", type: "line", a: { x: 0, y: 0 }, b: { x: 20, y: 0 } };
  const target = { id: "target", type: "line", a: { x: 5, y: 5 }, b: { x: 25, y: 10 } };
  const adjusted = perpendicularLineToReference(reference, target, target.a);
  assert.ok(adjusted);
  assert.deepEqual(adjusted.a, target.a);
  assert.equal(Math.abs(adjusted.b.x - adjusted.a.x), 0);
  assert.ok(Math.abs(Math.hypot(adjusted.b.x - adjusted.a.x, adjusted.b.y - adjusted.a.y) - Math.hypot(target.b.x - target.a.x, target.b.y - target.a.y)) < 1e-9);
  assert.ok(adjusted.relations.includes("Perpendicular"));
});

test("spline tangent handles reshape the curve without moving through points", () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  const handles = automaticSplineHandles(points);
  handles[1] = { in: { x: 6, y: 8 }, out: { x: 14, y: 8 } };
  const sampled = sampleSplineEntity({ id: "spline", type: "spline", points, handles }, 8);
  assert.deepEqual(sampled[0], points[0]);
  assert.deepEqual(sampled.at(-1), points.at(-1));
  assert.ok(sampled.some((point) => point.y > 2));
});

test("inserting a spline point preserves the curve and adds the point at the clicked span", () => {
  const spline = { id: "spline", type: "spline", points: [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: 0 }] };
  const before = sampleSplineEntity(spline, 80); const result = insertSplinePoint(spline, { x: 5, y: 5 }); const after = sampleSplineEntity(result.entity, 80);
  assert.equal(result.entity.points.length, 4); assert.equal(result.pointIndex, 1);
  assert.ok(before.every((point) => Math.min(...after.map((candidate) => Math.hypot(point.x - candidate.x, point.y - candidate.y))) < 0.2));
});

test("deleting points keeps a closed spline closed and protects its minimum profile", () => {
  const closed = { id: "closed", type: "spline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 12, y: 8 }, { x: 2, y: 10 }, { x: 0, y: 0 }] };
  const reduced = deleteSplinePoint(closed, 2);
  assert.ok(reduced); assert.deepEqual(reduced.points[0], reduced.points.at(-1)); assert.equal(reduced.points.length, 4);
  assert.equal(deleteSplinePoint(reduced, 1), null);
});
