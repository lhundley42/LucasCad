"use client";

import { useEffect, useState } from "react";
import type { DocumentRequest } from "./CadViewport";
import { toggleUnionBody, type UnionParameters } from "./unionBodies";

export function UnionPanel({ value, bodies, candidate, api, editing, onChange, onClose, onCommit }: {
  value: UnionParameters; bodies: { id: string; name: string }[]; candidate: DocumentRequest;
  api: string; editing: boolean; onChange: (value: UnionParameters) => void; onClose: () => void; onCommit: () => void;
}) {
  const key = JSON.stringify(candidate);
  const [validation, setValidation] = useState({ key: "", valid: false, message: "" });
  const enough = value.bodyIds.length >= 2;
  useEffect(() => {
    if (!enough) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${api}/api/document`, { method: "POST", headers: { "Content-Type": "application/json" }, body: key, signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail ?? "Union rebuild failed.");
        if (!result.properties?.valid) throw new Error("Union did not produce valid geometry.");
        if (!controller.signal.aborted) setValidation({ key, valid: true, message: "Valid union · feature history verified" });
      } catch (error) {
        if (!controller.signal.aborted) setValidation({ key, valid: false, message: error instanceof Error ? error.message : "Unable to validate union." });
      }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [api, key, enough]);
  const ready = enough && validation.key === key && validation.valid;
  return <section role="dialog" aria-label={editing ? "Edit union" : "Union bodies"} className="cad-dialog feature-dialog feature-flyout union-flyout" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header><strong>{editing ? "Edit union" : "Union bodies"}</strong><button aria-label="Close union" onClick={onClose}>×</button></header>
    <p className="dialog-hint">Click bodies in 3D, in the tree, or below. Click again to remove. Select any number of touching or overlapping solids.</p>
    <fieldset className="union-body-list"><legend>Bodies to union · {value.bodyIds.length} selected</legend>
      {bodies.map((body) => <label key={body.id}><input type="checkbox" checked={value.bodyIds.includes(body.id)} onChange={() => onChange(toggleUnionBody(value, body.id))} />{body.name}{body.id === value.targetBodyId && <small>Result body</small>}</label>)}
    </fieldset>
    <p className="dialog-hint">The first selected body keeps its name. Other selected bodies are consumed; their source features remain editable.</p>
    <p role="status" className={`dialog-hint ${enough && validation.key === key && !validation.valid ? "loft-error" : ""}`}>{!enough ? "Select at least two bodies." : validation.key === key ? validation.message : "Checking union and downstream features…"}</p>
    <div className="dialog-actions"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!ready} onClick={() => { if (ready) onCommit(); }}>{editing ? "Apply changes" : "Create union"}</button></div>
  </section>;
}
