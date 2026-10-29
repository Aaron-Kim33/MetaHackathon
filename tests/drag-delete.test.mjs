import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { DragDelete, insideTrash } from '../src/drag-delete.ts';
import { canvasTouchFromEvent } from '../src/canvas-touch.ts';
import { compose } from '../server/composition.mjs';
const bounds = { pageX: 120, pageY: 570, width: 72, height: 72 }, center = { x: 156, y: 606 };
test('Android release uses the lifted finger rather than the empty event origin',()=>{
  const release=canvasTouchFromEvent({pageX:0,pageY:0,touches:[],changedTouches:[{identifier:0,pageX:center.x,pageY:center.y}]});
  const drag=new DragDelete('one',{x:100,y:250});drag.move(center,1,bounds);
  assert.equal(drag.release(release,bounds),'one');
});

test('trash hit testing uses the measured page circle and ignores its label and stale/missing layout', () => {
  assert.equal(insideTrash(center, bounds), true);
  assert.equal(insideTrash({ x: 156, y: 642 }, bounds), true);
  assert.equal(insideTrash({ x: 156, y: 650 }, bounds), false);
  assert.equal(insideTrash({ x: 121, y: 571 }, bounds), false);
  assert.equal(insideTrash(center, null), false);
  assert.equal(insideTrash(center, { ...bounds, height: 0 }), false);
});

test('only a deliberate single-finger drag released inside the target deletes, exactly once', () => {
  const tap = new DragDelete('one', center);
  assert.deepEqual(tap.move(center, 1, bounds), { visible: false, over: false });
  assert.equal(tap.release(center, bounds), null);
  const drag = new DragDelete('one', { x: 100, y: 250 });
  assert.deepEqual(drag.move({ x: 110, y: 250 }, 1, bounds), { visible: true, over: false });
  assert.deepEqual(drag.move(center, 1, bounds), { visible: true, over: true });
  assert.equal(drag.release(center, bounds), 'one');
  assert.equal(drag.release(center, bounds), null);
});

test('leaving the target, missing measurements, and cancelled gestures never delete', () => {
  const drag = new DragDelete('one', { x: 100, y: 250 });
  drag.move(center, 1, bounds);
  assert.deepEqual(drag.move({ x: 250, y: 500 }, 1, bounds), { visible: true, over: false });
  assert.equal(drag.release({ x: 250, y: 500 }, bounds), null);
  const cancelled = new DragDelete('one', { x: 100, y: 250 });
  cancelled.move(center, 1, bounds); cancelled.cancel();
  assert.equal(cancelled.release(center, bounds), null);
  const unmeasured = new DragDelete('one', { x: 100, y: 250 });
  unmeasured.move(center, 1, null);
  assert.equal(unmeasured.release(center, null), null);
});

test('pinching disables trash until the entire gesture ends, and background-only gestures cannot delete', () => {
  const pinch = new DragDelete('one', { x: 100, y: 250 });
  assert.deepEqual(pinch.move(center, 2, bounds), { visible: false, over: false });
  assert.deepEqual(pinch.move(center, 1, bounds), { visible: false, over: false });
  assert.equal(pinch.release(center, bounds), null);
  const background = new DragDelete(null, { x: 100, y: 250 });
  assert.deepEqual(background.move(center, 1, bounds), { visible: false, over: false });
  assert.equal(background.release(center, bounds), null);
});

test('deleting the primary cutout leaves the other sticker visible and supports restoring it', async () => {
  const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const cutout = await sharp(source).ensureAlpha().png().toBuffer();
  const sticker = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#0000ff' } }).png().toBuffer();
  const id = '11111111-1111-4111-8111-111111111111';
  const args = { source, cutout, stickers: [{ id, bytes: sticker, width: 20, height: 20 }], options: { mode: 'plain', background: '#ffffff', stickerTransforms: [{ id, x: 0.8, y: 0.8, scale: 0.2 }] } };
  const hidden = await compose({ ...args, options: { ...args.options, hidePrimary: true } });
  const a = await sharp(hidden.bytes).raw().toBuffer();
  const pixel = (data, x, y) => [...data.subarray((y * 1080 + x) * 4, (y * 1080 + x) * 4 + 4)];
  assert.deepEqual(pixel(a, 540, 675), [255, 255, 255, 255]);
  assert.deepEqual(pixel(a, 864, 1080), [0, 0, 255, 255]);
  const restored = await compose(args);
  assert.deepEqual(pixel(await sharp(restored.bytes).raw().toBuffer(), 540, 675), [255, 0, 0, 255]);
});

test('deleting a popout photo removes both its screen copy and foreground from the exported image', async () => {
  const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const cutout = await sharp(source).ensureAlpha().png().toBuffer();
  const sticker = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#0000ff' } }).png().toBuffer();
  const id = '11111111-1111-4111-8111-111111111111';
  const args = { source, cutout, stickers: [{ id, bytes: sticker, width: 20, height: 20 }], options: { mode: 'frame', background: '#ffffff', stickerTransforms: [{ id, x: .8, y: .8, scale: .2 }] } };
  const hidden = await compose({ ...args, options: { ...args.options, hidePrimary: true } });
  const visible = await compose(args);
  const countRed = async bytes => {
    const data = await sharp(bytes).ensureAlpha().raw().toBuffer(); let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 240 && data[i + 1] < 10 && data[i + 2] < 10 && data[i + 3] > 240) count++;
    return count;
  };
  assert.equal(await countRed(hidden.bytes), 0, 'original photo cannot remain inside the phone after deletion');
  assert.ok(await countRed(visible.bytes) > 10000, 'undoing deletion restores the actual photo');
  const pixels = await sharp(hidden.bytes).ensureAlpha().raw().toBuffer();
  const at = (1080 * 1080 + 864) * 4;
  assert.deepEqual([...pixels.subarray(at, at + 4)], [0, 0, 255, 255], 'independent sticker remains visible');
});
