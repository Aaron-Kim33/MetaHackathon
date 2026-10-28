import React, { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { G, Rect, Circle, Ellipse, Path, Text, ClipPath, LinearGradient, RadialGradient, Stop, Defs } from 'react-native-svg';
import type { EditOptions, ProjectView } from './client';
import type { SceneNode } from './composition-scene';
import { buildCompositionScene } from './composition-scene';
import { nativeSceneChildren } from './native-scene-children';
import { nativeCompositionPlan } from './native-composition-plan';
import { backgroundPhotoRect, stickerRect } from './layout';
import { orderedLayers } from './layer-order';
import { useSpatialMotion } from './use-spatial-motion';
import { spatialOffset } from './spatial-motion';

type RectBox = { x: number; y: number; width: number; height: number };
class ImagePose {
  readonly x: Animated.Value; readonly y: Animated.Value; readonly sx: Animated.Value; readonly sy: Animated.Value;
  private native = false;
  private rect: RectBox;
  constructor(rect: RectBox, readonly width: number, readonly height: number, readonly unit: number) {
    this.rect = rect;
    this.x = new Animated.Value(rect.x * unit); this.y = new Animated.Value(rect.y * unit);
    this.sx = new Animated.Value(rect.width / width); this.sy = new Animated.Value(rect.height / height);
  }
  activate() {
    if (this.native) return; this.native = true;
    const values: [Animated.Value, number][] = [[this.x, this.rect.x * this.unit], [this.y, this.rect.y * this.unit], [this.sx, this.rect.width / this.width], [this.sy, this.rect.height / this.height]];
    for (const [value, toValue] of values) Animated.timing(value, { toValue, duration: 0, useNativeDriver: true }).start();
  }
  update(rect: RectBox) {
    if (rect.x === this.rect.x && rect.y === this.rect.y && rect.width === this.rect.width && rect.height === this.rect.height) return;
    this.rect = rect;
    this.x.setValue(rect.x * this.unit); this.y.setValue(rect.y * this.unit);
    this.sx.setValue(rect.width / this.width); this.sy.setValue(rect.height / this.height);
  }
}
const Texture = memo(function Texture({ source, pose, left = 0, top = 0, dx = 0, dy = 0, opacity = 1 }: { source: { uri: string }; pose: ImagePose; left?: number; top?: number; dx?: number; dy?: number; opacity?: number }) {
  useEffect(() => { pose.activate(); }, [pose]);
  const style = useMemo(() => ({
    position: 'absolute' as const, left: 0, top: 0, width: pose.width * pose.unit, height: pose.height * pose.unit, opacity,
    transformOrigin: [0, 0, 0] as [number, number, number],
    transform: [{ translateX: Animated.add(pose.x, (dx - left) * pose.unit) }, { translateY: Animated.add(pose.y, (dy - top) * pose.unit) }, { scaleX: pose.sx }, { scaleY: pose.sy }],
  }), [pose, left, top, dx, dy, opacity]);
  return <Animated.Image pointerEvents="none" source={source} resizeMode="stretch" resizeMethod="none" fadeDuration={0} renderToHardwareTextureAndroid style={style} />;
});
const svgElements = { g: G, rect: Rect, circle: Circle, ellipse: Ellipse, path: Path, text: Text, clipPath: ClipPath, linearGradient: LinearGradient, radialGradient: RadialGradient, stop: Stop };
const PhoneChrome = memo(function PhoneChrome({ source, options }: { source: { width: number; height: number }; options: EditOptions }) {
  const scene = buildCompositionScene({ source, subject: false, shadow: false, stickers: [] }, options);
  const render = (n: SceneNode): React.ReactNode => {
    if (n.asset || n.type === 'image') return null;
    const Element = svgElements[n.type] as React.ElementType;
    return <Element key={n.key} {...n.attrs}>{nativeSceneChildren(n, render)}</Element>;
  };
  const phone = scene.background.find(n => n.key === 'background-plane')?.children || [];
  return <View pointerEvents="none" renderToHardwareTextureAndroid style={StyleSheet.absoluteFill}><Svg width="100%" height="100%" viewBox={`0 0 ${scene.width} ${scene.height}`} preserveAspectRatio="none"><Defs>{scene.defs.map(render)}</Defs>{phone.map(render)}</Svg></View>;
}, (a, b) => a.source.width === b.source.width && a.source.height === b.source.height && ['mode', 'ratio', 'frameScale', 'frameX', 'frameY', 'tilt', 'depth'].every(key => a.options[key as keyof EditOptions] === b.options[key as keyof EditOptions]));

export type NativeCompositionHandle = { setPose: (options: EditOptions) => void };
export const NativeCompositionCanvas = memo(forwardRef<NativeCompositionHandle, { view: ProjectView; options: EditOptions; width: number; calibration?: number; dragging?: boolean }>(function NativeCompositionCanvas({ view, options, width, calibration = 0, dragging = false }, ref) {
  const plan = nativeCompositionPlan(view.project, options), unit = width / plan.width;
  const poses = useMemo(() => new Map<string, ImagePose>(), [view.project.id, unit]);
  const sources = useRef(new Map<string, { data: string; source: { uri: string } }>());
  const layerIds = new Set((view.stickers || []).map(item => item.id));
  for (const key of sources.current.keys()) if (key.startsWith('sticker:') && !layerIds.has(key.slice(8))) sources.current.delete(key);
  for (const key of poses.keys()) if (!['primary', 'background', 'decoration'].includes(key) && !layerIds.has(key)) poses.delete(key);
  const source = (key: string, data?: string | null) => {
    if (!data) { sources.current.delete(key); return null; }
    let cached = sources.current.get(key);
    if (!cached || cached.data !== data) { cached = { data, source: { uri: `data:image/png;base64,${data}` } }; sources.current.set(key, cached); }
    return cached.source;
  };
  const pose = (id: string, size: { width: number; height: number }, rect: RectBox) => {
    let value = poses.get(id);
    if (!value || value.width !== size.width || value.height !== size.height) { value = new ImagePose(rect, size.width, size.height, unit); poses.set(id, value); }
    return value;
  };
  const photoPose = pose('primary', view.project, plan.photo);
  for (const sticker of view.stickers || []) {
    const t = options.stickerTransforms.find(t => t.id === sticker.id);
    if (t) pose(sticker.id, sticker, stickerRect(sticker, t, plan));
  }
  const update = (next: EditOptions) => {
    const g = nativeCompositionPlan(view.project, next);
    poses.get('primary')?.update(g.photo);
    for (const t of next.stickerTransforms) { const item = view.stickers?.find(s => s.id === t.id); if (item) poses.get(t.id)?.update(stickerRect(item, t, g)); }
    if (view.backgroundPhoto) poses.get('background')?.update(backgroundPhotoRect(view.backgroundPhoto, g, next));
    if (view.decorationImage) {
      const w = Math.round(g.width * next.decorationScale), h = Math.round(w * view.decorationImage.height / view.decorationImage.width);
      poses.get('decoration')?.update({ x: Math.round(next.decorationX * g.width - w / 2), y: Math.round(next.decorationY * g.height - h / 2), width: w, height: h });
    }
  };
  useImperativeHandle(ref, () => ({ setPose: update }));
  useLayoutEffect(() => { if (!dragging) update(options); }, [options, view, unit, dragging]);
  const motion = useSpatialMotion(!!options.spatialEnabled, calibration);
  const offset = (role: 'backdrop' | 'scene' | 'sticker') => {
    const p = spatialOffset(role, motion, options.spatialStrength ?? .7);
    return [{ translateX: p.x * unit }, { translateY: p.y * unit }];
  };
  const plane = { position: 'absolute' as const, left: 0, top: 0, width, height: plan.height * unit, transform: [{ matrix: plan.matrix }] };
  const clip = (rect: RectBox & { radius?: number }, bottom = false) => ({ position: 'absolute' as const, left: rect.x * unit, top: rect.y * unit, width: rect.width * unit, height: rect.height * unit, overflow: 'hidden' as const, ...(bottom ? { borderBottomLeftRadius: (rect.radius || 0) * unit, borderBottomRightRadius: (rect.radius || 0) * unit } : { borderRadius: (rect.radius || 0) * unit }) });
  const raw = source('source', view.photoSource || view.source), subject = source('subject', view.subject), shadow = source('shadow', view.subjectShadow);
  const decoration = source('decoration', view.decorationImage?.data);
  let ornament: React.ReactNode = null;
  if (decoration && view.decorationImage) {
    const w = Math.round(plan.width * options.decorationScale), h = Math.round(w * view.decorationImage.height / view.decorationImage.width);
    const r = { x: Math.round(options.decorationX * plan.width - w / 2), y: Math.round(options.decorationY * plan.height - h / 2), width: w, height: h };
    const p = pose('decoration', view.decorationImage, r);
    ornament = <Texture source={decoration} pose={p} />;
  }
  const foreground = () => {
    if (options.hidePrimary) return null;
    if (!subject) return options.mode === 'plain' && raw ? <Texture source={raw} pose={photoPose} /> : null;
    if (options.mode !== 'frame') return <Texture source={subject} pose={photoPose} />;
    return <>
      {shadow && options.shadow > 0 && <View style={clip(plan.screenClip)}><Texture source={shadow} pose={photoPose} left={plan.screenClip.x} top={plan.screenClip.y} dx={plan.shadow.x - plan.photo.x} dy={plan.shadow.y - plan.photo.y} opacity={options.shadow} /></View>}
      <View style={clip(plan.escapeTop)}><Texture source={subject} pose={photoPose} /></View>
      <View style={clip(plan.escapeBottom, true)}><Texture source={subject} pose={photoPose} left={plan.escapeBottom.x} top={plan.escapeBottom.y} /></View>
    </>;
  };
  const backdrop = source('background', view.backgroundPhoto?.data);
  let background: React.ReactNode = null;
  if (backdrop && view.backgroundPhoto && options.mode !== 'sticker') {
    const r = backgroundPhotoRect(view.backgroundPhoto, plan, options), p = pose('background', view.backgroundPhoto, r);
    background = <View style={[StyleSheet.absoluteFill, { transform: [...offset('backdrop'), { scale: options.spatialEnabled ? 1.06 : 1 }] }]}><Texture source={backdrop} pose={p} /></View>;
  }
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {options.mode !== 'sticker' && <View style={[StyleSheet.absoluteFill, { backgroundColor: options.background }]} />}
    {background}{background && options.backgroundDim > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: options.backgroundDim }]} />}
    <View style={[StyleSheet.absoluteFill, { transform: offset('scene') }]}><View style={plane}>
      {options.mode === 'frame' && <><PhoneChrome source={view.project} options={options} />{raw && !options.hidePrimary && <View style={clip(plan.screenClip)}><Texture source={raw} pose={photoPose} left={plan.screenClip.x} top={plan.screenClip.y} /></View>}</>}
      {options.decorationDepth === 'back' && ornament}
    </View></View>
    {orderedLayers(options).map(id => {
      if (id === 'primary') return <View key={id} style={[StyleSheet.absoluteFill, { transform: offset('scene') }]}><View style={plane}>{foreground()}{options.decorationDepth === 'front' && ornament}</View></View>;
      const item = view.stickers?.find(s => s.id === id), pixels = item && source(`sticker:${id}`, item.data), p = poses.get(id);
      return pixels && p ? <View key={id} style={[StyleSheet.absoluteFill, { transform: offset('sticker') }]}><Texture source={pixels} pose={p} /></View> : null;
    })}
  </View>;
}));
