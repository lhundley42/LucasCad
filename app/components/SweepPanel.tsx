"use client";

import { useEffect, useRef, useState } from "react";
import type { DocumentRequest, SweepParameters, SketchRecord } from "./CadViewport";

export function SweepPanel({ value, sketches, bodies, candidate, api, editing, onChange, onClose, onCommit, onValidated }: {
  value: SweepParameters; sketches: SketchRecord[]; bodies: { id: string; name: string }[];
  candidate: DocumentRequest; api: string; editing: boolean;
  onChange: (value: SweepParameters) => void; onClose: () => void; onCommit: () => void; onValidated: (key: string) => void;
}) {
  const key = JSON.stringify(candidate);
  const [validation, setValidation] = useState({ key: "", valid: false, message: "" });
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const enough = value.sketchIds.length === 2 && value.sketchIds.every(Boolean);
  useEffect(() => {
    if (!enough) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${api}/api/document`, { method: "POST", headers: { "Content-Type": "application/json" }, body: key, signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail ?? "Sweep rebuild failed.");
        if (!result.properties?.valid || result.properties.solidCount < 1) throw new Error("Sweep rebuild did not produce a valid solid.");
        if (!controller.signal.aborted) {
          setValidation({ key, valid: true, message: "Valid solid · complete feature history verified" });
          onValidated(key);
        }
      } catch (error) {
        if (!controller.signal.aborted) setValidation({ key, valid: false, message: error instanceof Error ? error.message : "Cannot validate sweep." });
      }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [api, enough, key, onValidated]);
  const ready = enough && validation.key === key && validation.valid;
  return <section role="dialog" aria-label={editing ? "Edit sweep" : "Sweep"} className="cad-dialog feature-dialog feature-flyout loft-flyout sweep-flyout" style={position ? { left: position.x, top: position.y, right: "auto", maxHeight: `calc(100dvh - ${position.y + 16}px)` } : undefined} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header style={{ cursor: "move", touchAction: "none" }} onPointerDown={(event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
      const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
      drag.current = { x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => { if (drag.current) setPosition({ x: Math.max(0, Math.min(window.innerWidth - 330, drag.current.left + event.clientX - drag.current.x)), y: Math.max(0, Math.min(window.innerHeight - 80, drag.current.top + event.clientY - drag.current.y)) }); }} onPointerUp={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <strong>{editing ? "Edit sweep" : "Sweep — profile and path"}</strong><button aria-label="Close sweep" onClick={onClose}>×</button>
    </header>
    <div className="loft-fields">
      <p className="dialog-hint">Sweep a closed profile along a connected sketch path. Place the profile at a path endpoint, preferably normal to the path.</p>
      <div className="sweep-references">
      {(["Profile", "Path"] as const).map((label, index) => <button type="button" key={label} className={(!value.sketchIds[0] ? index === 0 : !value.sketchIds[1] && index === 1) ? "active" : ""} aria-label={`Select sweep ${label.toLowerCase()}`} onClick={() => { const sketchIds = [...value.sketchIds]; sketchIds[index] = ""; onChange({ ...value, sketchIds }); }}>
        <b>{index + 1} · {label}</b><span>{sketches.find(s => s.id === value.sketchIds[index])?.name ?? `Click a ${label.toLowerCase()} sketch in 3D or the tree`}</span><small>{value.sketchIds[index] ? "Click to reselect" : index ? "One continuous chain; open or closed" : "Closed contour; holes allowed"}</small>
      </button>)}
      </div>
      <button type="button" disabled={!enough} onClick={() => onChange({ ...value, sketchIds: [...value.sketchIds].reverse() })}>⇄ Swap profile and path</button>
      {!enough && <p role="status">{!value.sketchIds[0] ? "Select the profile sketch." : "Now select the path sketch."}</p>}
      <label>Profile orientation<select aria-label="Sweep orientation" value={value.orientation} onChange={event => onChange({ ...value, orientation: event.target.value as SweepParameters["orientation"] })}><option value="follow">Follow path</option><option value="fixed">Keep normal constant</option></select></label>
      <label>Path corners<select aria-label="Sweep corners" value={value.transition} onChange={event => onChange({ ...value, transition: event.target.value as SweepParameters["transition"] })}><option value="round">Round transitions</option><option value="right">Miter transitions</option></select></label>
      <label>Result<select aria-label="Sweep result" value={value.combine} onChange={event => onChange({ ...value, combine: event.target.value as SweepParameters["combine"], targetBodyId: value.targetBodyId || bodies[0]?.id || "" })}><option value="new">New body</option><option value="union" disabled={!bodies.length}>Union with body</option><option value="cut" disabled={!bodies.length}>Cut body</option></select></label>
      {value.combine !== "new" && <label>Target body<select aria-label="Sweep target body" value={value.targetBodyId} onChange={event => onChange({ ...value, targetBodyId: event.target.value })}>{bodies.map(body => <option key={body.id} value={body.id}>{body.name}</option>)}</select></label>}
      {enough && <p className={`dialog-hint ${validation.key === key && !validation.valid ? "loft-error" : ""}`} role="status">{validation.key === key ? validation.message : "Checking sweep and downstream features…"}</p>}
    </div>
    <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!ready} onClick={() => { if (ready) onCommit(); }}>{editing ? "Apply changes" : "Create sweep"}</button></div>
  </section>;
}

