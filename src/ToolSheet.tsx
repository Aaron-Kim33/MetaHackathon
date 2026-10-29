import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LocalizedText as Text } from './i18n-react';
import { t } from './i18n';

type Props = React.PropsWithChildren<{
  title: string; compactHeight: number; expandedHeight: number;
  bottom: number; hidden: boolean; onClose: () => void;
}>;

export function ToolSheet({ title, compactHeight, expandedHeight, bottom, hidden, onClose, children }: Props) {
  const height = useRef(new Animated.Value(compactHeight)).current;
  const current = useRef(compactHeight), start = useRef(compactHeight);
  const expanded = useRef(false), scrollY = useRef(0);
  const bounds = useRef({ compactHeight, expandedHeight });
  bounds.current = { compactHeight, expandedHeight };
  const snap = (open: boolean) => {
    expanded.current = open;
    const target = open ? bounds.current.expandedHeight : bounds.current.compactHeight;
    current.current = target;
    Animated.spring(height, { toValue: target, useNativeDriver: false, damping: 24, stiffness: 240, mass: 0.8 }).start();
  };
  useEffect(() => { snap(expanded.current); }, [compactHeight, expandedHeight]);
  const gestures = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      if (Math.abs(gesture.dy) < 10 || Math.abs(gesture.dy) <= Math.abs(gesture.dx) * 1.3) return false;
      // A compact sheet expands before its contents scroll. In the expanded
      // sheet, downward movement is handed back only at the top of the list.
      return !expanded.current ? gesture.dy < 0 : gesture.dy > 0 && scrollY.current <= 1;
    },
    onPanResponderGrant: () => {
      height.stopAnimation(value => { current.current = value; start.current = value; });
    },
    onPanResponderMove: (_event, gesture) => {
      const value = Math.max(bounds.current.compactHeight, Math.min(bounds.current.expandedHeight, start.current - gesture.dy));
      current.current = value; height.setValue(value);
    },
    onPanResponderRelease: (_event, gesture) => {
      snap(Math.abs(gesture.vy) > 0.35 ? gesture.vy < 0 : current.current > (bounds.current.compactHeight + bounds.current.expandedHeight) / 2);
    },
    onPanResponderTerminate: () => snap(expanded.current),
    onPanResponderTerminationRequest: () => false,
  }), [height]);
  return <Animated.View pointerEvents={hidden ? 'none' : 'auto'} {...gestures.panHandlers} style={[styles.sheet, { height, bottom, opacity: hidden ? 0 : 1 }]}>
    <View style={styles.header}>
      <View pointerEvents="none" style={styles.handleTrack}><View style={styles.handle} /></View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('메뉴 펼치기 또는 줄이기')} onPress={() => snap(!expanded.current)} style={styles.heading}>
        <Text style={styles.title}>{title}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('도구 접기')} hitSlop={4} onPress={onClose} style={styles.close}><View style={styles.chevron} /></Pressable>
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} scrollEventThrottle={16} onScroll={event => { scrollY.current = event.nativeEvent.contentOffset.y; }}>
      {children}
    </ScrollView>
  </Animated.View>;
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, zIndex: 90, backgroundColor: '#FAF8F5', borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden' },
  header: { height: 40, flexShrink: 0, flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  heading: { flex: 1, height: 40, paddingLeft: 18, justifyContent: 'center' },
  handleTrack: { position: 'absolute', left: 0, right: 0, top: 5, alignItems: 'center' },
  handle: { width: 28, height: 3, borderRadius: 2, backgroundColor: '#C3BBCB' },
  title: { color: '#352C40', fontSize: 14, fontWeight: '700', marginTop: 6 },
  close: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' },
  chevron: { width: 9, height: 9, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: '#776B82', transform: [{ rotate: '45deg' }], marginTop: -5 },
  scroll: { flex: 1 }, content: { paddingHorizontal: 17, paddingTop: 8, paddingBottom: 16, gap: 10 },
});
