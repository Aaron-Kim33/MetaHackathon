export type ToolId = 'photo' | 'subject' | 'position' | 'decoration' | 'background' | 'more';
export function editorLayout(height: number, panelOpen: boolean, keyboardOpen: boolean) {
  const stageHeight = Math.max(0, height);
  const panelHeight = panelOpen ? Math.max(0, Math.min(keyboardOpen ? 220 : 290, height * (keyboardOpen ? 0.45 : 0.36))) : 0;
  const showRail = !keyboardOpen && height >= 300;
  return { panelHeight, stageHeight, showRail, railButtonHeight: Math.min(46, Math.max(24, (stageHeight - 160) / 6)) };
}
export function fitCanvas(width: number, height: number, ratio: number, _railVisible: boolean) {
  const railWidth = 0;
  if (!(ratio > 0) || !Number.isFinite(ratio)) return { width: 0, height: 0, railWidth };
  const canvasWidth = Math.min(Math.max(0, width), Math.max(0, height) * ratio);
  return { width: canvasWidth, height: canvasWidth / ratio, railWidth };
}
