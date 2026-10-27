import test from 'node:test';
import assert from 'node:assert/strict';
import { saveToPhotos, photoDestination } from '../src/photos.ts';

test('denied add-only permission never creates an asset', async () => {
  let creates = 0;
  await assert.rejects(saveToPhotos('file:///photo.png', {
    requestPermissionsAsync: async (writeOnly, granular) => { assert.equal(writeOnly, true); assert.deepEqual(granular, ['photo']); return { granted: false }; },
    Asset: { create: async () => { creates++; return { id: 'unexpected' }; } },
  }), /권한/);
  assert.equal(creates, 0);
});

test('save waits for native asset creation and returns its receipt', async () => {
  let resolve;
  const created = new Promise(done => { resolve = done; });
  let finished = false;
  const saving = saveToPhotos('file:///popout.png', {
    requestPermissionsAsync: async () => ({ granted: true }),
    Asset: { create: async uri => { assert.equal(uri, 'file:///popout.png'); return created; } },
  }).then(id => { finished = true; return id; });
  await new Promise(done => setImmediate(done));
  assert.equal(finished, false);
  resolve({ id: 'saved-photo-id' });
  assert.equal(await saving, 'saved-photo-id');
});

test('native save errors propagate instead of reporting success', async () => {
  await assert.rejects(saveToPhotos('file:///photo.png', {
    requestPermissionsAsync: async () => ({ granted: true }),
    Asset: { create: async () => { throw new Error('disk full'); } },
  }), /disk full/);
  assert.match(photoDestination('ios'), /사진 앱/);
  assert.match(photoDestination('android'), /기기 사진/);
});
