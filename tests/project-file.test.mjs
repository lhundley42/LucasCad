import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLucasCadFileName, parseLucasCadProject, serializeLucasCadProject } from "../app/components/projectFile.ts";

const document = {
  sketches: [{ id: "sketch-1", name: "Hull", plane: "XY", entities: [{ id: "circle-1", type: "circle", c: { x: 0, y: 0 }, r: 12 }], constraints: [{ id: "diameter-1", type: "diameter", entityId: "circle-1", value: 24 }] }],
  features: [{ id: "extrude-1", name: "Hull extrusion", type: "extrude", sketchId: "sketch-1", combine: "new", bodyId: "body-1", distance: 8 }],
  referenceGeometry: [{ id: "plane-1", name: "Deck plane", type: "plane", origin: [0, 0, 8], normal: [0, 0, 1], xDir: [1, 0, 0], sourceLabel: "Top face" }],
};

test("LucasCad project files round-trip the complete modeling document", () => {
  const serialized = serializeLucasCadProject(document);
  const parsed = parseLucasCadProject(serialized);
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.units, "mm");
  assert.deepEqual(parsed.sketches, document.sketches);
  assert.deepEqual(parsed.features, document.features);
  assert.deepEqual(parsed.referenceGeometry, document.referenceGeometry);
});

test("older project JSON without reference geometry remains readable", () => {
  const parsed = parseLucasCadProject(JSON.stringify({ schemaVersion: 1, sketches: [], features: [] }));
  assert.deepEqual(parsed.referenceGeometry, []);
});

test("invalid and unsupported project files are rejected clearly", () => {
  assert.throws(() => parseLucasCadProject("not-json"), /not valid JSON/);
  assert.throws(() => parseLucasCadProject(JSON.stringify({ schemaVersion: 99, sketches: [], features: [] })), /not supported/);
  assert.throws(() => parseLucasCadProject(JSON.stringify({ schemaVersion: 2, sketches: {}, features: [] })), /Sketches must be an array/);
});

test("unnamed saves receive a LucasCad JSON filename", () => {
  assert.equal(normalizeLucasCadFileName("Hull"), "Hull.lucascad.json");
  assert.equal(normalizeLucasCadFileName("Hull.json"), "Hull.json");
  assert.equal(normalizeLucasCadFileName(""), "Untitled Part.lucascad.json");
});
