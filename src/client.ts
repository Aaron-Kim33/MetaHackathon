import Constants from 'expo-constants';

export type EditOptions = {
  layerOrder: string[];
  hidePrimary: boolean;
  tilt: number; depth: number;
  stickerTransforms: import('./layout').StickerTransform[];
  mode: 'plain' | 'frame' | 'sticker';
  ratio: 'portrait' | 'story' | 'square'; zoom: number; x: number; y: number; shadow: number; background: string;
  decorationDepth: 'front' | 'back'; decorationX: number; decorationY: number; decorationScale: number;
};
export type Usage = { sam: { reserved: number; cap: number }; image: { reserved: number; cap: number } };
export type ProjectView = {
  project: {
    id: string; createdAt: string; width: number; height: number; provenance: string; selectedId: string | null;
    candidates: { id: string; label: string; provider: string; box?: { left: number; top: number; right: number; bottom: number } }[];
    decoration: boolean; decorationPending?: { prompt: string } | null;
    maskRevision?: number;
  };
  image: string; source: string; photoSource?: string | null; subject?: string | null; decorationImage?: { data: string; width: number; height: number } | null; width: number; height: number; options: EditOptions; usage: Usage;
  baseImage?: string | null; baseOptions?: EditOptions; imageOptions?: EditOptions;
  primaryImage?: string | null;
  subjectBounds?: { x: number; y: number; width: number; height: number } | null;
  stickers?: { id: string; data: string; width: number; height: number; label: string }[];
  pendingPhoto?: { id: string; source: string; width: number; height: number } | null;
};
export type Connection = { url: string; token: string };
export const initialConnection: Connection = {
  url: Constants.expoConfig?.extra?.apiUrl || 'http://127.0.0.1:4180',
  token: Constants.expoConfig?.extra?.pairingToken || '',
};
export const jobId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
  const n = Math.floor(Math.random() * 16); return (character === 'x' ? n : (n & 3) | 8).toString(16);
});
export async function request<T>(connection: Connection, endpoint: string, data?: unknown): Promise<T> {
  if (!/^https?:\/\/[^\s/]+(?::\d+)?$/i.test(connection.url.replace(/\/$/, ''))) throw new Error('PC 서버 주소를 확인해 주세요.');
  if (!connection.token.trim()) throw new Error('PC 연결 코드를 입력해 주세요. API 키를 입력하면 안 돼요.');
  let response: Response;
  try {
    response = await fetch(`${connection.url.replace(/\/$/, '')}${endpoint}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(145000),
    });
  } catch { throw new Error('PC 연결이 끊겼거나 대기 시간이 지났어요. AI 요청을 다시 보내기 전에 작업 상태를 확인해 주세요.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '작업에 실패했어요.');
  return result as T;
}
