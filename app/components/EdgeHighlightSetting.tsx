"use client";

export function EdgeHighlightSetting({ value, onChange }: { value: number; onChange: (width: number) => void }) {
  return <section className="settings-section">
    <label htmlFor="selected-edge-width"><span>Selected edge thickness</span><output>{value.toFixed(1)} px</output></label>
    <input id="selected-edge-width" aria-label="Selected edge thickness" type="range" min="1" max="10" step="0.5" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    <div aria-hidden="true" style={{ height: 16, display: "flex", alignItems: "center" }}><span style={{ width: "100%", height: value, borderRadius: 8, background: "#ff9700" }} /></div>
    <p>Orange highlights on selected solid edges. Updates immediately and stays the same screen width as you zoom.</p>
  </section>;
}
