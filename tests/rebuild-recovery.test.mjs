import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canRememberRebuild, documentKey, recoverWorkingDocument } from "../app/components/rebuildRecovery.ts";

const good = { sketches: [{ id: "profile", entities: [] }], features: [{ id: "extrude", type: "extrude", distance: 10 }], referenceGeometry: [] };
const failed = { ...good, features: [...good.features, { id: "bad-fillet", type: "fillet", radius: 100 }] };

test("backout restores the exact last successful edit, not merely one fewer feature", async () => {
  const edited = { ...good, features: [{ ...good.features[0], distance: -1 }] };
  const result = await recoverWorkingDocument(edited, good, () => { throw new Error("Should use remembered success"); });
  assert.deepEqual(result, good);
  assert.notEqual(result, good);
  assert.equal(edited.features[0].distance, -1);
});

test("an imported failed project recovers the longest valid prefix and preserves the original", async () => {
  const original = structuredClone(failed);
  const attempts = [];
  const result = await recoverWorkingDocument(failed, null, async (candidate) => { attempts.push(candidate.features.length); return candidate.features.length === 1; });
  assert.deepEqual(attempts, [1]);
  assert.deepEqual(result, good);
  assert.deepEqual(failed, original);
});

test("dependent failures back out together, only after a prefix validates", async () => {
  const attempts = [];
  const result = await recoverWorkingDocument({ ...failed, features: [...failed.features, { id: "downstream" }] }, null, async (candidate) => { attempts.push(candidate.features.length); return candidate.features.length === 1; });
  assert.deepEqual(attempts, [2, 1]);
  assert.deepEqual(result, good);
});

test("service failures abort recovery instead of erasing progressively more geometry", async () => {
  let attempts = 0;
  await assert.rejects(recoverWorkingDocument(failed, null, async () => { attempts++; throw new Error("Offline"); }), /Offline/);
  assert.equal(attempts, 1);
  assert.equal(failed.features.length, 2);
});

test("stale results, previews and rolled-back edit documents cannot replace the successful checkpoint", () => {
  assert.equal(canRememberRebuild(good, structuredClone(good)), true);
  assert.equal(canRememberRebuild(failed, good), false);
  assert.equal(canRememberRebuild(good, undefined), false);
  assert.notEqual(documentKey(good), documentKey(failed));
});

test("error UI exposes reversible recovery; previews cancel rather than truncate committed features", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const viewport = readFileSync(new URL("../app/components/CadViewport.tsx", import.meta.url), "utf8");
  assert.match(page, /Back out to last working model/);
  assert.match(page, /Back out of failed preview/);
  assert.match(page, /DocumentHistoryButtons/);
  assert.match(page, /onRestore=\{restoreHistoryDocument\}/);
  assert.match(page, /controller\.signal\.aborted \|\| documentKey\(currentDocumentRef\.current\) !== key/);
  assert.match(viewport, /built.previewFeature \|\| editingSketchId \? undefined : \{ sketches: built.sketches/);
});
