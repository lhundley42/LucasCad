"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentRequest, LoftParameters, SketchRecord } from "./CadViewport";

export function LoftPanel({ value, sketches, bodies, candidate, api, editing, onChange, onClose, onCommit, onValidated }: {
  value: LoftParameters; sketches: SketchRecord[]; bodies: { id: string; name: string }[];
  candidate: DocumentRequest; api: string; editing: boolean;
  onChange: (value: LoftParameters) => void; onClose: () => void; onCommit: () => void; onValidated: (key: string) => void;
}) {
  const key = JSON.stringify(candidate);
  const [validation, setValidation] = useState({ key: "", valid: false, message: "" });
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const enough = value.sketchIds.length >= 2;
  useEffect(() => {
    if (!enough) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${api}/api/document`, { method: "POST", headers: { "Content-Type": "application/json" }, body: key, signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail ?? "Loft rebuild failed.");
        if (!result.properties?.valid || result.properties.solidCount < 1) throw new Error("Loft rebuild did not produce a valid solid.");
        if (!controller.signal.aborted) {
          setValidation({ key, valid: true, message: "Valid solid · complete feature history verified" });
          onValidated(key);
        }
      } catch (error) {
        if (!controller.signal.aborted) setValidation({ key, valid: false, message: error instanceof Error ? error.message : "Cannot validate loft." });
      }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [api, enough, key, onValidated]);
  const ready = enough && validation.key === key && validation.valid;
  const move = (index: number, delta: number) => {
    const sketchIds = [...value.sketchIds];
    [sketchIds[index], sketchIds[index + delta]] = [sketchIds[index + delta], sketchIds[index]];
    onChange({ ...value, sketchIds });
  };
  return <section role="dialog" aria-label={editing ? "Edit loft" : "Loft"} className="cad-dialog feature-dialog feature-flyout loft-flyout" style={position ? { left: position.x, top: position.y, right: "auto", maxHeight: `calc(100dvh - ${position.y + 16}px)` } : undefined} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header style={{ cursor: "move", touchAction: "none" }} onPointerDown={(event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
      const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
      drag.current = { x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => { if (drag.current) setPosition({ x: Math.max(0, Math.min(window.innerWidth - 330, drag.current.left + event.clientX - drag.current.x)), y: Math.max(0, Math.min(window.innerHeight - 80, drag.current.top + event.clientY - drag.current.y)) }); }} onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <strong>{editing ? "Edit loft" : "Loft — ordered profiles"}</strong><button aria-label="Close loft" onClick={onClose}>×</button>
    </header>
    <div className="loft-fields">
    <p className="dialog-hint">Click sketches in the model or feature tree, in travel order. Use one closed contour per section on separate planes.</p>
    <ol className="loft-sections" aria-label="Ordered loft profiles">
      {value.sketchIds.map((id, index) => <li key={id}><span><b>{index + 1}</b> {sketches.find((sketch) => sketch.id === id)?.name ?? "Missing sketch"}</span><button title="Move profile earlier" aria-label={`Move profile ${index + 1} up`} disabled={!index} onClick={() => move(index, -1)}>↑</button><button title="Move profile later" aria-label={`Move profile ${index + 1} down`} disabled={index === value.sketchIds.length - 1} onClick={() => move(index, 1)}>↓</button><button aria-label={`Remove profile ${index + 1}`} onClick={() => onChange({ ...value, sketchIds: value.sketchIds.filter((item) => item !== id) })}>×</button></li>)}
    </ol>
    {!enough && <p role="status">Select {value.sketchIds.length ? "one more profile" : "at least two profiles"} to preview.</p>}
    <label>Transition<select aria-label="Loft transition" value={value.ruled ? "ruled" : "smooth"} onChange={(event) => onChange({ ...value, ruled: event.target.value === "ruled" })}><option value="smooth">Smooth — blended through sections</option><option value="ruled">Ruled — straight between sections</option></select></label>
    <label>Result<select aria-label="Loft result" value={value.combine} onChange={(event) => onChange({ ...value, combine: event.target.value as LoftParameters["combine"], targetBodyId: value.targetBodyId || bodies[0]?.id || "" })}><option value="new">New body</option><option value="union" disabled={!bodies.length}>Union with body</option><option value="cut" disabled={!bodies.length}>Cut body</option></select></label>
    {value.combine !== "new" && <label>Target body<select aria-label="Loft target body" value={value.targetBodyId} onChange={(event) => onChange({ ...value, targetBodyId: event.target.value })}>{bodies.map((body) => <option key={body.id} value={body.id}>{body.name}</option>)}</select></label>}
    {enough && <p className={`dialog-hint ${validation.key === key && !validation.valid ? "loft-error" : ""}`} role="status">{validation.key === key ? validation.message : "Checking loft and downstream features…"}</p>}
    </div>
    <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!ready} onClick={() => { if (ready) onCommit(); }}>{editing ? "Apply changes" : "Create loft"}</button></div>
  </section>;
}
