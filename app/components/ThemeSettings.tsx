import { useState } from "react";
import { normalizeTheme, THEME_PRESETS, type ThemeColors, type ThemeSettings as ThemeValue } from "./themes";

const colorLabels: Record<keyof ThemeColors, string> = {
  backgroundTop: "Background top / center", backgroundMiddle: "Background middle", backgroundBottom: "Background bottom / outside",
  model: "Default model", selectedModel: "Selected model", modelEdge: "Model edges", selection: "Selected model edges",
  grid: "Model minor grid", gridMajor: "Model major grid", sketchBackground: "Sketch background", sketchGrid: "Sketch minor grid", sketchGridMajor: "Sketch major grid", sketch: "Sketch geometry", sketchHighlight: "Sketch highlight",
  axisX: "Red sketch axis", axisY: "Green sketch axis", viewText: "Viewport text",
};
export function ThemeSettings({ value, onChange }: { value: ThemeValue; onChange: (value: ThemeValue) => void }) {
  const [expanded, setExpanded] = useState(false);
  return <section className="settings-section theme-settings">
    <button className="theme-submenu-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <span>Themes</span><span>{value.preset === "tron" ? "Tron" : "Old School"} {expanded ? "▾" : "▸"}</span>
    </button>
    {expanded && <div className="theme-submenu">
      <div className="theme-presets" role="group" aria-label="Theme presets">
        {(["tron", "old-school"] as const).map(preset => <button type="button" key={preset} aria-pressed={value.preset === preset} onClick={() => onChange(normalizeTheme(THEME_PRESETS[preset]))}>
          <span className="theme-swatch" style={{ background: `linear-gradient(${THEME_PRESETS[preset].colors.backgroundTop}, ${THEME_PRESETS[preset].colors.backgroundBottom})` }}><i style={{ backgroundColor: THEME_PRESETS[preset].colors.model }}/></span>
          {preset === "tron" ? "Tron" : "Old School"}
        </button>)}
      </div>
      <p>Colors update live without rebuilding geometry. Saved with this model, together with every setting below.</p>
      <label className="theme-color-row"><span>Background style</span><select aria-label="Background style" value={value.backgroundStyle} onChange={e => onChange({ ...value, backgroundStyle: e.target.value as ThemeValue["backgroundStyle"] })}><option value="radial">Radial gradient</option><option value="linear">Vertical gradient</option><option value="solid">Solid</option></select></label>
      <details className="theme-custom-colors"><summary>Customize colors</summary>
        {(Object.keys(colorLabels) as (keyof ThemeColors)[]).map(key => <label className="theme-color-row" key={key}>
          <span>{colorLabels[key]}</span><input type="color" aria-label={colorLabels[key]} value={value.colors[key]} onChange={e => onChange({ ...value, colors: { ...value.colors, [key]: e.target.value } })}/>
        </label>)}
        <button type="button" className="theme-reset" onClick={() => onChange(normalizeTheme(THEME_PRESETS[value.preset]))}>Reset this theme’s colors</button>
      </details>
    </div>}
  </section>;
}
