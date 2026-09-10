"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RectangleMode } from "./rectangleGeometry";

export function RectangleToolMenu({ active, mode, onChoose }: {
  active: boolean; mode: RectangleMode; onChoose: (mode: RectangleMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)), top: rect.bottom + 5 });
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className={`sketch-tool-button rectangle-tool-trigger ${active ? "active" : ""}`}
      title="Rectangle: choose creation mode" aria-label="Rectangle creation modes" aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}>
      <span className="sketch-tool-icon">{mode === "center" ? "⊞" : "▭"}</span><span className="rectangle-menu-chevron" aria-hidden="true">▾</span><span className="sketch-tool-label">Rect</span>
    </button>
    {open && createPortal(<div ref={menu} className="rectangle-mode-menu" role="menu" aria-label="Rectangle creation modes" style={position}
      onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>("button"));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}>
      {([['corners', 'Point to point', 'Click two opposite corners', '▭'], ['center', 'Centered rectangle', 'Click center, then an outer corner', '⊞']] as const).map(([value, label, hint, icon]) =>
        <button key={value} type="button" role="menuitemradio" aria-checked={mode === value} onClick={() => { onChoose(value); setOpen(false); trigger.current?.focus(); }}>
          <span aria-hidden="true">{icon}</span><span>{label}<small>{hint}</small></span><span aria-hidden="true">{mode === value ? "✓" : ""}</span>
        </button>)}
    </div>, document.body)}
  </>;
}
