import React, { useEffect, useMemo, useRef, useState } from 'react';
import {  PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import type { EditOptions, ProjectView } from './client';
import { CachedImage } from './CachedImage';
import { meaningfulGesture, sameBase } from './edit-performance';
import { orderedLayers } from './layer-order';
import { frameMatrix, unprojectFrame } from './frame';
import { DragDelete } from './drag-delete';
import type { TrashBounds, TrashState } from './drag-delete';
import { gesturePhoto, gestureSticker, stickerRect, photoLayout } from './layout';

type Props = { view: ProjectView; options: EditOptions; disabled: boolean; onCommit: (options: EditOptions) => void; onInteracting: (value: boolean) => void; compact?: boolean; compare?: boolean; touchEnabled?: boolean; activeStickerId?: string | null; onSelectSticker?: (id: string | null) => void; trashBounds?: TrashBounds | null; onTrashState?: (state: TrashState) => void; onDropDelete?: (id: string, options: EditOptions) => void; onReorder?: (id: string, direction: 'front' | 'back') => void };
function touchState(event: GestureResponderEvent) {
  const touches = event.nativeEvent.touches;
  const first = touches[0] || event.nativeEvent, second = touches[1];
  const x = second ? (first.pageX + second.pageX) / 2 : first.pageX;
  const y = second ? (first.pageY + second.pageY) / 2 : first.pageY;
  return {
    count: touches.length,
    x, y, localX: x - first.pageX + event.nativeEvent.locationX, localY: y - first.pageY + event.nativeEvent.locationY,
    distance: second ? Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY) : 0,
  };
}

export function GestureCanvas(props: Props) {
  const [width, setWidth] = useState(300), [internalEnabled, setEnabled] = useState(false), [internalCompare, setCompare] = useState(false);
  const enabled = props.touchEnabled ?? internalEnabled, compare = props.compare ?? internalCompare;
  const [live, setLive] = useState<EditOptions | null>(null);
  const current = useRef({ ...props, width, enabled, compare });
  current.current = { ...props, width, enabled, compare };
  const latest = useRef<EditOptions | null>(null);
  const toolbarTouch = useRef(false);
  const deletion = useRef<DragDelete | null>(null);
  const dragTouch = useRef<ReturnType<typeof touchState> | null>(null);
  useEffect(() => {
    const touch = dragTouch.current;
    if (touch && deletion.current) current.current.onTrashState?.(deletion.current.move({ x: touch.x, y: touch.y }, touch.count, props.trashBounds || null));
  }, [props.trashBounds]);
  const base = useRef<{ touch: ReturnType<typeof touchState>; options: EditOptions; anchorX: number; anchorY: number; stickerId: string | null } | null>(null);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !toolbarTouch.current && current.current.enabled && !current.current.disabled && !current.current.compare,
    onMoveShouldSetPanResponder: () => current.current.enabled && !current.current.disabled && !current.current.compare,
    onPanResponderGrant: event => {
      const touch = touchState(event);
      dragTouch.current = touch;
      const g = photoLayout(current.current.view.project, current.current.options), units = g.width / current.current.width;
      const cursor = { x: touch.localX * units, y: touch.localY * units }, settings = current.current.options;
      const primaryPoint = unprojectFrame(cursor, g, settings), b = current.current.view.subjectBounds || { x: 0, y: 0, width: 1, height: 1 };
      let hitId: string | null = null;
      for (const id of orderedLayers(settings).reverse()) {
        if (id === 'primary') {
          if (!settings.hidePrimary && (current.current.view.subject || settings.mode === 'plain')) {
            const r = { x: g.photo.x + b.x * g.photo.width, y: g.photo.y + b.y * g.photo.height, width: b.width * g.photo.width, height: b.height * g.photo.height };
            if (primaryPoint.x >= r.x && primaryPoint.x <= r.x + r.width && primaryPoint.y >= r.y && primaryPoint.y <= r.y + r.height) { hitId = id; break; }
          }
        } else {
          const sticker = current.current.view.stickers?.find(item => item.id === id), transform = settings.stickerTransforms.find(item => item.id === id);
          if (!sticker || !transform) continue;
          const r = stickerRect(sticker, transform, g);
          if (cursor.x >= r.x && cursor.x <= r.x + r.width && cursor.y >= r.y && cursor.y <= r.y + r.height) { hitId = id; break; }
        }
      }
      const hit = hitId && hitId !== 'primary' ? { id: hitId } : null;
      current.current.onSelectSticker?.(hit?.id || null);
      const deleteId = hit?.id || (!current.current.options.hidePrimary && (current.current.view.subject || current.current.options.mode === 'plain') ? 'primary' : null);
      current.current.trashBounds = null;
      deletion.current = new DragDelete(deleteId, { x: touch.x, y: touch.y });
      deletion.current.move({ x: touch.x, y: touch.y }, touch.count, current.current.trashBounds || null);
      latest.current = null;
      base.current = { touch, options: current.current.options, anchorX: touch.localX, anchorY: touch.localY, stickerId: hit?.id || null };

    },
    onPanResponderMove: event => {
      if (!base.current || !event.nativeEvent.touches.length) return;
      const touch = touchState(event), previous = base.current;
      dragTouch.current = touch;
      const trash = deletion.current?.move({ x: touch.x, y: touch.y }, touch.count, current.current.trashBounds || null);
      if (trash) current.current.onTrashState?.(trash);
      if (touch.count !== previous.touch.count) {
        base.current = { touch, options: latest.current || previous.options, anchorX: touch.localX, anchorY: touch.localY, stickerId: previous.stickerId };
        return;
      }
      const gesture = {
        dx: touch.x - previous.touch.x, dy: touch.y - previous.touch.y,
        factor: touch.count > 1 && previous.touch.distance > 0 ? touch.distance / previous.touch.distance : 1,
        anchorX: previous.anchorX, anchorY: previous.anchorY,
      };
      if (!latest.current && !meaningfulGesture(gesture.dx, gesture.dy, gesture.factor)) return;
      if (!latest.current) current.current.onInteracting(true);
      let options: EditOptions;
      if (previous.stickerId) {
        const sticker = current.current.view.stickers?.find(item => item.id === previous.stickerId);
        if (!sticker) return;
        const g = photoLayout(current.current.view.project, previous.options);
        options = { ...previous.options, stickerTransforms: (previous.options.stickerTransforms || []).map(t => t.id === sticker.id ? gestureSticker(t, sticker, g, current.current.width, gesture) : t) };
      } else options = gesturePhoto(previous.options, current.current.view.project, current.current.width, gesture);
      latest.current = options; setLive(options);
    },
    onPanResponderRelease: event => {
      const result = latest.current;
      const dropId = deletion.current?.release({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }, current.current.trashBounds || null);
      deletion.current = null;
      dragTouch.current = null;
      base.current = null; latest.current = null; setLive(null); current.current.onInteracting(false);
      current.current.onTrashState?.({ visible: false, over: false });
      if (dropId && result && current.current.onDropDelete) { current.current.onDropDelete(dropId, result); return; }
      if (result && JSON.stringify(result) !== JSON.stringify(current.current.options)) current.current.onCommit(result);
    },
    onPanResponderTerminate: () => { deletion.current?.cancel(); deletion.current = null; dragTouch.current = null; base.current = null; latest.current = null; setLive(null); current.current.onInteracting(false); current.current.onTrashState?.({ visible: false, over: false }); },
    onPanResponderTerminationRequest: () => false,
  }), []);
  const options = live || props.options, layout = photoLayout(props.view.project, options), scale = width / layout.width;
  const q = layout.screen, photo = layout.photo;
  const fm = frameMatrix(options), matrix = [fm.a, fm.b, 0, 0, fm.c, fm.d, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const localPreview = !!live || JSON.stringify(options) !== JSON.stringify(props.view.options);
  const raster = !!props.view.primaryImage && sameBase(options, props.view.baseOptions || props.view.options);
  const primaryVisible = !options.hidePrimary && (!!props.view.subject || options.mode === 'plain');
  const layerOrder = orderedLayers(options), visibleOrder = layerOrder.filter(id => id !== 'primary' || primaryVisible);
  const activeKey = props.activeStickerId || 'primary', activeIndex = visibleOrder.indexOf(activeKey);
  const box = props.view.subjectBounds || { x: 0, y: 0, width: 1, height: 1 };
  const sourceRect = { x: photo.x + box.x * photo.width, y: photo.y + box.y * photo.height, width: box.width * photo.width, height: box.height * photo.height };
  const project = (x: number, y: number) => ({ x: fm.a * (x - layout.width / 2) + fm.c * (y - layout.height / 2) + layout.width / 2, y: fm.b * (x - layout.width / 2) + fm.d * (y - layout.height / 2) + layout.height / 2 });
  const corners = [project(sourceRect.x, sourceRect.y), project(sourceRect.x + sourceRect.width, sourceRect.y), project(sourceRect.x, sourceRect.y + sourceRect.height), project(sourceRect.x + sourceRect.width, sourceRect.y + sourceRect.height)];
  const rootRect = { x: Math.min(...corners.map(p => p.x)), y: Math.min(...corners.map(p => p.y)), width: Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x)), height: Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y)) };
  const selectedTransform = options.stickerTransforms?.find(item => item.id === props.activeStickerId), selectedSticker = props.view.stickers?.find(item => item.id === props.activeStickerId);
  const selectedRect = selectedTransform && selectedSticker ? stickerRect(selectedSticker, selectedTransform, layout) : !props.activeStickerId && primaryVisible ? rootRect : null;
  const decoration = props.view.decorationImage, dw = layout.width * options.decorationScale, dh = decoration ? dw * decoration.height / decoration.width : 0;
  const ornament = decoration ? <CachedImage pointerEvents="none" data={decoration.data} style={{ position: 'absolute', left: (options.decorationX * layout.width - dw / 2) * scale, top: (options.decorationY * layout.height - dh / 2) * scale, width: dw * scale, height: dh * scale }} /> : null;
  const subject = props.view.subject && !options.hidePrimary ? <CachedImage pointerEvents="none" data={props.view.subject} style={{ position: 'absolute', left: photo.x * scale, top: photo.y * scale, width: photo.width * scale, height: photo.height * scale }} /> : null;
  const planeStyle = [StyleSheet.absoluteFill, { transform: [{ matrix }] }];
  const background = raster && props.view.baseImage ? <CachedImage pointerEvents="none" data={props.view.baseImage} style={StyleSheet.absoluteFill} /> : <View pointerEvents="none" style={planeStyle}>
    {options.mode === 'frame' && <>
      <View style={{ position: 'absolute', left: (q.x - 15 + 28 * (options.depth || 0)) * scale, top: (q.y - 15 + 18 * (options.depth || 0)) * scale, width: (q.width + 30) * scale, height: (q.height + 30) * scale, borderRadius: 46 * scale, backgroundColor: '#253246' }} />
      <View style={{ position: 'absolute', left: (q.x - 15) * scale, top: (q.y - 15) * scale, width: (q.width + 30) * scale, height: (q.height + 30) * scale, borderRadius: 46 * scale, backgroundColor: '#171e2b' }} />
      <View style={{ position: 'absolute', left: q.x * scale, top: q.y * scale, width: q.width * scale, height: q.height * scale, borderRadius: 30 * scale, overflow: 'hidden' }}><CachedImage data={props.view.photoSource || props.view.source} style={{ position: 'absolute', left: (photo.x - q.x) * scale, top: (photo.y - q.y) * scale, width: photo.width * scale, height: photo.height * scale }} /></View>
    </>}
    {options.decorationDepth === 'back' && ornament}
  </View>;
  const primary = raster && props.view.primaryImage ? <CachedImage pointerEvents="none" data={props.view.primaryImage} style={StyleSheet.absoluteFill} /> : <View pointerEvents="none" style={planeStyle}>
    {options.mode === 'plain' ? options.hidePrimary ? null : props.view.subject ? subject : <CachedImage data={props.view.photoSource || props.view.source} style={{ position: 'absolute', left: photo.x * scale, top: photo.y * scale, width: photo.width * scale, height: photo.height * scale }} /> : options.mode === 'sticker' ? subject : <>
      <View style={{ position: 'absolute', left: 0, top: 0, width, height: (q.y + q.height - 40) * scale, overflow: 'hidden' }}>{subject}</View>
      {props.view.subject && !options.hidePrimary && <View style={{ position: 'absolute', left: q.x * scale, top: (q.y + q.height - 40) * scale, width: q.width * scale, height: 40 * scale, overflow: 'hidden' }}><View style={{ position: 'absolute', top: -(q.height - 40) * scale, width: q.width * scale, height: q.height * scale, borderRadius: 30 * scale, overflow: 'hidden' }}><CachedImage data={props.view.subject} style={{ position: 'absolute', left: (photo.x - q.x) * scale, top: (photo.y - q.y) * scale, width: photo.width * scale, height: photo.height * scale }} /></View></View>}
    </>}
    {options.decorationDepth === 'front' && ornament}
  </View>;
  return <View style={props.compact ? { flex: 1 } : undefined}>
    {!props.compact && <View style={styles.toolbar}><Pressable disabled={props.disabled} onPress={() => setEnabled(!enabled)} style={styles.tool}><Text style={styles.label}>터치 조절</Text></Pressable><Pressable disabled={props.disabled} onPressIn={() => setCompare(true)} onPressOut={() => setCompare(false)} style={styles.tool}><Text style={styles.label}>누르고 원본 보기</Text></Pressable></View>}
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} {...responder.panHandlers} style={{ width: '100%', height: layout.height * scale, overflow: 'hidden', backgroundColor: options.background }}>
      {options.mode === 'sticker' && !compare && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#F4F1F7' }]}>{Array.from({ length: 6 * Math.ceil(layout.height / layout.width * 6) }, (_, i) => <View key={i} style={{ width: width / 6, height: width / 6, backgroundColor: (Math.floor(i / 6) + i % 6) % 2 ? '#E0DCE7' : '#F4F1F7' }} />)}</View>}
      {compare ? <CachedImage pointerEvents="none" data={props.view.source} style={StyleSheet.absoluteFill} resizeMode="contain" /> : !props.view.primaryImage && !localPreview ? <CachedImage pointerEvents="none" data={props.view.image} style={StyleSheet.absoluteFill} /> : <>
        {background}
        {layerOrder.map(id => {
          if (id === 'primary') return <View pointerEvents="none" key={id} style={StyleSheet.absoluteFill}>{primary}</View>;
          const t = options.stickerTransforms.find(item => item.id === id), sticker = props.view.stickers?.find(item => item.id === id);
          if (!t || !sticker) return null;
          const r = stickerRect(sticker, t, layout);
          return <CachedImage key={id} pointerEvents="none" data={sticker.data} style={{ position: 'absolute', left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale }} />;
        })}
      </>}
      {selectedRect && !compare && <View pointerEvents="none" style={{ position: 'absolute', left: selectedRect.x * scale, top: selectedRect.y * scale, width: selectedRect.width * scale, height: selectedRect.height * scale, borderWidth: 1.5, borderColor: '#A58ADC', borderStyle: 'dashed' }} />}
      {selectedRect && width >= 96 && visibleOrder.length > 1 && !live && !compare && props.onReorder && <View onStartShouldSetResponder={() => true} onTouchStart={() => { toolbarTouch.current = true; }} onTouchEnd={() => { toolbarTouch.current = false; }} onTouchCancel={() => { toolbarTouch.current = false; }} style={{ position: 'absolute', left: Math.max(5, Math.min(width - 89, selectedRect.x * scale)), top: Math.max(5, Math.min(layout.height * scale - 39, selectedRect.y * scale - 40)), flexDirection: 'row', gap: 3, backgroundColor: '#282131EE', padding: 3, borderRadius: 12 }}>
        {(['back', 'front'] as const).map(direction => <Pressable key={direction} accessibilityRole="button" accessibilityLabel={direction === 'front' ? '레이어 한 단계 앞으로' : '레이어 한 단계 뒤로'} disabled={props.disabled || (direction === 'front' ? activeIndex === visibleOrder.length - 1 : activeIndex === 0)} onPress={() => props.onReorder?.(activeKey, direction)} style={{ width: 36, height: 30, justifyContent: 'center', alignItems: 'center', opacity: props.disabled || (direction === 'front' ? activeIndex === visibleOrder.length - 1 : activeIndex === 0) ? 0.3 : 1 }}><Text style={{ color: '#fff', fontSize: 13 }}>{direction === 'front' ? '↑ 앞' : '↓ 뒤'}</Text></Pressable>)}
      </View>}
    </View>
    {!props.compact && enabled && <Text style={styles.hint}>한 손가락으로 이동 · 두 손가락으로 확대</Text>}
  </View>;
}

const styles = StyleSheet.create({ toolbar: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, padding: 10, backgroundColor: '#F5F1EB' }, tool: { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#fff' }, active: { backgroundColor: '#7260cb' }, label: { fontSize: 11, color: '#6D607F', fontWeight: '600' }, activeLabel: { color: '#fff' }, hint: { textAlign: 'center', color: '#796E86', backgroundColor: '#F5F1EB', padding: 8, fontSize: 11 } });
