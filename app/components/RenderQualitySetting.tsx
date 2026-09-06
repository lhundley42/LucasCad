"use client";
import { useEffect, useState } from "react";

export function RenderQualitySetting({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onChange(draft); };
  const tolerance = 0.15 * (0.01 / 0.15) ** (draft / 100);
  return <section className="settings-section">
    <label htmlFor="mesh-quality"><span>Render &amp; mesh export quality</span><output>{draft}%</output></label>
    <input id="mesh-quality" aria-label="Render and mesh export quality" type="range" min="0" max="100" step="1" value={draft} onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} onPointerCancel={() => setDraft(value)} />
    <div className="quality-range-labels"><span>Fast</span><span>Ultra fine</span></div>
    <p>Meshing deflection: {tolerance.toFixed(4)} mm. Applies when you release the slider. STL and OBJ use the same quality; higher values use more memory and produce larger files.</p>
    <p>STEP / STP always exports exact CAD surfaces, independent of this slider.</p>
  </section>;
}
