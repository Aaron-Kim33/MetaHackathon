import sharp from 'sharp';
import { insist } from './errors.mjs';
import { photoLayout } from '../src/layout.ts';

export const DEFAULTS = Object.freeze({ ratio: 'portrait', zoom: 1.25, x: 0, y: -0.10, shadow: 0.3, background: '#EEE8DF', decorationDepth: 'front', decorationX: 0.76, decorationY: 0.35, decorationScale: 0.26 });

export function settings(value = {}) {
  insist(value && typeof value === 'object' && !Array.isArray(value), '편집 설정이 올바르지 않아요.');
  const result = { mode: 'frame', ...DEFAULTS };
  if (Object.hasOwn(value, 'mode')) result.mode = value.mode;
  insist(['frame', 'sticker'].includes(result.mode), '편집 모드를 확인해 주세요.');
  for (const name of Object.keys(DEFAULTS)) if (Object.hasOwn(value, name)) result[name] = value[name];
  insist(['portrait', 'story', 'square'].includes(result.ratio), '지원하지 않는 비율이에요.');
  insist(/^#[0-9a-f]{6}$/i.test(result.background), '배경 색상을 확인해 주세요.');
  insist(['front', 'back'].includes(result.decorationDepth), '장식 순서를 확인해 주세요.');
  for (const [name, min, max] of [['zoom', 0.8, 2.4], ['x', -0.8, 0.8], ['y', -0.8, 0.8], ['shadow', 0, 0.8], ['decorationX', 0, 1], ['decorationY', 0, 1], ['decorationScale', 0.08, 0.65]]) {
    insist(Number.isFinite(result[name]) && result[name] >= min && result[name] <= max, `${name} 값이 허용 범위를 벗어났어요.`);
  }
  return result;
}

export function geometry(source, options) {
  const s = settings(options);
  insist(source.width > 0 && source.height > 0, '사진 크기가 올바르지 않아요.');
  return photoLayout(source, s);
}

const svg = (width, height, content) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${content}</svg>`);
const canvas = (width, height, background = '#00000000') => sharp({ create: { width, height, channels: 4, background } });

export async function normalisePhoto(bytes) {
  const result = await sharp(bytes, { limitInputPixels: 40000000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).removeAlpha().png().toBuffer({ resolveWithObject: true });
  return { bytes: result.data, width: result.info.width, height: result.info.height };
}

// Both photo and subject use this exact transform; negative offsets are clipped explicitly.
async function place(bytes, rect, width, height) {
  const left = Math.max(0, rect.x), top = Math.max(0, rect.y);
  const right = Math.min(width, rect.x + rect.width), bottom = Math.min(height, rect.y + rect.height);
  if (right <= left || bottom <= top) return canvas(width, height).png().toBuffer();
  const image = await sharp(bytes).resize(rect.width, rect.height, { fit: 'fill' }).extract({ left: left - rect.x, top: top - rect.y, width: right - left, height: bottom - top }).png().toBuffer();
  return canvas(width, height).composite([{ input: image, left, top }]).png().toBuffer();
}

export async function compose({ source, cutout, decoration, options }) {
  const s = settings(options), dimensions = await sharp(source).metadata();
  const g = geometry(dimensions, s), { width, height, screen: q, photo } = g;
  const screenMask = svg(width, height, `<rect x="${q.x}" y="${q.y}" width="${q.width}" height="${q.height}" rx="30" fill="white"/>`);
  const phone = svg(width, height, `<defs><filter id="s" x="-30%" y="-20%" width="160%" height="150%"><feGaussianBlur stdDeviation="19"/></filter></defs><rect x="${q.x - 12}" y="${q.y + 6}" width="${q.width + 24}" height="${q.height + 36}" rx="48" fill="#0d1725" opacity=".18" filter="url(#s)"/><rect x="${q.x - 15}" y="${q.y - 15}" width="${q.width + 30}" height="${q.height + 30}" rx="46" fill="#171e2b"/><rect x="${q.x - 8}" y="${q.y - 8}" width="${q.width + 16}" height="${q.height + 16}" rx="39" fill="none" stroke="#58606e" stroke-width="2"/>`);
  const photoLayer = await place(source, photo, width, height);
  const inside = await sharp(photoLayer).composite([{ input: screenMask, blend: 'dest-in' }]).png().toBuffer();
  const layers = s.mode === 'sticker' ? [] : [{ input: phone }, { input: inside }];
  let adornment;
  if (decoration) {
    const m = await sharp(decoration).metadata(), dw = Math.round(width * s.decorationScale), dh = Math.round(dw * m.height / m.width);
    adornment = await place(decoration, { x: Math.round(s.decorationX * width - dw / 2), y: Math.round(s.decorationY * height - dh / 2), width: dw, height: dh }, width, height);
    if (s.decorationDepth === 'back') layers.push({ input: adornment });
  }
  if (cutout) {
    const m = await sharp(cutout).metadata();
    insist(m.width === dimensions.width && m.height === dimensions.height && m.hasAlpha, '피사체와 원본 사진의 좌표가 맞지 않아요.');
    const subject = await place(cutout, photo, width, height);
    // The lower edge remains inside the rounded screen; the top and sides can escape.
    const escapeMask = svg(width, height, `<rect width="${width}" height="${q.y}" fill="white"/><rect x="0" y="${q.y}" width="${width}" height="${q.height - 40}" fill="white"/><rect x="${q.x}" y="${q.y}" width="${q.width}" height="${q.height}" rx="30" fill="white"/>`);
    const foreground = s.mode === 'sticker' ? subject : await sharp(subject).composite([{ input: escapeMask, blend: 'dest-in' }]).png().toBuffer();
    if (s.shadow > 0 && s.mode !== 'sticker') {
      const { data } = await sharp(foreground).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 4) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = Math.round(data[i + 3] * s.shadow); }
      const shadow = await sharp(data, { raw: { width, height, channels: 4 } }).blur(10).png().toBuffer();
      const shifted = await place(shadow, { x: 8, y: 12, width, height }, width, height);
      // A subject casts a shadow onto the phone, not across its own face.
      layers.push({ input: shifted }, { input: foreground });
    } else layers.push({ input: foreground });
  }
  if (adornment && s.decorationDepth === 'front') layers.push({ input: adornment });
  const bytes = await canvas(width, height, s.mode === 'sticker' ? '#00000000' : s.background).composite(layers).png().toBuffer();
  return { bytes, width, height, options: s, geometry: g };
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
