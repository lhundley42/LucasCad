import assert from "node:assert/strict";
import test from "node:test";

import { entityInSelectionBox, nearestGridVertex, normalizedSelectionBox, pointInSelectionBox, translateSketchEntity, trimEntityAtPoint } from "../app/components/sketchGeometry.ts";

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
