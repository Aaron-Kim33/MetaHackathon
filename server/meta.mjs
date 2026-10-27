import { AppError, insist } from './errors.mjs';

export function responseText(response) {
  return response.output_text ?? (response.output || []).flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text).join('');
}
async function call(key, body, fetcher = fetch) {
  insist(typeof key === 'string' && key.trim(), 'PC에서 npm run setup:model로 Meta Model API 키를 설정해 주세요.', 503);
  let response;
  try {
    response = await fetcher('https://api.meta.ai/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: false, store: false }), signal: AbortSignal.timeout(120000),
    });
  } catch { throw new AppError(504, '모델 호출 결과를 확인하지 못했어요. 자동 재시도하지 않아요.', 'provider_uncertain'); }
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403 ? 'Meta 키·모델 권한·Billing 상태를 확인해 주세요.' : response.status === 429 ? 'Meta 제공자의 사용 한도에 도달했어요.' : 'Meta 모델 요청에 실패했어요. 작업 상태와 제공자 사용량을 확인해 주세요.';
    throw new AppError(502, message, 'provider_error');
  }
  const data = await response.json();
  insist(data.status === 'completed', '모델이 작업을 완료하지 못했어요.', 502);
  return { data, requestId: response.headers.get('x-request-id') || data.id || null };
}

export async function segment({ key, image, width, height, point, prompt = 'person' }, fetcher) {
  const { buildObjectPrompt, parseImageStream, recordsOfKind, decodeMaskToRaster } = await import('@meta-sam/parser');
  let text = prompt;
  if (point) {
    insist(Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1, '사진 안에서 대상을 선택해 주세요.');
    text = buildObjectPrompt({ size: { width, height }, objects: [{ id: 1, prompts: [{ points: [{ x: Math.min(width - 1, Math.round(point.x * width)), y: Math.min(height - 1, Math.round(point.y * height)) }] }] }] });
  }
  insist(typeof text === 'string' && text.trim() && text.length < 2000, '분리할 대상을 입력해 주세요.');
  const { data, requestId } = await call(key, { model: 'sam-3.1', input: [{ role: 'user', content: [{ type: 'input_text', text }, { type: 'input_image', image_url: `data:image/png;base64,${image.toString('base64')}` }] }], metadata: { mask_encoding: 'one_bit' } }, fetcher);
  const output = responseText(data);
  if (!output.trim()) return { masks: [], requestId, model: 'sam-3.1' };
  for (const match of output.matchAll(/<\|box;[^|]*;w=(\d+);h=(\d+)/g)) {
    insist(Number(match[1]) === width && Number(match[2]) === height, 'SAM의 원본 크기가 입력 사진과 맞지 않아요.', 502);
  }
  // Adapt the completed non-streaming response to the official parser's event interface.
  async function* events() {
    yield { type: 'response.output_text.done', item_id: data.id || 'sam', output_index: 0, content_index: 0, text: output };
    yield { type: 'response.completed' };
  }
  const parsed = await parseImageStream(events()).finalResult;
  insist(parsed.outcome.status === 'completed' && !parsed.diagnostics.some(d => d.severity === 'error'), 'SAM 응답을 완전히 해석하지 못했어요.', 502);
  const boxes = recordsOfKind(parsed.records, 'box');
  const masks = recordsOfKind(parsed.records, 'mask').map(record => {
    const box = boxes.find(item => item.objectId === record.objectId);
    insist(box, 'SAM 박스가 누락됐어요.', 502);
    return { objectId: record.objectId, box, raster: decodeMaskToRaster(record.mask), width: record.mask.width, height: record.mask.height };
  });
  return { masks, requestId, model: 'sam-3.1' };
}

export async function generateDecoration({ key, prompt }, fetcher) {
  insist(typeof prompt === 'string' && prompt.trim() && prompt.length <= 500, '장식 설명을 500자 이내로 입력해 주세요.');
  const { data, requestId } = await call(key, {
    model: 'muse-image-1.0',
    input: `Create one isolated decorative object: ${prompt}. Plain white background, generous empty margin, no person, no text, no frame. The object will be segmented into an editable foreground decoration.`,
    tools: [{ type: 'image_generation', output_format: 'png', reasoning_strength: 'low', enable_image_search: false, enable_web_search: false, enable_shell: false }],
  }, fetcher);
  const item = data.output?.find(value => value.type === 'image_generation_call' && typeof value.result === 'string');
  insist(item && item.result.length < 30000000, '생성된 이미지가 없거나 너무 커요.', 502);
  return { bytes: Buffer.from(item.result, 'base64'), requestId, model: 'muse-image-1.0' };
}
