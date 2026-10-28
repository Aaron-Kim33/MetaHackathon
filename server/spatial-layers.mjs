import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCompositionScene, compositionSvg } from '../src/composition-scene.ts';
import { spatialFrame } from './depth.mjs';
import { atomicJson } from './store.mjs';

const uri = data => `data:image/png;base64,${typeof data === 'string' ? data : data.toString('base64')}`;
export function padTransparentColours(rgba, width, height) {
  const output = Buffer.from(rgba), seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, end = 0;
  for (let i = 0; i < seen.length; i++) if (rgba[i * 4 + 3]) { seen[i] = 1; queue[end++] = i; }
  while (head < end) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    for (const j of [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y ? i - width : -1, y + 1 < height ? i + width : -1]) if (j >= 0 && !seen[j]) {
      seen[j] = 1; queue[end++] = j;
      for (let c = 0; c < 3; c++) output[j * 4 + c] = output[i * 4 + c];
    }
  }
  return output;
}
// Extend only the invisible depth field. Visible RGB/alpha edges never change.
export function extendInvisibleDepth(rgba, width, height) {
  const depth = new Uint8Array(width * height), seen = new Uint8Array(depth.length), queue = new Int32Array(depth.length);
  let head = 0, end = 0;
  for (let i = 0; i < depth.length; i++) if (rgba[i * 4 + 3] > 8) { depth[i] = rgba[i * 4]; seen[i] = 1; queue[end++] = i; }
  while (head < end) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    for (const j of [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y ? i - width : -1, y + 1 < height ? i + width : -1]) if (j >= 0 && !seen[j]) { seen[j] = 1; depth[j] = depth[i]; queue[end++] = j; }
  }
  return [...depth];
}
export async function spatialLayers(view, root, stickerSources = {}, estimator) {
  const identity = createHash('sha256').update('separate-surfaces-v2').update(JSON.stringify(view.options));
  for (const pixels of [view.image, view.source, view.subject, view.photoSource, view.backgroundPhoto?.data, view.decorationImage?.data, ...(view.stickers || []).flatMap(s => [s.id, s.data, stickerSources[s.id]])]) identity.update(pixels || '').update('\0');
  const key = identity.digest('hex');
  const folder = path.join(root, 'spatial-layers-cache'), file = path.join(folder, key + '.json');
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const scene = buildCompositionScene({ source: view.project, backdrop: view.backgroundPhoto, subject: !!view.subject, shadow: !!view.subjectShadow, decoration: view.decorationImage, stickers: view.stickers || [] }, view.options);
  const assets = { source: uri(view.photoSource || view.source), ...(view.subject ? { subject: uri(view.subject) } : {}), ...(view.subjectShadow ? { shadow: uri(view.subjectShadow) } : {}), ...(view.backgroundPhoto ? { background: uri(view.backgroundPhoto.data) } : {}), ...(view.decorationImage ? { decoration: uri(view.decorationImage.data) } : {}) };
  for (const sticker of view.stickers || []) assets[`sticker:${sticker.id}`] = uri(sticker.data);
  const width = Math.min(1024, scene.width), height = Math.round(width * scene.height / scene.width);
  const gridWidth = 96, gridHeight = Math.min(160, Math.max(64, Math.round(gridWidth * height / width)));
  const raster = async (nodes, textures) => sharp(Buffer.from(compositionSvg({ ...scene, background: nodes, layers: [], primary: [] }, textures))).resize(width, height).png().toBuffer();
  const depthAssets = {};
  async function mapAsset(name, source, alphaImage) {
    const input = Buffer.from(source, 'base64'), estimate = await spatialFrame(input, root, estimator), meta = await sharp(input).metadata();
    let image = sharp(Buffer.from(estimate.depth), { raw: { width: estimate.gridWidth, height: estimate.gridHeight, channels: 1 } }).resize(meta.width, meta.height).toColourspace('srgb').removeAlpha();
    if (alphaImage) { const alpha = await sharp(Buffer.from(alphaImage, 'base64')).ensureAlpha().extractChannel(3).raw().toBuffer(); image = image.joinChannel(alpha, { raw: { width: meta.width, height: meta.height, channels: 1 } }); }
    depthAssets[name] = uri(await image.png().toBuffer());
  }
  if (view.backgroundPhoto) await mapAsset('background', view.backgroundPhoto.data);
  if (!view.options.hidePrimary && (view.subject || view.options.mode === 'plain')) {
    await mapAsset('source', view.source);
    if (view.subject) await mapAsset('subject', view.source, view.subject);
  }
  if (view.decorationImage) {
    const alpha = await sharp(Buffer.from(view.decorationImage.data, 'base64')).ensureAlpha().extractChannel(3).raw().toBuffer();
    depthAssets.decoration = uri(await sharp({ create: { width: view.decorationImage.width, height: view.decorationImage.height, channels: 3, background: '#808080' } }).joinChannel(alpha, { raw: { width: view.decorationImage.width, height: view.decorationImage.height, channels: 1 } }).png().toBuffer());
  }
  for (const sticker of view.stickers || []) await mapAsset(`sticker:${sticker.id}`, stickerSources[sticker.id] || sticker.data, sticker.data);
  const phone = scene.background.find(n => n.key === 'background-plane');
  const primary = scene.layers.find(n => n.key === 'primary-plane');
  const shadows = primary?.children?.filter(n => n.key === 'subject-shadow') || [];
  const frontNodes = scene.layers.map(n => n.key === 'primary-plane' ? { ...n, children: n.children?.filter(c => c.key !== 'subject-shadow') } : n).filter(n => n.type !== 'g' || n.children?.length);
  const groups = [
    { id: 'backdrop', nodes: scene.background.filter(n => n.key !== 'background-plane'), z: -.6, relief: view.backgroundPhoto ? .18 : 0 },
    ...(phone?.children?.length ? [{ id: 'phone', nodes: [phone, ...(shadows.length ? [{ ...primary, children: shadows }] : [])], z: 0, relief: 0 }] : []),
    ...frontNodes.map((node, index) => { const band = .6 / frontNodes.length; return { id: node.key, nodes: [node], z: .15 + band * (index + .5), relief: band * .8 }; }),
  ];
  const layers = [];
  for (const group of groups) {
    const image = await raster(group.nodes, assets);
    const neutralCanvas = n => n.key === 'canvas' ? { ...n, attrs: { ...n.attrs, fill: '#808080' } } : n;
    const depthPng = group.relief ? await raster(group.nodes.map(neutralCanvas), depthAssets) : null;
    const field = depthPng ? await sharp(depthPng).resize(gridWidth, gridHeight).ensureAlpha().raw().toBuffer() : null;
    const depth = field ? extendInvisibleDepth(field, gridWidth, gridHeight) : Array(gridWidth * gridHeight).fill(128);
    // Power-of-two textures allow stable trilinear minification on ES 2 and 3.
    const textureWidth = 2 ** Math.ceil(Math.log2(width)), textureHeight = 2 ** Math.ceil(Math.log2(height));
    const raw = await sharp(image).ensureAlpha().raw().toBuffer();
    const padded = padTransparentColours(raw, width, height);
    const texture = await sharp(padded, { raw: { width, height, channels: 4 } }).resize(textureWidth, textureHeight, { fit: 'fill' }).png().toBuffer();
    layers.push({ id: group.id, width, height, gridWidth, gridHeight, depth, baseZ: group.z, relief: group.relief, image: image.toString('base64'), textureImage: texture.toString('base64') });
  }
  await atomicJson(file, layers);
  return layers;
}
