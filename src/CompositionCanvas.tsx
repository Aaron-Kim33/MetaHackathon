import React, { memo, useMemo, useRef } from 'react';
import Svg, { Text, Path, G, Rect, Circle, Ellipse, Image, ClipPath, LinearGradient, RadialGradient, Stop, Defs } from 'react-native-svg';
import type { EditOptions, ProjectView } from './client';
import { buildCompositionScene } from './composition-scene';
import { useSpatialMotion } from './use-spatial-motion';
import { spatialOffset } from './spatial-motion';
import type { SceneNode } from './composition-scene';
const elements = { text: Text, path: Path, g: G, rect: Rect, circle: Circle, ellipse: Ellipse, image: Image, clipPath: ClipPath, linearGradient: LinearGradient, radialGradient: RadialGradient, stop: Stop };
export const CompositionCanvas = memo(function CompositionCanvas({ view, options, calibration = 0 }: { view: ProjectView; options: EditOptions; calibration?: number }) {
  const cache = useRef(new Map<string, { data: string; href: { uri: string } }>());
  const data: Record<string, string | null | undefined> = { background: view.backgroundPhoto?.data, source: view.photoSource || view.source, subject: view.subject, shadow: view.subjectShadow, decoration: view.decorationImage?.data };
  for (const sticker of view.stickers || []) data[`sticker:${sticker.id}`] = sticker.data;
  for (const key of cache.current.keys()) if (!data[key]) cache.current.delete(key);
  const scene = useMemo(() => buildCompositionScene({ source: view.project, subject: !!view.subject, shadow: !!view.subjectShadow, decoration: view.decorationImage, backdrop: view.backgroundPhoto, stickers: view.stickers || [] }, options), [view, options]);
  const motion = useSpatialMotion(!!options.spatialEnabled, calibration);
  const render = (n: SceneNode): React.ReactNode => {
    let href: { uri: string } | undefined;
    if (n.asset) {
      const pixels = data[n.asset]; if (!pixels) return null;
      let item = cache.current.get(n.asset);
      if (!item || item.data !== pixels) { item = { data: pixels, href: { uri: `data:image/png;base64,${pixels}` } }; cache.current.set(n.asset, item); }
      href = item.href;
    }
    const Element = elements[n.type] as React.ElementType;
    return <Element key={n.key} {...n.attrs} {...(href ? { href } : {})}>{n.text}{n.children?.map(render)}</Element>;
  };
  const rendered = useMemo(() => ({ defs: scene.defs.map(render), background: scene.background.map(n => ({ key: n.key, child: render(n) })), layers: scene.layers.map(n => ({ key: n.key, child: render(n) })) }), [scene, view]);
  const offset = (role: 'backdrop' | 'scene' | 'sticker') => { const p = spatialOffset(role, motion, options.spatialStrength ?? 0.7); return 'translate(' + p.x + ' ' + p.y + ')'; };
  return <Svg pointerEvents="none" width="100%" height="100%" viewBox={`0 0 ${scene.width} ${scene.height}`} preserveAspectRatio="none"><Defs>{rendered.defs}</Defs>{rendered.background.map(n => <G key={n.key} transform={options.spatialEnabled && n.key === 'background-photo' ? offset('backdrop') + ' translate(' + (-scene.width * 0.03) + ' ' + (-scene.height * 0.03) + ') scale(1.06)' : n.key === 'background-plane' ? offset('scene') : undefined}>{n.child}</G>)}{rendered.layers.map(n => <G key={n.key} transform={offset(n.key === 'primary-plane' ? 'scene' : 'sticker')}>{n.child}</G>)}</Svg>;
});
