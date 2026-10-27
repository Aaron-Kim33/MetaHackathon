import type { EditOptions, ProjectView } from './client';
import { orderedLayers } from './layer-order.ts';
const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export function sameOptions(a: EditOptions, b: EditOptions) { return stable({ ...a, layerOrder: orderedLayers(a) }) === stable({ ...b, layerOrder: orderedLayers(b) }); }
export function sameBase(a: EditOptions, b: EditOptions) {
  const { stickerTransforms: _a, layerOrder: _la, ...left } = a, { stickerTransforms: _b, layerOrder: _lb, ...right } = b;
  return stable(left) === stable(right);
}
export function meaningfulGesture(dx: number, dy: number, factor: number) {
  return Math.hypot(dx, dy) >= 6 || Math.abs(factor - 1) >= 0.02;
}
export function rebaseOptions(saved: EditOptions, view: ProjectView): EditOptions {
  const ids = (view.stickers || []).map(item => item.id);
  const existing = (saved.stickerTransforms || []).filter(item => ids.includes(item.id));
  const stickerTransforms = [...existing, ...(view.options.stickerTransforms || []).filter(item => ids.includes(item.id) && !existing.some(old => old.id === item.id))];
  const next = { ...view.options, ...saved, stickerTransforms };
  return { ...next, layerOrder: orderedLayers(next) };
}
export function moveLayer(options: EditOptions, id: string, direction: 'front' | 'back', visibleIds?: string[]): EditOptions {
  const layerOrder = orderedLayers(options), visible = layerOrder.filter(item => visibleIds ? visibleIds.includes(item) : item !== 'primary' || !options.hidePrimary);
  const index = visible.indexOf(id), next = index + (direction === 'front' ? 1 : -1);
  if (index < 0 || next < 0 || next >= visible.length) return options;
  const from = layerOrder.indexOf(visible[index]), to = layerOrder.indexOf(visible[next]);
  [layerOrder[from], layerOrder[to]] = [layerOrder[to], layerOrder[from]];
  const stickerTransforms = layerOrder.filter(item => item !== 'primary').map(item => options.stickerTransforms.find(t => t.id === item)!);
  return { ...options, layerOrder, stickerTransforms };
}
