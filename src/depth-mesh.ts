import {rigidFaceDepth} from './face-safety.ts';
import { t } from './i18n.ts';
import { stableSurfaceDepth } from './surface-depth.ts';
import { repairedLayerDepth } from './layered-depth.ts';
export type DepthSurface = { faceMask?:number[]; id: string; image: string; surfaceImage?: string; textureImage: string; width: number; height: number; gridWidth: number; gridHeight: number; depth: number[]; baseZ: number; relief: number; focus?: {u:number;v:number;z:number;weight:number}; bounds?: { x: number; y: number; width: number; height: number } };
export type DepthFrame = { key: string; model: string; image: string; farImage: string; width: number; height: number; gridWidth: number; gridHeight: number; depth: number[]; layers?: DepthSurface[] };
export function surfaceMesh(surface: DepthSurface) {
  if (!Number.isFinite(surface.baseZ) || Math.abs(surface.baseZ) > 1 || !Number.isFinite(surface.relief) || surface.relief < 0 || surface.relief > 1) throw Error(t("입체 면의 깊이가 올바르지 않아요."));
  depthMesh(surface as unknown as DepthFrame); // Validate dimensions and field.
  const w = surface.relief ? surface.gridWidth : 2, h = surface.relief ? surface.gridHeight : 2;
  let field = surface.relief ? (surface.id==='backdrop' ? stableSurfaceDepth(surface.depth,w,h,true) : repairedLayerDepth(surface.depth,w,h)) : null;
  if(field&&surface.faceMask&&surface.id!=='backdrop')field=rigidFaceDepth(Array.from(field),surface.faceMask,w,h);
  const aspect = surface.width / surface.height, vertices = new Float32Array(w * h * 5), indices: number[] = [];
  const bounds = surface.bounds || { x: 0, y: 0, width: 1, height: 1 };
  if (![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) throw Error(t("배경 사진 범위가 올바르지 않아요."));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const u = x / (w - 1), v = y / (h - 1);
    // Keep the outer photo boundary planar so framing uses the actual rectangle,
    // rather than chasing noisy edge-depth estimates as the phone tilts.
    const boundary = surface.id === 'backdrop' && (x === 0 || y === 0 || x === w - 1 || y === h - 1);
    const z = surface.baseZ + (field && !boundary ? field[i] / 255 - .5 : 0) * surface.relief;
    const canvasU = bounds.x + u * bounds.width, canvasV = bounds.y + v * bounds.height;
    vertices.set([(canvasU * 2 - 1) * aspect * (3 - z) / 3, (1 - canvasV * 2) * (3 - z) / 3, z, u, v], i * 5);
  }
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const a=y*w+x;indices.push(a,a+w,a+1,a+1,a+w,a+w+1);
  }
  return {vertices,indices:new Uint16Array(indices),edges:[]};
}
// A depth map is inverse depth: bright pixels are closer. Reconstruct each ray
// so that the neutral camera exactly reproduces the original photo.
export function depthMesh(frame: DepthFrame) {
  const { gridWidth: w, gridHeight: h, depth } = frame;
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.width > 4096 || frame.height > 4096 || !Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || w * h > 65535 || depth.length !== w * h || !depth.every(v => Number.isFinite(v) && v >= 0 && v <= 255)) throw Error(t("깊이 데이터가 올바르지 않아요."));
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
export function spatialObjectView(motion:{x:number;y:number},strength:number){
  const clamp=(n:number)=>Math.max(-1,Math.min(1,n));
  return {yaw:-clamp(motion.x)*.22*strength,pitch:-clamp(motion.y)*.16*strength};
}
// Rotate the reconstructed surface around the foreground focus, not around the
// screen origin. Its centre stays put while its sides change perspective.
export function orbitDepthPoint(point:number[],pivot:number[],view:ReturnType<typeof spatialObjectView>){
  const [x,y,z]=point.map((v,i)=>v-pivot[i]),cy=Math.cos(view.yaw),sy=Math.sin(view.yaw),cx=Math.cos(view.pitch),sx=Math.sin(view.pitch);
  const x1=cy*x+sy*z,z1=-sy*x+cy*z;
  return [x1+pivot[0],cx*y-sx*z1+pivot[1],sx*y+cx*z1+pivot[2]];
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

type ViewPan = { x: number; y: number };
type ViewConstraint = ViewPan & { minimum: number };
// Find the nearest viewport translation that keeps all four corners inside the
// real background. Only framing moves; camera rotation and depth stay intact.
function closestViewPan(constraints: ViewConstraint[], target: ViewPan): ViewPan | null {
  const inside = (p: ViewPan) => constraints.every(c => c.x * p.x + c.y * p.y >= c.minimum - 1e-8);
  if (inside(target)) return target;
  const candidates: ViewPan[] = [];
  for (let i = 0; i < constraints.length; i++) {
    const c = constraints[i], amount = (c.minimum - c.x * target.x - c.y * target.y) / (c.x * c.x + c.y * c.y);
    candidates.push({ x: target.x + c.x * amount, y: target.y + c.y * amount });
    for (const d of constraints.slice(i + 1)) {
      const determinant = c.x * d.y - c.y * d.x;
      if (Math.abs(determinant) > 1e-10) candidates.push({ x: (c.minimum * d.y - c.y * d.minimum) / determinant, y: (c.x * d.minimum - c.minimum * d.x) / determinant });
    }
  }
  return candidates.filter(inside).sort((a,b) => (a.x-target.x)**2+(a.y-target.y)**2-((b.x-target.x)**2+(b.y-target.y)**2))[0] || null;
}
export function spatialPreviewSurface(surface:DepthSurface):DepthSurface {
  return surface.id==='backdrop'?{...surface,baseZ:Math.max(-.95,surface.baseZ-.1),relief:surface.relief*1.3}:surface;
}
export function foregroundFocus(layers:DepthSurface[]){
  const front=layers.filter(s=>s.id!=='backdrop'&&s.id!=='phone');
  if(!front.length)return [0,0,0];
  let u=0,v=0,z=0,total=0;
  for(const s of front){const f=s.focus||{u:.5,v:.5,z:s.baseZ,weight:1},w=Math.max(.001,f.weight);u+=f.u*w;v+=f.v*w;z+=f.z*w;total+=w;}
  u/=total;v/=total;z/=total;const aspect=front[0].width/front[0].height;
  return [(u*2-1)*aspect*(3-z)/3,(1-v*2)*(3-z)/3,z];
}
export function createDepthFraming(surface: DepthSurface,focus?:number[]) {
  const aspect = surface.width / surface.height, b = surface.bounds || { x: 0, y: 0, width: 1, height: 1 }, z = surface.baseZ;
  // Clockwise in clip space, matching the four planar outer edges of backdrop.
  const corners = [[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([u,v]) => [(u*2-1)*aspect*(3-z)/3,(1-v*2)*(3-z)/3,z]);
  const constraints = (camera: ReturnType<typeof depthCamera>, scale: number) => {
    const points = corners.map(p => projectDepthPoint(p,aspect,camera));
    return points.map((p,i) => {
      const q = points[(i+1)%4], x = p.y-q.y, y = q.x-p.x;
      return { x, y, minimum: Math.abs(x)+Math.abs(y)+.001-scale*(x*p.x+y*p.y) };
    });
  };
  const neutral=focus?projectDepthPoint(focus,aspect,depthCamera({x:0,y:0},0)):null;
  const focusPan=(camera:ReturnType<typeof depthCamera>,scale:number)=>{
    const p=projectDepthPoint(focus!,aspect,camera);return{x:(neutral!.x-p.x)*scale,y:(neutral!.y-p.y)*scale};
  };
  // Choose the crop ONCE, including maximum strength. Never zoom in response to
  // live tilt or strength changes. The small safety margin covers between samples.
  const samples: { camera: ReturnType<typeof depthCamera>; target: ViewPan }[] = [];
  for (let y=-1;y<=1.001;y+=.25) for(let x=-1;x<=1.001;x+=.25) samples.push({camera:depthCamera({x,y},1),target:{x:-x*.10,y:-y*.10}});
  let low=1.12, high=2;
  // Reserve room for an actual peek, not merely enough to hide a stationary edge.
  const foregroundScale=1.12;
  const fits = (scale: number) => samples.every(({camera,target}) => {const pan=focus?focusPan(camera,foregroundScale):target;return constraints(camera,scale).every(c => c.x*pan.x+c.y*pan.y >= c.minimum);});
  if (!fits(low)) { for(let i=0;i<20;i++){const middle=(low+high)/2;if(fits(middle))high=middle;else low=middle;} low=high+.005; }
  // Reserve the extra surround in the background only. Keep foreground framing
  // fixed so stabilising the subject cannot enlarge the phone or stickers.
  const backgroundScale=low,scale=focus?foregroundScale:low;
  return { scale, backgroundScale, pan(motion: ViewPan, strength: number) {
    const clamp = (n: number) => Math.max(-1,Math.min(1,n));
    const target = focus?focusPan(depthCamera(motion,strength),scale):{ x:-clamp(motion.x)*.16*strength, y:-clamp(motion.y)*.16*strength };
    return closestViewPan(constraints(depthCamera(motion,strength),backgroundScale),target) || {x:0,y:0};
  }};
}
