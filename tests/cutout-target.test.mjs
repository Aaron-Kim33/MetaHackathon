import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoutTarget } from '../src/cutout-target.ts';

test('target selection follows the selected sticker and never reopens a deleted primary photo', () => {
  const view = { stickers: [{ id: 'old' }, { id: 'new' }], pendingPhoto: { id: 'pending' } };
  assert.deepEqual(cutoutTarget(view, { hidePrimary: false }, 'new'), { kind: 'sticker', id: 'new' });
  assert.deepEqual(cutoutTarget(view, { hidePrimary: false }, 'primary'), { kind: 'primary' });
  assert.deepEqual(cutoutTarget(view, { hidePrimary: true }, 'primary'), { kind: 'import', id: 'pending' });
  const completed = { ...view, pendingPhoto: null };
  assert.deepEqual(cutoutTarget(completed, { hidePrimary: true }, null), { kind: 'sticker', id: 'new' });
  assert.equal(cutoutTarget({ stickers: [] }, { hidePrimary: true }, null), null);
});
