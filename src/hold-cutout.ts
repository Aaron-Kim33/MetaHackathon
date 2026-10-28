export class HoldCutout {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fire: () => void;
  constructor(fire: () => void) { this.fire = fire; }
  start() { this.cancel(); this.timer = setTimeout(() => { this.timer = null; this.fire(); }, 600); }
  move(dx: number, dy: number, count: number) { if (count !== 1 || Math.hypot(dx, dy) >= 6) this.cancel(); }
  cancel() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
