import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ProjectView } from './client';
import { BrushStroke, containedImage } from './layout';
import { MeasuredBrush } from './brush';

type Props = { visible: boolean; view: ProjectView; onClose: () => void; onApply: (strokes: BrushStroke[]) => Promise<void>; onReset: () => Promise<void>; outline?: boolean; embedded?: boolean; viewportHeight?: number };
export function MaskEditor(props: Props) {
  const [width, setWidth] = useState(300), [radius, setRadius] = useState(0.025);
  const [strokes, setStrokes] = useState<BrushStroke[]>([]), [drawing, setDrawing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const outline = !!props.outline;
  const image = containedImage(props.view.project, width, props.embedded ? Math.max(32, (props.viewportHeight || 440) - 148) : 440);
  const current = useRef({ source: props.view.project, radius, busy, outline }); current.current = { source: props.view.project, radius, busy, outline };
  const records = useRef<BrushStroke[]>([]);
  const canvas = useRef<React.ComponentRef<typeof View>>(null);
  const session = useRef<{ path: MeasuredBrush; baseline: BrushStroke[] } | null>(null);
  const update = (next: BrushStroke[]) => { records.current = next; setStrokes(next); };
  useEffect(() => { update([]); setError(''); session.current = null; setDrawing(false); return () => { session.current = null; }; }, [props.visible, props.view.project.id, props.view.project.selectedId, props.view.project.maskRevision]);
  const publish = (stroke: NonNullable<typeof session.current>) => {
    if (session.current !== stroke) return;
    const result = stroke.path.snapshot();
    if (result.points.length) update([...stroke.baseline, result]);
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !current.current.busy,
    onMoveShouldSetPanResponder: () => !!session.current && !session.current.path.ended,
    onPanResponderGrant: event => {
      const remaining = 2000 - records.current.reduce((n, stroke) => n + stroke.points.length, 0);
      if (!canvas.current || records.current.length >= 32 || remaining <= 0) return;
      const stroke = { path: new MeasuredBrush('erase', current.current.outline ? 0.003 : current.current.radius, current.current.source, remaining), baseline: current.current.outline ? [] : records.current };
      session.current = stroke; setDrawing(true);
      stroke.path.push(event.nativeEvent.pageX, event.nativeEvent.pageY);
      canvas.current.measure((_x, _y, width, height, pageX, pageY) => {
        if (session.current !== stroke) return;
        stroke.path.locate({ width, height, pageX, pageY });
        publish(stroke);
        if (stroke.path.ended) session.current = null;
      });
    },
    onPanResponderMove: event => {
      const stroke = session.current;
      if (!stroke || event.nativeEvent.touches.length > 1) return;
      if (stroke.path.push(event.nativeEvent.pageX, event.nativeEvent.pageY)) publish(stroke);
    },
    onPanResponderRelease: () => { session.current?.path.end(); setDrawing(false); },
    onPanResponderTerminate: () => { session.current = null; setDrawing(false); },
    onPanResponderTerminationRequest: () => false,
  }), []);
  const action = async (reset: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try { if (reset) await props.onReset(); else await props.onApply(records.current); update([]); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '보정을 적용하지 못했어요.'); }
    finally { setBusy(false); }
  };
  const tool = (title: string, selected: boolean, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled: busy || drawing || disabled }} disabled={busy || drawing || disabled} onPress={onPress} style={[styles.button, props.embedded && { paddingHorizontal: 10, paddingVertical: 9 }, selected && styles.selected, (busy || drawing || disabled) && styles.disabled]}><Text style={[styles.label, selected && styles.selectedLabel]}>{title}</Text></Pressable>;
  const endpoints = outline && strokes[0]?.points.length > 2 ? [strokes[0].points[0], strokes[0].points.at(-1)!] : null;
  const closing = endpoints ? { dx: (endpoints[1].x - endpoints[0].x) * image.width, dy: (endpoints[1].y - endpoints[0].y) * image.height } : null;
  const drawingCanvas = <View ref={canvas} collapsable={false} onLayout={event => setWidth(event.nativeEvent.layout.width)} {...responder.panHandlers} style={{ width: '100%', height: image.height, backgroundColor: '#E6E0ED', borderRadius: 16, overflow: 'hidden' }}>
      {outline && <Image pointerEvents="none" source={{ uri: `data:image/png;base64,${props.view.source}` }} style={{ position: 'absolute', left: image.x, width: image.width, height: image.height }} />}
      {!outline && props.view.subject && <Image pointerEvents="none" source={{ uri: `data:image/png;base64,${props.view.subject}` }} style={{ position: 'absolute', left: image.x, width: image.width, height: image.height }} />}
      {closing && endpoints && <View pointerEvents="none" style={{ position: 'absolute', left: image.x + (endpoints[0].x + endpoints[1].x) * image.width / 2 - Math.hypot(closing.dx, closing.dy) / 2, top: (endpoints[0].y + endpoints[1].y) * image.height / 2 - 1, width: Math.hypot(closing.dx, closing.dy), height: 2, backgroundColor: '#BAFFB9', transform: [{ rotate: `${Math.atan2(closing.dy, closing.dx)}rad` }] }} />}
      {strokes.flatMap((stroke, index) => stroke.points.map((p, i) => {
        const r = outline ? 2 : stroke.radius * Math.min(image.width, image.height);
        return <View pointerEvents="none" key={`${index}-${i}`} style={{ position: 'absolute', left: image.x + p.x * image.width - r, top: p.y * image.height - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: outline ? '#BAFFB9' : '#e15c6d55' }} />;
      }))}
    </View>;
  const sizes = ([0.01, 0.025, 0.05] as const).map((value, i) => <React.Fragment key={value}>{tool(['작게', '중간', '크게'][i], radius === value, () => setRadius(value))}</React.Fragment>);
  if (props.embedded) return <View style={{ flex: 1, width: '100%', justifyContent: 'center', gap: 6 }}>
    <View style={styles.header}><Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{outline ? '테두리로 자르기' : '지우개 보정'}</Text>{tool('닫기', false, props.onClose)}</View>
    <View style={[styles.row, { gap: 6 }]}>{outline ? <Text style={{ color: '#ddd', fontSize: 11, flex: 1 }}>남길 부분을 한 바퀴 그려 주세요. 끝점은 자동으로 이어져요.</Text> : sizes}{tool('↶', false, () => update(records.current.slice(0, -1)), !strokes.length)}</View>
    {drawingCanvas}
    <View style={[styles.row, { gap: 6 }]}>{tool(busy ? '적용 중…' : outline ? '스티커로 자르기' : '보정 적용', true, () => { void action(false); }, !strokes.length || (outline && strokes[0].points.length < 3))}{!outline && tool('지우개 보정 초기화', false, () => { void action(true); })}</View>
    {error ? <Text accessibilityLiveRegion="polite" numberOfLines={2} style={[styles.error, { color: '#FFB9C1', position: 'absolute', left: 6, right: 6, top: 78, backgroundColor: '#45232A', padding: 8 }]}>{error}</Text> : null}
  </View>;
  return <Modal visible={props.visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { if (!busy) props.onClose(); }}><SafeAreaView style={styles.safe}><ScrollView scrollEnabled={!drawing} contentContainerStyle={styles.page}>
    <View style={styles.header}><Text style={styles.title}>{outline ? '테두리로 자르기' : '지우개 보정'}</Text>{tool('닫기', false, props.onClose)}</View>
    <Text style={styles.help}>지울 부분을 칠한 뒤 ‘보정 적용’을 누르세요.{ '\n' }처음 상태로 돌아가려면 ‘누끼 보정 초기화’를 누르세요.</Text>
    <View style={styles.row}><Text style={styles.help}>지우기 브러시</Text>{tool('한 획 취소', false, () => update(records.current.slice(0, -1)), !strokes.length)}</View>
    <View style={styles.row}><Text style={styles.help}>브러시</Text>{sizes}</View>
    {drawingCanvas}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {busy ? <ActivityIndicator color="#7260cb" /> : null}
    <View style={styles.row}>{tool('보정 적용', true, () => { void action(false); }, !strokes.length)}{tool('누끼 보정 초기화', false, () => { void action(true); })}</View>
    <Text style={styles.help}>초기화하면 적용한 보정과 아직 적용하지 않은 획을 모두 취소하고, 처음 분리된 누끼로 돌아갑니다. 모델을 다시 호출하지 않아요.</Text>
  </ScrollView></SafeAreaView></Modal>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#F8F6F2' }, page: { padding: 20, gap: 16, maxWidth: 620, width: '100%', alignSelf: 'center', paddingBottom: 40 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { fontSize: 24, color: '#253043', fontWeight: '700' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }, button: { borderRadius: 12, backgroundColor: '#EFEDF5', paddingVertical: 12, paddingHorizontal: 15 }, selected: { backgroundColor: '#7260cb' }, label: { fontSize: 12, color: '#625574', fontWeight: '600' }, selectedLabel: { color: '#fff' }, disabled: { opacity: 0.4 }, help: { fontSize: 12, color: '#857B8D', lineHeight: 19 }, error: { fontSize: 12, color: '#B84054' } });
