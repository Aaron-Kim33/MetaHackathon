import type { EditOptions } from './client';
import { frameMatrix } from './frame.ts';
import { photoLayout, stickerRect } from './layout.ts';
import type { Dimensions } from './layout';
import { orderedLayers } from './layer-order.ts';
export const COMPOSITION_VERSION = 1;
export type SceneNode = { key: string; type: 'g' | 'rect' | 'circle' | 'ellipse' | 'image' | 'clipPath' | 'linearGradient' | 'radialGradient' | 'stop'; attrs: Record<string, string | number>; asset?: string; children?: SceneNode[] };
export type SceneContent = { source: Dimensions; subject: boolean; shadow: boolean; decoration?: Dimensions | null; stickers: (Dimensions & { id: string })[] };
export type CompositionScene = { width: number; height: number; defs: SceneNode[]; background: SceneNode[]; primary: SceneNode[]; layers: SceneNode[] };
const node = (key: string, type: SceneNode['type'], attrs: SceneNode['attrs'], children?: SceneNode[]): SceneNode => ({ key, type, attrs, children });
const image = (key: string, asset: string, attrs: SceneNode['attrs']): SceneNode => ({ key, type: 'image', attrs: { ...attrs, preserveAspectRatio: 'none' }, asset });
export function buildCompositionScene(content: SceneContent, options: EditOptions): CompositionScene {
  const g = photoLayout(content.source, options), { width, height, screen: q, photo } = g;
  const matrix = frameMatrix(options), cx = width / 2, cy = height / 2;
  const transform = `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${cx - matrix.a * cx - matrix.c * cy} ${cy - matrix.b * cx - matrix.d * cy})`;
  const screen = { x: q.x, y: q.y, width: q.width, height: q.height, rx: 30 };
  const defs = [
    node('screen-clip', 'clipPath', { id: 'scene-screen', clipPathUnits: 'userSpaceOnUse' }, [node('screen-path', 'rect', screen)]),
    node('escape-clip', 'clipPath', { id: 'scene-escape', clipPathUnits: 'userSpaceOnUse' }, [node('escape-top', 'rect', { x: 0, y: 0, width, height: q.y + q.height - 40 }), node('escape-bottom', 'rect', screen)]),
    node('metal', 'linearGradient', { id: 'scene-metal', x1: '0%', y1: '0%', x2: '100%', y2: '100%' }, [node('metal-light', 'stop', { offset: '0%', stopColor: '#75849a' }), node('metal-mid', 'stop', { offset: '40%', stopColor: '#253246' }), node('metal-dark', 'stop', { offset: '100%', stopColor: '#101827' })]),
    node('ground', 'radialGradient', { id: 'scene-ground', cx: '50%', cy: '50%', r: '50%' }, [node('ground-dark', 'stop', { offset: '0%', stopColor: '#101827', stopOpacity: 0.24 }), node('ground-clear', 'stop', { offset: '100%', stopColor: '#101827', stopOpacity: 0 })]),
  ];
  const background: SceneNode[] = [], primary: SceneNode[] = [];
  if (options.mode === 'frame') {
    const extrusion = Math.round(28 * options.depth);
    background.push(
      node('phone-ground', 'ellipse', { cx: q.x + q.width / 2 + extrusion, cy: q.y + q.height + 29, rx: q.width * 0.75, ry: 44, fill: 'url(#scene-ground)' }),
      node('phone-depth', 'rect', { x: q.x - 15 + extrusion, y: q.y - 15 + Math.round(extrusion * 0.65), width: q.width + 30, height: q.height + 30, rx: 46, fill: 'url(#scene-metal)' }),
      node('phone-face', 'rect', { x: q.x - 15, y: q.y - 15, width: q.width + 30, height: q.height + 30, rx: 46, fill: '#171e2b' }),
      node('phone-border', 'rect', { x: q.x - 8, y: q.y - 8, width: q.width + 16, height: q.height + 16, rx: 39, fill: 'none', stroke: '#58606e', strokeWidth: 2 }),
      image('screen-photo', 'source', { ...photo, clipPath: 'url(#scene-screen)' }),
      node('phone-highlight', 'rect', { x: q.x - 14, y: q.y - 14, width: q.width + 28, height: q.height + 28, rx: 45, fill: 'none', stroke: '#b9c7d5', strokeOpacity: 0.55, strokeWidth: 2 }),
      node('phone-notch', 'rect', { x: q.x + q.width / 2 - 46, y: q.y + 9, width: 92, height: 19, rx: 10, fill: '#101724' }),
      node('phone-camera', 'circle', { cx: q.x + q.width / 2 + 29, cy: q.y + 18, r: 4, fill: '#354861' }),
      node('phone-button', 'rect', { x: q.x + q.width + 16, y: q.y + 120, width: 5, height: 58, rx: 2, fill: '#8b9bb0' }),
    );
  }
  if (!options.hidePrimary) {
    if (content.subject) {
      if (options.mode === 'frame' && content.shadow && options.shadow > 0) primary.push(image('subject-shadow', 'shadow', { x: photo.x + Math.round(8 + options.depth * 24), y: photo.y + Math.round(12 + options.depth * 28), width: photo.width, height: photo.height, opacity: options.shadow, clipPath: 'url(#scene-screen)' }));
      primary.push(image('subject', 'subject', { ...photo, ...(options.mode === 'frame' ? { clipPath: 'url(#scene-escape)' } : {}) }));
    } else if (options.mode === 'plain') primary.push(image('plain-photo', 'source', photo));
  }
  if (content.decoration) {
    const w = Math.round(width * options.decorationScale), h = Math.round(w * content.decoration.height / content.decoration.width);
    const ornament = image('decoration', 'decoration', { x: Math.round(options.decorationX * width - w / 2), y: Math.round(options.decorationY * height - h / 2), width: w, height: h });
    (options.decorationDepth === 'front' ? primary : background).push(ornament);
  }
  const backPlane = node('background-plane', 'g', { transform }, background), primaryPlane = node('primary-plane', 'g', { transform }, primary);
  const base = [node('canvas', 'rect', { x: 0, y: 0, width, height, fill: options.mode === 'sticker' ? 'none' : options.background }), backPlane];
  const layers = orderedLayers(options).flatMap(id => {
    if (id === 'primary') return [primaryPlane];
    const sticker = content.stickers.find(item => item.id === id), t = options.stickerTransforms.find(item => item.id === id);
    return sticker && t ? [image(`sticker-${id}`, `sticker:${id}`, stickerRect(sticker, t, g))] : [];
  });
  return { width, height, defs, background: base, primary: [primaryPlane], layers };
}
const escapeXml = (value: string | number) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export function compositionSvg(scene: CompositionScene, assets: Record<string, string>, part: 'all' | 'background' | 'primary' = 'all') {
  const render = (n: SceneNode): string => {
    if (n.asset && !assets[n.asset]) return '';
    const attrs = { ...n.attrs, ...(n.asset ? { href: assets[n.asset] } : {}) };
    const attributes = Object.entries(attrs).map(([key, value]) => `${['clipPathUnits', 'preserveAspectRatio'].includes(key) ? key : key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}="${escapeXml(value)}"`).join(' ');
    return `<${n.type} ${attributes}>${(n.children || []).map(render).join('')}</${n.type}>`;
  };
  const nodes = part === 'primary' ? scene.primary : part === 'background' ? scene.background : [...scene.background, ...scene.layers];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}"><defs>${scene.defs.map(render).join('')}</defs>${nodes.map(render).join('')}</svg>`;
}
