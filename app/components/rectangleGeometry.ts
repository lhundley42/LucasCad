import type { Point } from "./sketchGeometry";

export type RectangleMode = "corners" | "center";

// Both the live preview and the committed contour use these exact corners.
export function rectangleCorners(first: Point, second: Point, mode: RectangleMode): Point[] {
  const a = mode === "center" ? { x: 2 * first.x - second.x, y: 2 * first.y - second.y } : first;
  return [a, { x: second.x, y: a.y }, second, { x: a.x, y: second.y }];
}
