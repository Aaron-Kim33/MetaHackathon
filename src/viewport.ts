import { rotatedRect } from './rotation.ts';
import type { EditOptions, ProjectView } from './client';
import { keepPhotoVisible, keepStickerVisible, photoLayout, projectedPhotoRect, stickerRect } from './layout.ts';
export function keepSceneVisible(options: EditOptions, view: ProjectView): EditOptions {
  const base = options.hidePrimary ? options : keepPhotoVisible(view.project, options, view.subject ? view.subjectBounds || undefined : undefined);
  const canvas = photoLayout(view.project, base);
  const stickerTransforms = base.stickerTransforms.map(t => { const source = view.stickers?.find(item => item.id === t.id); return source ? keepStickerVisible(source, t, canvas) : t; });
  return { ...base, stickerTransforms };
}
export function recoverScene(options: EditOptions, view: ProjectView): EditOptions {
  let result = { ...options };
  const canvas = photoLayout(view.project, options), p = projectedPhotoRect(view.project, options, view.subject ? view.subjectBounds || undefined : undefined);
  const lost = (r: { x: number; y: number; width: number; height: number }) => r.x + r.width / 2 < 0 || r.x + r.width / 2 > canvas.width || r.y + r.height / 2 < 0 || r.y + r.height / 2 > canvas.height;
  if (!options.hidePrimary && lost(p)) result = { ...result, x: 0, y: options.mode === 'frame' ? -0.15 : 0, zoom: options.mode === 'frame' ? 1.55 : 1 };
  result.stickerTransforms = result.stickerTransforms.map(t => { const source = view.stickers?.find(item => item.id === t.id); return source && lost(rotatedRect(stickerRect(source, t, canvas), t.rotation || 0)) ? { ...t, x: 0.5, y: 0.5, scale: Math.min(t.scale, 0.85) } : t; });
  return keepSceneVisible(result, view);
}
