import React, { useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import type { EditOptions, ProjectView } from './client';
import { gesturePhoto, photoLayout } from './layout';

type Props = { view: ProjectView; options: EditOptions; disabled: boolean; onCommit: (options: EditOptions) => void; onInteracting: (value: boolean) => void };
const uri = (data: string) => ({ uri: `data:image/png;base64,${data}` });
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
  const [width, setWidth] = useState(300), [enabled, setEnabled] = useState(false), [compare, setCompare] = useState(false);
  const [live, setLive] = useState<EditOptions | null>(null);
  const current = useRef({ ...props, width, enabled, compare });
  current.current = { ...props, width, enabled, compare };
  const latest = useRef<EditOptions | null>(null);
  const base = useRef<{ touch: ReturnType<typeof touchState>; options: EditOptions; anchorX: number; anchorY: number } | null>(null);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => current.current.enabled && !current.current.disabled && !current.current.compare,
    onMoveShouldSetPanResponder: () => current.current.enabled && !current.current.disabled && !current.current.compare,
    onPanResponderGrant: event => {
      const touch = touchState(event);
      latest.current = current.current.options;
      base.current = { touch, options: current.current.options, anchorX: touch.localX, anchorY: touch.localY };
      current.current.onInteracting(true);
    },
    onPanResponderMove: event => {
      if (!base.current || !event.nativeEvent.touches.length) return;
      const touch = touchState(event), previous = base.current;
      if (touch.count !== previous.touch.count) {
        base.current = { touch, options: latest.current || previous.options, anchorX: touch.localX, anchorY: touch.localY };
        return;
      }
      const options = gesturePhoto(previous.options, current.current.view.project, current.current.width, {
        dx: touch.x - previous.touch.x, dy: touch.y - previous.touch.y,
        factor: touch.count > 1 && previous.touch.distance > 0 ? touch.distance / previous.touch.distance : 1,
        anchorX: previous.anchorX, anchorY: previous.anchorY,
      });
      latest.current = options; setLive(options);
    },
    onPanResponderRelease: () => {
      const result = latest.current;
      base.current = null; latest.current = null; setLive(null); current.current.onInteracting(false);
      if (result && JSON.stringify(result) !== JSON.stringify(current.current.options)) current.current.onCommit(result);
    },
    onPanResponderTerminate: () => { base.current = null; latest.current = null; setLive(null); current.current.onInteracting(false); },
    onPanResponderTerminationRequest: () => false,
  }), []);
  const options = live || props.options, layout = photoLayout(props.view.project, options), scale = width / layout.width;
  const q = layout.screen, photo = layout.photo;
  const dirty = JSON.stringify(options) !== JSON.stringify(props.view.options);
  const localPreview = !!live || dirty;
  const decoration = props.view.decorationImage;
  const decorationWidth = layout.width * options.decorationScale;
  const decorationHeight = decoration ? decorationWidth * decoration.height / decoration.width : 0;
  const ornament = decoration ? <Image pointerEvents="none" source={uri(decoration.data)} style={{ position: 'absolute', left: (options.decorationX * layout.width - decorationWidth / 2) * scale, top: (options.decorationY * layout.height - decorationHeight / 2) * scale, width: decorationWidth * scale, height: decorationHeight * scale }} /> : null;
  const subject = props.view.subject ? <Image pointerEvents="none" source={uri(props.view.subject)} style={{ position: 'absolute', left: photo.x * scale, top: photo.y * scale, width: photo.width * scale, height: photo.height * scale }} /> : null;
  return <View>
    <View style={styles.toolbar}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: enabled }} disabled={props.disabled} onPress={() => setEnabled(!enabled)} style={[styles.tool, enabled && styles.active]}><Text style={[styles.label, enabled && styles.activeLabel]}>{enabled ? '터치 조절 켜짐' : '터치로 조절'}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="누르고 있는 동안 원본 보기" disabled={props.disabled} onPressIn={() => setCompare(true)} onPressOut={() => setCompare(false)} style={styles.tool}><Text style={styles.label}>누르고 원본 보기</Text></Pressable>
    </View>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} {...responder.panHandlers} style={{ width: '100%', height: layout.height * scale, overflow: 'hidden', backgroundColor: options.background }}>
      {compare ? <Image pointerEvents="none" source={uri(props.view.source)} resizeMode="contain" style={StyleSheet.absoluteFill} /> : !localPreview ? <Image pointerEvents="none" source={uri(props.view.image)} style={StyleSheet.absoluteFill} resizeMode="contain" /> : <>
        <View pointerEvents="none" style={{ position: 'absolute', left: (q.x - 15) * scale, top: (q.y - 15) * scale, width: (q.width + 30) * scale, height: (q.height + 30) * scale, borderRadius: 46 * scale, backgroundColor: '#171e2b' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: q.x * scale, top: q.y * scale, width: q.width * scale, height: q.height * scale, borderRadius: 30 * scale, overflow: 'hidden' }}><Image source={uri(props.view.source)} style={{ position: 'absolute', left: (photo.x - q.x) * scale, top: (photo.y - q.y) * scale, width: photo.width * scale, height: photo.height * scale }} /></View>
        {options.decorationDepth === 'back' && ornament}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height: (q.y + q.height - 40) * scale, overflow: 'hidden' }}>{subject}</View>
        {props.view.subject && <View pointerEvents="none" style={{ position: 'absolute', left: q.x * scale, top: (q.y + q.height - 40) * scale, width: q.width * scale, height: 40 * scale, overflow: 'hidden' }}><View style={{ position: 'absolute', top: -(q.height - 40) * scale, width: q.width * scale, height: q.height * scale, borderRadius: 30 * scale, overflow: 'hidden' }}><Image source={uri(props.view.subject)} style={{ position: 'absolute', left: (photo.x - q.x) * scale, top: (photo.y - q.y) * scale, width: photo.width * scale, height: photo.height * scale }} /></View></View>}
        {options.decorationDepth === 'front' && ornament}
      </>}
    </View>
    {enabled && <Text style={styles.hint}>한 손가락으로 이동 · 두 손가락으로 확대{live ? ' · 조절 중' : ''}</Text>}
  </View>;
}
const styles = StyleSheet.create({ toolbar: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, padding: 10, backgroundColor: '#F5F1EB' }, tool: { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#fff' }, active: { backgroundColor: '#7260cb' }, label: { fontSize: 11, color: '#6D607F', fontWeight: '600' }, activeLabel: { color: '#fff' }, hint: { textAlign: 'center', color: '#796E86', backgroundColor: '#F5F1EB', padding: 8, fontSize: 11 } });
