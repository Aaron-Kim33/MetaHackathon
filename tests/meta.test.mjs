import test from 'node:test';
import assert from 'node:assert/strict';
import { segment, generateDecoration } from '../server/meta.mjs';

// Documented SAM wire example, used only as an explicit mocked provider response.
const wire = '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3\'7`e.ioeAf6-k/#Xd8%dX9x(|>';
const response = text => new Response(JSON.stringify({ id: 'resp_mock', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }), { headers: { 'x-request-id': 'mock_request' } });
test('official parser decodes a non-streaming response and point prompts use normalised source pixels', async () => {
  let body;
  const result = await segment({ key: 'test-only', image: Buffer.from('test'), width: 320, height: 334, point: { x: 0.5, y: 0.5 } }, async (url, init) => { assert.equal(url, 'https://api.meta.ai/v1/responses'); body = JSON.parse(init.body); return response(wire); });
  assert.match(body.input[0].content[0].text, /point;x=160;y=167/);
  assert.equal(body.model, 'sam-3.1'); assert.equal(body.store, false); assert.equal(body.metadata.mask_encoding, 'one_bit');
  assert.equal(result.masks.length, 1); assert.equal(result.masks[0].width, 60); assert.equal(result.masks[0].height, 27); assert.equal(result.masks[0].raster.length, 1620);
  assert.equal(result.masks[0].box.right, 271); assert.equal(result.requestId, 'mock_request');
});
test('zero SAM matches stays empty, provider failure never becomes a fake mask', async () => {
  const input = { key: 'test-only', image: Buffer.from('test'), width: 10, height: 10, prompt: 'person' };
  assert.deepEqual((await segment(input, async () => response(''))).masks, []);
  await assert.rejects(segment(input, async () => new Response('{}', { status: 403 })), /권한/);
});
test('Muse Image reads the image item by type and disables storage/search', async () => {
  const output = await generateDecoration({ key: 'test-only', prompt: 'purple crystal' }, async (url, init) => {
    const body = JSON.parse(init.body); assert.equal(body.model, 'muse-image-1.0'); assert.equal(body.store, false); assert.equal(body.tools[0].enable_web_search, false);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'image_generation_call', result: Buffer.from('fixture').toString('base64') }] }));
  });
  assert.equal(output.bytes.toString(), 'fixture');
});
