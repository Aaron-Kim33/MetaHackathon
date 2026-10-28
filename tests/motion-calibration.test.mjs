import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionCalibration } from '../src/spatial-motion.ts';

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
