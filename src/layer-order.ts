import type { StickerTransform } from './layout';
export function orderedLayers(options: { layerOrder?: string[]; stickerTransforms?: StickerTransform[] }) {
  const allowed = ['primary', ...(options.stickerTransforms || []).map(item => item.id)];
  return [...new Set([...(options.layerOrder || allowed), ...allowed])].filter(id => allowed.includes(id));
}
