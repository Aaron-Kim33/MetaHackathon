import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCompositionPlan } from '../src/native-composition-plan.ts';
import { buildCompositionScene } from '../src/composition-scene.ts';
import { unprojectFrame } from '../src/frame.ts';
import { canAutoLiftPhoto, HoldCutout } from '../src/hold-cutout.ts';
import { settings } from '../server/composition.mjs';

test('a paused drag of an existing subject never starts another segmentation', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let calls = 0;
  for (const id of ['primary', 'extra', null]) {
    if (canAutoLiftPhoto(true, id)) new HoldCutout(() => calls++).start();
    t.mock.timers.tick(2000);
  }
  assert.equal(calls, 0);
  assert.equal(canAutoLiftPhoto(false, 'extra'), false);
  if (canAutoLiftPhoto(false, 'primary')) new HoldCutout(() => calls++).start();
  t.mock.timers.tick(600); assert.equal(calls, 1);
});

test('native image rectangles, clipping and affine projection match the export scene across canvas sizes', () => {
  const source = { width: 1200, height: 1600 };
  for (const ratio of ['portrait', 'story', 'square']) {
    const options = settings({ mode: 'frame', ratio, tilt: -17, depth: .7, x: .17, y: -.21, zoom: 1.35 });
    const plan = nativeCompositionPlan(source, options);
    const scene = buildCompositionScene({ source, subject: true, shadow: true, stickers: [] }, options);
    const photo = scene.background.at(-1).children.find(n => n.key === 'screen-photo').attrs;
    for (const key of ['x', 'y', 'width', 'height']) assert.equal(plan.photo[key], photo[key]);
    const shadow = scene.primary[0].children.find(n => n.key === 'subject-shadow').attrs;
    for (const key of ['x', 'y', 'width', 'height']) assert.equal(plan.shadow[key], shadow[key]);
    assert.equal(plan.escapeTop.height, plan.escapeBottom.y);
    assert.equal(plan.escapeBottom.y + plan.escapeBottom.height, plan.screen.y + plan.screen.height);
    assert.equal(plan.escapeBottom.x, plan.screen.x);
    assert.equal(plan.escapeBottom.width, plan.screen.width);
    const screen = scene.defs[0].children[0].attrs;
    assert.equal(plan.screenClip.radius, screen.rx);
    const [a, b, , , c, d] = plan.matrix;
    for (const point of [{ x: 0, y: 0 }, { x: 450, y: 700 }, { x: plan.width, y: plan.height }]) {
      const x = point.x - plan.width / 2, y = point.y - plan.height / 2;
      const projected = { x: a * x + c * y + plan.width / 2, y: b * x + d * y + plan.height / 2 };
      const restored = unprojectFrame(projected, plan, options);
      assert.ok(Math.abs(restored.x - point.x) < 1e-9 && Math.abs(restored.y - point.y) < 1e-9);
    }
    const moved = nativeCompositionPlan(source, { ...options, x: -.3, y: .25, zoom: 2 });
    assert.deepEqual(moved.matrix, plan.matrix);
    assert.deepEqual(moved.screenClip, plan.screenClip);
    assert.deepEqual(moved.escapeBottom, plan.escapeBottom);
    assert.notDeepEqual(moved.photo, plan.photo);
  }
});
