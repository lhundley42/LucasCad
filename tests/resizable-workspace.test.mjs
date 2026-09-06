import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { ResizableWorkspace } from "../app/components/ResizableWorkspace.tsx";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:4310" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const observers = new Set();
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; }
  observe() { observers.add(this.callback); }
  disconnect() { observers.delete(this.callback); }
};
let workspaceWidth = 1200;
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { width: this.classList.contains("workspace") ? workspaceWidth : this.classList.contains("properties-panel") ? 248 : 0 };
};
window.HTMLElement.prototype.setPointerCapture = function (id) { this.capture = id; };
window.HTMLElement.prototype.hasPointerCapture = function (id) { return this.capture === id; };
window.HTMLElement.prototype.releasePointerCapture = function () { this.capture = null; };

async function mount(t, saved = null) {
  window.localStorage.clear(); workspaceWidth = 1200;
  if (saved !== null) window.localStorage.setItem("lucascad.featureTreeWidth", saved);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const render = (propertiesCollapsed = false) => root.render(React.createElement(ResizableWorkspace, { propertiesCollapsed },
    React.createElement("aside", { id: "feature-tree-panel", className: "feature-panel" }, "Tree"),
    React.createElement("main", null, "Viewport"), React.createElement("aside", { className: "properties-panel" })));
  await act(async () => render());
  t.after(async () => { await act(async () => root.unmount()); host.remove(); });
  const handle = host.querySelector('[role="separator"]');
  return {
    host, handle, width: () => Number(handle.getAttribute("aria-valuenow")),
    fire: async (type, properties = {}) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 1, button: 0, clientX: 0, ...properties });
      await act(async () => handle.dispatchEvent(event));
    },
    collapse: async (value) => { await act(async () => render(value)); },
    resize: async (value) => { workspaceWidth = value; await act(async () => { for (const callback of observers) callback(); }); },
  };
}

test("left drag updates the tree continuously, captures the pointer and remembers width", async (t) => {
  const ui = await mount(t);
  assert.equal(ui.width(), 230);
  await ui.fire("pointerdown", { clientX: 230 });
  assert.equal(ui.handle.capture, 1);
  assert.equal(document.body.style.cursor, "col-resize");
  await ui.fire("pointermove", { clientX: 320 });
  assert.equal(ui.width(), 320);
  await ui.fire("pointermove", { clientX: 410 });
  assert.equal(ui.width(), 410);
  assert.equal(ui.host.querySelector("section").style.getPropertyValue("--feature-tree-width"), "410px");
  await ui.fire("pointerup");
  assert.equal(ui.handle.capture, null);
  assert.equal(document.body.style.cursor, "");
  assert.equal(window.localStorage.getItem("lucascad.featureTreeWidth"), "410");
  await ui.fire("pointermove", { clientX: 500 });
  assert.equal(ui.width(), 410);
});

test("width is bounded and responds to collapsed properties and window resizing", async (t) => {
  const ui = await mount(t);
  await ui.resize(1000);
  await ui.fire("keydown", { key: "End" });
  assert.equal(ui.width(), 432);
  await ui.collapse(true);
  await ui.fire("keydown", { key: "End" });
  assert.equal(ui.width(), 600);
  await ui.resize(720);
  assert.equal(ui.width(), 400);
  await ui.fire("keydown", { key: "Home" });
  assert.equal(ui.width(), 160);
  await ui.fire("keydown", { key: "ArrowLeft" });
  assert.equal(ui.width(), 160);
});

test("saved width, keyboard resizing and double-click reset", async (t) => {
  const ui = await mount(t, "380");
  assert.equal(ui.width(), 380);
  await ui.fire("keydown", { key: "ArrowRight" });
  assert.equal(ui.width(), 390);
  await ui.fire("keydown", { key: "ArrowLeft", shiftKey: true });
  assert.equal(ui.width(), 350);
  await ui.fire("dblclick");
  assert.equal(ui.width(), 230);
});

test("invalid saved values are ignored; right drag never starts resizing", async (t) => {
  const ui = await mount(t, "NaN");
  assert.equal(ui.width(), 230);
  await ui.fire("pointerdown", { button: 2, clientX: 230 });
  await ui.fire("pointermove", { clientX: 500 });
  assert.equal(ui.width(), 230);
  assert.equal(document.body.style.cursor, "");
});

test("pointer cancellation and window blur release resize state without affecting geometry", async (t) => {
  const ui = await mount(t);
  await ui.fire("pointerdown");
  await ui.fire("pointercancel");
  await ui.fire("pointermove", { clientX: 100 });
  assert.equal(ui.width(), 230);
  assert.equal(document.body.style.userSelect, "");
  await ui.fire("pointerdown");
  await act(async () => window.dispatchEvent(new window.Event("blur")));
  await ui.fire("pointermove", { clientX: 100 });
  assert.equal(ui.width(), 230);
  assert.equal(document.body.style.cursor, "");
  assert.equal(ui.host.querySelector("main").textContent, "Viewport");
});
