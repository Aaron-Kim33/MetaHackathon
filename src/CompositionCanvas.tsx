import React, { memo, useRef } from 'react';
import Svg, { G, Rect, Circle, Ellipse, Image, ClipPath, LinearGradient, RadialGradient, Stop, Defs } from 'react-native-svg';
import type { EditOptions, ProjectView } from './client';
import { buildCompositionScene } from './composition-scene';
import type { SceneNode } from './composition-scene';
const elements = { g: G, rect: Rect, circle: Circle, ellipse: Ellipse, image: Image, clipPath: ClipPath, linearGradient: LinearGradient, radialGradient: RadialGradient, stop: Stop };
export const CompositionCanvas = memo(function CompositionCanvas({ view, options }: { view: ProjectView; options: EditOptions }) {
  const cache = useRef(new Map<string, { data: string; href: { uri: string } }>());
  const data: Record<string, string | null | undefined> = { source: view.photoSource || view.source, subject: view.subject, shadow: view.subjectShadow, decoration: view.decorationImage?.data };
  for (const sticker of view.stickers || []) data[`sticker:${sticker.id}`] = sticker.data;
  for (const key of cache.current.keys()) if (!data[key]) cache.current.delete(key);
  const scene = buildCompositionScene({ source: view.project, subject: !!view.subject, shadow: !!view.subjectShadow, decoration: view.decorationImage, stickers: view.stickers || [] }, options);
  const render = (n: SceneNode): React.ReactNode => {
    let href: { uri: string } | undefined;
    if (n.asset) {
      const pixels = data[n.asset]; if (!pixels) return null;
      let item = cache.current.get(n.asset);
      if (!item || item.data !== pixels) { item = { data: pixels, href: { uri: `data:image/png;base64,${pixels}` } }; cache.current.set(n.asset, item); }
      href = item.href;
    }
    const Element = elements[n.type] as React.ElementType;
    return <Element key={n.key} {...n.attrs} {...(href ? { href } : {})}>{n.children?.map(render)}</Element>;
  };
  return <Svg pointerEvents="none" width="100%" height="100%" viewBox={`0 0 ${scene.width} ${scene.height}`} preserveAspectRatio="none"><Defs>{scene.defs.map(render)}</Defs>{scene.background.map(render)}{scene.layers.map(render)}</Svg>;
});
