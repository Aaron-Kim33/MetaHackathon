import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const required = ['sam-3.1', 'muse-image-1.0'];
export async function inspectKey(key, fetcher = fetch) {
  if (!key?.trim()) throw new Error('Meta Model API 키가 없습니다. Billing 지급 확인 후 npm run setup:model을 실행하세요.');
  let response;
  try {
    response = await fetcher('https://api.meta.ai/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
  } catch { throw new Error('Meta에 연결하지 못했습니다. 네트워크와 공식 지역 지원 조건을 확인하세요.'); }
  if (response.status === 401) throw new Error('API 인증 실패(401). 발급한 키가 정확한지 확인하세요. 키를 채팅에 붙여넣지 마세요.');
  if (response.status === 403) throw new Error('API 접근 거부(403). 계정·지역·모델 권한과 Billing 상태를 확인하세요.');
  if (!response.ok) throw new Error(`모델 목록 조회 실패(HTTP ${response.status}). 자동 재시도하지 않습니다.`);
  const body = await response.json();
  if (!Array.isArray(body.data)) throw new Error('모델 목록 응답을 해석하지 못했습니다.');
  const ids = new Set(body.data.map(model => model.id));
  return required.map(id => ({ id, available: ids.has(id) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const envFile = path.join(root, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  console.log('Meta 접속 점검: GET /v1/models만 조회합니다. 모델 추론·이미지 생성·사진 전송은 하지 않습니다.');
  console.log(`Billing 크레딧 수동 확인 기록: ${process.env.HACKATHON_CREDITS_CONFIRMED === 'true' ? '있음 (실제 잔액 자동 조회 아님)' : '없음 · 유료 호출 차단'}`);
  console.log(`설정 호출 상한: SAM ${process.env.SAM_REQUEST_CAP || 0}회 / 이미지 ${process.env.IMAGE_REQUEST_CAP || 0}회`);
  try {
    const models = await inspectKey(process.env.MODEL_API_KEY);
    for (const model of models) console.log(`${model.id}: ${model.available ? '목록에 있음' : '목록에 없음'}`);
    console.log('목록 조회 성공은 크레딧 잔액·결제 활성화·실제 모델 요청 성공을 보장하지 않습니다.');
    if (models.some(model => !model.available)) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
