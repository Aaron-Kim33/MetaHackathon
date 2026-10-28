import type { EditOptions } from './client';
import { frameMatrix } from './frame.ts';
import { backgroundPhotoRect, photoLayout, stickerRect } from './layout.ts';
import type { Dimensions } from './layout';
import { orderedLayers } from './layer-order.ts';
export const COMPOSITION_VERSION = 2;
export type SceneNode = { key: string; type: 'text' | 'path' | 'g' | 'rect' | 'circle' | 'ellipse' | 'image' | 'clipPath' | 'linearGradient' | 'radialGradient' | 'stop'; attrs: Record<string, string | number>; asset?: string; text?: string; children?: SceneNode[] };
export type SceneContent = { source: Dimensions; backdrop?: Dimensions | null; subject: boolean; shadow: boolean; decoration?: Dimensions | null; stickers: (Dimensions & { id: string })[] };
export type CompositionScene = { width: number; height: number; defs: SceneNode[]; background: SceneNode[]; primary: SceneNode[]; layers: SceneNode[] };
const node = (key: string, type: SceneNode['type'], attrs: SceneNode['attrs'], children?: SceneNode[]): SceneNode => ({ key, type, attrs, children });
const image = (key: string, asset: string, attrs: SceneNode['attrs']): SceneNode => ({ key, type: 'image', attrs: { ...attrs, preserveAspectRatio: 'none' }, asset });
export function buildCompositionScene(content: SceneContent, options: EditOptions): CompositionScene {
  const g = photoLayout(content.source, options), { width, height, screen: q, photo } = g;
  const matrix = frameMatrix(options), cx = width / 2, cy = height / 2;
  const transform = `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${cx - matrix.a * cx - matrix.c * cy} ${cy - matrix.b * cx - matrix.d * cy})`;
  const screen = { x: q.x, y: q.y, width: q.width, height: q.height, rx: 6 };
  const defs = [
    node('screen-clip', 'clipPath', { id: 'scene-screen', clipPathUnits: 'userSpaceOnUse' }, [node('screen-path', 'rect', screen)]),
    node('escape-clip', 'clipPath', { id: 'scene-escape', clipPathUnits: 'userSpaceOnUse' }, [node('escape-top', 'rect', { x: 0, y: 0, width, height: q.y + q.height - 24 }), node('escape-bottom', 'rect', screen)]),
    node('metal', 'linearGradient', { id: 'scene-metal', x1: '0%', y1: '0%', x2: '100%', y2: '100%' }, [node('metal-light', 'stop', { offset: '0%', stopColor: '#d5dfc8' }), node('metal-mid', 'stop', { offset: '40%', stopColor: '#9cae91' }), node('metal-dark', 'stop', { offset: '100%', stopColor: '#101827' })]),
    node('ground', 'radialGradient', { id: 'scene-ground', cx: '50%', cy: '50%', r: '50%' }, [node('ground-dark', 'stop', { offset: '0%', stopColor: '#101827', stopOpacity: 0.24 }), node('ground-clear', 'stop', { offset: '100%', stopColor: '#101827', stopOpacity: 0 })]),
  ];
  const background: SceneNode[] = [], primary: SceneNode[] = [];
  if (options.mode === 'frame') {
    const extrusion = Math.round(3 + 5 * options.depth);
    const label = (key: string, text: string, x: number, y: number, size: number): SceneNode => ({ key, type: 'text', text, attrs: { x, y, fill: '#f7f7f4', fontSize: size, fontFamily: 'sans-serif', fontWeight: 600 } });
    background.push(
      node('phone-ground', 'ellipse', { cx: q.x + q.width / 2, cy: q.y + q.height + 52, rx: q.width * 0.65, ry: 30, fill: 'url(#scene-ground)' }),
      node('phone-depth', 'rect', { x: q.x - 14 + extrusion, y: q.y - 38 + extrusion, width: q.width + 28, height: q.height + 82, rx: 50, fill: '#62735a' }),
      node('phone-case', 'rect', { x: q.x - 14, y: q.y - 38, width: q.width + 28, height: q.height + 82, rx: 50, fill: 'url(#scene-metal)' }),
      node('phone-face', 'rect', { x: q.x - 7, y: q.y - 32, width: q.width + 14, height: q.height + 70, rx: 44, fill: '#111313' }),
      image('screen-photo', 'source', { ...photo, clipPath: 'url(#scene-screen)' }),
      node('phone-highlight', 'rect', { x: q.x - 12, y: q.y - 36, width: q.width + 24, height: q.height + 78, rx: 48, fill: 'none', stroke: '#edf1df', strokeOpacity: 0.7, strokeWidth: 2 }),
      label('status-time', '9:41', q.x + 24, q.y - 10, 12),
      node('camera-pill', 'rect', { x: q.x + q.width / 2 - 33, y: q.y - 27, width: 66, height: 12, rx: 6, fill: '#050606' }),
      node('battery', 'rect', { x: q.x + q.width - 45, y: q.y - 23, width: 22, height: 11, rx: 3, fill: 'none', stroke: '#f5f5ed', strokeWidth: 1 }),
      node('battery-fill', 'rect', { x: q.x + q.width - 43, y: q.y - 21, width: 17, height: 7, rx: 1, fill: '#f5f5ed' }),
      node('story-button', 'rect', { x: q.x + 12, y: q.y + q.height + 8, width: q.width * 0.45, height: 22, rx: 11, fill: '#353738' }),
      label('story-label', 'Your story', q.x + 29, q.y + q.height + 23, 10),
      label('friends-label', 'Friends', q.x + q.width * 0.57, q.y + q.height + 23, 10),
      node('send-button', 'circle', { cx: q.x + q.width - 23, cy: q.y + q.height + 19, r: 12, fill: '#f4f4ef' }),
      node('send-arrow', 'path', { d: 'M ' + (q.x + q.width - 29) + ' ' + (q.y + q.height + 19) + ' h 12 m -5 -5 l 5 5 l -5 5', stroke: '#171a18', strokeWidth: 2, fill: 'none' }),
      node('phone-button', 'rect', { x: q.x + q.width + 15, y: q.y + 95, width: 3, height: 52, rx: 1, fill: '#94a387' }),
    );
  }
  if (!options.hidePrimary) {
    if (content.subject) {
      if (options.mode === 'frame' && content.shadow && options.shadow > 0) primary.push(image('subject-shadow', 'shadow', { x: photo.x + Math.round(4 + options.depth * 8), y: photo.y + Math.round(6 + options.depth * 12), width: photo.width, height: photo.height, opacity: options.shadow, clipPath: 'url(#scene-screen)' }));
      primary.push(image('subject', 'subject', { ...photo, ...(options.mode === 'frame' ? { clipPath: 'url(#scene-escape)' } : {}) }));
    } else if (options.mode === 'plain') primary.push(image('plain-photo', 'source', photo));
  }
  if (content.decoration) {
    const w = Math.round(width * options.decorationScale), h = Math.round(w * content.decoration.height / content.decoration.width);
    const ornament = image('decoration', 'decoration', { x: Math.round(options.decorationX * width - w / 2), y: Math.round(options.decorationY * height - h / 2), width: w, height: h });
    (options.decorationDepth === 'front' ? primary : background).push(ornament);
  }
  const backPlane = node('background-plane', 'g', { transform }, background), primaryPlane = node('primary-plane', 'g', { transform }, primary);
  const base = [node('canvas', 'rect', { x: 0, y: 0, width, height, fill: options.mode === 'sticker' ? 'none' : options.background }), ...(content.backdrop && options.mode !== 'sticker' ? [image('background-photo', 'background', backgroundPhotoRect(content.backdrop, { width, height }, options)), node('background-dim', 'rect', { x: 0, y: 0, width, height, fill: '#000', opacity: options.backgroundDim || 0 })] : []), backPlane];
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
    return `<${n.type} ${attributes}>${n.text ? escapeXml(n.text) : ''}${(n.children || []).map(render).join('')}</${n.type}>`;
  };
  const nodes = part === 'primary' ? scene.primary : part === 'background' ? scene.background : [...scene.background, ...scene.layers];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}"><defs>${scene.defs.map(render).join('')}</defs>${nodes.map(render).join('')}</svg>`;
}
