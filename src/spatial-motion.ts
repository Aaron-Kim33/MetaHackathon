export type MotionPoint = { x: number; y: number };
type Rotation = { beta: number; gamma: number };
export class MotionCalibration {
  private origin: Rotation | null = null;
  private latest: Rotation | null = null;
  private point: MotionPoint = { x: 0, y: 0 };
  sample(rotation: Rotation): MotionPoint {
    if (![rotation.beta, rotation.gamma].every(Number.isFinite)) return this.point;
    this.latest = { beta: rotation.beta, gamma: rotation.gamma };
    this.origin ||= this.latest;
    return this.point = relativeMotion(this.latest, this.origin, this.point);
  }
  recenter(): MotionPoint {
    this.origin = this.latest;
    return this.point = { x: 0, y: 0 };
  }
}
const clamp = (n: number) => Math.max(-1, Math.min(1, n));
export function relativeMotion(rotation: { beta: number; gamma: number }, origin: { beta: number; gamma: number }, previous: MotionPoint): MotionPoint {
  if (![rotation.beta, rotation.gamma, origin.beta, origin.gamma].every(Number.isFinite)) return previous;
  const wrap = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));
  const x = clamp(wrap(rotation.gamma - origin.gamma) / 0.35), y = clamp(wrap(rotation.beta - origin.beta) / 0.35);
  return { x: previous.x + (x - previous.x) * 0.18, y: previous.y + (y - previous.y) * 0.18 };
}
export function spatialOffset(role: 'backdrop' | 'scene' | 'sticker', motion: MotionPoint, strength: number) {
  const depth = role === 'backdrop' ? -12 : role === 'scene' ? 12 : 25;
  return { x: motion.x * depth * strength, y: motion.y * depth * strength };
}
