import test from 'node:test';
import assert from 'node:assert/strict';
import { containedImage, imagePoint, pageImagePoint, gesturePhoto, photoLayout } from '../src/layout.ts';
import { MeasuredBrush } from '../src/brush.ts';

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

test('touch mapping uses measured page bounds after scrolling, not child-local touch positions', () => {
  const source = { width: 800, height: 1200 };
  const normal = pageImagePoint(170, 500, { pageX: 20, pageY: 280, width: 300, height: 440 }, source);
  const scrolled = pageImagePoint(170, 340, { pageX: 20, pageY: 120, width: 300, height: 440 }, source);
  assert.ok(Math.abs(normal.x - 0.5) < 1e-12 && Math.abs(normal.y - 0.5) < 1e-12);
  assert.deepEqual(scrolled, normal);
  assert.equal(pageImagePoint(20, 500, { pageX: 20, pageY: 280, width: 300, height: 440 }, source), null);
  assert.equal(pageImagePoint(NaN, 500, { pageX: 20, pageY: 280, width: 300, height: 440 }, source), null);
});

test('a quick tap remains at the touched pixel when native measurement returns after finger release', () => {
  const path = new MeasuredBrush('erase', 0.025, { width: 800, height: 1200 });
  path.push(170, 500);
  path.end();
  assert.deepEqual(path.snapshot().points, []);
  path.locate({ pageX: 20, pageY: 280, width: 300, height: 440 });
  const [point] = path.snapshot().points;
  assert.ok(Math.abs(point.x - 0.5) < 1e-12 && Math.abs(point.y - 0.5) < 1e-12);
  assert.equal(path.push(180, 500), false);
});

test('queued brush motion keeps its measured origin and ignores the image margins', () => {
  const path = new MeasuredBrush('restore', 0.01, { width: 100, height: 1000 });
  path.push(10, 210); // Left margin, outside the narrow displayed image.
  path.push(160, 210);
  path.push(160, 430);
  path.locate({ pageX: 10, pageY: 210, width: 300, height: 440 });
  assert.deepEqual(path.snapshot().points, [{ x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }]);
  assert.ok(path.push(160, 650));
  assert.deepEqual(path.snapshot().points.at(-1), { x: 0.5, y: 1 });
});
