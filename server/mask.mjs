import sharp from 'sharp';
import { insist } from './errors.mjs';
export async function makeHitMask(bytes) {
  const width = 64, height = 64;
  const alpha = await sharp(bytes).ensureAlpha().extractChannel('alpha').resize(width, height, { fit: 'fill' }).raw().toBuffer();
  const bits = Buffer.alloc(width * height / 8);
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > 8) bits[Math.floor(i / 8)] |= 1 << (i % 8);
  return { width, height, bits: bits.toString('hex') };
}
export async function alphaBounds(cutout) {
  const { data, info } = await sharp(cutout).extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] > 0) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < left ? { x: 0, y: 0, width: 0, height: 0 } : { x: left / info.width, y: top / info.height, width: (right - left + 1) / info.width, height: (bottom - top + 1) / info.height };
}

export async function trimSticker(source, cutout) {
  const { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 0) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  insist(right >= left && bottom >= top, '남길 피사체가 비어 있어요.');
  const rect = { left, top, width: right - left + 1, height: bottom - top + 1 };
  return { bytes: await sharp(cutout).extract(rect).png().toBuffer(), source: await sharp(source).extract(rect).png().toBuffer(), width: rect.width, height: rect.height };
}

export async function contourCutout(source, points) {
  insist(Array.isArray(points) && points.length >= 3 && points.length <= 2000, '테두리를 한 바퀴 그려 주세요.');
  for (const p of points) insist(p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, '사진 안에서 테두리를 그려 주세요.');
  const area = Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
  insist(area >= 0.0001, '테두리 안에 남길 영역이 있어야 해요.');
  const { width, height } = await sharp(source).metadata();
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><polygon points="${points.map(p => `${p.x * width},${p.y * height}`).join(' ')}" fill="white" fill-rule="evenodd"/></svg>`);
  const alpha = await sharp({ create: { width, height, channels: 3, background: '#000' } }).composite([{ input: mask }]).greyscale().raw().toBuffer();
  const rgb = await sharp(source).removeAlpha().png().toBuffer();
  return sharp(rgb).joinChannel(alpha, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

// Erasing foreground pixels must not reveal the unedited duplicate in the phone.
export async function photoWithMaskEdits(source, original, edited) {
  const { width, height } = await sharp(source).metadata();
  const before = await sharp(original).extractChannel('alpha').raw().toBuffer();
  const after = await sharp(edited).extractChannel('alpha').raw().toBuffer();
  insist(before.length === width * height && after.length === before.length, '보정 사진의 크기가 맞지 않아요.');
  const alpha = Buffer.alloc(before.length);
  for (let i = 0; i < alpha.length; i++) alpha[i] = 255 - Math.max(0, before[i] - after[i]);
  const rgb = await sharp(source).removeAlpha().png().toBuffer();
  return sharp(rgb).joinChannel(alpha, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

export function validateStrokes(strokes) {
  insist(Array.isArray(strokes) && strokes.length > 0 && strokes.length <= 32, '보정할 획은 한 번에 1~32개까지 가능해요.');
  let count = 0;
  for (const stroke of strokes) {
    insist(stroke && ['erase', 'restore'].includes(stroke.mode) && Number.isFinite(stroke.radius) && stroke.radius >= 0.003 && stroke.radius <= 0.12, '브러시 설정을 확인해 주세요.');
    insist(Array.isArray(stroke.points) && stroke.points.length > 0, '브러시 위치가 비어 있어요.');
    count += stroke.points.length;
    insist(count <= 2400, '보정 획이 너무 길어요. 먼저 적용한 뒤 계속해 주세요.');
    for (const point of stroke.points) insist(point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1, '사진 안에서 보정해 주세요.');
  }
  return strokes;
}

export async function refineMask(source, cutout, input) {
  const strokes = validateStrokes(input);
  const metadata = await sharp(source).metadata(), maskMetadata = await sharp(cutout).metadata();
  const { width, height } = metadata;
  insist(width === maskMetadata.width && height === maskMetadata.height && maskMetadata.hasAlpha, '원본과 누끼 크기가 맞지 않아요.');
  const drawing = strokes.map(stroke => {
    const radius = stroke.radius * Math.min(width, height), color = stroke.mode === 'erase' ? 'black' : 'white';
    const points = stroke.points.map(point => [point.x * width, point.y * height]);
    if (points.length === 1) return `<circle cx="${points[0][0]}" cy="${points[0][1]}" r="${radius}" fill="${color}"/>`;
    return `<path d="${points.map((point, i) => `${i ? 'L' : 'M'}${point.join(' ')}`).join(' ')}" stroke="${color}" stroke-width="${radius * 2}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  }).join('');
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${drawing}</svg>`);
  const alphaImage = await sharp(cutout).extractChannel('alpha').png().toBuffer();
  const alpha = await sharp(alphaImage).toColourspace('srgb').composite([{ input: overlay }]).greyscale().raw().toBuffer();
  const rgb = await sharp(source).removeAlpha().png().toBuffer();
  return sharp(rgb).joinChannel(alpha, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

// Device APIs return a full-resolution grayscale confidence mask, never replacement RGB.
export async function deviceMaskCutout(source, bytes) {
  const a = await sharp(source).metadata(), b = await sharp(bytes, { limitInputPixels: 1600 * 1600 }).metadata();
  insist(b.format === 'png' && b.width === a.width && b.height === a.height, '자동 누끼 크기가 원본 사진과 달라요. 다시 시도해 주세요.');
  const alpha = await sharp(bytes).removeAlpha().greyscale().raw().toBuffer();
  if (a.hasAlpha) {
    const original = await sharp(source).extractChannel('alpha').raw().toBuffer();
    for (let i = 0; i < alpha.length; i++) alpha[i] = Math.round(alpha[i] * original[i] / 255);
  }
  insist(alpha.some(value => value > 8), '사진에서 피사체를 찾지 못했어요.');
  const rgb = await sharp(source).removeAlpha().png().toBuffer();
  return sharp(rgb).joinChannel(alpha, { raw: { width: a.width, height: a.height, channels: 1 } }).png().toBuffer();
}
