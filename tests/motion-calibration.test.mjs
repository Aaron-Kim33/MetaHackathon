import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionCalibration, spatialOffset } from '../src/spatial-motion.ts';

test('recenter uses the current tilted pose immediately and subsequent samples keep that origin', () => {
  const motion = new MotionCalibration();
  motion.sample({ beta: 1, gamma: 0 });
  for (let i = 0; i < 30; i++) motion.sample({ beta: 1.2, gamma: .3 });
  assert.ok(motion.sample({ beta: 1.2, gamma: .3 }).x > .8);
  assert.deepEqual(motion.recenter(), { x: 0, y: 0 });
  assert.deepEqual(motion.sample({ beta: 1.2, gamma: .3 }), { x: 0, y: 0 });
  assert.ok(motion.sample({ beta: 1.2, gamma: .4 }).x > 0);
  motion.sample({ beta: NaN, gamma: NaN });
  assert.deepEqual(motion.recenter(), { x: 0, y: 0 });
  assert.deepEqual(motion.sample({ beta: 1.2, gamma: .4 }), { x: 0, y: 0 });
});

test('tilting separates the primary subject from the phone at a visible preview distance', () => {
  const motion = { x: 1, y: .5 }, strength = .7;
  const phone = spatialOffset('scene', motion, strength), subject = spatialOffset('foreground', motion, strength);
  const backdrop = spatialOffset('backdrop', motion, strength);
  assert.ok((subject.x - phone.x) * 360 / 1080 > 12, 'foreground and phone should separate by more than 12 display points on a 360pt preview');
  assert.ok(backdrop.x < 0 && subject.x > phone.x);
  assert.deepEqual(spatialOffset('foreground', { x: 0, y: 0 }, strength), { x: 0, y: 0 });
  assert.deepEqual(spatialOffset('foreground', motion, 0), { x: 0, y: 0 });
});
