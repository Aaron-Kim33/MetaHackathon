import { frameMatrix, unprojectFrame } from './frame.ts';
export type PhotoLayoutOptions = { mode?: 'plain' | 'frame' | 'sticker'; tilt?: number; depth?: number; ratio: 'portrait' | 'story' | 'square'; zoom: number; x: number; y: number };
export type Dimensions = { width: number; height: number };
export type StickerTransform = { id: string; x: number; y: number; scale: number };
export type NormalizedBounds = { x: number; y: number; width: number; height: number };
const visibleShift = (start: number, length: number, total: number, minimum: number) => {
  const keep = Math.min(minimum, length, total);
  return start + length < keep ? keep - start - length : start > total - keep ? total - keep - start : 0;
};
export function keepStickerVisible(source: Dimensions, transform: StickerTransform, canvas: Dimensions, minimum = 140): StickerTransform {
  const r = stickerRect(source, transform, canvas);
  return { ...transform, x: Math.max(-0.3, Math.min(1.3, transform.x + visibleShift(r.x, r.width, canvas.width, minimum) / canvas.width)), y: Math.max(-0.3, Math.min(1.3, transform.y + visibleShift(r.y, r.height, canvas.height, minimum) / canvas.height)) };
}
export function projectedPhotoRect(source: Dimensions, options: PhotoLayoutOptions, bounds: NormalizedBounds = { x: 0, y: 0, width: 1, height: 1 }) {
  const g = photoLayout(source, options), p = g.photo, m = frameMatrix(options);
  const x = p.x + bounds.x * p.width, y = p.y + bounds.y * p.height, w = p.width * bounds.width, h = p.height * bounds.height;
  const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => ({ x: m.a * (px - g.width / 2) + m.c * (py - g.height / 2) + g.width / 2, y: m.b * (px - g.width / 2) + m.d * (py - g.height / 2) + g.height / 2 }));
  return { x: Math.min(...corners.map(p => p.x)), y: Math.min(...corners.map(p => p.y)), width: Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x)), height: Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y)) };
}
export function keepPhotoVisible<T extends PhotoLayoutOptions>(source: Dimensions, options: T, bounds?: NormalizedBounds, minimum = 140): T {
  const g = photoLayout(source, options), r = projectedPhotoRect(source, options, bounds);
  if (r.width <= 0 || r.height <= 0) return options;
  const delta = unprojectFrame({ x: visibleShift(r.x, r.width, g.width, minimum), y: visibleShift(r.y, r.height, g.height, minimum) }, g, options, true);
  return { ...options, x: Math.max(-0.8, Math.min(0.8, options.x + delta.x / g.screen.width)), y: Math.max(-0.8, Math.min(0.8, options.y + delta.y / g.screen.height)) };
}
export function stickerRect(source: Dimensions, transform: StickerTransform, canvas: Dimensions) {
  const factor = Math.min(canvas.width / source.width, canvas.height / source.height) * transform.scale;
  const width = Math.max(1, Math.round(source.width * factor)), height = Math.max(1, Math.round(source.height * factor));
  return { x: Math.round(transform.x * canvas.width - width / 2), y: Math.round(transform.y * canvas.height - height / 2), width, height };
}
export function gestureSticker(initial: StickerTransform, source: Dimensions, canvas: Dimensions, displayWidth: number, gesture: { dx: number; dy: number; factor: number; anchorX: number; anchorY: number }): StickerTransform {
  if (!(displayWidth > 0) || ![gesture.dx, gesture.dy, gesture.factor, gesture.anchorX, gesture.anchorY].every(Number.isFinite) || gesture.factor <= 0) return initial;
  const units = canvas.width / displayWidth, before = stickerRect(source, initial, canvas);
  const scale = Math.min(2.5, Math.max(0.08, initial.scale * gesture.factor)), factor = scale / initial.scale;
  const x = gesture.anchorX * units - (gesture.anchorX * units - (before.x + before.width / 2)) * factor + gesture.dx * units;
  const y = gesture.anchorY * units - (gesture.anchorY * units - (before.y + before.height / 2)) * factor + gesture.dy * units;
  return keepStickerVisible(source, { ...initial, scale, x: Math.min(1.3, Math.max(-0.3, x / canvas.width)), y: Math.min(1.3, Math.max(-0.3, y / canvas.height)) }, canvas);
}
export function photoLayout(source: Dimensions, options: PhotoLayoutOptions) {
  const width = 1080, height = options.ratio === 'story' ? 1920 : options.ratio === 'square' ? 1080 : 1350;
  const screenHeight = Math.round(height * 0.59), screenWidth = Math.min(588, Math.round(screenHeight * 0.56));
  const screen = options.mode === 'sticker' || options.mode === 'plain' ? { x: 0, y: 0, width, height } : { x: Math.round((width - screenWidth) / 2), y: Math.round(height * 0.29), width: screenWidth, height: screenHeight };
  const scale = (options.mode === 'sticker' || options.mode === 'plain' ? Math.min(width / source.width, height / source.height) * 0.85 : Math.max(screen.width / source.width, screen.height / source.height)) * options.zoom;
  const photo = { width: Math.round(source.width * scale), height: Math.round(source.height * scale), x: 0, y: 0 };
  photo.x = Math.round(screen.x + (screen.width - photo.width) / 2 + options.x * screen.width);
  photo.y = Math.round(screen.y + (screen.height - photo.height) / 2 + options.y * screen.height);
  return { width, height, screen, photo };
}
const bound = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function gesturePhoto<T extends PhotoLayoutOptions>(initial: T, source: Dimensions, displayWidth: number, gesture: { dx: number; dy: number; factor: number; anchorX: number; anchorY: number }, bounds?: NormalizedBounds): T {
  if (!(displayWidth > 0) || ![gesture.dx, gesture.dy, gesture.factor, gesture.anchorX, gesture.anchorY].every(Number.isFinite) || gesture.factor <= 0) return initial;
  const before = photoLayout(source, initial);
  const display = { width: displayWidth, height: displayWidth * before.height / before.width };
  const anchor = unprojectFrame({ x: gesture.anchorX, y: gesture.anchorY }, display, initial);
  const delta = unprojectFrame({ x: gesture.dx, y: gesture.dy }, display, initial, true);
  gesture = { ...gesture, dx: delta.x, dy: delta.y, anchorX: anchor.x, anchorY: anchor.y };
  const zoom = bound(initial.zoom * gesture.factor, 0.8, 2.4);
  const factor = zoom / initial.zoom, units = before.width / displayWidth;
  const after = photoLayout(source, { ...initial, zoom });
  const desiredX = gesture.anchorX * units - (gesture.anchorX * units - before.photo.x) * factor + gesture.dx * units;
  const desiredY = gesture.anchorY * units - (gesture.anchorY * units - before.photo.y) * factor + gesture.dy * units;
  return keepPhotoVisible(source, { ...initial, zoom, x: bound(initial.x + (desiredX - after.photo.x) / after.screen.width, -0.8, 0.8), y: bound(initial.y + (desiredY - after.photo.y) / after.screen.height, -0.8, 0.8) }, bounds);
}

export type BrushPoint = { x: number; y: number };
export type BrushStroke = { mode: 'erase' | 'restore'; radius: number; points: BrushPoint[] };
export function containedImage(source: Dimensions, width: number, maxHeight = 440) {
  const scale = Math.min(width / source.width, maxHeight / source.height);
  const imageWidth = source.width * scale, imageHeight = source.height * scale;
  return { x: (width - imageWidth) / 2, y: 0, width: imageWidth, height: imageHeight };
}
export function imagePoint(x: number, y: number, image: { x: number; y: number; width: number; height: number }): BrushPoint | null {
  if (![x, y, image.x, image.y, image.width, image.height].every(Number.isFinite)) return null;
  if (image.width <= 0 || image.height <= 0 || x < image.x || y < image.y || x > image.x + image.width || y > image.y + image.height) return null;
  return { x: (x - image.x) / image.width, y: (y - image.y) / image.height };
}

export type PageBounds = { pageX: number; pageY: number; width: number; height: number };
export function pageImagePoint(pageX: number, pageY: number, bounds: PageBounds, source: Dimensions): BrushPoint | null {
  if (![pageX, pageY, bounds.pageX, bounds.pageY, bounds.width, bounds.height, source.width, source.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || source.width <= 0 || source.height <= 0) return null;
  const image = containedImage(source, bounds.width, bounds.height);
  return imagePoint(pageX - bounds.pageX, pageY - bounds.pageY, image);
}
