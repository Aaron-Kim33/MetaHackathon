import sharp from 'sharp';
export async function subjectShadow(cutout) {
  const { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).blur(Math.max(0.6, Math.min(12, Math.min(info.width, info.height) * 0.012))).png().toBuffer();
}
