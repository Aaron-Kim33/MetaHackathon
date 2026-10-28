export type DepthSurface = { id: string; image: string; surfaceImage?: string; textureImage: string; width: number; height: number; gridWidth: number; gridHeight: number; depth: number[]; baseZ: number; relief: number; bounds?: { x: number; y: number; width: number; height: number } };
export type DepthFrame = { key: string; model: string; image: string; farImage: string; width: number; height: number; gridWidth: number; gridHeight: number; depth: number[]; layers?: DepthSurface[] };
export function surfaceMesh(surface: DepthSurface) {
  if (!Number.isFinite(surface.baseZ) || Math.abs(surface.baseZ) > 1 || !Number.isFinite(surface.relief) || surface.relief < 0 || surface.relief > 1) throw Error('입체 면의 깊이가 올바르지 않아요.');
  depthMesh(surface as unknown as DepthFrame); // Validate dimensions and field.
  const w = surface.relief ? surface.gridWidth : 2, h = surface.relief ? surface.gridHeight : 2;
  const aspect = surface.width / surface.height, vertices = new Float32Array(w * h * 5), indices: number[] = [];
  const bounds = surface.bounds || { x: 0, y: 0, width: 1, height: 1 };
  if (![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) throw Error('배경 사진 범위가 올바르지 않아요.');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const u = x / (w - 1), v = y / (h - 1);
    const z = surface.baseZ + (surface.relief ? surface.depth[i] / 255 - .5 : 0) * surface.relief;
    const canvasU = bounds.x + u * bounds.width, canvasV = bounds.y + v * bounds.height;
    vertices.set([(canvasU * 2 - 1) * aspect * (3 - z) / 3, (1 - canvasV * 2) * (3 - z) / 3, z, u, v], i * 5);
  }
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) { const a = y * w + x; indices.push(a,a+w,a+1,a+1,a+w,a+w+1); }
  return { vertices, indices: new Uint16Array(indices), edges: [] };
}
// A depth map is inverse depth: bright pixels are closer. Reconstruct each ray
// so that the neutral camera exactly reproduces the original photo.
export function depthMesh(frame: DepthFrame) {
  const { gridWidth: w, gridHeight: h, depth } = frame;
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.width > 4096 || frame.height > 4096 || !Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || w * h > 65535 || depth.length !== w * h || !depth.every(v => Number.isFinite(v) && v >= 0 && v <= 255)) throw Error('깊이 데이터가 올바르지 않아요.');
  const aspect = frame.width / frame.height;
  const vertices = new Float32Array(w * h * 5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, u = x / (w - 1), v = y / (h - 1), z = (depth[i] / 255 - .5) * 1.1;
    vertices.set([(u * 2 - 1) * aspect * (3 - z) / 3, (1 - v * 2) * (3 - z) / 3, z, u, v], i * 5);
  }
  const indices: number[] = [], edgeData: number[] = [];
  const triangle = (ids: number[]) => {
    const values = ids.map(i => depth[i]);
    if (Math.max(...values) - Math.min(...values) <= 28) { indices.push(...ids); return; }
    // Disconnect depth discontinuities instead of stretching foreground colors
    // into long rubber walls. Duplicate this narrow boundary triangle onto the
    // nearer surface; the far plate covers the newly exposed background.
    const z = (Math.max(...values) / 255 - .5) * 1.1;
    for (const id of ids) { const u = vertices[id * 5 + 3], v = vertices[id * 5 + 4]; edgeData.push((u * 2 - 1) * aspect * (3 - z) / 3, (1 - v * 2) * (3 - z) / 3, z, u, v); }
  };
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) { const a = y * w + x, b = a + 1, c = a + w, d = c + 1; triangle([a,c,b]); triangle([b,c,d]); }
  const edges: { vertices: Float32Array; indices: Uint16Array }[] = [];
  for (let start = 0; start < edgeData.length; start += 63000 * 5) {
    const vertices = new Float32Array(edgeData.slice(start, start + 63000 * 5));
    edges.push({ vertices, indices: Uint16Array.from({ length: vertices.length / 5 }, (_, i) => i) });
  }
  return { vertices, indices: new Uint16Array(indices), edges };
}
export function depthCamera(motion: { x: number; y: number }, strength: number) {
  const clamp = (n: number) => Math.max(-1, Math.min(1, n));
  return { yaw: -clamp(motion.x) * .13 * strength, pitch: -clamp(motion.y) * .10 * strength, shiftX: clamp(motion.x) * .24 * strength, shiftY: -clamp(motion.y) * .18 * strength };
}
// Shared with the GPU shader and offline projection verification.
export function projectDepthPoint(point: number[], aspect: number, camera: ReturnType<typeof depthCamera>) {
  let [x, y, z] = point;
  const x1 = Math.cos(camera.yaw) * x + Math.sin(camera.yaw) * z;
  z = -Math.sin(camera.yaw) * x + Math.cos(camera.yaw) * z;
  const y1 = Math.cos(camera.pitch) * y - Math.sin(camera.pitch) * z;
  z = Math.sin(camera.pitch) * y + Math.cos(camera.pitch) * z;
  // Off-axis projection keeps the reference plane centred instead of sliding it.
  return { x: 3 * (x1 - camera.shiftX) / ((3 - z) * aspect) + camera.shiftX / aspect, y: 3 * (y1 - camera.shiftY) / (3 - z) + camera.shiftY, z: 3 - z };
}
