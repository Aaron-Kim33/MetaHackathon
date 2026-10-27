import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ProjectView } from './client';
import { BrushStroke, containedImage, imagePoint } from './layout';

type Props = { visible: boolean; view: ProjectView; onClose: () => void; onApply: (strokes: BrushStroke[]) => Promise<void>; onReset: () => Promise<void> };
export function MaskEditor(props: Props) {
  const [width, setWidth] = useState(300), [mode, setMode] = useState<'erase' | 'restore'>('erase'), [radius, setRadius] = useState(0.025);
  const [strokes, setStrokes] = useState<BrushStroke[]>([]), [drawing, setDrawing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const image = containedImage(props.view.project, width);
  const current = useRef({ image, mode, radius, busy }); current.current = { image, mode, radius, busy };
  const records = useRef<BrushStroke[]>([]), active = useRef(false);
  const update = (next: BrushStroke[]) => { records.current = next; setStrokes(next); };
  useEffect(() => { update([]); setError(''); active.current = false; setDrawing(false); }, [props.visible, props.view.project.id, props.view.project.selectedId, props.view.project.maskRevision]);
  const point = (event: GestureResponderEvent) => imagePoint(event.nativeEvent.locationX, event.nativeEvent.locationY, current.current.image);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: event => !current.current.busy && !!point(event),
    onMoveShouldSetPanResponder: () => active.current,
    onPanResponderGrant: event => {
      const next = point(event);
      if (!next || records.current.length >= 32) return;
      active.current = true; setDrawing(true);
      update([...records.current, { mode: current.current.mode, radius: current.current.radius, points: [next] }]);
    },
    onPanResponderMove: event => {
      if (!active.current) return;
      const next = point(event), last = records.current.at(-1);
      if (!next || !last || records.current.reduce((n, stroke) => n + stroke.points.length, 0) >= 2000) return;
      const previous = last.points.at(-1)!;
      if (Math.hypot(next.x - previous.x, next.y - previous.y) < last.radius * 0.35) return;
      update([...records.current.slice(0, -1), { ...last, points: [...last.points, next] }]);
    },
    onPanResponderRelease: () => { active.current = false; setDrawing(false); },
    onPanResponderTerminate: () => { active.current = false; setDrawing(false); },
    onPanResponderTerminationRequest: () => false,
  }), []);
  const action = async (reset: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try { if (reset) await props.onReset(); else await props.onApply(records.current); update([]); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '보정을 적용하지 못했어요.'); }
    finally { setBusy(false); }
  };
  const tool = (title: string, selected: boolean, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled: busy || disabled }} disabled={busy || disabled} onPress={onPress} style={[styles.button, selected && styles.selected, (busy || disabled) && styles.disabled]}><Text style={[styles.label, selected && styles.selectedLabel]}>{title}</Text></Pressable>;
  return <Modal visible={props.visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { if (!busy) props.onClose(); }}><SafeAreaView style={styles.safe}><ScrollView scrollEnabled={!drawing} contentContainerStyle={styles.page}>
    <View style={styles.header}><Text style={styles.title}>누끼 다듬기</Text>{tool('닫기', false, props.onClose)}</View>
    <Text style={styles.help}>빨간색은 지우기, 초록색은 원본 복원이에요.{ '\n' }칠한 뒤 ‘보정 적용’을 눌러 결과를 확인하세요.</Text>
    <View style={styles.row}>{tool('지우기', mode === 'erase', () => setMode('erase'))}{tool('복원', mode === 'restore', () => setMode('restore'))}{tool('한 획 취소', false, () => update(records.current.slice(0, -1)), !strokes.length)}</View>
    <View style={styles.row}><Text style={styles.help}>브러시</Text>{([0.01, 0.025, 0.05] as const).map((value, i) => <React.Fragment key={value}>{tool(['작게', '중간', '크게'][i], radius === value, () => setRadius(value))}</React.Fragment>)}</View>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} {...responder.panHandlers} style={{ width: '100%', height: image.height, backgroundColor: '#E6E0ED', borderRadius: 16, overflow: 'hidden' }}>
      <Image pointerEvents="none" source={{ uri: `data:image/png;base64,${props.view.source}` }} style={{ position: 'absolute', left: image.x, width: image.width, height: image.height, opacity: 0.2 }} />
      {props.view.subject && <Image pointerEvents="none" source={{ uri: `data:image/png;base64,${props.view.subject}` }} style={{ position: 'absolute', left: image.x, width: image.width, height: image.height }} />}
      {strokes.flatMap((stroke, index) => stroke.points.map((p, i) => {
        const r = stroke.radius * Math.min(image.width, image.height);
        return <View pointerEvents="none" key={`${index}-${i}`} style={{ position: 'absolute', left: image.x + p.x * image.width - r, top: p.y * image.height - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: stroke.mode === 'erase' ? '#e15c6d55' : '#3ca67c55' }} />;
      }))}
    </View>
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {busy ? <ActivityIndicator color="#7260cb" /> : null}
    <View style={styles.row}>{tool('보정 적용', true, () => { void action(false); }, !strokes.length)}{tool('분리 원본으로', false, () => { void action(true); })}</View>
    <Text style={styles.help}>모델을 다시 호출하지 않아요. 복원은 원본 사진에 있는 픽셀을 되살립니다. 닫기를 누르면 아직 적용하지 않은 획은 취소됩니다.</Text>
  </ScrollView></SafeAreaView></Modal>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#F8F6F2' }, page: { padding: 20, gap: 16, maxWidth: 620, width: '100%', alignSelf: 'center', paddingBottom: 40 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { fontSize: 24, color: '#253043', fontWeight: '700' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, button: { borderRadius: 12, backgroundColor: '#EFEDF5', paddingVertical: 12, paddingHorizontal: 15 }, selected: { backgroundColor: '#7260cb' }, label: { fontSize: 12, color: '#625574', fontWeight: '600' }, selectedLabel: { color: '#fff' }, disabled: { opacity: 0.4 }, help: { fontSize: 12, color: '#857B8D', lineHeight: 19 }, error: { fontSize: 12, color: '#B84054' } });
