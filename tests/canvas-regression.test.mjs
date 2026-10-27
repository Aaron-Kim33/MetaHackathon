import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { MeasuredCanvasTouch } from '../src/canvas-touch.ts';
import { hitLayer, opaqueHit } from '../src/hit-testing.ts';
import { makeHitMask } from '../server/mask.mjs';
import { gestureSticker, keepPhotoVisible, photoLayout, projectedPhotoRect, stickerRect } from '../src/layout.ts';
import { recoverScene } from '../src/viewport.ts';
import { moveLayer } from '../src/edit-performance.ts';

test('a quick tap selects using measured page coordinates even when measurement completes after release', () => {
  const events = [];
  const session = new MeasuredCanvasTouch({ x: 145, y: 390, count: 1, distance: 0 }, (kind, touch) => events.push({ kind, touch }));
  session.end({ x: 145, y: 390, count: 0, distance: 0 });
  assert.equal(events.length, 0);
  session.locate({ pageX: 25, pageY: 210, width: 320, height: 400 });
  assert.deepEqual(events.map(item => item.kind), ['start', 'end']);
  assert.equal(events[0].touch.localX, 120); assert.equal(events[0].touch.localY, 180); assert.equal(events[0].touch.displayWidth, 320);
});

test('queued drag coordinates use one native origin and cancelled gestures cannot resurrect selection', () => {
  const events = [], start = { x: 100, y: 200, count: 1, distance: 0 };
  const session = new MeasuredCanvasTouch(start, (kind, touch) => events.push({ kind, touch }));
  session.move({ ...start, x: 180, y: 250 });
  session.locate({ pageX: 20, pageY: 100, width: 300, height: 500 });
  session.move({ ...start, x: 210, y: 280 }); session.end({ ...start, x: 210, y: 280, count: 0 });
  assert.deepEqual(events.map(item => [item.kind, item.touch.localX, item.touch.localY]), [['start', 80, 100], ['move', 160, 150], ['move', 190, 180], ['end', 190, 180]]);
  const cancelled = new MeasuredCanvasTouch(start, () => assert.fail('cancelled selection must stay cancelled'));
  cancelled.cancel(); cancelled.locate({ pageX: 0, pageY: 0, width: 300, height: 500 }); cancelled.end(start);
});

test('transparent sticker regions select the visible layer below and promoted root layers win overlaps', async () => {
  const opaque = await sharp({ create: { width: 32, height: 64, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#00000000' } }).composite([{ input: opaque, left: 0, top: 0 }]).png().toBuffer();
  const mask = await makeHitMask(png);
  assert.equal(opaqueHit(mask, 0.2, 0.5), true); assert.equal(opaqueHit(mask, 0.8, 0.5), false);
  const id = '11111111-1111-4111-8111-111111111111';
  const options = { mode: 'plain', ratio: 'portrait', zoom: 1, x: 0, y: 0, hidePrimary: false, stickerTransforms: [{ id, x: 0.5, y: 0.5, scale: 0.5 }] };
  const view = { project: { width: 100, height: 100 }, stickers: [{ id, width: 64, height: 64, hitMask: mask }], options };
  const g = photoLayout(view.project, options), r = stickerRect(view.stickers[0], options.stickerTransforms[0], g);
  const at = u => ({ x: (r.x + r.width * u) / 3, y: (r.y + r.height * 0.5) / 3 });
  assert.equal(hitLayer(view, options, at(0.2), 360), id);
  assert.equal(hitLayer(view, options, { x: r.x / 3 - 3, y: (r.y + r.height / 2) / 3 }, 360), id, 'thin opaque sticker edges allow a small touch margin');
  assert.equal(hitLayer(view, options, at(0.8), 360), 'primary');
  const behind = moveLayer(options, id, 'back');
  assert.equal(hitLayer(view, behind, at(0.2), 360), 'primary');
  assert.equal(hitLayer(view, options, { x: 0, y: 0 }, 360), null, 'empty canvas is not an implicit primary selection');
});

test('extreme sticker drags retain a touchable part on every canvas edge', () => {
  const canvas = { width: 1080, height: 1350 }, source = { width: 40, height: 500 };
  for (const [dx, dy] of [[100000, 100000], [-100000, -100000], [100000, -100000], [-100000, 100000]]) {
    const moved = gestureSticker({ id: 'tiny', x: 0.5, y: 0.5, scale: 0.2 }, source, canvas, 360, { dx, dy, factor: 1, anchorX: 180, anchorY: 225 });
    const r = stickerRect(source, moved, canvas);
    const visibleWidth = Math.min(canvas.width, r.x + r.width) - Math.max(0, r.x), visibleHeight = Math.min(canvas.height, r.y + r.height) - Math.max(0, r.y);
    assert.ok(visibleWidth >= Math.min(140, r.width) - 2); assert.ok(visibleHeight >= Math.min(140, r.height) - 2);
  }
});

test('primary movement limits use the actual subject bounds rather than the original photo padding', () => {
  const source = { width: 800, height: 1200 }, options = { mode: 'plain', ratio: 'portrait', zoom: 2.4, x: 0.8, y: 0.8 };
  const bounds = { x: 0.8, y: 0.1, width: 0.1, height: 0.2 };
  const next = keepPhotoVisible(source, options, bounds), r = projectedPhotoRect(source, next, bounds), g = photoLayout(source, next);
  assert.ok(Math.min(g.width, r.x + r.width) - Math.max(0, r.x) >= Math.min(140, r.width) - 2);
  assert.ok(Math.min(g.height, r.y + r.height) - Math.max(0, r.y) >= Math.min(140, r.height) - 2);
});

test('recovery recenters old offscreen stickers while preserving visible layers and deleted primary state', () => {
  const source = { id: 'lost', width: 100, height: 100 }, stay = { id: 'stay', width: 100, height: 100 };
  const options = { mode: 'plain', ratio: 'portrait', zoom: 1, x: 0, y: 0, hidePrimary: true, stickerTransforms: [{ id: 'lost', x: 1.3, y: 1.3, scale: 0.1 }, { id: 'stay', x: 0.3, y: 0.4, scale: 0.2 }] };
  const next = recoverScene(options, { project: { width: 100, height: 100 }, stickers: [source, stay] });
  assert.equal(next.stickerTransforms[0].x, 0.5); assert.equal(next.stickerTransforms[0].y, 0.5);
  assert.deepEqual(next.stickerTransforms[1], options.stickerTransforms[1]); assert.equal(next.hidePrimary, true);
});
