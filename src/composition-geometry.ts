import type { Dimensions } from './layout';
export type SceneRect = Dimensions & { x: number; y: number };
export function compositionClips(screen: SceneRect, canvas: Dimensions) {
  const floor = screen.y + screen.height - 24;
  return {
    screenClip: { ...screen, radius: 6 },
    escapeTop: { x: 0, y: 0, width: canvas.width, height: Math.max(0, floor) },
    escapeBottom: { x: screen.x, y: floor, width: screen.width, height: 24, radius: 6 },
  };
}
export function compositionShadowOffset(depth: number) { return { x: Math.round(4 + depth * 8), y: Math.round(6 + depth * 12) }; }
