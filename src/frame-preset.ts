export const PHOTO_FRAME_PRESET = { zoom: 1.2, x: 0.18, y: -0.17, tilt: -6, depth: 0.2, shadow: 0.2, frameScale: 1.32, frameX: -0.12, frameY: -0.02 };
export function legacyDefaultFrame(value: { mode?: string; zoom?: number; x?: number; y?: number; frameScale?: number }) {
  return value.mode === 'frame' && value.frameScale === undefined && value.zoom === 1.55 && value.x === 0 && value.y === -0.15;
}
