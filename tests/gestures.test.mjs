import test from 'node:test';
import assert from 'node:assert/strict';
import { containedImage, imagePoint, gesturePhoto, photoLayout } from '../src/layout.ts';

const source = { width: 800, height: 1200 };
const initial = { ratio: 'portrait', zoom: 1.25, x: 0, y: -0.1 };
test('drag displacement maps from phone display to output pixels without losing photo-subject alignment', () => {
  const before = photoLayout(source, initial);
  const next = gesturePhoto(initial, source, 360, { dx: 20, dy: -15, factor: 1, anchorX: 180, anchorY: 220 });
  const after = photoLayout(source, next);
  assert.equal(after.photo.x - before.photo.x, 60);
  assert.equal(after.photo.y - before.photo.y, -45);
  assert.equal(next.zoom, initial.zoom);
});

test('pinch keeps the touched source point anchored and constrains extreme zoom/pan', () => {
  const before = photoLayout(source, initial), display = 360, anchor = { x: 160, y: 190 };
  const next = gesturePhoto(initial, source, display, { dx: 0, dy: 0, factor: 1.2, anchorX: anchor.x, anchorY: anchor.y });
  const after = photoLayout(source, next);
  const u = (anchor.x * 3 - before.photo.x) / before.photo.width;
  const v = (anchor.y * 3 - before.photo.y) / before.photo.height;
  assert.ok(Math.abs(after.photo.x + u * after.photo.width - anchor.x * 3) < 1.5);
  assert.ok(Math.abs(after.photo.y + v * after.photo.height - anchor.y * 3) < 1.5);
  const limited = gesturePhoto(initial, source, display, { dx: 10000, dy: -10000, factor: 100, anchorX: 0, anchorY: 0 });
  assert.equal(limited.zoom, 2.4); assert.equal(limited.x, 0.8); assert.equal(limited.y, -0.8);
});

test('brush coordinates ignore letterboxing and map the visible image back to source coordinates', () => {
  const image = containedImage({ width: 100, height: 1000 }, 300, 440);
  assert.equal(image.width, 44);
  assert.equal(imagePoint(0, 100, image), null);
  assert.deepEqual(imagePoint(150, 220, image), { x: 0.5, y: 0.5 });
  assert.equal(imagePoint(150, 441, image), null);
});
