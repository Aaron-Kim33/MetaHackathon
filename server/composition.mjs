import sharp from 'sharp';
import { buildCompositionScene, compositionSvg } from '../src/composition-scene.ts';
import { PHOTO_FRAME_PRESET, legacyDefaultFrame } from '../src/frame-preset.ts';
import { subjectShadow } from './subject-shadow.mjs';
import { insist } from './errors.mjs';
import { orderedLayers } from '../src/layer-order.ts';
import { photoLayout } from '../src/layout.ts';

export const DEFAULTS = Object.freeze({ ratio: 'portrait', ...PHOTO_FRAME_PRESET, backgroundZoom: 1, backgroundX: 0.5, backgroundY: 0.5, backgroundDim: 0.04, background: '#EEE8DF', decorationDepth: 'front', decorationX: 0.76, decorationY: 0.35, decorationScale: 0.26 });

export function settings(value = {}) {
  insist(value && typeof value === 'object' && !Array.isArray(value), '편집 설정이 올바르지 않아요.');
  const result = { mode: 'frame', spatialEnabled: false, spatialStrength: 0.7, ...DEFAULTS };
  result.spatialEnabled = value.spatialEnabled ?? false;
  result.spatialStrength = value.spatialStrength ?? 0.7;
  insist(typeof result.spatialEnabled === 'boolean' && Number.isFinite(result.spatialStrength) && result.spatialStrength >= 0 && result.spatialStrength <= 1, '입체 미리보기 설정을 확인해 주세요.');
  if (Object.hasOwn(value, 'mode')) result.mode = value.mode;
  insist(['plain', 'frame', 'sticker'].includes(result.mode), '편집 모드를 확인해 주세요.');
  result.hidePrimary = value.hidePrimary ?? false;
  insist(typeof result.hidePrimary === 'boolean', '기본 피사체 표시 설정을 확인해 주세요.');
  result.stickerTransforms = value.stickerTransforms || [];
  insist(Array.isArray(result.stickerTransforms) && result.stickerTransforms.length <= 16, '스티커는 최대 16개까지 가능해요.');
  const ids = new Set();
  for (const t of result.stickerTransforms) {
    insist(t && typeof t.id === 'string' && /^[a-f0-9-]{36}$/i.test(t.id) && !ids.has(t.id), '스티커 ID를 확인해 주세요.');
    ids.add(t.id);
    insist([t.x, t.y, t.scale].every(Number.isFinite) && t.x >= -0.3 && t.x <= 1.3 && t.y >= -0.3 && t.y <= 1.3 && t.scale >= 0.08 && t.scale <= 2.5, '스티커 위치·크기를 확인해 주세요.');
  }
  for (const name of Object.keys(DEFAULTS)) if (Object.hasOwn(value, name)) result[name] = value[name];
  if (value.mode === 'frame' && value.frameScale === undefined && value.zoom !== undefined) {
    if (legacyDefaultFrame(value)) Object.assign(result, PHOTO_FRAME_PRESET);
    else Object.assign(result, { frameScale: 1, frameX: 0, frameY: 0 });
  }
  insist(value.layerOrder === undefined || (Array.isArray(value.layerOrder) && value.layerOrder.length <= 17 && value.layerOrder.every(id => typeof id === 'string')), '레이어 순서를 확인해 주세요.');
  result.layerOrder = orderedLayers({ ...result, layerOrder: value.layerOrder });
  insist(['portrait', 'story', 'square'].includes(result.ratio), '지원하지 않는 비율이에요.');
  insist(/^#[0-9a-f]{6}$/i.test(result.background), '배경 색상을 확인해 주세요.');
  insist(['front', 'back'].includes(result.decorationDepth), '장식 순서를 확인해 주세요.');
  for (const [name, min, max] of [['zoom', 0.8, 2.4], ['x', -0.8, 0.8], ['y', -0.8, 0.8], ['shadow', 0, 0.8], ['tilt', -18, 18], ['depth', 0, 1], ['frameScale', 0.7, 1.5], ['frameX', -0.35, 0.35], ['frameY', -0.25, 0.25], ['backgroundZoom', 1, 3], ['backgroundX', 0, 1], ['backgroundY', 0, 1], ['backgroundDim', 0, 0.5], ['decorationX', 0, 1], ['decorationY', 0, 1], ['decorationScale', 0.08, 0.65]]) {
    insist(Number.isFinite(result[name]) && result[name] >= min && result[name] <= max, `${name} 값이 허용 범위를 벗어났어요.`);
  }
  return result;
}

export function geometry(source, options) {
  const s = settings(options);
  insist(source.width > 0 && source.height > 0, '사진 크기가 올바르지 않아요.');
  return photoLayout(source, s);
}

export async function normalisePhoto(bytes) {
  const result = await sharp(bytes, { limitInputPixels: 40000000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).removeAlpha().png().toBuffer({ resolveWithObject: true });
  return { bytes: result.data, width: result.info.width, height: result.info.height };
}

export async function compose({ source, cutout, decoration, stickers = [], options, shadow, backgroundPhoto }) {
  const s = settings(options), dimensions = await sharp(source).metadata();
  if (cutout) { const m = await sharp(cutout).metadata(); insist(m.width === dimensions.width && m.height === dimensions.height && m.hasAlpha, '피사체와 원본 사진의 좌표가 맞지 않아요.'); }
  const shadowBytes = cutout ? shadow || await subjectShadow(cutout) : null;
  const decorationMeta = decoration ? await sharp(decoration).metadata() : null;
  const scene = buildCompositionScene({ source: dimensions, subject: !!cutout, shadow: !!shadowBytes, decoration: decorationMeta, backdrop: backgroundPhoto, stickers }, s);
  const dataUri = bytes => `data:image/png;base64,${bytes.toString('base64')}`;
  const assets = { source: dataUri(source) };
  if (cutout) assets.subject = dataUri(cutout);
  if (shadowBytes) assets.shadow = dataUri(shadowBytes);
  if (backgroundPhoto) assets.background = dataUri(backgroundPhoto.bytes);
  if (decoration) assets.decoration = dataUri(decoration);
  for (const sticker of stickers) assets[`sticker:${sticker.id}`] = dataUri(sticker.bytes);
  const raster = part => sharp(Buffer.from(compositionSvg(scene, assets, part))).png().toBuffer();
  const [bytes, baseBytes, primaryBytes] = await Promise.all([raster('all'), raster('background'), raster('primary')]);
  return { bytes, baseBytes, primaryBytes, width: scene.width, height: scene.height, options: s, geometry: photoLayout(dimensions, s) };
}

export async function cutoutFromRaster(source, raster, box, maskWidth, maskHeight) {
  const m = await sharp(source).metadata();
  const [left, top, right, bottom] = [box.left, box.top, box.right, box.bottom];
  insist([left, top, right, bottom, maskWidth, maskHeight].every(Number.isInteger) && left >= 0 && top >= 0 && right <= m.width && bottom <= m.height && right > left && bottom > top, 'SAM 박스 좌표가 원본과 맞지 않아요.', 502);
  insist(maskWidth > 0 && maskHeight > 0 && raster.length === maskWidth * maskHeight && raster.some(v => v > 0), 'SAM 마스크가 비어 있거나 손상됐어요.', 502);
  const alpha = Buffer.from(Uint8Array.from(raster, value => value ? 255 : 0));
  const patch = await sharp(alpha, { raw: { width: maskWidth, height: maskHeight, channels: 1 } }).resize(right - left, bottom - top, { kernel: 'nearest' }).png().toBuffer();
  const mask = await sharp({ create: { width: m.width, height: m.height, channels: 3, background: '#000000' } }).composite([{ input: patch, left, top }]).greyscale().raw().toBuffer();
  const rgb = await sharp(source).removeAlpha().png().toBuffer();
  return sharp(rgb).joinChannel(mask, { raw: { width: m.width, height: m.height, channels: 1 } }).png().toBuffer();
}
