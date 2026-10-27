import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { compose, geometry, cutoutFromRaster, normalisePhoto } from '../server/composition.mjs';
import { fixture } from '../server/fixture.mjs';

test('sticker mode has transparent output and moving it leaves no original copy behind', async () => {
  const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const { contourCutout } = await import('../server/mask.mjs');
  const cutout = await contourCutout(source, [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }]);
  const options = { mode: 'sticker', zoom: 1, x: 0.3, y: 0, shadow: 0.8 };
  const rendered = await compose({ source, cutout, options });
  const pixels = await sharp(rendered.bytes).raw().toBuffer();
  const alpha = (x, y) => pixels[(y * rendered.width + x) * 4 + 3];
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(540, 675), 0, 'old centered copy must not remain');
  const g = geometry({ width: 100, height: 100 }, options);
  assert.equal(alpha(g.photo.x + Math.round(g.photo.width / 2), g.photo.y + Math.round(g.photo.height / 2)), 255);
});

test('source and subject remain aligned in all output ratios and negative crop positions', async () => {
  const sample = await fixture();
  for (const ratio of ['portrait', 'square', 'story']) {
    const options = { ratio, shadow: 0, x: -0.15, y: -0.05, zoom: 1.4 };
    const base = await compose({ source: sample.bytes, options });
    const result = await compose({ source: sample.bytes, cutout: sample.cutout, options });
    const g = geometry(sample, options), region = { left: g.screen.x + 60, top: g.screen.y + 60, width: g.screen.width - 120, height: g.screen.height - 120 };
    const a = await sharp(base.bytes).extract(region).raw().toBuffer();
    const b = await sharp(result.bytes).extract(region).raw().toBuffer();
    const alpha = await sharp(sample.cutout).extractChannel('alpha').resize(g.photo.width, g.photo.height).raw().toBuffer();
    let checked = 0, maxDifference = 0;
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
      const sx = x + region.left - g.photo.x, sy = y + region.top - g.photo.y;
      if (sx < 3 || sy < 3 || sx >= g.photo.width - 3 || sy >= g.photo.height - 3) continue;
      // Compare opaque interiors, excluding the interpolation kernel at translucent edges.
      let solid = true;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (alpha[(sy + dy) * g.photo.width + sx + dx] < 255) solid = false;
      if (!solid) continue;
      checked++;
      const offset = (y * region.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) maxDifference = Math.max(maxDifference, Math.abs(a[offset + channel] - b[offset + channel]));
    }
    assert.ok(checked > 1000, 'fixture must cover enough opaque subject pixels');
    assert.ok(maxDifference <= 2, `unexpected displacement in ${ratio}: max ${maxDifference}`);
    const m = await sharp(result.bytes).metadata(); assert.equal(m.width, 1080); assert.equal(m.height, result.height);
  }
});

test('SAM box-local raster becomes source-sized alpha without losing origin', async () => {
  const source = await sharp({ create: { width: 10, height: 8, channels: 3, background: '#e04050' } }).png().toBuffer();
  const result = await cutoutFromRaster(source, Uint8Array.from([1, 0, 0, 1]), { left: 3, top: 2, right: 5, bottom: 4 }, 2, 2);
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  const alpha = (x, y) => data[(y * 10 + x) * 4 + 3];
  assert.equal(alpha(3, 2), 255); assert.equal(alpha(4, 2), 0); assert.equal(alpha(4, 3), 255); assert.equal(alpha(0, 0), 0);
  await assert.rejects(cutoutFromRaster(source, Uint8Array.from([0]), { left: 0, top: 0, right: 1, bottom: 1 }, 1, 1), /비어/);
});

test('invalid numeric settings and mismatched cutouts are rejected before composing', async () => {
  const sample = await fixture();
  await assert.rejects(compose({ source: sample.bytes, options: { zoom: NaN } }), /허용 범위/);
  const wrong = await sharp(sample.cutout).resize(20, 20).png().toBuffer();
  await assert.rejects(compose({ source: sample.bytes, cutout: wrong }), /좌표/);
});

test('orientation is normalised before dimensions are used for prompts', async () => {
  const source = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#fff' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const image = await normalisePhoto(source);
  assert.equal(image.width, 20); assert.equal(image.height, 40);
  assert.equal((await sharp(image.bytes).metadata()).orientation, undefined);
});
