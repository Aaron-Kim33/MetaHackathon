import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { rotatePoint, wrapAngle } from '../src/rotation.ts';
import { gesturePhoto, gestureSticker, photoLayout, stickerRect } from '../src/layout.ts';
import { hitLayer } from '../src/hit-testing.ts';
import { meaningfulGesture } from '../src/edit-performance.ts';
import { compose, settings } from '../server/composition.mjs';

test('two-finger rotation preserves the touched image point while scaling and moving', () => {
  const source = { width: 500, height: 700 }, anchor = { x: 600, y: 600 };
  const initial = settings({ mode: 'plain', photoRotation: 20, zoom: 1, x: 0, y: 0 });
  const rect = photoLayout(source, initial).photo;
  const local = rotatePoint(anchor, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, -20);
  const uv = { x: (local.x - rect.x) / rect.width, y: (local.y - rect.y) / rect.height };
  const next = gesturePhoto(initial, source, 1080, { dx: 10, dy: -5, factor: 1.2, rotation: 30, anchorX: anchor.x, anchorY: anchor.y });
  assert.equal(next.photoRotation, 50);
  assert.equal(next.tilt, initial.tilt);
  const after = photoLayout(source, next).photo;
  const actual = rotatePoint({ x: after.x + uv.x * after.width, y: after.y + uv.y * after.height }, { x: after.x + after.width / 2, y: after.y + after.height / 2 }, next.photoRotation);
  assert.ok(Math.hypot(actual.x - 610, actual.y - 595) < 2);
  assert.equal(meaningfulGesture(0, 0, 1, 10), true);
  assert.equal(meaningfulGesture(0, 0, 1, .5), false);
  assert.equal(wrapAngle(-179 - 179), 2);
});

test('a rotated sticker remains selectable at its visible pixels and its pinch anchor stays fixed', () => {
  const source = { width: 400, height: 80 }, canvas = { width: 1080, height: 1350 };
  const initial = { id: 'one', x: .5, y: .5, scale: .6, rotation: 90 };
  const before = stickerRect(source, initial, canvas), anchor = { x: 540, y: 750 };
  const local = rotatePoint(anchor, { x: 540, y: 675 }, -90);
  const uv = { x: (local.x - before.x) / before.width, y: (local.y - before.y) / before.height };
  const next = gestureSticker(initial, source, canvas, 1080, { dx: 0, dy: 0, factor: 1.1, rotation: 20, anchorX: anchor.x, anchorY: anchor.y });
  const after = stickerRect(source, next, canvas);
  const actual = rotatePoint({ x: after.x + uv.x * after.width, y: after.y + uv.y * after.height }, { x: after.x + after.width / 2, y: after.y + after.height / 2 }, next.rotation);
  assert.ok(Math.hypot(actual.x - anchor.x, actual.y - anchor.y) < 2);
  const view = { project: source, subject: null, stickers: [{ ...source, id: 'one' }] };
  const options = { ...settings({ mode: 'plain', hidePrimary: true }), stickerTransforms: [initial], layerOrder: ['primary', 'one'] };
  assert.equal(hitLayer(view, options, { x: 540, y: 900 }, 1080), 'one');
  assert.equal(hitLayer(view, options, { x: 750, y: 675 }, 1080), null);
});

test('primary rotation is selectable and exported with the saved angle', async () => {
  const source = await sharp(Buffer.from('<svg width="100" height="100"><path fill="red" d="M0 0h50v100H0z"/><path fill="blue" d="M50 0h50v100H50z"/></svg>')).png().toBuffer();
  const options = settings({ mode: 'plain', ratio: 'square', zoom: 1, x: 0, y: 0, photoRotation: 90 });
  const result = await compose({ source, options });
  assert.equal(result.options.photoRotation, 90);
  const pixels = await sharp(result.bytes).ensureAlpha().raw().toBuffer();
  const pixel = (x, y) => [...pixels.subarray((y * 1080 + x) * 4, (y * 1080 + x) * 4 + 4)];
  assert.deepEqual(pixel(540, 250), [255, 0, 0, 255]);
  assert.deepEqual(pixel(540, 830), [0, 0, 255, 255]);
  const view = { project: { width: 400, height: 80 }, subject: null, stickers: [] };
  assert.equal(hitLayer(view, { ...options, ratio: 'portrait' }, { x: 540, y: 900 }, 1080), 'primary');
  assert.equal(hitLayer(view, { ...options, ratio: 'portrait' }, { x: 750, y: 675 }, 1080), null);
  assert.throws(() => settings({ photoRotation: NaN }));
});
