import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

test('local workflow authenticates, persists project edits and renders without model access', async t => {
  await mkdir('.local/tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.local/tests/server-'));
  const app = await createApp({ root, token: 'test-pairing', key: '', caps: { sam: 0, image: 0 } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = (route, value) => fetch(base + route, { method: value === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer test-pairing', 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) });
  assert.equal((await fetch(base + '/status')).status, 401);
  const initial = await (await request('/fixture', {})).json();
  assert.equal(initial.project.provenance, 'synthetic-fixture'); assert.equal(initial.width, 1080);
  const updated = await (await request('/render', { projectId: initial.project.id, options: { ...initial.options, ratio: 'story', x: 0.1 } })).json();
  assert.equal(updated.height, 1920); assert.equal(updated.options.x, 0.1);
  const stored = await app.store.get(initial.project.id); assert.equal(stored.options.ratio, 'story');
  assert.equal((await request('/segment', { projectId: initial.project.id, prompt: 'person' })).status, 503);
  assert.equal(app.jobs.usage().sam.reserved, 0);
  const restored = await (await request(`/projects/${initial.project.id}`)).json();
  assert.equal(restored.image, updated.image); assert.equal(restored.project.selectedId, initial.project.selectedId);
});
