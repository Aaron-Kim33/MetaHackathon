// Offline verification of the same perspective projection used by the GL shader.
// This produces a renderer comparison artifact, not an Android screen recording.
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { depthMesh, surfaceMesh, depthCamera, projectDepthPoint } from '../src/depth-mesh.ts';
const frame = JSON.parse(await readFile(process.argv[2] || '.local/depth-qa/frame.json', 'utf8'));
const folder = process.argv[3] || '.local/depth-qa/projection'; await mkdir(folder, { recursive: true });
const width = 360, height = Math.round(width * frame.height / frame.width), aspect = frame.width / frame.height;
const parts = [];
if (frame.layers) {
  for (const layer of frame.layers) {
    const pixels = await sharp(Buffer.from(layer.image, 'base64')).ensureAlpha().raw().toBuffer();
    parts.push({ ...surfaceMesh(layer), pixels, iw: layer.width, ih: layer.height });
  }
} else {
  const pixels = await sharp(Buffer.from(frame.image, 'base64')).ensureAlpha().raw().toBuffer();
  const mesh = depthMesh(frame);
  for (const item of [mesh, ...mesh.edges]) parts.push({ ...item, pixels, iw: frame.width, ih: frame.height });
}
const back = frame.farImage ? await sharp(Buffer.from(frame.farImage, 'base64')).resize(width, height).ensureAlpha().raw().toBuffer() : Buffer.alloc(width * height * 4, 238);
for (let index = 0; index < 48; index++) {
  const phase = index / 48 * Math.PI * 2;
  const camera = depthCamera({ x: Math.sin(phase), y: Math.cos(phase) * .35 }, .7);
  const output = Buffer.from(back), z = new Float64Array(width * height).fill(Infinity);
  for (const part of parts) {
    const { pixels, iw, ih } = part;
    const vertices = [];
    for (let i = 0; i < part.vertices.length / 5; i++) {
      const p = projectDepthPoint([...part.vertices.slice(i * 5, i * 5 + 3)], aspect, camera);
      vertices.push({ x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2, z: p.z, u: part.vertices[i * 5 + 3], v: part.vertices[i * 5 + 4] });
    }
    for (let i = 0; i < part.indices.length; i += 3) {
      const a = vertices[part.indices[i]], b = vertices[part.indices[i + 1]], c = vertices[part.indices[i + 2]];
      const area = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y); if (Math.abs(area) < 1e-8) continue;
      const left = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), right = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const top = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), bottom = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const aa = ((b.y - c.y) * (x + .5 - c.x) + (c.x - b.x) * (y + .5 - c.y)) / area;
        const bb = ((c.y - a.y) * (x + .5 - c.x) + (a.x - c.x) * (y + .5 - c.y)) / area, cc = 1 - aa - bb;
        if (aa < -1e-6 || bb < -1e-6 || cc < -1e-6) continue;
        const inv = aa / a.z + bb / b.z + cc / c.z, distance = 1 / inv, at = y * width + x; if (distance >= z[at]) continue;
        const u = (aa * a.u / a.z + bb * b.u / b.z + cc * c.u / c.z) / inv, v = (aa * a.v / a.z + bb * b.v / b.z + cc * c.v / c.z) / inv;
        const sx = Math.max(0, Math.min(iw - 1, Math.round(u * (iw - 1)))), sy = Math.max(0, Math.min(ih - 1, Math.round(v * (ih - 1))));
        const src = (sy * iw + sx) * 4, alpha = pixels[src + 3] / 255;
        if (alpha < .004) continue;
        for (let k = 0; k < 3; k++) output[at * 4 + k] = Math.round(pixels[src + k] * alpha + output[at * 4 + k] * (1 - alpha));
        output[at * 4 + 3] = 255; z[at] = distance;
      }
    }
  }
  await sharp(output, { raw: { width, height, channels: 4 } }).png().toFile(path.join(folder, `frame-${String(index).padStart(3, '0')}.png`));
}
console.log('48 perspective verification frames written:', folder);
