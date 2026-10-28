import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { depthMesh, depthCamera, projectDepthPoint } from '../src/depth-mesh.ts';
import { spatialFrame, fillFarPlate } from '../server/depth.mjs';
import { createApp } from '../server/index.mjs';

test('depth reconstruction preserves every neutral camera pixel and creates perspective rather than a uniform image shift', () => {
  const frame = { width: 800, height: 1000, gridWidth: 3, gridHeight: 3, depth: [0, 30, 70, 120, 200, 240, 0, 100, 255] };
  const mesh = depthMesh(frame), aspect = .8;
  for (let i = 0; i < 9; i++) {
    const p = projectDepthPoint([...mesh.vertices.slice(i * 5, i * 5 + 3)], aspect, depthCamera({ x: 0, y: 0 }, .7));
    assert.ok(Math.abs(p.x - (i % 3 - 1)) < 1e-6);
    assert.ok(Math.abs(p.y - (1 - Math.floor(i / 3))) < 1e-6);
  }
  const camera = depthCamera({ x: .9, y: .5 }, .7);
  const near = projectDepthPoint([0, 0, .5], aspect, camera), far = projectDepthPoint([0, 0, -.5], aspect, camera);
  assert.ok(Math.abs(near.x - far.x) > .1, 'camera orbit and translation must reinforce depth instead of cancelling each other');
  assert.ok(near.x < 0 && far.x > 0, 'a camera moving right reveals nearby surfaces to the left of the reference plane');
  const left = projectDepthPoint([-.5, 0, 0], aspect, camera), right = projectDepthPoint([.5, 0, 0], aspect, camera);
  assert.notEqual(left.z, right.z, 'tilt changes perspective across the same plane');
  assert.ok(mesh.indices.every(i => i < 9));
  assert.ok(mesh.edges.length > 0);
  for (const edge of mesh.edges) {
    assert.ok(edge.indices.every(i => i < edge.vertices.length / 5));
    for (let i = 0; i < edge.vertices.length; i += 15) assert.ok(edge.vertices[i + 2] === edge.vertices[i + 7] && edge.vertices[i + 7] === edge.vertices[i + 12], 'boundary triangles cannot stretch across foreground and background depth');
  }
  for (const edge of mesh.edges) for (let i = 0; i < edge.vertices.length; i += 5) {
    const p = projectDepthPoint([...edge.vertices.slice(i, i + 3)], aspect, depthCamera({ x: 0, y: 0 }, .7));
    assert.ok(Math.abs(p.x - (edge.vertices[i + 3] * 2 - 1)) < 1e-6);
    assert.ok(Math.abs(p.y - (1 - edge.vertices[i + 4] * 2)) < 1e-6);
  }
  assert.throws(() => depthMesh({ ...frame, depth: [0] }));
  assert.throws(() => depthMesh({ ...frame, depth: Array(9).fill(NaN) }));
});

test('far plate propagates distant background colors into newly revealed foreground gaps', () => {
  const rgb = Buffer.from([0, 0, 255, 255, 0, 0, 255, 0, 0]);
  const plate = fillFarPlate(rgb, [0, 200, 255], 3, 1);
  assert.deepEqual([...plate], [0, 0, 255, 0, 0, 255, 0, 0, 255]);
  assert.deepEqual([...rgb], [0, 0, 255, 255, 0, 0, 255, 0, 0]);
});

test('depth analysis is cached per image, stays authenticated, and never edits the project or consumes Meta quota', async t => {
  await mkdir('.local/tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.local/tests/spatial-')); let calls = 0;
  const estimator = async () => { calls++; return { width: 2, height: 2, depth: Uint8Array.from([0, 90, 160, 255]) }; };
  const app = await createApp({ root, token: 'spatial-test', key: '', caps: { sam: 0, image: 0 }, depthEstimator: estimator });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (route, data) => { const r = await fetch(base + route, { method: 'POST', headers: { Authorization: 'Bearer spatial-test', 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const v = await r.json(); assert.equal(r.status, 200, v.error); return v; };
  const initial = await post('/fixture', {}), before = await app.store.get(initial.project.id);
  const a = await post('/spatial', { projectId: initial.project.id });
  const b = await post('/spatial', { projectId: initial.project.id });
  assert.equal(calls, 1); assert.equal(a.key, b.key);
  assert.equal(a.depth.length, a.gridWidth * a.gridHeight, 'grid must remain one channel after resizing');
  depthMesh(a);
  assert.deepEqual(await app.store.get(initial.project.id), before);
  assert.equal(app.jobs.usage().sam.reserved, 0); assert.equal(app.jobs.usage().image.reserved, 0);
  assert.equal((await fetch(base + '/spatial', { method: 'POST', body: '{}' })).status, 401);
  const changed = await sharp(Buffer.from(a.image, 'base64')).modulate({ brightness: .8 }).png().toBuffer();
  await spatialFrame(changed, root, estimator); assert.equal(calls, 2);
  const blue = await sharp({ create: { width: 60, height: 100, channels: 3, background: '#0000ff' } }).png().toBuffer();
  await post('/background', { projectId: initial.project.id, image: blue.toString('base64') });
  const layered = await post('/spatial', { projectId: initial.project.id });
  const behind = await sharp(Buffer.from(layered.farImage, 'base64')).removeAlpha().raw().toBuffer();
  assert.ok(behind[0] < 10 && behind[1] < 10 && behind[2] > 225, 'a separately chosen background must fill occluded areas with the actual original background');
});
