import { LocalizedText as Text } from './i18n-react';
import { t } from './i18n';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import type { ToolId } from './editor-layout';

export const EDITOR_TOOLS: { id: ToolId; icon: string; label: string }[] = [
  { id: 'photo', icon: '＋', label: t("사진") },
  { id: 'subject', icon: '◎', label: t("피사체") },
  { id: 'position', icon: '↔', label: t("편집") },
  { id: 'decoration', icon: '✧', label: t("AI 생성") },
  { id: 'repair', icon: '', label: t("보정") },
  { id: 'more', icon: '···', label: t("더보기") },
  { id: 'library', icon: '▣', label: t("보관함") },
];
type Props = { active: ToolId | null; onSelect: (id: ToolId) => void; disabled: boolean; hasPhoto: boolean; buttonHeight: number; pendingJob: boolean };
export function ToolRail(props: Props) {
  const renderTool = (tool: typeof EDITOR_TOOLS[number]) => {
    const disabled = props.disabled || (!props.hasPhoto && tool.id !== 'photo' && tool.id !== 'more');
    const photo = tool.id === 'photo';
    const ai = tool.id === 'subject' || tool.id === 'decoration' || tool.id === 'repair';
    return <Pressable key={tool.id} accessibilityRole="button" accessibilityLabel={ai ? t("{0} 도구 · AI 기능 포함", tool.label) : t("{0} 도구", tool.label)} accessibilityState={{ selected: props.active === tool.id, disabled }} onPress={() => props.onSelect(tool.id)} disabled={disabled} style={[styles.tool, { height: props.buttonHeight }, props.active === tool.id && styles.active, photo && styles.photo, photo && props.active === tool.id && styles.photoActive, disabled && styles.disabled]}>
      {tool.id === 'repair' ? <Svg width={22} height={25} viewBox="0 0 24 24" pointerEvents="none"><Path d="M4 6h16M4 12h16M4 18h16" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" /><Circle cx={9} cy={6} r={2.5} fill="#302D38" stroke="#fff" strokeWidth={1.5} /><Circle cx={16} cy={12} r={2.5} fill="#302D38" stroke="#fff" strokeWidth={1.5} /><Circle cx={10} cy={18} r={2.5} fill="#302D38" stroke="#fff" strokeWidth={1.5} /></Svg> : <Text style={styles.icon}>{tool.id === 'more' && props.pendingJob ? '!' : tool.icon}</Text>}
      {ai && <View pointerEvents="none" style={{ position: 'absolute', right: 2, top: 2 }}><Svg width={12} height={12} viewBox="0 0 24 24"><Defs><LinearGradient id={`ai-${tool.id}`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#67D9FF" /><Stop offset="1" stopColor="#B89BFF" /></LinearGradient></Defs><Path d="M12 1C13.5 8.5 15.5 10.5 23 12C15.5 13.5 13.5 15.5 12 23C10.5 15.5 8.5 13.5 1 12C8.5 10.5 10.5 8.5 12 1Z" fill={`url(#ai-${tool.id})`} /></Svg></View>}
      {props.buttonHeight >= 40 && <Text style={[styles.label, photo && styles.photoLabel]}>{tool.label}</Text>}
    </Pressable>;
  };
  return <View style={styles.group}>
    {EDITOR_TOOLS.filter(tool => tool.id === 'photo').map(renderTool)}
    <View style={styles.rail}>{EDITOR_TOOLS.filter(tool => tool.id !== 'photo' && tool.id !== 'library').map(renderTool)}</View>
    <View style={styles.library}>{EDITOR_TOOLS.filter(tool => tool.id === 'library').map(renderTool)}</View>
  </View>;
}
const styles = StyleSheet.create({ group: { width: 52, gap: 10 }, library: { width: 52, paddingVertical: 4, borderRadius: 18, backgroundColor: '#302D38DD' }, rail: { width: 52, borderRadius: 24, backgroundColor: '#302D38DD', paddingVertical: 4 }, tool: { alignItems: 'center', justifyContent: 'center', gap: 1, marginHorizontal: 3, borderRadius: 19 }, photo: { marginHorizontal: 0, borderRadius: 18, backgroundColor: '#2563EB', borderWidth: 1.5, borderColor: '#9C8CFF' }, photoActive: { backgroundColor: '#6350DC', borderColor: '#C2B8FF' }, photoLabel: { color: '#FFFFFF', fontWeight: '700' }, active: { backgroundColor: '#7762C9' }, disabled: { opacity: 0.3 }, icon: { color: '#fff', fontSize: 22, lineHeight: 25, fontWeight: '500' }, label: { color: '#E8E2F3', fontSize: 9, lineHeight: 12 } });
