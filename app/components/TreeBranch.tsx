"use client";

import { useId, useState, type ReactNode } from "react";

/** Disclosure state is UI-only: never changes feature visibility or rebuilds CAD. */
export function TreeBranch({ label, icon, count, root = false, children }: {
  label: string; icon: ReactNode; count?: number; root?: boolean; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  return <div className="tree-branch">
    <button type="button" className={`tree-row tree-folder-toggle ${root ? "root" : "child"}`}
      aria-label={label} aria-expanded={expanded} aria-controls={contentId}
      title={`${expanded ? "Collapse" : "Expand"} ${label}`}
      onClick={() => setExpanded(value => !value)}
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); event.stopPropagation(); setExpanded(event.key === "ArrowRight");
        }
      }}>
      <span className={`twisty ${expanded ? "expanded" : ""}`} aria-hidden="true">▸</span>
      <span className="tree-folder-icon" aria-hidden="true">{icon}</span>
      <span className="tree-folder-label">{label}</span>
      {count !== undefined && <small className="tree-support">{count}</small>}
    </button>
    <div id={contentId} className="tree-branch-children" hidden={!expanded}>{children}</div>
  </div>;
}
