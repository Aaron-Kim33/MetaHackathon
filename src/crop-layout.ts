import { containedImage } from './layout.ts';
import type { Dimensions } from './layout';
// The native flex slot already excludes the header, tools, and pinned actions.
export function cropImageLayout(source: Dimensions, slot: Dimensions) {
  if (slot.width <= 0 || slot.height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  return containedImage(source, slot.width, slot.height);
}
