import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildCompositionScene, compositionSvg } from '../src/composition-scene.ts';
import { compose, settings, geometry } from '../server/composition.mjs';
import { subjectShadow } from '../server/subject-shadow.mjs';
import { fixture } from '../server/fixture.mjs';
import { alphaBounds } from '../server/mask.mjs';
import { gesturePhoto, keepPhotoVisible, photoLayout } from '../src/layout.ts';
const nodes = list => list.flatMap(node => [node, ...nodes(node.children || [])]);

test('finishing a drag does not move the committed photo or change tilt and depth', async () => {
  const sample = await fixture(), bounds = await alphaBounds(sample.cutout), initial = settings({ mode: 'frame' });
  for (const dx of [-900, -300, -40, 0, 40, 300, 900]) for (const dy of [-900, -300, -40, 0, 40, 300, 900]) for (const factor of [0.8, 1, 1.4, 2]) {
    const live = gesturePhoto(initial, sample, 360, { dx, dy, factor, anchorX: 180, anchorY: 225 }, bounds);
    const committed = keepPhotoVisible(sample, live, bounds);
    assert.deepEqual(photoLayout(sample, live), photoLayout(sample, committed));
    assert.equal(committed.tilt, initial.tilt); assert.equal(committed.depth, initial.depth);
  }
});

test('moving or resizing the photo never changes phone geometry, tilt, or clipping definitions', () => {
  for (const ratio of ['portrait', 'story', 'square']) {
    const initial = settings({ mode: 'frame', ratio, tilt: -11, depth: 0.8 });
    const content = { source: { width: 800, height: 1200 }, subject: true, shadow: true, stickers: [] };
    const before = buildCompositionScene(content, initial);
    const after = buildCompositionScene(content, { ...initial, x: 0.25, y: -0.3, zoom: 2 });
    assert.deepEqual(before.defs, after.defs);
    const phone = scene => nodes(scene.background).filter(node => node.key.startsWith('phone-'));
    assert.deepEqual(phone(before), phone(after));
    assert.equal(before.background.at(-1).attrs.transform, after.background.at(-1).attrs.transform);
    assert.equal(before.primary[0].attrs.transform, after.primary[0].attrs.transform);
    assert.equal(nodes(after.primary).find(node => node.key === 'subject').attrs.clipPath, 'url(#scene-escape)');
    assert.notDeepEqual(nodes(before.background).find(node => node.key === 'screen-photo').attrs, nodes(after.background).find(node => node.key === 'screen-photo').attrs);
  }
});

test('the same edit before and after server normalization produces identical scene nodes and PNG bytes', async () => {
  const sample = await fixture(), options = settings({ mode: 'frame', x: 0.12, y: -0.2, zoom: 1.7, tilt: -13, depth: 0.7 });
  const content = { source: sample, subject: true, shadow: true, stickers: [] };
  const acknowledged = settings(JSON.parse(JSON.stringify(options)));
  assert.deepEqual(buildCompositionScene(content, options), buildCompositionScene(content, acknowledged));
  const a = await compose({ source: sample.bytes, cutout: sample.cutout, options });
  const b = await compose({ source: sample.bytes, cutout: sample.cutout, options: acknowledged });
  assert.deepEqual(a.bytes, b.bytes); assert.deepEqual(a.primaryBytes, b.primaryBytes);
});

test('the shared foreground clip follows the rounded phone floor without a second rectangular cut', async () => {
  const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const cutout = await sharp(source).ensureAlpha().png().toBuffer();
  const options = settings({ mode: 'frame', x: 0, y: 0, zoom: 1, tilt: 0, depth: 0, shadow: 0 });
  const rendered = await compose({ source, cutout, options }), q = geometry({ width: 100, height: 100 }, options).screen;
  const data = await sharp(rendered.primaryBytes).ensureAlpha().raw().toBuffer();
  const alpha = (x, y) => data[(Math.round(y) * rendered.width + Math.round(x)) * 4 + 3];
  assert.equal(alpha(q.x - 20, q.y + q.height - 50), 255);
  assert.equal(alpha(q.x - 20, q.y + q.height - 20), 0);
  assert.equal(alpha(q.x + 1, q.y + q.height - 1), 0);
  assert.equal(alpha(q.x + q.width / 2, q.y + q.height - 1), 255);
});

test('subject shadows stay on the phone and never change the cutout alpha or cast a dark outside rim', async () => {
  const sample = await fixture(), original = Buffer.from(sample.cutout), shadow = await subjectShadow(sample.cutout);
  assert.deepEqual(sample.cutout, original);
  const options = settings({ mode: 'frame', tilt: 0, depth: 0.8, shadow: 0.8 });
  const scene = buildCompositionScene({ source: sample, subject: true, shadow: true, stickers: [] }, options);
  const primary = scene.primary[0], onlyShadow = { ...scene, primary: [{ ...primary, children: primary.children.filter(node => node.key === 'subject-shadow') }] };
  const xml = compositionSvg(onlyShadow, { shadow: `data:image/png;base64,${shadow.toString('base64')}` }, 'primary');
  const { data, info } = await sharp(Buffer.from(xml)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const q = geometry(sample, options).screen;
  let onPhone = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const alpha = data[(y * info.width + x) * 4 + 3];
    if (x < q.x || x >= q.x + q.width || y < q.y || y >= q.y + q.height) assert.equal(alpha, 0);
    else if (alpha > 0) onPhone++;
  }
  assert.ok(onPhone > 1000);
});
