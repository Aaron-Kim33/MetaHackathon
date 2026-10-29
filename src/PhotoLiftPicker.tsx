import { LocalizedText as Text } from './i18n-react';
import { t } from './i18n';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ProjectView } from './client';
import { cropImageLayout } from './crop-layout';
import { SourcePicker } from './SourcePicker';

export function PhotoLiftPicker({ view, disabled, onLift, onManual, onClose }: {
  view: ProjectView; disabled: boolean; onLift: (point: { x: number; y: number }) => void;
  onManual: () => void; onClose: () => void;
}) {
  const [slot, setSlot] = useState({ width: 300, height: 1 });
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const image = cropImageLayout(view.project, slot);
  const button = (text: string, action: () => void) => <Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{ padding: 12, borderRadius: 12, backgroundColor: '#37313F', opacity: disabled ? .4 : 1 }}><Text style={{ color: '#EEE7F7', fontSize: 12 }}>{text}</Text></Pressable>;
  return <View style={{ flex: 1, width: '100%', minHeight: 0, gap: 10 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
      <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>추가 사진에서 피사체 선택</Text>
      {button(t("닫기"), onClose)}
    </View>
    <Text style={{ color: '#E3D9EF', fontSize: 13, lineHeight: 20, flexShrink: 0 }}>스티커로 만들 피사체 안쪽을 0.6초 꾹 누르세요. 진동이 오면 손을 떼도 돼요.</Text>
    <View style={{ flex: 1, minHeight: 0, justifyContent: 'center', alignItems: 'center' }} onLayout={event => setSlot({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
      <View style={{ width: image.width, height: image.height }}><SourcePicker view={view} point={point} onPoint={setPoint} onAutoCutout={onLift} disabled={disabled} /></View>
    </View>
    <View style={{ flexShrink: 0, alignItems: 'center' }}>{button(t("잘 안 되나요? 수동으로 자르기"), onManual)}</View>
  </View>;
}
