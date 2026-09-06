import type { DocumentRequest } from "./CadViewport";

// Display metadata must never invalidate solid geometry.
export function geometryDocumentKey(document: DocumentRequest): string {
  return JSON.stringify(document, (key, value) => ["name", "bodyName", "bodyColor", "visible", "bodyVisible", "dimensionOffsets", "hiddenDimensionKeys", "sourceLabel"].includes(key) ? undefined : value);
}

/** One running calculation and only the newest pending input. Stale results
 * never replace a newer selection/preview; identical input does no work. */
export class LatestViewportRequest<T> {
  private desired = "";
  private pending: string | null = null;
  private running = false;
  private disposed = false;
  constructor(private run: (key: string) => Promise<T>, private apply: (value: T, key: string) => void, private fail: (error: unknown) => void) {}
  request(key: string) {
    if (this.disposed || key === this.desired) return;
    this.desired = key; this.pending = key;
    void this.drain();
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending !== null && !this.disposed) {
        const key = this.pending; this.pending = null;
        try {
          const result = await this.run(key);
          if (!this.disposed && key === this.desired) this.apply(result, key);
        } catch (error) { if (!this.disposed && key === this.desired) this.fail(error); }
      }
    } finally { this.running = false; }
  }
  invalidate() { this.desired = ""; this.pending = null; }
  dispose() { this.disposed = true; this.pending = null; }
}
