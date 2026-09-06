/** Bounded, immutable CAD history. No meshes, selections or camera state. */
export class SnapshotHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private current: T;
  private key: string;
  private observed: T;
  constructor(initial: T, private limit = 100) {
    this.current = structuredClone(initial); this.key = JSON.stringify(initial); this.observed = initial;
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  record(value: T): boolean {
    if (value === this.observed) return false;
    this.observed = value;
    const key = JSON.stringify(value);
    if (key === this.key) return false;
    this.past.push(this.current); if (this.past.length > this.limit) this.past.shift();
    this.current = structuredClone(value); this.key = key; this.future = []; return true;
  }
  reset(value: T) { this.past = []; this.future = []; this.current = structuredClone(value); this.observed = value; this.key = JSON.stringify(value); }
  step(direction: "undo" | "redo"): T | null {
    const from = direction === "undo" ? this.past : this.future;
    const to = direction === "undo" ? this.future : this.past;
    const next = from.pop(); if (next === undefined) return null;
    to.push(this.current); this.current = next; this.key = JSON.stringify(next);
    // Restore a clone so an editor can never mutate a historical entry.
    this.observed = structuredClone(next); return this.observed;
  }
}

export function undoRedoShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  return key === "z" ? event.shiftKey ? "redo" : "undo" : key === "y" ? "redo" : null;
}
