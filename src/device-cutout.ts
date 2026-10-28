import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as FS from 'expo-file-system/legacy';
export type DeviceMask = { mask: string; width: number; height: number; provider: 'apple-vision' | 'android-mlkit' | 'android-mediapipe-cpu' };
type LiftModule = { isSupported: () => boolean; engine?: () => string; segment: (uri: string, x: number | null, y: number | null) => Promise<DeviceMask> };
const native = requireOptionalNativeModule<LiftModule>('SubjectLift');
export const deviceCutoutAvailable = () => !!native?.isSupported() && (Platform.OS !== 'android' || native.engine?.() === 'mediapipe-cpu-v1');
export async function deviceCutout(source: string, point?: { x: number; y: number } | null): Promise<DeviceMask> {
  if (!native) throw new Error('자동 누끼는 설치형 개발 빌드에서 사용할 수 있어요. Expo Go에서는 지원하지 않아요.');
  if (!native.isSupported()) throw new Error('이 기기에서는 자동 누끼를 지원하지 않아요. SAM 분리 또는 테두리 자르기를 사용해 주세요.');
  if (Platform.OS === 'android' && native.engine?.() !== 'mediapipe-cpu-v1') throw new Error('자동 누끼 안정화 버전을 설치 중이에요. 업데이트 후 다시 시도해 주세요.');
  if (!FS.cacheDirectory) throw new Error('사진 캐시를 사용할 수 없어요.');
  const uri = `${FS.cacheDirectory}lift-${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
  try {
    await FS.writeAsStringAsync(uri, source, { encoding: FS.EncodingType.Base64 });
    return await native.segment(uri, point?.x ?? null, point?.y ?? null);
  } finally { await FS.deleteAsync(uri, { idempotent: true }).catch(() => {}); }
}
