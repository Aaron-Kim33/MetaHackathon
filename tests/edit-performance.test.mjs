import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedLayers } from '../src/layer-order.ts';
import { meaningfulGesture, sameBase, sameOptions, moveLayer, rebaseOptions } from '../src/edit-performance.ts';
import { SnapshotJournal } from '../src/snapshot-journal.ts';
const options = { mode: 'plain', zoom: 1, x: 0, stickerTransforms: [{ id: 'a', x: 0.2, y: 0.4, scale: 0.3 }, { id: 'b', x: 0.7, y: 0.4, scale: 0.3 }, { id: 'c', x: 0.5, y: 0.6, scale: 0.3 }] };
const snapshot = () => ({ view: { project: { id: 'test' }, image: 'I'.repeat(250000), source: 'S'.repeat(250000), subject: 'A'.repeat(250000), baseImage: 'B'.repeat(250000), primaryImage: 'P'.repeat(250000), options, stickers: [{ id: 'a', data: 'T'.repeat(250000) }] }, draft: options, history: [], activeStickerId: 'a', pendingJob: null });
function memoryStorage() {
  const files = new Map(), writes = [];
  return { files, writes, ensure: async () => {}, read: async name => { if (!files.has(name)) throw Error('missing'); return files.get(name); }, write: async (name, data) => { files.set(name, data); writes.push({ name, data }); }, list: async () => [...files.keys()], remove: async name => { files.delete(name); } };
}

test('tap jitter never commits an edit, while deliberate drag/pinch does', () => {
  assert.equal(meaningfulGesture(0, 0, 1), false);
  assert.equal(meaningfulGesture(2, -2, 1.005), false);
  assert.equal(meaningfulGesture(6, 0, 1), true);
  assert.equal(meaningfulGesture(0, 0, 1.05), true);
});

test('small layer buttons move exactly one level without changing any positions', () => {
  const forward = moveLayer(options, 'a', 'front');
  assert.deepEqual(forward.stickerTransforms.map(item => item.id), ['b', 'a', 'c']);
  assert.deepEqual(forward.stickerTransforms[1], options.stickerTransforms[0]);
  assert.equal(sameOptions(moveLayer(forward, 'a', 'back'), options), true);
  assert.deepEqual(orderedLayers(moveLayer(options, 'a', 'back')), ['a', 'primary', 'b', 'c']);
  assert.equal(moveLayer(options, 'primary', 'back'), options);
  assert.equal(moveLayer(options, 'c', 'front'), options);
  assert.equal(moveLayer(options, 'missing', 'front'), options);
  const hiddenRootBetween = { ...options, layerOrder: ['a', 'primary', 'b', 'c'] };
  assert.deepEqual(orderedLayers(moveLayer(hiddenRootBetween, 'a', 'front', ['a', 'b', 'c'])), ['b', 'primary', 'a', 'c']);
});

test('layer moves reuse the base render, while real photo edits require a new base', () => {
  assert.equal(sameBase(options, moveLayer(options, 'a', 'front')), true);
  assert.equal(sameOptions(options, moveLayer(options, 'a', 'front')), false);
  assert.equal(sameBase(options, { ...options, zoom: 1.2 }), false);
  const reorderedKeys = { stickerTransforms: options.stickerTransforms, x: 0, zoom: 1, mode: 'plain' };
  assert.equal(sameOptions(options, reorderedKeys), true, 'wire key order must not start a sync loop');
});

test('saving selection/position updates does not serialize or rewrite unchanged image bytes', async () => {
  const storage = memoryStorage(), journal = new SnapshotJournal(storage), first = snapshot();
  await journal.save(first);
  const mediaWrites = storage.writes.filter(item => item.name.endsWith('.b64')).length;
  assert.equal(mediaWrites, 6);
  const next = { ...first, activeStickerId: null, draft: { ...options, x: 0.2 } };
  await journal.save(next);
  assert.equal(storage.writes.filter(item => item.name.endsWith('.b64')).length, mediaWrites);
  const headers = storage.writes.filter(item => item.name.endsWith('.json'));
  assert.ok(headers.every(item => item.data.length < 5000), 'journal metadata must not contain megabytes of image JSON');
  const restored = await new SnapshotJournal(storage).restore();
  assert.equal(restored.view.source, first.view.source);
  assert.equal(restored.view.baseImage, first.view.baseImage);
  assert.equal(restored.view.stickers[0].data, first.view.stickers[0].data);
  assert.equal(restored.draft.x, 0.2);
});

test('an interrupted image write falls back to the previous intact edit', async () => {
  const storage = memoryStorage(), journal = new SnapshotJournal(storage), first = snapshot();
  await journal.save(first);
  await journal.save({ ...first, view: { ...first.view, image: 'NEW' }, draft: { ...options, x: 0.8 } });
  const latest = JSON.parse(storage.files.get('draft-0.json'));
  storage.files.delete(latest.snapshot.view.image.slice(7));
  const restored = await new SnapshotJournal(storage).restore();
  assert.equal(restored.view.image, first.view.image);
  assert.equal(restored.draft.x, 0);
});

test('only two journal versions keep media files, without touching exports or originals', async () => {
  const storage = memoryStorage(), journal = new SnapshotJournal(storage), first = snapshot();
  storage.files.set('popout-export.png', 'EXPORT');
  for (let i = 0; i < 8; i++) await journal.save({ ...first, view: { ...first.view, image: `VERSION-${i}` } });
  assert.equal(storage.files.get('popout-export.png'), 'EXPORT');
  assert.equal([...storage.files.keys()].filter(name => name.endsWith('.b64')).length, 7);
  const restored = await new SnapshotJournal(storage).restore();
  assert.equal(restored.view.image, 'VERSION-7');
});

test('background saves coalesce, but a durable model request ID is always written', async () => {
  const storage = memoryStorage();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  let blocked = false;
  const write = storage.write;
  storage.write = async (name, data) => { if (!blocked && name.endsWith('.b64')) { blocked = true; entered(); await gate; } await write(name, data); };
  const journal = new SnapshotJournal(storage), first = snapshot();
  const saved = [journal.save(first)];
  await started;
  saved.push(journal.save({ ...first, pendingJob: 'routine-2' }));
  saved.push(journal.save({ ...first, pendingJob: 'routine-3' }));
  saved.push(journal.save({ ...first, pendingJob: 'critical-model-request' }, true));
  saved.push(journal.save({ ...first, pendingJob: 'routine-4' }));
  saved.push(journal.save({ ...first, pendingJob: 'routine-5' }));
  release(); await Promise.all(saved);
  assert.deepEqual(storage.writes.filter(item => item.name.endsWith('.json')).map(item => JSON.parse(item.data).snapshot.pendingJob), [null, 'routine-3', 'critical-model-request', 'routine-5']);
});

test('legacy snapshots migrate without losing their pixels or draft', async () => {
  const storage = memoryStorage(), first = snapshot();
  storage.files.set('draft-1.json', JSON.stringify({ version: 2, revision: 7, snapshot: first }));
  const journal = new SnapshotJournal(storage), restored = await journal.restore();
  assert.equal(restored.view.image, first.view.image);
  await journal.save(restored);
  const migrated = JSON.parse(storage.files.get('draft-0.json'));
  assert.equal(migrated.version, 3);
  assert.ok(migrated.snapshot.view.image.startsWith('@asset/'));
  assert.equal(migrated.revision, 8);
});

test('restoring an older draft keeps newly added layers and drops deleted ones', () => {
  const view = { stickers: [{ id: 'a' }, { id: 'new' }], options: { ...options, stickerTransforms: [options.stickerTransforms[0], { id: 'new', x: 0.8, y: 0.8, scale: 0.4 }] } };
  const restored = rebaseOptions({ ...options, x: 0.3 }, view);
  assert.deepEqual(restored.stickerTransforms.map(item => item.id), ['a', 'new']);
  assert.deepEqual(restored.layerOrder, ['primary', 'a', 'new']);
  assert.equal(restored.x, 0.3);
});

test('the first cutout can move in front of an added sticker and export matches the layer order', async () => {
  const sharp = (await import('sharp')).default, { compose } = await import('../server/composition.mjs');
  const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const cutout = await sharp(source).ensureAlpha().png().toBuffer();
  const sticker = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#0000ff' } }).png().toBuffer();
  const id = '11111111-1111-4111-8111-111111111111';
  const initial = { mode: 'plain', zoom: 1, x: 0, y: 0, stickerTransforms: [{ id, x: 0.5, y: 0.5, scale: 0.3 }] };
  const args = { source, cutout, stickers: [{ id, bytes: sticker, width: 20, height: 20 }] };
  const before = await compose({ ...args, options: initial });
  const promoted = moveLayer(before.options, 'primary', 'front');
  assert.equal(sameBase(before.options, promoted), true, 'root order changes reuse the cached images');
  const after = await compose({ ...args, options: promoted });
  const pixel = async bytes => { const data = await sharp(bytes).raw().toBuffer(); return [...data.subarray((675 * 1080 + 540) * 4, (675 * 1080 + 540) * 4 + 4)]; };
  assert.deepEqual(await pixel(before.bytes), [0, 0, 255, 255]);
  assert.deepEqual(await pixel(after.bytes), [255, 0, 0, 255]);
  const composedFromCachedLayers = await sharp(before.baseBytes).composite([{ input: after.primaryBytes }]).png().toBuffer();
  assert.deepEqual(await pixel(composedFromCachedLayers), [255, 0, 0, 255]);
});
