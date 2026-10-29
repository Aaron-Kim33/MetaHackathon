import { t } from './i18n.ts';
type PhotosLibrary = {
  requestPermissionsAsync(writeOnly: boolean, granularPermissions: ('photo')[]): Promise<{ granted: boolean }>;
  Asset: { create(uri: string): Promise<{ id: string }> };
};

export async function saveToPhotos(uri: string, library: PhotosLibrary): Promise<string> {
  const permission = await library.requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) throw new Error(t("사진 저장 권한을 허용한 뒤 다시 시도해 주세요."));
  const asset = await library.Asset.create(uri);
  if (!asset?.id) throw new Error(t("사진 보관함의 저장 결과를 확인하지 못했어요."));
  return asset.id;
}

export function photoDestination(platform: string): string {
  return platform === 'ios'
    ? t("사진 앱에서 최근 추가된 사진을 확인해 주세요.")
    : t("휴대폰 갤러리 또는 Google 포토의 기기 사진에서 확인해 주세요.");
}
