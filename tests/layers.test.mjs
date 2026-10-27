import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/index.mjs';
import { Store } from '../server/store.mjs';
import { gestureSticker, stickerRect } from '../src/layout.ts';
import { frameMatrix, unprojectFrame } from '../src/frame.ts';
import { lastEdit } from '../src/snapshot.ts';

test('two imported cutouts accumulate, move independently, preserve order, and survive reopening', async t => {
  await mkdir('.local/tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.local/tests/layers-'));
  const app = await createApp({ root, token: 'layers', key: '', caps: { sam: 0, image: 0 } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (route, data) => {
    const response = await fetch(base + route, { method: 'POST', headers: { Authorization: 'Bearer layers', 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json(); assert.equal(response.status, 200, result.error); return result;
  };
  const original = await post('/fixture', {}), projectId = original.project.id;
  let current = original;
  for (const color of ['#ff0000', '#0000ff']) {
    const image = (await sharp({ create: { width: 120, height: 100, channels: 3, background: color } }).png().toBuffer()).toString('base64');
    const imported = await post('/imports', { projectId, image });
    assert.equal(imported.project.id, projectId);
    assert.equal(imported.subject, original.subject);
    assert.deepEqual(imported.stickers, current.stickers);
    const count = current.stickers.length;
    current = await post('/cutout', { projectId, assetId: imported.pendingPhoto.id, points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }] });
    assert.equal(current.stickers.length, count + 1);
    assert.equal(current.pendingPhoto, null);
    assert.equal(current.subject, original.subject);
    assert.equal(current.options.mode, original.options.mode);
  }
  const [red, blue] = current.stickers;
  assert.ok(red.width < 120 && red.height < 100, 'transparent padding is trimmed for sticker selection');
  const transforms = current.options.stickerTransforms.map((item, i) => ({ ...item, x: i ? 0.75 : 0.25, y: 0.5, scale: 0.2 }));
  current = await post('/render', { projectId, options: { ...current.options, stickerTransforms: transforms } });
  const { data, info } = await sharp(Buffer.from(current.image, 'base64')).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
  assert.deepEqual(pixel(270, 675), [255, 0, 0, 255]);
  assert.deepEqual(pixel(810, 675), [0, 0, 255, 255]);
  const moved = await post('/render', { projectId, options: { ...current.options, stickerTransforms: transforms.map(item => item.id === red.id ? { ...item, x: 0.35 } : item) } });
  assert.deepEqual(moved.options.stickerTransforms[1], transforms[1]);
  assert.equal(moved.stickers[1].data, blue.data);
  const staleOptions = await post('/render', { projectId, options: { ...moved.options, stickerTransforms: [moved.options.stickerTransforms[0]] } });
  assert.equal(staleOptions.options.stickerTransforms.length, 2, 'older edit options must not silently hide newly added stickers');
  const edit = await post('/stickers/edit', { projectId, stickerId: red.id });
  const corrected = await post('/mask', { projectId, stickerId: red.id, baseRevision: edit.project.maskRevision || 0, strokes: [{ mode: 'erase', radius: 0.1, points: [{ x: 0.5, y: 0.5 }] }] });
  assert.notEqual(corrected.stickers[0].data, red.data);
  assert.equal(corrected.stickers[1].data, blue.data);
  assert.equal(corrected.subject, original.subject);
  const reset = await post('/mask/reset', { projectId, stickerId: red.id, baseRevision: corrected.project.maskRevision });
  assert.equal(reset.stickers[0].data, red.data);
  const reopened = await new Store(root).get(projectId);
  assert.equal(reopened.stickers.length, 2);
  assert.deepEqual(reopened.options.stickerTransforms, moved.options.stickerTransforms);
  const reordered = await post('/render', { projectId, options: { ...moved.options, stickerTransforms: [...moved.options.stickerTransforms].reverse(), layerOrder: ['primary', ...[...moved.options.stickerTransforms].reverse().map(item => item.id)] } });
  assert.equal(reordered.options.stickerTransforms.at(-1).id, red.id);
  const metadata = await post('/options', { projectId, options: { ...reordered.options, stickerTransforms: [...reordered.options.stickerTransforms].reverse() } });
  assert.deepEqual(metadata.options.stickerTransforms, [...reordered.options.stickerTransforms].reverse());
  assert.equal('image' in metadata, false, 'layer changes must not produce image payloads');
  assert.equal('source' in metadata, false);
  const preview = await post('/render', { projectId, options: reordered.options, previewOnly: true });
  assert.ok(preview.baseImage);
  assert.equal('source' in preview, false, 'preview updates must not transfer all source images again');
  assert.equal('stickers' in preview, false);
  const removed = await post('/stickers/remove', { projectId, stickerId: red.id, options: { ...reordered.options, stickerTransforms: reordered.options.stickerTransforms.map(item => item.id === blue.id ? { ...item, x: 0.85 } : item) } });
  assert.equal(removed.stickers.length, 1); assert.equal(removed.stickers[0].data, blue.data);
  assert.deepEqual(removed.options.stickerTransforms, [{ ...transforms[1], x: 0.85 }]);
  assert.equal(removed.usage.sam.reserved, 0); assert.equal(removed.usage.image.reserved, 0);
});

test('sticker drag/pinch transforms only its own center and preserves the pinch anchor', () => {
  const first = { id: 'one', x: 0.3, y: 0.5, scale: 0.4 }, second = { id: 'two', x: 0.7, y: 0.5, scale: 0.4 };
  const dimensions = { width: 1080, height: 1350 }, source = { width: 300, height: 200 };
  const next = gestureSticker(first, source, dimensions, 360, { dx: 20, dy: -10, factor: 1, anchorX: 90, anchorY: 180 });
  assert.ok(Math.abs(next.x - first.x - 60 / 1080) < 1e-8);
  assert.deepEqual(second, { id: 'two', x: 0.7, y: 0.5, scale: 0.4 });
  const pinched = gestureSticker(first, source, dimensions, 360, { dx: 0, dy: 0, factor: 1.5, anchorX: 90, anchorY: 180 });
  const a = stickerRect(source, first, dimensions), b = stickerRect(source, pinched, dimensions);
  const u = (270 - a.x) / a.width, v = (540 - a.y) / a.height;
  assert.ok(Math.abs(b.x + u * b.width - 270) <= 1);
  assert.ok(Math.abs(b.y + v * b.height - 540) <= 1);
});

test('tilted phone coordinates invert accurately for touch gestures', () => {
  const size = { width: 360, height: 450 }, options = { mode: 'frame', tilt: -12, depth: 0.8 };
  const m = frameMatrix(options), original = { x: 90, y: 170 }, cx = 180, cy = 225;
  const projected = { x: m.a * (original.x - cx) + m.c * (original.y - cy) + cx, y: m.b * (original.x - cx) + m.d * (original.y - cy) + cy };
  const restored = unprojectFrame(projected, size, options);
  assert.ok(Math.abs(restored.x - original.x) < 1e-8 && Math.abs(restored.y - original.y) < 1e-8);
  assert.deepEqual(frameMatrix({ ...options, mode: 'plain' }), { a: 1, b: 0, c: 0, d: 1 });
});

test('only the last edit is retained, legacy project lists are dropped, and selection is validated', () => {
  const view = { stickers: [{ id: 'one', data: 'pixels' }] }, draft = { stickerTransforms: [{ id: 'one', x: 0.2, y: 0.4, scale: 0.5 }] };
  const saved = lastEdit({ view, draft, history: [], pendingJob: null, activeStickerId: 'one', projects: [{ id: 'old' }] });
  assert.equal('projects' in saved, false);
  assert.equal(saved.activeStickerId, 'one'); assert.deepEqual(saved.draft, draft);
  assert.equal(lastEdit({ ...saved, activeStickerId: 'removed' }).activeStickerId, null);
});
