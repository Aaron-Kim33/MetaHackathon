import type { EditOptions } from './client';
import { frameMatrix } from './frame.ts';
import { photoLayout } from './layout.ts';
import type { Dimensions } from './layout';
import { compositionClips, compositionShadowOffset } from './composition-geometry.ts';
export function nativeCompositionPlan(source: Dimensions, options: EditOptions) {
  const layout = photoLayout(source, options), m = frameMatrix(options), offset = compositionShadowOffset(options.depth);
  return {
    ...layout,
    matrix: [m.a, m.b, 0, 0, m.c, m.d, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    ...compositionClips(layout.screen, layout),
    shadow: { ...layout.photo, x: layout.photo.x + offset.x, y: layout.photo.y + offset.y },
  };
}
