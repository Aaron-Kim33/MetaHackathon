import { toQR } from 'toqr';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function saveQR(url, file) {
  const matrix = toQR(url), size = Math.sqrt(matrix.length), extent = size + 8;
  const modules = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (matrix[y * size + x]) modules.push(`<rect x="${x + 4}" y="${y + 4}" width="1" height="1"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${extent * 10}" height="${extent * 10}" viewBox="0 0 ${extent} ${extent}"><rect width="${extent}" height="${extent}" fill="white"/><g fill="#171e2b">${modules.join('')}</g></svg>`;
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(file);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]?.startsWith('exp://')) throw new Error('Expo Go URL이 필요합니다.');
  await saveQR(process.argv[2], '.local/expo-qr.png');
  console.log('QR saved to .local/expo-qr.png');
}
