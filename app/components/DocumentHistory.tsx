"use client";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { DocumentRequest } from "./CadViewport";
import { SnapshotHistory, undoRedoShortcut } from "./snapshotHistory";

export function useSnapshotHistory<T>(snapshot: T, restore: (snapshot: T) => void, paused = false, enabled = true) {
  const store = useRef<SnapshotHistory<T> | null>(null);
  if (!store.current) store.current = new SnapshotHistory(snapshot);
  const latest = useRef({ snapshot, restore, paused, enabled }); latest.current = { snapshot, restore, paused, enabled };
  const [revision, setRevision] = useState(0);
  const [, refresh] = useState(0);
  const flush = () => { if (latest.current.enabled && store.current!.record(latest.current.snapshot)) refresh(n => n + 1); };
  useLayoutEffect(() => { if (!paused) flush(); }, [snapshot, paused, enabled]);
  const step = (direction: "undo" | "redo") => {
    flush(); const next = store.current!.step(direction);
    if (next === null) return;
    latest.current.snapshot = next;
    latest.current.restore(next); setRevision(n => n + 1);
  };
  const reset = (snapshot: T) => { store.current!.reset(snapshot); latest.current.snapshot = snapshot; setRevision(n => n + 1); };
  return { canUndo: store.current.canUndo, canRedo: store.current.canRedo, revision, undo: () => step("undo"), redo: () => step("redo"), flush, reset };
}

type HistoryControls = { canUndo: boolean; canRedo: boolean; revision: number; undo: () => void; redo: () => void };
const HistoryContext = createContext<HistoryControls | null>(null);
export const useDocumentHistory = () => useContext(HistoryContext);
const RESET_EVENT = "lucascad-document-history-reset";
export function resetDocumentHistory(document: DocumentRequest) { window.dispatchEvent(new window.CustomEvent(RESET_EVENT, { detail: document })); }

export function DocumentHistory({ document: model, onRestore, cancelPending, children }: { document: DocumentRequest; onRestore: (document: DocumentRequest) => void; cancelPending: () => boolean; children: ReactNode }) {
  const [dragging, setDragging] = useState(false);
  const history = useSnapshotHistory(model, onRestore, dragging);
  const latest = useRef({ history, cancelPending }); latest.current = { history, cancelPending };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof window.Element) || !event.target.closest(".sketch-canvas")) return;
      clearTimeout(timer); latest.current.history.flush(); setDragging(true);
    };
    const up = () => {
      clearTimeout(timer);
      // Run after React's pointer-up handlers commit coincident links / trims.
      timer = setTimeout(() => { setDragging(false); latest.current.history.flush(); }, 0);
    };
    const keyboard = (event: KeyboardEvent) => {
      const direction = undoRedoShortcut(event);
      if (!direction || event.defaultPrevented) return;
      if (event.target instanceof window.Element && event.target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false'])")) return;
      event.preventDefault(); event.stopImmediatePropagation();
      clearTimeout(timer); setDragging(false);
      if (latest.current.cancelPending()) return;
      latest.current.history[direction]();
    };
    const reset = (event: Event) => { clearTimeout(timer); setDragging(false); latest.current.history.reset((event as CustomEvent<DocumentRequest>).detail); };
    window.addEventListener("pointerdown", down, true); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up); window.addEventListener("blur", up);
    window.addEventListener("keydown", keyboard, true); window.addEventListener(RESET_EVENT, reset);
    return () => { clearTimeout(timer); window.removeEventListener("pointerdown", down, true); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); window.removeEventListener("blur", up); window.removeEventListener("keydown", keyboard, true); window.removeEventListener(RESET_EVENT, reset); };
  }, []);
  return <HistoryContext.Provider value={history}>{children}</HistoryContext.Provider>;
}
