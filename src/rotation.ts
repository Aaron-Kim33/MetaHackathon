export const wrapAngle = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;
export function rotatePoint(point: { x: number; y: number }, center: { x: number; y: number }, degrees = 0) {
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const x = point.x - center.x, y = point.y - center.y;
  return { x: center.x + c * x - s * y, y: center.y + s * x + c * y };
}
export function rotatedRect(rect: { x: number; y: number; width: number; height: number }, degrees = 0) {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]].map(([x, y]) => rotatePoint({ x, y }, center, degrees));
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
}
