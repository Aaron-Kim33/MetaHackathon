import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { cropImageLayout } from '../src/crop-layout.ts';
import { pageImagePoint } from '../src/layout.ts';
import { createApp } from '../server/index.mjs';
import { Store } from '../server/store.mjs';

test('very long photos fit the measured drawing slot without increasing the action area height', () => {
  for (const source of [{ width: 100, height: 10000 }, { width: 10000, height: 100 }, { width: 400, height: 1600 }]) {
    for (const slot of [{ width: 296, height: 160 }, { width: 366, height: 420 }, { width: 406, height: 620 }]) {
      const image = cropImageLayout(source, slot);
      assert.ok(image.height <= slot.height + 1e-6); assert.ok(image.width <= slot.width + 1e-6);
      assert.ok(image.x >= 0 && image.x + image.width <= slot.width + 1e-6);
      assert.ok(Math.abs(image.width / image.height - source.width / source.height) < 1e-6);
    }
  }
  assert.deepEqual(cropImageLayout({ width: 100, height: 10000 }, { width: 300, height: 0 }), { x: 0, y: 0, width: 0, height: 0 });
});

test('long-photo crop touches stay aligned and the apply-button area is outside the drawing responder', () => {
  const source = { width: 100, height: 4000 }, slot = { width: 340, height: 420 }, image = cropImageLayout(source, slot);
  const measured = { pageX: 20, pageY: 200, width: slot.width, height: image.height };
  const point = pageImagePoint(measured.pageX + image.x + image.width / 2, measured.pageY + image.height * 0.75, measured, source);
  assert.ok(Math.abs(point.x - 0.5) < 1e-8 && Math.abs(point.y - 0.75) < 1e-8);
  assert.equal(pageImagePoint(190, measured.pageY + image.height + 20, measured, source), null);
});

test('main photo replacement preserves stickers, theme and order, resets its mask, and uses the new source for later cuts', async t => {
  await mkdir('.local/tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.local/tests/main-photo-'));
  const app = await createApp({ root, token: 'main-photo', key: '', caps: { sam: 0, image: 0 } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const send = (route, value) => fetch(base + route, { method: 'POST', headers: { Authorization: 'Bearer main-photo', 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const post = async (route, value) => { const response = await send(route, value), data = await response.json(); assert.equal(response.status, 200, data.error); return data; };
  const image = async (width, height, color) => (await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()).toString('base64');
  const initial = await post('/fixture', {}), projectId = initial.project.id;
  const imported = await post('/imports', { projectId, image: await image(100, 100, '#0000ff') });
  const cut = await post('/cutout', { projectId, assetId: imported.pendingPhoto.id, points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }] });
  const id = cut.stickers[0].id;
  const positioned = await post('/options', { projectId, options: { ...cut.options, mode: 'frame', shadow: 0.6, tilt: -10, depth: 0.8, background: '#ffffff', layerOrder: [id, 'primary'], stickerTransforms: [{ id, x: 0.25, y: 0.7, scale: 0.28 }] } });
  const oldBytes = await app.store.read(projectId, 'source.png');
  const changed = await post('/source/replace', { projectId, image: await image(80, 360, '#00ff00') });
  assert.equal(changed.project.id, projectId); assert.equal(changed.project.width, 80); assert.equal(changed.project.height, 360);
  assert.equal(changed.project.selectedId, null); assert.deepEqual(changed.project.candidates, []); assert.equal(changed.subject, null);
  assert.equal(changed.options.mode, 'frame'); assert.equal(changed.options.shadow, 0.6); assert.equal(changed.options.depth, 0.8); assert.equal(changed.options.tilt, -10);
  assert.deepEqual(changed.options.stickerTransforms, positioned.options.stickerTransforms);
  assert.deepEqual(changed.options.layerOrder, positioned.options.layerOrder);
  assert.equal(changed.stickers[0].data, cut.stickers[0].data);
  assert.notEqual(changed.source, initial.source); assert.notEqual(changed.project.sourceFile, 'source.png');
  assert.deepEqual(await app.store.read(projectId, 'source.png'), oldBytes, 'old source remains intact');
  const stale = await send('/mask', { projectId, candidateId: initial.project.selectedId, baseRevision: 0, strokes: [{ mode: 'erase', radius: 0.1, points: [{ x: 0.5, y: 0.5 }] }] });
  assert.notEqual(stale.status, 200);
  const newCut = await post('/cutout', { projectId, points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }] });
  const meta = await sharp(Buffer.from(newCut.subject, 'base64')).metadata();
  assert.equal(meta.width, 80); assert.equal(meta.height, 360);
  const corrected = await post('/mask', { projectId, candidateId: newCut.project.selectedId, baseRevision: newCut.project.maskRevision, strokes: [{ mode: 'erase', radius: 0.1, points: [{ x: 0.5, y: 0.5 }] }] });
  const reset = await post('/mask/reset', { projectId, candidateId: newCut.project.selectedId, baseRevision: corrected.project.maskRevision });
  assert.equal(reset.subject, newCut.subject); assert.equal(reset.stickers[0].data, cut.stickers[0].data);
  const replacedAgain = await post('/source/replace', { projectId, image: await image(320, 80, '#ff0000') });
  assert.notEqual(replacedAgain.project.sourceFile, changed.project.sourceFile);
  assert.equal(replacedAgain.stickers[0].data, cut.stickers[0].data);
  const persisted = await new Store(root).get(projectId);
  assert.equal(persisted.sourceFile, replacedAgain.project.sourceFile); assert.equal(persisted.width, 320); assert.equal(persisted.height, 80);
  app.jobs.active = true;
  const busy = await send('/source/replace', { projectId, image: await image(100, 100, '#ffffff') });
  assert.equal(busy.status, 409); app.jobs.active = false;
  assert.equal((await app.store.get(projectId)).sourceFile, persisted.sourceFile);
  assert.equal(app.jobs.usage().sam.reserved, 0); assert.equal(app.jobs.usage().image.reserved, 0);
});
