"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { DocumentRequest, FacePayload } from "./CadViewport";
import { geometryDocumentKey } from "./viewportRequests";
import { BufferedNumberInput } from "./BufferedNumberInput";

export type FilletDraft = { type: "fillet"; targetBodyId: string; edgeIndices: number[]; radius: number };
export type FilletResult = { available: boolean; radius: number; maxRadius: number; minimumRadius: number; limitResolved: boolean; message: string; adjusted?: boolean; targetBodyId: string; anchor: [number, number, number]; direction: [number, number, number]; previewFaces: FacePayload[] };
type Session = { draft: FilletDraft; result: FilletResult | null; pending: boolean; ready: boolean; message: string; committing: boolean; setRadius: (radius: number) => void; commit: () => void; close: () => void; unit: string; factor: number; editing: boolean; bodyName: string };
const Context = createContext<Session | null>(null);
export const useFilletSession = () => useContext(Context);
const parameterKey = (selection: string, radius: number) => `${selection}:${radius}`;

export function FilletSession({ draft, baseDocument, candidate, api, onRadiusChange, onCommit, onClose, imperial, editing, bodyName, children }: {
  draft: FilletDraft | null; baseDocument: DocumentRequest; candidate: DocumentRequest; api: string;
  onRadiusChange: (radius: number) => void; onCommit: () => void; onClose: () => void; imperial: boolean; editing: boolean; bodyName: string; children: ReactNode;
}) {
  const selection = draft ? JSON.stringify([geometryDocumentKey(baseDocument), draft.targetBodyId, [...draft.edgeIndices].sort((a, b) => a - b)]) : "";
  const key = draft ? parameterKey(selection, draft.radius) : "";
  const [validation, setValidation] = useState<{ key: string; selection: string; result: FilletResult | null; message: string }>({ key: "", selection: "", result: null, message: "" });
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState({ key: "", message: "" });
  const accepted = useRef("");
  const running = useRef(false);
  const queued = useRef<null | (() => Promise<void>)>(null);
  const alive = useRef(true);
  const live = useRef({ key, selection, draft, candidate, baseDocument, onRadiusChange, onCommit });
  live.current = { key, selection, draft, candidate, baseDocument, onRadiusChange, onCommit };
  useEffect(() => { alive.current = true; return () => { alive.current = false; queued.current = null; }; }, []);
  const pump = async () => {
    if (running.current) return;
    running.current = true;
    try { while (queued.current && alive.current) { const work = queued.current; queued.current = null; await work(); } }
    finally { running.current = false; }
  };
  useEffect(() => {
    queued.current = null;
    if (!draft || !draft.edgeIndices.length) { accepted.current = ""; setValidation({ key: "", selection: "", result: null, message: "" }); return; }
    if (accepted.current === key) return;
    const timer = setTimeout(() => {
      const request = live.current;
      queued.current = async () => {
        // Coalesce pointer motion: never queue a kernel operation for every mouse event.
        if (live.current.key !== request.key) return;
        try {
          const response = await fetch(`${api}/api/fillet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: request.baseDocument, ...request.draft }) });
          const result = await response.json() as FilletResult & { detail?: string };
          if (!response.ok) throw new Error(result.detail ?? "Cannot test these fillet edges.");
          if (!alive.current || live.current.key !== request.key) return;
          const validKey = result.available ? parameterKey(request.selection, result.radius) : request.key;
          accepted.current = validKey;
          setValidation(previous => ({ key: validKey, selection: request.selection,
            result: result.available ? result : previous.selection === request.selection ? previous.result : null,
            message: result.message }));
          if (!result.available) accepted.current = "";
          if (result.available && result.radius !== request.draft!.radius) live.current.onRadiusChange(result.radius);
        } catch (error) {
          if (alive.current && live.current.key === request.key) setValidation(previous => ({ ...previous, key: request.key, message: error instanceof Error ? error.message : "Cannot reach the modeling service." }));
        }
      };
      void pump();
    }, 90);
    return () => { clearTimeout(timer); queued.current = null; };
  }, [api, key]);
  const result = validation.selection === selection ? validation.result : null;
  const ready = !!draft?.edgeIndices.length && !!result?.available && validation.key === key && accepted.current === key;
  const pending = !!draft?.edgeIndices.length && validation.key !== key;
  const setRadius = (radius: number) => {
    if (!Number.isFinite(radius) || committing) return;
    onRadiusChange(Math.max(result?.minimumRadius ?? .001, Math.min(result?.maxRadius ?? Infinity, radius)));
  };
  const commit = async () => {
    if (!ready || committing) return;
    const submitted = live.current;
    setCommitting(true); setCommitError({ key, message: "" });
    try {
      // Check downstream features on edit before touching the user's committed history.
      const response = await fetch(`${api}/api/document`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submitted.candidate) });
      const payload = await response.json();
      if (!response.ok || !payload.properties?.valid) throw new Error(payload.detail ?? "The complete feature history could not be rebuilt.");
      if (alive.current && live.current.key === submitted.key) live.current.onCommit();
    } catch (error) {
      if (alive.current) setCommitError({ key: submitted.key, message: `${error instanceof Error ? error.message : "Cannot validate the model."} Your model has not been changed.` });
    } finally { if (alive.current) setCommitting(false); }
  };
  const session: Session | null = draft ? { draft, result, ready, pending, committing, setRadius, commit, close: onClose, editing, bodyName,
    unit: imperial ? "in" : "mm", factor: imperial ? 25.4 : 1,
    message: commitError.key === key && commitError.message ? commitError.message : committing ? "Checking complete feature history…" : !draft.edgeIndices.length ? "Click an edge. Hold Shift to add more edges." : pending ? result ? "Updating preview… You can keep adjusting." : "Finding a usable radius and testing the upper limit…" : validation.message } : null;
  return <Context.Provider value={session}>{children}</Context.Provider>;
}

export function FilletPanel() {
  const session = useFilletSession();
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  if (!session) return null;
  const { draft, result, ready, pending, committing, setRadius, commit, close, unit, factor, editing, bodyName, message } = session;
  const display = (value: number) => Number((value / factor).toPrecision(5));
  return <section role="dialog" aria-label={editing ? "Edit fillet" : "Fillet"} className="cad-dialog feature-dialog feature-flyout fillet-flyout" style={position ? { left: position.x, top: position.y, right: "auto" } : undefined} onPointerDown={event => event.stopPropagation()}>
    <header style={{ cursor: "move", touchAction: "none" }} onPointerDown={event => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
      const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
      drag.current = { x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top }; event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => { if (drag.current) setPosition({ x: Math.max(0, Math.min(window.innerWidth - 330, drag.current.left + event.clientX - drag.current.x)), y: Math.max(0, Math.min(window.innerHeight - 160, drag.current.top + event.clientY - drag.current.y)) }); }} onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <strong>{editing ? "Edit fillet" : "Fillet"}</strong><button aria-label="Close fillet" onClick={close}>×</button>
    </header>
    <div className="loft-fields">
      <div className="feature-summary"><span>◜</span><div><strong>{bodyName || "Select a solid edge"}</strong><small>{draft.edgeIndices.length} {draft.edgeIndices.length === 1 ? "edge" : "edges"} selected · Shift-click to add/remove</small></div></div>
      <label>Radius <span>{unit}</span><BufferedNumberInput aria-label="Fillet radius" value={display(draft.radius)} min={result ? result.minimumRadius / factor : .001 / factor} max={result ? result.maxRadius / factor : undefined} step="any" disabled={committing} onValidValue={value => setRadius(value * factor)} /></label>
      <input type="range" aria-label="Fillet radius slider" min={result?.minimumRadius ?? .001} max={result?.maxRadius ?? Math.max(2, draft.radius)} step="any" value={draft.radius} disabled={!result || committing} onChange={event => setRadius(Number(event.target.value))} />
      {result && <p className="fillet-limit"><strong>{result.limitResolved ? "Maximum radius ≈" : "Tested radius limit"} {display(result.maxRadius)} {unit}</strong><small>For this complete edge selection. Oversized values are limited automatically.</small></p>}
      <p role="status" className={`dialog-hint ${!pending && !ready && draft.edgeIndices.length ? "loft-error" : ""}`}>{message}</p>
      <p className="dialog-hint">Drag the gold radius arrow in the model, use the slider, or type a value. Pan and rotate normally. The last valid preview stays visible during calculation.</p>
    </div>
    <div className="dialog-actions"><button onClick={close}>Cancel</button><button className="primary" disabled={!ready || committing} onClick={commit}>{editing ? "Apply changes" : "Create fillet"}</button></div>
  </section>;
}
