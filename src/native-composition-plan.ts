import type { EditOptions } from './client';
import { frameMatrix } from './frame.ts';
import { photoLayout } from './layout.ts';
import type { Dimensions } from './layout';
import { compositionClips, compositionShadowOffset } from './composition-geometry.ts';
export function framePreviewMatrix(source: Dimensions, before: EditOptions, after: EditOptions, unit: number) {
  const g=photoLayout(source,before), next=photoLayout(source,after), m=frameMatrix(after), scale=next.screen.height/g.screen.height;
  const x=next.screen.x+next.screen.width/2-g.width/2-scale*(g.screen.x+g.screen.width/2-g.width/2);
  const y=next.screen.y+next.screen.height/2-g.height/2-scale*(g.screen.y+g.screen.height/2-g.height/2);
  return [m.a*scale,m.b*scale,0,0,m.c*scale,m.d*scale,0,0,0,0,1,0,(m.a*x+m.c*y)*unit,(m.b*x+m.d*y)*unit,0,1];
}
export function nativeCompositionPlan(source: Dimensions, options: EditOptions) {
  const layout = photoLayout(source, options), m = frameMatrix(options), offset = compositionShadowOffset(options.depth);
  return {
    ...layout,
    matrix: [m.a, m.b, 0, 0, m.c, m.d, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    ...compositionClips(layout.screen, layout),
    shadow: { ...layout.photo, x: layout.photo.x + offset.x, y: layout.photo.y + offset.y },
  };
}
