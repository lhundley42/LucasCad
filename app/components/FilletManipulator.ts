import * as THREE from "three";

export type FilletHandleValue = { radius: number; maxRadius: number; minimumRadius: number; anchor: [number, number, number]; direction: [number, number, number]; disabled?: boolean };

/** Screen-sized handle; a 72px pull traverses the tested radius range. */
export class FilletManipulator {
  readonly group = new THREE.Group();
  private arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xffc54d);
  private hit = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  private value: FilletHandleValue | null = null;
  private direction = new THREE.Vector3();
  private ray = new THREE.Raycaster();
  private drag: { pointerId: number; x: number; y: number; radius: number; max: number; min: number; direction: THREE.Vector2 } | null = null;
  constructor(private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, private element: HTMLCanvasElement, private controls: { enabled: boolean }, private change: (radius: number) => void) {
    this.group.name = "fillet-radius-manipulator";
    this.group.add(this.arrow, this.hit); this.group.visible = false;
    this.arrow.traverse(object => { object.renderOrder = 30; const material = (object as THREE.Mesh).material as THREE.Material | undefined; if (material) { material.depthTest = false; material.depthWrite = false; } });
    element.addEventListener("pointerdown", this.down, true);
    element.addEventListener("pointermove", this.move, true);
    element.addEventListener("pointerup", this.up, true);
    element.addEventListener("pointercancel", this.cancel, true);
    window.addEventListener("keydown", this.key);
  }
  get dragging() { return this.drag !== null; }
  update(value: FilletHandleValue | null) {
    this.value = value;
    this.group.visible = !!value;
    if (!value) { if (this.drag) this.finish(false); return; }
    const origin = new THREE.Vector3(...value.anchor);
    this.direction.set(...value.direction).normalize();
    const view = this.camera.getWorldDirection(new THREE.Vector3());
    // A handle aimed straight at the eye has no useful drag direction.
    if (Math.abs(view.dot(this.direction)) > .92) this.direction.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const bounds = this.element.getBoundingClientRect();
    const unitsPerPixel = this.camera instanceof THREE.OrthographicCamera ? (this.camera.top - this.camera.bottom) / this.camera.zoom / Math.max(bounds.height, 1)
      : 2 * this.camera.position.distanceTo(origin) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.max(bounds.height, 1);
    const length = unitsPerPixel * (48 + 72 * value.radius / Math.max(value.maxRadius, .001));
    this.arrow.position.copy(origin); this.arrow.setDirection(this.direction);
    this.arrow.setLength(length, unitsPerPixel * 14, unitsPerPixel * 9);
    this.hit.position.copy(origin).addScaledVector(this.direction, length * .65);
    this.hit.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.direction);
    this.hit.scale.set(unitsPerPixel * 7, length * .7, unitsPerPixel * 7);
    this.group.updateMatrixWorld(true);
  }
  private hovered(event: PointerEvent) {
    if (!this.value || this.value.disabled) return false;
    const bounds = this.element.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), this.camera);
    return this.ray.intersectObject(this.hit, false).length > 0;
  }
  private down = (event: PointerEvent) => {
    if (event.button !== 0 || !this.hovered(event) || !this.value) return;
    const origin = new THREE.Vector3(...this.value.anchor);
    const start = origin.clone().project(this.camera), end = origin.add(this.direction).project(this.camera);
    const bounds = this.element.getBoundingClientRect();
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, radius: this.value.radius, max: this.value.maxRadius, min: this.value.minimumRadius,
      direction: new THREE.Vector2((end.x - start.x) * bounds.width, -(end.y - start.y) * bounds.height).normalize() };
    this.controls.enabled = false; this.element.setPointerCapture(event.pointerId); this.element.style.cursor = "grabbing";
    event.preventDefault(); event.stopImmediatePropagation();
  };
  private move = (event: PointerEvent) => {
    if (this.drag) {
      const displacement = new THREE.Vector2(event.clientX - this.drag.x, event.clientY - this.drag.y).dot(this.drag.direction);
      const radius = Math.max(this.drag.min, Math.min(this.drag.max, this.drag.radius + displacement / 72 * this.drag.max));
      this.change(radius); if (this.value) this.update({ ...this.value, radius });
      event.preventDefault(); event.stopImmediatePropagation();
    } else if (this.hovered(event)) { this.element.style.cursor = "grab"; event.stopImmediatePropagation(); }
  };
  private finish(commit: boolean) {
    if (!this.drag) return;
    const drag = this.drag; this.drag = null; this.controls.enabled = true;
    if (this.element.hasPointerCapture(drag.pointerId)) this.element.releasePointerCapture(drag.pointerId);
    if (!commit && this.value) this.change(drag.radius);
    this.element.style.cursor = "grab";
  }
  private up = (event: PointerEvent) => { if (this.drag) { this.finish(true); event.stopImmediatePropagation(); } };
  private cancel = (event: PointerEvent) => { if (this.drag) { this.finish(false); event.stopImmediatePropagation(); } };
  private key = (event: KeyboardEvent) => { if (event.key === "Escape" && this.drag) this.finish(false); };
  dispose() {
    this.finish(true);
    this.element.removeEventListener("pointerdown", this.down, true); this.element.removeEventListener("pointermove", this.move, true);
    this.element.removeEventListener("pointerup", this.up, true); this.element.removeEventListener("pointercancel", this.cancel, true); window.removeEventListener("keydown", this.key);
    // Viewport owns/disposes group geometry and materials with its scene.
  }
}
