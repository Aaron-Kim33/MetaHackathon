import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectKey } from '../scripts/check-model.mjs';

test('preflight only lists models and reports required model availability', async () => {
  let requests = 0;
  const result = await inspectKey('test-only', async (url, init) => {
    requests++;
    assert.equal(url, 'https://api.meta.ai/v1/models');
    assert.equal(init.body, undefined);
    assert.equal(init.headers.Authorization, 'Bearer test-only');
    return Response.json({ data: [{ id: 'sam-3.1' }, { id: 'muse-image-1.0' }] });
  });
  assert.equal(requests, 1);
  assert.ok(result.every(item => item.available));
});

test('preflight separates invalid credentials from unavailable models without retries', async () => {
  let requests = 0;
  await assert.rejects(inspectKey('test-only', async () => { requests++; return new Response('', { status: 401 }); }), /401/);
  assert.equal(requests, 1);
  const models = await inspectKey('test-only', async () => Response.json({ data: [{ id: 'sam-3.1' }] }));
  assert.equal(models.find(model => model.id === 'muse-image-1.0').available, false);
  await assert.rejects(inspectKey('', async () => { throw Error('must not call'); }), /키가 없습니다/);
});
