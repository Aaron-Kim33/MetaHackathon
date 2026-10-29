export type CanvasTouch = { x: number; y: number; count: number; distance: number; angle?: number };
export type LocalCanvasTouch = CanvasTouch & { localX: number; localY: number; displayWidth: number };
export type CanvasBounds = { pageX: number; pageY: number; width: number; height: number };
type PageTouch = { pageX: number; pageY: number; identifier?: string | number };
export function canvasTouchFromEvent(event: PageTouch & { touches: readonly PageTouch[]; changedTouches?: readonly PageTouch[] }): CanvasTouch {
  const touches=[...event.touches].sort((a,b)=>Number(a.identifier)-Number(b.identifier));
  // Android release events can have no active touches and a zero event origin.
  // changedTouches still contains the actual finger location over the bin.
  const first=touches[0] || event.changedTouches?.[0] || event, second=touches[1];
  return {count:touches.length,x:second?(first.pageX+second.pageX)/2:first.pageX,y:second?(first.pageY+second.pageY)/2:first.pageY,angle:second?Math.atan2(second.pageY-first.pageY,second.pageX-first.pageX)*180/Math.PI:0,distance:second?Math.hypot(first.pageX-second.pageX,first.pageY-second.pageY):0};
}
export class MeasuredCanvasTouch {
  private bounds: CanvasBounds | null = null;
  private queue: { kind: 'start' | 'move' | 'end'; point: CanvasTouch }[];
  private ended = false;
  private cancelled = false;
  private emit: (kind: 'start' | 'move' | 'end', point: LocalCanvasTouch) => void;
  constructor(start: CanvasTouch, emit: (kind: 'start' | 'move' | 'end', point: LocalCanvasTouch) => void) { this.queue = [{ kind: 'start', point: start }]; this.emit = emit; }
  locate(bounds: CanvasBounds) {
    if (this.cancelled || ![bounds.pageX, bounds.pageY, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return;
    this.bounds = bounds;
    const events = this.queue; this.queue = [];
    events.forEach(event => this.deliver(event.kind, event.point));
  }
  move(point: CanvasTouch) { if (!this.ended && !this.cancelled) this.push('move', point); }
  end(point: CanvasTouch) { if (!this.ended && !this.cancelled) { this.ended = true; this.push('end', point); } }
  cancel() { this.cancelled = true; this.queue = []; }
  private push(kind: 'start' | 'move' | 'end', point: CanvasTouch) { if (this.bounds) this.deliver(kind, point); else this.queue.push({ kind, point }); }
  private deliver(kind: 'start' | 'move' | 'end', point: CanvasTouch) {
    if (!this.bounds || this.cancelled) return;
    this.emit(kind, { ...point, localX: point.x - this.bounds.pageX, localY: point.y - this.bounds.pageY, displayWidth: this.bounds.width });
  }
}
