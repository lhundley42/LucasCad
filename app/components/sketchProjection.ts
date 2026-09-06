import { OrthographicCamera, Quaternion, Vector3 } from "three";

type Point = { x: number; y: number };
export type PlaneProjection = [number, number, number, number, number, number];
export type ProjectionFrame = { origin: Vector3; xDir: Vector3; yDir: Vector3; normal: Vector3 };
export const IDENTITY_PROJECTION: PlaneProjection = [1, 0, 0, 1, 0, 0];

// Orthographic projection is affine: the same mapping drives SVG rendering,
// pointer inversion and screen-facing annotations. CAD coordinates never change.
export function sketchPlaneProjection(camera: OrthographicCamera, target: Vector3, frame: ProjectionFrame) {
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const offset = target.clone().sub(frame.origin);
  const center = { x: offset.dot(frame.xDir), y: offset.dot(frame.yDir) };
  const projection: PlaneProjection = [frame.xDir.dot(right), -frame.xDir.dot(up), frame.yDir.dot(right), -frame.yDir.dot(up), center.x - offset.dot(right), center.y + offset.dot(up)];
  return { center, zoom: camera.zoom, projection };
}

export function projectSketchPoint(p: Point, m: PlaneProjection = IDENTITY_PROJECTION): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
export function projectionDeterminant(m: PlaneProjection): number { return m[0] * m[3] - m[1] * m[2]; }
export function unprojectSketchPoint(p: Point, m: PlaneProjection = IDENTITY_PROJECTION): Point | null {
  const det = projectionDeterminant(m);
  // An exactly edge-on plane has no unique mouse/plane intersection.
  if (Math.abs(det) < 1e-6) return null;
  const x = p.x - m[4], y = p.y - m[5];
  return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det };
}
export function sketchBillboard(point: Point, scale: number, m: PlaneProjection = IDENTITY_PROJECTION): string {
  const det = projectionDeterminant(m);
  if (Math.abs(det) < 1e-6) return `translate(${point.x} ${point.y}) scale(${scale})`;
  return `matrix(${m[3] * scale / det} ${-m[1] * scale / det} ${-m[2] * scale / det} ${m[0] * scale / det} ${point.x} ${point.y})`;
}

// Minimal rotation to the nearest normal hemisphere; preserve screen roll,
// zoom and the point on the plane under the center of the viewport.
export function snapToNearestSketchNormal(camera: OrthographicCamera, target: Vector3, frame: ProjectionFrame) {
  const direction = camera.getWorldDirection(new Vector3());
  const facing = direction.dot(frame.normal);
  const nearest = frame.normal.clone().multiplyScalar(facing >= 0 ? 1 : -1);
  const distance = Math.max(1, camera.position.distanceTo(target));
  const height = target.clone().sub(frame.origin).dot(frame.normal);
  if (Math.abs(facing) > 1e-4) target.addScaledVector(direction, -height / facing);
  else target.addScaledVector(frame.normal, -height);
  const rotation = new Quaternion().setFromUnitVectors(direction, nearest);
  camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(rotation).normalize();
  camera.position.copy(target).addScaledVector(nearest, -distance);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}
