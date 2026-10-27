import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ModelJobs } from '../server/store.mjs';

async function temporary(prefix) { await mkdir('.local/tests', { recursive: true }); return mkdtemp(path.resolve('.local/tests', prefix)); }

test('simultaneous requests cannot exceed the cap; repeated ID reuses a durable result', async () => {
  const root = await temporary('jobs-');
  const jobs = new ModelJobs(path.join(root, 'jobs.json'), { sam: 1, image: 1 }); await jobs.init();
  let calls = 0; const id = randomUUID();
  const first = jobs.run(id, 'sam', 'one', async () => { calls++; await new Promise(resolve => setTimeout(resolve, 40)); return { value: 'done' }; });
  const second = jobs.run(randomUUID(), 'sam', 'two', async () => { calls++; });
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal(calls, 1);
  const restarted = new ModelJobs(jobs.file, { sam: 1, image: 1 }); await restarted.init();
  assert.deepEqual(await restarted.run(id, 'sam', 'one', () => { throw Error('must not call'); }), { value: 'done' });
  await assert.rejects(restarted.run(randomUUID(), 'sam', 'other', () => {}), /한도/);
  await assert.rejects(restarted.run(id, 'sam', 'changed', () => {}), /다른 요청/);
});

test('ambiguous failures remain reserved after restart', async () => {
  const root = await temporary('uncertain-');
  const jobs = new ModelJobs(path.join(root, 'jobs.json'), { sam: 1, image: 0 }); await jobs.init();
  const id = randomUUID();
  await assert.rejects(jobs.run(id, 'sam', 'request', async () => { throw Error('network interrupted'); }));
  const restarted = new ModelJobs(jobs.file, { sam: 1, image: 0 }); await restarted.init();
  assert.equal(restarted.usage().sam.reserved, 1);
  await assert.rejects(restarted.run(id, 'sam', 'request', () => {}), /network interrupted/);
});
