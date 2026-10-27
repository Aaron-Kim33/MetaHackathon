export type PhotoLayoutOptions = { mode?: 'plain' | 'frame' | 'sticker'; ratio: 'portrait' | 'story' | 'square'; zoom: number; x: number; y: number };
export type Dimensions = { width: number; height: number };
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
export function gesturePhoto<T extends PhotoLayoutOptions>(initial: T, source: Dimensions, displayWidth: number, gesture: { dx: number; dy: number; factor: number; anchorX: number; anchorY: number }): T {
  if (!(displayWidth > 0) || ![gesture.dx, gesture.dy, gesture.factor, gesture.anchorX, gesture.anchorY].every(Number.isFinite) || gesture.factor <= 0) return initial;
  const before = photoLayout(source, initial);
  const zoom = bound(initial.zoom * gesture.factor, 0.8, 2.4);
  const factor = zoom / initial.zoom, units = before.width / displayWidth;
  const after = photoLayout(source, { ...initial, zoom });
  const desiredX = gesture.anchorX * units - (gesture.anchorX * units - before.photo.x) * factor + gesture.dx * units;
  const desiredY = gesture.anchorY * units - (gesture.anchorY * units - before.photo.y) * factor + gesture.dy * units;
  return { ...initial, zoom, x: bound(initial.x + (desiredX - after.photo.x) / after.screen.width, -0.8, 0.8), y: bound(initial.y + (desiredY - after.photo.y) / after.screen.height, -0.8, 0.8) };
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
