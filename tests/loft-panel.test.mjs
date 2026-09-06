import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { LoftPanel } from "../app/components/LoftPanel.tsx";

// DOM/component interaction tests, deliberately not advertised as real browser QA.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:4310" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sketches = ["A", "B", "C"].map((id) => ({ id, name: `Section ${id}`, plane: "XY", entities: [] }));
const success = () => ({ ok: true, json: async () => ({ properties: { valid: true, solidCount: 1 } }) });
const delay = () => new Promise((resolve) => setTimeout(resolve, 240));

async function mount(t, ids = []) {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let value = { type: "loft", sketchIds: ids, ruled: false, combine: "new", targetBodyId: "body" };
  const calls = { commit: 0, close: 0, validated: [] };
  const onValidated = (key) => calls.validated.push(key);
  const render = () => root.render(React.createElement(LoftPanel, {
    value, sketches, bodies: [{ id: "body", name: "Target" }], editing: false, api: "http://localhost:4311",
    candidate: { sketches, features: [{ ...value, id: "loft", bodyId: "new-body" }] },
    onChange: (next) => { value = next; render(); }, onClose: () => calls.close++, onCommit: () => calls.commit++, onValidated,
  }));
  await act(async () => render());
  t.after(async () => { await act(async () => root.unmount()); host.remove(); });
  return { host, calls, value: () => value,
    update: async (next) => { await act(async () => { value = { ...value, ...next }; render(); }); },
    click: async (label) => { const button = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent === label); assert.ok(button, label); await act(async () => button.click()); },
    choose: async (label, text) => { const select = host.querySelector(`select[aria-label="${label}"]`); await act(async () => { select.value = text; select.dispatchEvent(new window.Event("change", { bubbles: true })); }); },
    commitButton: () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Create loft"),
  };
}

test("loft manager opens immediately empty or with a preselected section", async (t) => {
  let requests = 0; globalThis.fetch = async () => { requests++; return success(); };
  const ui = await mount(t);
  assert.ok(ui.host.querySelector('[role="dialog"]'));
  assert.match(ui.host.textContent, /at least two profiles/);
  assert.equal(ui.commitButton().disabled, true);
  await ui.update({ sketchIds: ["A"] });
  assert.match(ui.host.textContent, /Section A/);
  assert.match(ui.host.textContent, /one more profile/);
  await act(delay);
  assert.equal(requests, 0);
});

test("two profiles validate before commit; transition changes invalidate stale approval", async (t) => {
  globalThis.fetch = async () => success();
  const ui = await mount(t, ["A", "B"]);
  assert.equal(ui.commitButton().disabled, true);
  await act(delay);
  assert.equal(ui.commitButton().disabled, false);
  await ui.choose("Loft transition", "ruled");
  assert.equal(ui.value().ruled, true);
  assert.equal(ui.commitButton().disabled, true);
  await act(delay);
  await ui.click("Create loft");
  assert.equal(ui.calls.commit, 1);
  assert.equal(ui.calls.validated.length, 2);
});

test("reorder/remove controls preserve actual ordered section IDs", async (t) => {
  globalThis.fetch = async () => success();
  const ui = await mount(t, ["A", "B", "C"]);
  await ui.click("Move profile 3 up");
  assert.deepEqual(ui.value().sketchIds, ["A", "C", "B"]);
  await ui.click("Move profile 1 down");
  assert.deepEqual(ui.value().sketchIds, ["C", "A", "B"]);
  await ui.click("Remove profile 2");
  assert.deepEqual(ui.value().sketchIds, ["C", "B"]);
  await ui.click("Remove profile 1");
  assert.equal(ui.commitButton().disabled, true);
});

test("Union/Cut target changes do not clear the selected profiles", async (t) => {
  globalThis.fetch = async () => success();
  const ui = await mount(t, ["A", "B"]);
  for (const mode of ["union", "cut", "new"]) {
    await ui.choose("Loft result", mode);
    assert.deepEqual(ui.value().sketchIds, ["A", "B"]);
    assert.equal(ui.value().combine, mode);
    assert.equal(Boolean(ui.host.querySelector('[aria-label="Loft target body"]')), mode !== "new");
  }
});

test("invalid sections give an inline diagnostic and cannot commit", async (t) => {
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ detail: "Section A is not closed. Run SketchCheck." }) });
  const ui = await mount(t, ["A", "B"]);
  await act(delay);
  assert.match(ui.host.textContent, /not closed.*SketchCheck/);
  assert.equal(ui.commitButton().disabled, true);
  await ui.click("Create loft");
  assert.equal(ui.calls.commit, 0);
  assert.deepEqual(ui.calls.validated, []);
});

test("late validation from a superseded profile selection cannot enable commit", async (t) => {
  const pending = [];
  globalThis.fetch = () => new Promise((resolve) => pending.push(resolve));
  const ui = await mount(t, ["A", "B"]);
  await act(delay);
  await ui.update({ sketchIds: ["A", "C"] });
  await act(delay);
  assert.equal(pending.length, 2);
  await act(async () => pending[0](success()));
  assert.equal(ui.commitButton().disabled, true);
  assert.equal(ui.calls.validated.length, 0);
  await act(async () => pending[1](success()));
  assert.equal(ui.commitButton().disabled, false);
  assert.equal(ui.calls.validated.length, 1);
});

test("Cancel and Escape close the manager without committing", async (t) => {
  const ui = await mount(t);
  await ui.click("Cancel");
  await act(async () => ui.host.querySelector('[role="dialog"]').dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(ui.calls.close, 2);
  assert.equal(ui.calls.commit, 0);
});
