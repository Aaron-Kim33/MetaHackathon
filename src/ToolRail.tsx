import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ToolId } from './editor-layout';

export const EDITOR_TOOLS: { id: ToolId; icon: string; label: string }[] = [
  { id: 'photo', icon: '＋', label: '사진' },
  { id: 'subject', icon: '◎', label: '피사체' },
  { id: 'position', icon: '↔', label: '위치' },
  { id: 'decoration', icon: '✧', label: '장식' },
  { id: 'background', icon: '◐', label: '테마' },
  { id: 'more', icon: '···', label: '더보기' },
];
type Props = { active: ToolId | null; onSelect: (id: ToolId) => void; disabled: boolean; hasPhoto: boolean; buttonHeight: number; pendingJob: boolean };
export function ToolRail(props: Props) {
  return <View style={styles.rail}>{EDITOR_TOOLS.map(tool => {
    const disabled = props.disabled || (!props.hasPhoto && tool.id !== 'photo' && tool.id !== 'more');
    return <Pressable key={tool.id} accessibilityRole="button" accessibilityLabel={`${tool.label} 도구`} accessibilityState={{ selected: props.active === tool.id, disabled }} onPress={() => props.onSelect(tool.id)} disabled={disabled} style={[styles.tool, { height: props.buttonHeight }, props.active === tool.id && styles.active, disabled && styles.disabled]}>
      <Text style={styles.icon}>{tool.id === 'more' && props.pendingJob ? '!' : tool.icon}</Text>
      {props.buttonHeight >= 40 && <Text style={styles.label}>{tool.label}</Text>}
    </Pressable>;
  })}</View>;
}
const styles = StyleSheet.create({ rail: { width: 52, borderRadius: 24, backgroundColor: '#302D38', paddingVertical: 4 }, tool: { alignItems: 'center', justifyContent: 'center', gap: 1, marginHorizontal: 3, borderRadius: 19 }, active: { backgroundColor: '#7762C9' }, disabled: { opacity: 0.3 }, icon: { color: '#fff', fontSize: 22, lineHeight: 25, fontWeight: '500' }, label: { color: '#E8E2F3', fontSize: 9, lineHeight: 12 } });
