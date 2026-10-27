import sharp from 'sharp';
import { insist } from './errors.mjs';

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
