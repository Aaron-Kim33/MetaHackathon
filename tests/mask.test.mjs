import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { refineMask, validateStrokes } from '../server/mask.mjs';

test('erase and restore change alpha while restored RGB comes from the original photo', async () => {
  const source = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#e04867' } }).png().toBuffer();
  const full = await sharp(source).ensureAlpha().png().toBuffer();
  const erased = await refineMask(source, full, [{ mode: 'erase', radius: 0.1, points: [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }] }]);
  const raw = await sharp(erased).raw().toBuffer();
  assert.equal(raw[(40 * 100 + 50) * 4 + 3], 0);
  assert.equal(raw[(10 * 100 + 50) * 4 + 3], 255);
  const restored = await refineMask(source, erased, [{ mode: 'restore', radius: 0.08, points: [{ x: 0.5, y: 0.5 }] }]);
  const result = await sharp(restored).raw().toBuffer();
  const offset = (40 * 100 + 50) * 4;
  assert.deepEqual([...result.subarray(offset, offset + 4)], [224, 72, 103, 255]);
  assert.equal(result[(40 * 100 + 35) * 4 + 3], 0);
  assert.equal((await sharp(full).raw().toBuffer())[(40 * 100 + 50) * 4 + 3], 255, 'original cutout must remain intact');
});

test('brush edits preserve stroke order and reject invalid coordinates or oversized payloads', async () => {
  assert.throws(() => validateStrokes([{ mode: 'erase', radius: 0.02, points: [{ x: NaN, y: 0 }] }]), /사진 안/);
  assert.throws(() => validateStrokes([{ mode: 'erase', radius: 1, points: [{ x: 0, y: 0 }] }]), /브러시 설정/);
  assert.throws(() => validateStrokes(Array.from({ length: 33 }, () => ({ mode: 'restore', radius: 0.02, points: [{ x: 0, y: 0 }] }))), /32/);
  const source = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#543210' } }).png().toBuffer();
  const full = await sharp(source).ensureAlpha().png().toBuffer();
  const result = await refineMask(source, full, [
    { mode: 'erase', radius: 0.12, points: [{ x: 0.5, y: 0.5 }] },
    { mode: 'restore', radius: 0.05, points: [{ x: 0.5, y: 0.5 }] },
  ]);
  const raw = await sharp(result).raw().toBuffer();
  assert.equal(raw[(30 * 60 + 30) * 4 + 3], 255);
  assert.equal(raw[(30 * 60 + 35) * 4 + 3], 0);
});
