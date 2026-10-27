export function frameMatrix(options: { mode?: string; tilt?: number; depth?: number }) {
  if (options.mode && options.mode !== 'frame') return { a: 1, b: 0, c: 0, d: 1 };
  const angle = (options.tilt || 0) * Math.PI / 180, depth = options.depth || 0;
  const cosine = Math.cos(angle), sine = Math.sin(angle), squash = 1 - depth * 0.12, shear = depth * 0.09;
  return { a: cosine * squash, b: sine * squash, c: cosine * shear - sine, d: sine * shear + cosine };
}
export function unprojectFrame(point: { x: number; y: number }, dimensions: { width: number; height: number }, options: Parameters<typeof frameMatrix>[0], vector = false) {
  const { a, b, c, d } = frameMatrix(options), determinant = a * d - b * c;
  const cx = vector ? 0 : dimensions.width / 2, cy = vector ? 0 : dimensions.height / 2;
  const x = point.x - cx, y = point.y - cy;
  return { x: (d * x - c * y) / determinant + cx, y: (-b * x + a * y) / determinant + cy };
}
