import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { backgroundPhotoRect } from '../src/layout.ts';
let worker, sequence = 0, tail = Promise.resolve();
const pending = new Map();
async function infer(image) {
  const { data, info } = await sharp(image).flatten({ background: '#eee8df' }).resize({ width: 518, height: 518, fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (!worker) {
    worker = fork(fileURLToPath(new URL('./depth-worker.mjs', import.meta.url)), [], { execArgv: [], serialization: 'advanced', windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const current = worker;
    worker.unref(); worker.channel?.unref();
    worker.on('message', result => {
      const request = pending.get(result.id); if (!request) return;
      clearTimeout(request.timer); pending.delete(result.id);
      if (result.error) request.reject(Error(result.error)); else request.resolve(result);
      if (!pending.size) { worker.unref(); worker.channel?.unref(); }
    });
    const failed = error => { if (worker !== current) return; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); worker = undefined; };
    worker.on('error', failed);
    worker.on('exit', code => failed(Error(`Depth worker exited: ${code}`)));
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('깊이 분석 시간이 초과됐어요. 다시 시도해 주세요.')); const old = worker; worker = undefined; old?.kill(); }, 120000);
    pending.set(id, { resolve, reject, timer }); worker.ref(); worker.channel?.ref(); worker.send({ id, pixels: data, width: info.width, height: info.height });
  });
}
export const DEPTH_MODEL = 'Depth Anything V2 Small / DINOv2';
export async function spatialBackdrop(photo, source, canvas, options) {
  const r = backgroundPhotoRect(source, canvas, options);
  return sharp(photo).resize(r.width, r.height, { fit: 'fill' }).extract({ left: -r.x, top: -r.y, width: canvas.width, height: canvas.height }).modulate({ brightness: 1 - (options.backgroundDim || 0) }).png().toBuffer();
}
export function fillFarPlate(rgb, depth, width, height) {
  const sorted = [...depth].sort((a, b) => a - b), threshold = sorted[Math.max(0, Math.floor(sorted.length * .35) - 1)];
  const output = Buffer.from(rgb), seen = new Uint8Array(depth.length), queue = new Int32Array(depth.length);
  let head = 0, end = 0;
  for (let i = 0; i < depth.length; i++) if (depth[i] <= threshold) { seen[i] = 1; queue[end++] = i; }
  while (head < end) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    for (const j of [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y ? i - width : -1, y + 1 < height ? i + width : -1]) if (j >= 0 && !seen[j]) {
      seen[j] = 1; queue[end++] = j; for (let c = 0; c < 3; c++) output[j * 3 + c] = output[i * 3 + c];
    }
  }
  return output;
}
export async function spatialFrame(image, cacheRoot, estimator = infer, backdrop = null) {
  const bytes = await sharp(image).resize({ width: 1024, height: 1280, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const key = createHash('sha256').update('spatial-mesh-v3').update(bytes).update(backdrop || 'generated-backdrop').digest('hex');
  const folder = path.join(cacheRoot, 'spatial-cache'), file = path.join(folder, `${key}.json`);
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const run = async () => {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const result = await estimator(bytes);
    if (!Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 1 || result.height < 1 || result.width > 1024 || result.height > 1024 || result.depth.length !== result.width * result.height) throw Error('깊이 모델 출력 크기가 올바르지 않아요.');
    const gridWidth = 160, meta = await sharp(bytes).metadata(), gridHeight = Math.min(240, Math.max(80, Math.round(gridWidth * meta.height / meta.width)));
    const depth = await sharp(Buffer.from(result.depth), { raw: { width: result.width, height: result.height, channels: 1 } }).resize(gridWidth, gridHeight, { kernel: 'linear' }).toColourspace('b-w').raw().toBuffer();
    if (depth.length !== gridWidth * gridHeight) throw Error('깊이 그리드 크기가 맞지 않아요.');
    const rgb = await sharp(bytes).flatten({ background: '#eee8df' }).resize(gridWidth, gridHeight).removeAlpha().raw().toBuffer();
    const far = fillFarPlate(rgb, depth, gridWidth, gridHeight);
    const farImage = backdrop ? await sharp(backdrop).resize(meta.width, meta.height, { fit: 'fill' }).png().toBuffer() : await sharp(far, { raw: { width: gridWidth, height: gridHeight, channels: 3 } }).resize(meta.width, meta.height).blur(3).png().toBuffer();
    const payload = { key, model: DEPTH_MODEL, image: bytes.toString('base64'), farImage: farImage.toString('base64'), width: meta.width, height: meta.height, gridWidth, gridHeight, depth: [...depth] };
    await mkdir(folder, { recursive: true });
    const temp = file + '.tmp'; await writeFile(temp, JSON.stringify(payload)); await rename(temp, file);
    return payload;
  };
  const task = tail.then(run); tail = task.catch(() => {}); return task;
}
