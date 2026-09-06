"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const DEFAULT_WIDTH = 230;
const MIN_WIDTH = 160;
const STORAGE_KEY = "lucascad.featureTreeWidth";

export function ResizableWorkspace({ propertiesCollapsed, children }: { propertiesCollapsed: boolean; children: ReactNode }) {
  const workspace = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [maximum, setMaximum] = useState(600);
  const [resizing, setResizing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const clamp = (value: number) => Math.round(Math.max(MIN_WIDTH, Math.min(maximum, value)));
  const actualWidth = clamp(width);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= 600) setWidth(saved);
    } catch { /* Layout still works when browser storage is unavailable. */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(STORAGE_KEY, String(width)); } catch { /* Optional preference. */ }
  }, [width, loaded]);

  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const measure = () => {
      const properties = element.querySelector<HTMLElement>(".properties-panel");
      const reserved = propertiesCollapsed ? 0 : properties?.getBoundingClientRect().width ?? 0;
      // Keep at least 320px for the canvas on ordinary desktop layouts.
      setMaximum(Math.max(MIN_WIDTH, Math.min(600, element.getBoundingClientRect().width - reserved - 320)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [propertiesCollapsed]);

  useEffect(() => {
    if (!resizing) return;
    const previousCursor = document.body.style.cursor;
    const previousSelection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const stop = () => { drag.current = null; setResizing(false); };
    window.addEventListener("blur", stop);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelection;
      window.removeEventListener("blur", stop);
    };
  }, [resizing]);

  return <section ref={workspace} className={`workspace ${propertiesCollapsed ? "properties-collapsed" : ""} ${resizing ? "tree-resizing" : ""}`} style={{ "--feature-tree-width": `${actualWidth}px` } as CSSProperties}>
    {children}
    <div className="feature-tree-resizer" role="separator" tabIndex={0} aria-label="Resize feature tree" aria-orientation="vertical" aria-controls="feature-tree-panel" aria-valuemin={MIN_WIDTH} aria-valuemax={maximum} aria-valuenow={actualWidth} title="Drag to resize feature tree · Double-click to reset"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width: actualWidth };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        setWidth(clamp(drag.current.width + event.clientX - drag.current.x));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null; setResizing(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        event.stopPropagation();
      }}
      onPointerCancel={() => { drag.current = null; setResizing(false); }}
      onLostPointerCapture={() => { drag.current = null; setResizing(false); }}
      onDoubleClick={() => setWidth(clamp(DEFAULT_WIDTH))}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        const next = event.key === "ArrowLeft" ? actualWidth - step : event.key === "ArrowRight" ? actualWidth + step : event.key === "Home" ? MIN_WIDTH : event.key === "End" ? maximum : event.key === "Enter" ? DEFAULT_WIDTH : null;
        if (next === null) return;
        event.preventDefault(); event.stopPropagation(); setWidth(clamp(next));
      }} />
  </section>;
}
