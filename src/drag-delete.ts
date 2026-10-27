export type DropPoint = { x: number; y: number };
export type TrashBounds = { pageX: number; pageY: number; width: number; height: number };
export type TrashState = { visible: boolean; over: boolean };
export function insideTrash(point: DropPoint, bounds: TrashBounds | null) {
  if (!bounds || ![point.x, point.y, bounds.pageX, bounds.pageY, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return false;
  return Math.hypot(point.x - bounds.pageX - bounds.width / 2, point.y - bounds.pageY - bounds.height / 2) <= Math.min(bounds.width, bounds.height) / 2;
}
export class DragDelete {
  private moved = false;
  private pinched = false;
  private finished = false;
  readonly id: string | null;
  private start: DropPoint;
  constructor(id: string | null, start: DropPoint) { this.id = id; this.start = start; }
  move(point: DropPoint, count: number, bounds: TrashBounds | null): TrashState {
    if (this.finished || !this.id) return { visible: false, over: false };
    if (count > 1) this.pinched = true;
    if (Math.hypot(point.x - this.start.x, point.y - this.start.y) >= 6) this.moved = true;
    const visible = this.moved && !this.pinched && count === 1;
    return { visible, over: visible && insideTrash(point, bounds) };
  }
  release(point: DropPoint, bounds: TrashBounds | null): string | null {
    if (this.finished) return null;
    this.finished = true;
    return this.id && this.moved && !this.pinched && insideTrash(point, bounds) ? this.id : null;
  }
  cancel() { this.finished = true; }
}
