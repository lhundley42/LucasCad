"use client";

import { useState } from "react";
import { normalizeBodyColor } from "./bodyColors";

/** Draft locally so Cancel is harmless and Apply is one undoable action. */
export function BodyAppearance({ color, themeColor, onApply }: {
  color?: string; themeColor: string; onApply: (color?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(color ?? themeColor);
  const validColor = normalizeBodyColor(draft);
  if (!expanded) return <button onClick={() => { setDraft(color ?? themeColor); setExpanded(true); }}>
    <span className="body-color-swatch" style={{ backgroundColor: color ?? themeColor }} aria-hidden="true"/> Appearance…
  </button>;
  return <section className="body-appearance" aria-label="Body appearance" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); setExpanded(false); }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && validColor) { event.preventDefault(); onApply(validColor); }
  }}>
    <strong>Body appearance</strong>
    <p>{color ? "Custom body color" : "Currently using theme color"}</p>
    <div className="body-appearance-fields">
      <input type="color" aria-label="Body color" value={validColor ?? color ?? themeColor} onChange={event => setDraft(event.target.value)}/>
      <label>Hex color<input type="text" aria-label="Body color hex" value={draft} spellCheck={false} maxLength={7} aria-invalid={!validColor} onChange={event => setDraft(event.target.value)}/></label>
    </div>
    {!validColor && <small role="alert">Enter a color such as #b87333.</small>}
    <button onClick={() => onApply(undefined)}>Use theme color</button>
    <div className="body-appearance-actions"><button onClick={() => setExpanded(false)}>Cancel</button><button disabled={!validColor} onClick={() => onApply(validColor)}>Apply color</button></div>
  </section>;
}
