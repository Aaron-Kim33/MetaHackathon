import React, { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ProjectView } from './client';
import { pageImagePoint } from './layout';
import type { BrushPoint } from './layout';

type Props = { view: ProjectView; point: BrushPoint | null; onPoint: (point: BrushPoint) => void; disabled: boolean };
export function SourcePicker(props: Props) {
  const canvas = useRef<React.ComponentRef<typeof View>>(null), current = useRef(props);
  current.current = props;
  const [width, setWidth] = useState(300);
  const height = width * props.view.project.height / props.view.project.width;
  return <Pressable ref={canvas} collapsable={false} disabled={props.disabled} accessibilityRole="button" accessibilityLabel="사진에서 분리할 대상 선택" onLayout={event => setWidth(event.nativeEvent.layout.width)} onPress={event => {
    const { pageX: touchX, pageY: touchY } = event.nativeEvent;
    const project = current.current.view.project;
    canvas.current?.measure((_x, _y, measuredWidth, measuredHeight, pageX, pageY) => {
      if (current.current.view.project.id !== project.id) return;
      const point = pageImagePoint(touchX, touchY, { pageX, pageY, width: measuredWidth, height: measuredHeight }, project);
      if (point) current.current.onPoint(point);
    });
  }} style={{ width: '100%', height }}>
    <Image pointerEvents="none" source={{ uri: `data:image/png;base64,${props.view.source}` }} style={StyleSheet.absoluteFill} resizeMode="contain" />
    {props.view.project.candidates.map(candidate => candidate.box ? <View key={candidate.id} pointerEvents="none" style={{ position: 'absolute', left: candidate.box.left / props.view.project.width * width, top: candidate.box.top / props.view.project.height * height, width: (candidate.box.right - candidate.box.left) / props.view.project.width * width, height: (candidate.box.bottom - candidate.box.top) / props.view.project.height * height, borderWidth: 2, borderColor: '#7260cb' }}><Text style={styles.label}>{candidate.label}</Text></View> : null)}
    {props.point && <View pointerEvents="none" style={[styles.point, { left: props.point.x * width - 12, top: props.point.y * height - 12 }]} />}
  </Pressable>;
}
const styles = StyleSheet.create({ label: { backgroundColor: '#7260cb', color: '#fff', fontSize: 11, alignSelf: 'flex-start' }, point: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#fff', backgroundColor: '#7260cb99' } });
