import type { DepthFrame } from './depth-mesh';
import { rotatePoint, rotatedRect, wrapAngle } from './rotation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {  PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import type { EditOptions, ProjectView } from './client';
import { CachedImage } from './CachedImage';
import { NativeCompositionCanvas } from './NativeCompositionCanvas';
import type { NativeCompositionHandle } from './NativeCompositionCanvas';
import { canAutoLiftPhoto, HoldCutout } from './hold-cutout';
import { unprojectFrame } from './frame';
import { meaningfulGesture } from './edit-performance';
import { orderedLayers } from './layer-order';
import { MeasuredCanvasTouch } from './canvas-touch';
import type { CanvasTouch, LocalCanvasTouch } from './canvas-touch';
import { hitLayer } from './hit-testing';
import { DragDelete } from './drag-delete';
import type { TrashBounds, TrashState } from './drag-delete';
import { gesturePhoto, gestureSticker, stickerRect, photoLayout, projectedPhotoRect } from './layout';

type Props = { depthFrame?: DepthFrame | null; onAutoCutout?: (point: { x: number; y: number }) => void; calibration?: number; view: ProjectView; options: EditOptions; disabled: boolean; onCommit: (options: EditOptions) => void; onInteracting: (value: boolean) => void; compact?: boolean; compare?: boolean; touchEnabled?: boolean; activeStickerId?: string | null; onSelectSticker?: (id: string | null) => void; trashBounds?: TrashBounds | null; onTrashState?: (state: TrashState) => void; onDropDelete?: (id: string, options: EditOptions) => void; onReorder?: (id: string, direction: 'front' | 'back') => void };
function touchState(event: GestureResponderEvent) {
  const touches = [...event.nativeEvent.touches].sort((a, b) => Number(a.identifier) - Number(b.identifier));
  const first = touches[0] || event.nativeEvent, second = touches[1];
  const x = second ? (first.pageX + second.pageX) / 2 : first.pageX;
  const y = second ? (first.pageY + second.pageY) / 2 : first.pageY;
  return {
    count: touches.length,
    x, y,
    angle: second ? Math.atan2(second.pageY - first.pageY, second.pageX - first.pageX) * 180 / Math.PI : 0,
    distance: second ? Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY) : 0,
  };
}

export function GestureCanvas(props: Props) {
  const [width, setWidth] = useState(300), [internalEnabled, setEnabled] = useState(false), [internalCompare, setCompare] = useState(false);
  const enabled = props.touchEnabled ?? internalEnabled, compare = props.compare ?? internalCompare;
  const [dragging, setDragging] = useState(false);
  const visual = useRef<NativeCompositionHandle | null>(null);
  const visualFrame = useRef<number | null>(null);
  const current = useRef({ ...props, width, enabled, compare });
  current.current = { ...props, width, enabled, compare };
  const latest = useRef<EditOptions | null>(null);
  const nativeCanvas = useRef<React.ComponentRef<typeof View>>(null);
  const measured = useRef<MeasuredCanvasTouch | null>(null);
  const deletion = useRef<DragDelete | null>(null);
  const dragTouch = useRef<CanvasTouch | null>(null);
  useEffect(() => {
    const touch = dragTouch.current;
    if (touch && deletion.current) current.current.onTrashState?.(deletion.current.move({ x: touch.x, y: touch.y }, touch.count, props.trashBounds || null));
  }, [props.trashBounds]);
  const base = useRef<{ touch: CanvasTouch; options: EditOptions; anchorX: number; anchorY: number; stickerId: string | null } | null>(null);
  const hold = useRef<HoldCutout | null>(null);
  const holdFired = useRef(false);
  useEffect(() => () => { hold.current?.cancel(); if (visualFrame.current !== null) cancelAnimationFrame(visualFrame.current); }, []);
  const begin = (touch: LocalCanvasTouch) => {
    current.current.width = touch.displayWidth;
    hold.current?.cancel(); holdFired.current = false;
    dragTouch.current = touch; latest.current = null;
    const selected = current.current.activeStickerId;
    const selectedVisible = selected === 'primary' ? !current.current.options.hidePrimary && (!!current.current.view.subject || current.current.options.mode !== 'sticker') : current.current.view.stickers?.some(item => item.id === selected);
    const id = hitLayer(current.current.view, current.current.options, { x: touch.localX, y: touch.localY }, touch.displayWidth) || (touch.count > 1 && selectedVisible ? selected || null : null);
    const g = photoLayout(current.current.view.project, current.current.options), unit = g.width / touch.displayWidth;
    const framePoint = unprojectFrame({ x: touch.localX * unit, y: touch.localY * unit }, g, current.current.options);
    const p = rotatePoint(framePoint, { x: g.photo.x + g.photo.width / 2, y: g.photo.y + g.photo.height / 2 }, -(current.current.options.photoRotation || 0));
    const point = { x: (p.x - g.photo.x) / g.photo.width, y: (p.y - g.photo.y) / g.photo.height };
    const inScreen = framePoint.x >= g.screen.x && framePoint.x <= g.screen.x + g.screen.width && framePoint.y >= g.screen.y && framePoint.y <= g.screen.y + g.screen.height;
    const onPhoto = point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 && (id === 'primary' || (!current.current.view.subject && (current.current.options.mode === 'plain' || inScreen)));
    if (touch.count === 1 && onPhoto && canAutoLiftPhoto(!!current.current.view.subject, id) && current.current.onAutoCutout) {
      hold.current = new HoldCutout(() => { holdFired.current = true; base.current = null; deletion.current?.cancel(); deletion.current = null; current.current.onAutoCutout?.(point); });
      hold.current.start();
    }
    current.current.onSelectSticker?.(id);
    current.current.trashBounds = null;
    if (!id) { base.current = null; deletion.current = null; return; }
    deletion.current = new DragDelete(id, { x: touch.x, y: touch.y });
    deletion.current.move({ x: touch.x, y: touch.y }, touch.count, null);
    base.current = { touch, options: current.current.options, anchorX: touch.localX, anchorY: touch.localY, stickerId: id === 'primary' ? null : id };
  };
  const move = (touch: LocalCanvasTouch) => {
    const start = dragTouch.current;
    if (start) hold.current?.move(touch.x - start.x, touch.y - start.y, touch.count);
    if (holdFired.current || !base.current || !touch.count) return;
    const previous = base.current;
      dragTouch.current = touch;
      const trash = deletion.current?.move({ x: touch.x, y: touch.y }, touch.count, current.current.trashBounds || null);
      if (trash) current.current.onTrashState?.(trash);
      if (touch.count !== previous.touch.count) {
        base.current = { touch, options: latest.current || previous.options, anchorX: touch.localX, anchorY: touch.localY, stickerId: previous.stickerId };
        return;
      }
      const vectorInPlane = (angle: number, length: number) => {
        const v = { x: length * Math.cos(angle * Math.PI / 180), y: length * Math.sin(angle * Math.PI / 180) };
        const local = previous.stickerId ? v : unprojectFrame(v, { width: 1, height: 1 }, previous.options, true);
        return { angle: Math.atan2(local.y, local.x) * 180 / Math.PI, distance: Math.hypot(local.x, local.y) };
      };
      const from = vectorInPlane(previous.touch.angle || 0, previous.touch.distance), to = vectorInPlane(touch.angle || 0, touch.distance);
      const gesture = {
        dx: touch.x - previous.touch.x, dy: touch.y - previous.touch.y,
        factor: touch.count > 1 && from.distance > 0 ? to.distance / from.distance : 1,
        rotation: touch.count > 1 ? wrapAngle(to.angle - from.angle) : 0,
        anchorX: previous.anchorX, anchorY: previous.anchorY,
      };
      if (!latest.current && !meaningfulGesture(gesture.dx, gesture.dy, gesture.factor, gesture.rotation)) return;
      hold.current?.cancel();
      if (!latest.current) { current.current.onInteracting(true); setDragging(true); }
      let options: EditOptions;
      if (previous.stickerId) {
        const sticker = current.current.view.stickers?.find(item => item.id === previous.stickerId);
        if (!sticker) return;
        const g = photoLayout(current.current.view.project, previous.options);
        options = { ...previous.options, stickerTransforms: (previous.options.stickerTransforms || []).map(t => t.id === sticker.id ? gestureSticker(t, sticker, g, current.current.width, gesture) : t) };
      } else options = gesturePhoto(previous.options, current.current.view.project, current.current.width, gesture, current.current.view.subject ? current.current.view.subjectBounds || undefined : undefined);
      latest.current = options;
      if (visualFrame.current === null) visualFrame.current = requestAnimationFrame(() => { visualFrame.current = null; if (latest.current) visual.current?.setPose(latest.current); });
  };
  const end = (touch: LocalCanvasTouch) => {
    hold.current?.cancel();
    measured.current = null;
      const result = latest.current;
      if (visualFrame.current !== null) { cancelAnimationFrame(visualFrame.current); visualFrame.current = null; }
      if (result) visual.current?.setPose(result);
      const dropId = deletion.current?.release({ x: touch.x, y: touch.y }, current.current.trashBounds || null);
      deletion.current = null;
      dragTouch.current = null;
      base.current = null; latest.current = null; setDragging(false); current.current.onInteracting(false);
      current.current.onTrashState?.({ visible: false, over: false });
      if (dropId && result && current.current.onDropDelete) { current.current.onDropDelete(dropId, result); return; }
      if (result && JSON.stringify(result) !== JSON.stringify(current.current.options)) current.current.onCommit(result);
  };
  const handlers = useRef({ begin, move, end }); handlers.current = { begin, move, end };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => current.current.enabled && !current.current.disabled && !current.current.compare,
    onMoveShouldSetPanResponder: () => false,
    onPanResponderGrant: event => {
      const session = new MeasuredCanvasTouch(touchState(event), (kind, touch) => {
        if (measured.current !== session) return;
        if (kind === 'start') handlers.current.begin(touch);
        else if (kind === 'move') handlers.current.move(touch);
        else handlers.current.end(touch);
      });
      measured.current = session;
      nativeCanvas.current?.measure((_x, _y, width, height, pageX, pageY) => { if (measured.current !== session) return; if (width > 0 && height > 0) session.locate({ width, height, pageX, pageY }); else { session.cancel(); measured.current = null; } });
    },
    onPanResponderMove: event => measured.current?.move(touchState(event)),
    onPanResponderRelease: event => measured.current?.end(touchState(event)),
    onPanResponderTerminate: () => { hold.current?.cancel(); if (visualFrame.current !== null) { cancelAnimationFrame(visualFrame.current); visualFrame.current = null; } visual.current?.setPose(current.current.options); measured.current?.cancel(); measured.current = null; deletion.current?.cancel(); deletion.current = null; dragTouch.current = null; base.current = null; latest.current = null; setDragging(false); current.current.onInteracting(false); current.current.onTrashState?.({ visible: false, over: false }); },
    onPanResponderTerminationRequest: () => false,
  }), []);
  const options = props.options, layout = photoLayout(props.view.project, options), scale = width / layout.width;
  const primaryVisible = !options.hidePrimary && (!!props.view.subject || options.mode !== 'sticker');
  const layerOrder = orderedLayers(options), visibleOrder = layerOrder.filter(id => id !== 'primary' || primaryVisible);
  const activeKey = props.activeStickerId, activeIndex = activeKey ? visibleOrder.indexOf(activeKey) : -1;
  const box = props.view.subjectBounds || { x: 0, y: 0, width: 1, height: 1 };
  const rootRect = projectedPhotoRect(props.view.project, options, box);
  const selectedTransform = options.stickerTransforms?.find(item => item.id === props.activeStickerId), selectedSticker = props.view.stickers?.find(item => item.id === props.activeStickerId);
  const selectedRect = selectedTransform && selectedSticker ? rotatedRect(stickerRect(selectedSticker, selectedTransform, layout), selectedTransform.rotation || 0) : props.activeStickerId === 'primary' && primaryVisible ? rootRect : null;
  return <View style={props.compact ? { flex: 1 } : undefined}>
    {!props.compact && <View style={styles.toolbar}><Pressable disabled={props.disabled} onPress={() => setEnabled(!enabled)} style={styles.tool}><Text style={styles.label}>터치 조절</Text></Pressable><Pressable disabled={props.disabled} onPressIn={() => setCompare(true)} onPressOut={() => setCompare(false)} style={styles.tool}><Text style={styles.label}>누르고 원본 보기</Text></Pressable></View>}
    <View ref={nativeCanvas} collapsable={false} onLayout={event => setWidth(event.nativeEvent.layout.width)} {...responder.panHandlers} style={{ width: '100%', height: layout.height * scale, overflow: 'hidden', backgroundColor: options.background }}>
      {options.mode === 'sticker' && !compare && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#F4F1F7' }]}>{Array.from({ length: 6 * Math.ceil(layout.height / layout.width * 6) }, (_, i) => <View key={i} style={{ width: width / 6, height: width / 6, backgroundColor: (Math.floor(i / 6) + i % 6) % 2 ? '#E0DCE7' : '#F4F1F7' }} />)}</View>}
      {compare ? <CachedImage pointerEvents="none" data={props.view.source} style={StyleSheet.absoluteFill} resizeMode="contain" /> : <NativeCompositionCanvas depthFrame={props.depthFrame} ref={visual} view={props.view} options={options} width={width} dragging={dragging} calibration={props.calibration} />}
      {selectedRect && !compare && !dragging && <View pointerEvents="none" style={{ position: 'absolute', left: selectedRect.x * scale, top: selectedRect.y * scale, width: selectedRect.width * scale, height: selectedRect.height * scale, zIndex: 100, borderWidth: 1.5, borderColor: '#A58ADC', borderStyle: 'dashed' }} />}
      {selectedRect && width >= 96 && visibleOrder.length > 1 && !dragging && !compare && props.onReorder && <View onStartShouldSetResponder={() => true} style={{ position: 'absolute', left: Math.max(5, Math.min(width - 89, selectedRect.x * scale)), top: Math.max(5, Math.min(layout.height * scale - 39, selectedRect.y * scale - 40)), zIndex: 200, flexDirection: 'row', gap: 3, backgroundColor: '#282131EE', padding: 3, borderRadius: 12 }}>
        {(['back', 'front'] as const).map(direction => <Pressable key={direction} accessibilityRole="button" accessibilityLabel={direction === 'front' ? '레이어 한 단계 앞으로' : '레이어 한 단계 뒤로'} disabled={props.disabled || (direction === 'front' ? activeIndex === visibleOrder.length - 1 : activeIndex === 0)} onPress={() => props.onReorder?.(activeKey!, direction)} style={{ width: 36, height: 30, justifyContent: 'center', alignItems: 'center', opacity: props.disabled || (direction === 'front' ? activeIndex === visibleOrder.length - 1 : activeIndex === 0) ? 0.3 : 1 }}><Text style={{ color: '#fff', fontSize: 13 }}>{direction === 'front' ? '↑ 앞' : '↓ 뒤'}</Text></Pressable>)}
      </View>}
    </View>
    {!props.compact && enabled && <Text style={styles.hint}>한 손가락으로 이동 · 두 손가락으로 확대·회전</Text>}
  </View>;
}

const styles = StyleSheet.create({ toolbar: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, padding: 10, backgroundColor: '#F5F1EB' }, tool: { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#fff' }, active: { backgroundColor: '#7260cb' }, label: { fontSize: 11, color: '#6D607F', fontWeight: '600' }, activeLabel: { color: '#fff' }, hint: { textAlign: 'center', color: '#796E86', backgroundColor: '#F5F1EB', padding: 8, fontSize: 11 } });
