import { rotatePoint } from './rotation.ts';
import type { EditOptions, ProjectView } from './client';
import { orderedLayers } from './layer-order.ts';
import { photoLayout, stickerRect } from './layout.ts';
import { unprojectFrame } from './frame.ts';
export type HitMask = { width: number; height: number; bits: string };
export function opaqueHit(mask: HitMask | undefined | null, u: number, v: number) {
  if (u < 0 || v < 0 || u > 1 || v > 1) return false;
  if (!mask) return true;
  const x = Math.min(mask.width - 1, Math.floor(u * mask.width)), y = Math.min(mask.height - 1, Math.floor(v * mask.height));
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const px = x + dx, py = y + dy;
    if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) continue;
    const bit = py * mask.width + px, byte = parseInt(mask.bits.slice(Math.floor(bit / 8) * 2, Math.floor(bit / 8) * 2 + 2), 16);
    if (byte & (1 << (bit % 8))) return true;
  }
  return false;
}
export function hitLayer(view: ProjectView, options: EditOptions, point: { x: number; y: number }, displayWidth: number): string | null {
  if (!(displayWidth > 0)) return null;
  const g = photoLayout(view.project, options), unit = g.width / displayWidth;
  const cursor = { x: point.x * unit, y: point.y * unit }, primaryPoint = unprojectFrame(cursor, g, options);
  for (const id of orderedLayers(options).reverse()) {
    if (id === 'primary') {
      if (options.hidePrimary || (!view.subject && options.mode === 'sticker')) continue;
      if (options.mode === 'frame' && primaryPoint.y > g.screen.y + g.screen.height) continue;
      if (options.mode === 'frame' && !view.subject && (primaryPoint.x < g.screen.x || primaryPoint.x > g.screen.x + g.screen.width || primaryPoint.y < g.screen.y)) continue;
      const local = rotatePoint(primaryPoint, { x: g.photo.x + g.photo.width / 2, y: g.photo.y + g.photo.height / 2 }, -(options.photoRotation || 0));
      const u = (local.x - g.photo.x) / g.photo.width, v = (local.y - g.photo.y) / g.photo.height;
      if (opaqueHit(view.subject ? view.subjectHitMask : undefined, u, v)) return id;
    } else {
      const sticker = view.stickers?.find(item => item.id === id), t = options.stickerTransforms.find(item => item.id === id);
      if (!sticker || !t) continue;
      const r = stickerRect(sticker, t, g);
      const local = rotatePoint(cursor, { x: r.x + r.width / 2, y: r.y + r.height / 2 }, -(t.rotation || 0));
      const slop = 6 * unit;
      if (local.x < r.x - slop || local.y < r.y - slop || local.x > r.x + r.width + slop || local.y > r.y + r.height + slop) continue;
      if (opaqueHit(sticker.hitMask, Math.max(0, Math.min(1, (local.x - r.x) / r.width)), Math.max(0, Math.min(1, (local.y - r.y) / r.height)))) return id;
    }
  }
  return null;
}
