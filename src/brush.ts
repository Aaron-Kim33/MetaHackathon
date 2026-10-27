import { pageImagePoint } from './layout.ts';
import type { BrushPoint, BrushStroke, Dimensions, PageBounds } from './layout.ts';

// Queue page coordinates until native measurement completes, including very short taps.
export class MeasuredBrush {
  mode: BrushStroke['mode'];
  radius: number;
  source: Dimensions;
  maxPoints: number;
  ended = false;
  private bounds: PageBounds | null = null;
  private pending: BrushPoint[] = [];
  private points: BrushPoint[] = [];

  constructor(mode: BrushStroke['mode'], radius: number, source: Dimensions, maxPoints = 2000) {
    this.mode = mode; this.radius = radius; this.source = source; this.maxPoints = maxPoints;
  }
  push(pageX: number, pageY: number): boolean {
    if (this.ended || !Number.isFinite(pageX) || !Number.isFinite(pageY)) return false;
    if (!this.bounds) {
      if (this.pending.length < this.maxPoints) this.pending.push({ x: pageX, y: pageY });
      return false;
    }
    return this.append(pageX, pageY);
  }
  locate(bounds: PageBounds): boolean {
    if (![bounds.pageX, bounds.pageY, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return false;
    this.bounds = bounds;
    let changed = false;
    for (const page of this.pending) changed = this.append(page.x, page.y) || changed;
    this.pending = [];
    return changed;
  }
  private append(pageX: number, pageY: number): boolean {
    if (!this.bounds || this.points.length >= this.maxPoints) return false;
    const point = pageImagePoint(pageX, pageY, this.bounds, this.source);
    if (!point) return false;
    const previous = this.points.at(-1);
    if (previous && Math.hypot((point.x - previous.x) * this.source.width, (point.y - previous.y) * this.source.height) < this.radius * Math.min(this.source.width, this.source.height) * 0.35) return false;
    this.points.push(point);
    return true;
  }
  end() { this.ended = true; }
  snapshot(): BrushStroke { return { mode: this.mode, radius: this.radius, points: [...this.points] }; }
}
