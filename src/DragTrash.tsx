import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TrashBounds } from './drag-delete';
export function DragTrash({ over, right, onBounds }: { over: boolean; right: number; onBounds: (bounds: TrashBounds) => void }) {
  const target = useRef<React.ComponentRef<typeof View>>(null);
  return <View pointerEvents="none" style={[styles.overlay, { right }]}>
    <View ref={target} collapsable={false} accessible accessibilityLabel={over ? '놓으면 삭제' : '여기로 끌어 삭제'} onLayout={() => target.current?.measure((_x, _y, width, height, pageX, pageY) => onBounds({ width, height, pageX, pageY }))} style={[styles.target, over && styles.over]}>
      <View style={styles.icon}>
        <View style={[styles.handle, over && styles.whiteBackground]} /><View style={[styles.lid, over && styles.whiteBackground]} />
        <View style={[styles.bin, over && { borderColor: '#fff' }]}><View style={[styles.line, over && styles.whiteBackground]} /><View style={[styles.line, over && styles.whiteBackground]} /></View>
      </View>
    </View>
    <Text accessibilityLiveRegion="polite" style={[styles.label, over && { color: '#FFB3C1' }]}>{over ? '놓으면 삭제' : '여기로 끌어 삭제'}</Text>
  </View>;
}
const styles = StyleSheet.create({ overlay: { position: 'absolute', left: 10, bottom: 10, alignItems: 'center', gap: 5 }, target: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#302B3AEF', borderWidth: 2, borderColor: '#A99CB9' }, over: { backgroundColor: '#C53F5B', borderColor: '#FFA4B6' }, icon: { width: 28, height: 34 }, handle: { position: 'absolute', width: 10, height: 3, left: 9, top: 2, backgroundColor: '#E3D9EF', borderRadius: 2 }, lid: { position: 'absolute', width: 26, height: 3, left: 1, top: 7, borderRadius: 2, backgroundColor: '#E3D9EF' }, bin: { position: 'absolute', left: 5, top: 12, width: 18, height: 20, borderWidth: 2, borderTopWidth: 0, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, borderColor: '#E3D9EF', flexDirection: 'row', justifyContent: 'center', gap: 4, paddingTop: 3 }, line: { width: 2, height: 11, backgroundColor: '#E3D9EF' }, whiteBackground: { backgroundColor: '#fff' }, label: { color: '#DDD1EB', fontSize: 11, backgroundColor: '#211C29E8', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 9 } });
