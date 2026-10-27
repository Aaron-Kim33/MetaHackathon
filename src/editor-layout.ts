export type ToolId = 'photo' | 'subject' | 'position' | 'decoration' | 'background' | 'more';
export function editorLayout(height: number, panelOpen: boolean, keyboardOpen: boolean) {
  const fixedHeight = keyboardOpen ? 90 : 146;
  const usable = Math.max(0, height - fixedHeight);
  let panelHeight = 0;
  if (panelOpen) {
    const target = keyboardOpen ? Math.max(116, Math.min(240, height * 0.45)) : Math.min(300, height * 0.4);
    const minimumCanvas = Math.min(keyboardOpen ? 56 : 264, Math.max(0, usable - 116));
    panelHeight = Math.min(target, Math.max(0, usable - minimumCanvas));
  }
  const stageHeight = Math.max(0, usable - panelHeight);
  const showRail = !keyboardOpen && stageHeight >= 180;
  return { panelHeight, stageHeight, showRail, railButtonHeight: Math.min(50, Math.max(28, (stageHeight - 16) / 6)) };
}
export function fitCanvas(width: number, height: number, ratio: number, railVisible: boolean) {
  const railWidth = railVisible ? 66 : 0, padding = 10;
  const availableWidth = Math.max(0, width - railWidth - padding * 2);
  const availableHeight = Math.max(0, height - padding * 2);
  if (!(ratio > 0) || !Number.isFinite(ratio)) return { width: 0, height: 0, railWidth };
  const canvasWidth = Math.min(availableWidth, availableHeight * ratio);
  return { width: canvasWidth, height: canvasWidth / ratio, railWidth };
}
