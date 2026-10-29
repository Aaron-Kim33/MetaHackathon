import test from 'node:test';
import assert from 'node:assert/strict';
import {createDepthFraming,depthCamera,foregroundFocus,projectDepthPoint,spatialPreviewSurface,surfaceMesh} from '../src/depth-mesh.ts';
const surface=(width,height)=>({id:'backdrop',width,height,gridWidth:3,gridHeight:3,depth:Array(9).fill(128),baseZ:-.6,relief:.18,bounds:{x:0,y:-.12,width:1,height:1.24}});
test('foreground focus stays at its edited position while background reveals depth, with fixed foreground size',()=>{
 for(const height of [1080,1350,1920]){
  const source=surface(1080,height),background=spatialPreviewSurface(source),aspect=1080/height;
  const front=spatialPreviewSurface({...source,id:'sticker-a',baseZ:.45,relief:.2,focus:{u:.56,v:.46,z:.47,weight:.2}}),focus=foregroundFocus([background,front]);
  const framing=createDepthFraming(background,focus),neutral=projectDepthPoint(focus,aspect,depthCamera({x:0,y:0},0));
  assert.equal(framing.scale,1.12,'background overscan must not enlarge the phone or subject');
  assert.ok(framing.backgroundScale<1.85);
  const mesh=surfaceMesh(background),corners=[0,2,8,6],fixedScale=framing.backgroundScale;
  for(let x=-1;x<=1.001;x+=.1)for(let y=-1;y<=1.001;y+=.1){
   const c=depthCamera({x,y},1),pan=framing.pan({x,y},1),p=projectDepthPoint(focus,aspect,c);
   assert.ok(Math.abs(p.x*framing.scale+pan.x-neutral.x*framing.scale)<1e-6);
   assert.ok(Math.abs(p.y*framing.scale+pan.y-neutral.y*framing.scale)<1e-6);
   const quad=corners.map(i=>{const q=projectDepthPoint([...mesh.vertices.slice(i*5,i*5+3)],aspect,c);return{x:q.x*fixedScale+pan.x,y:q.y*fixedScale+pan.y};});
   for(const corner of [{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}])for(let i=0;i<4;i++){const a=quad[i],b=quad[(i+1)%4];assert.ok((b.x-a.x)*(corner.y-a.y)-(b.y-a.y)*(corner.x-a.x)<1e-5,'real background covers viewport');}
   assert.equal(framing.backgroundScale,fixedScale,'no zoom changes while tilting');
  }
  const old=createDepthFraming(source),motion={x:1,y:0},c=depthCamera(motion,.7),oldPan=old.pan(motion,.7),pan=framing.pan(motion,.7);
  const oldMovement=Math.abs(projectDepthPoint([0,0,source.baseZ],aspect,c).x*old.scale+oldPan.x);
  const movement=Math.abs(projectDepthPoint([0,0,background.baseZ],aspect,c).x*framing.backgroundScale+pan.x);
  assert.ok(movement>oldMovement*2,'background motion should no longer be cancelled by global pan');
 }
});
test('depth differences remain perspective-based instead of translating all background pixels equally',()=>{
 const background=spatialPreviewSurface(surface(800,1000)),focus=[0,0,.45],framing=createDepthFraming(background,focus),motion={x:.8,y:.5},c=depthCamera(motion,.7),pan=framing.pan(motion,.7);
 const positions=[-.55,-.85].map(z=>{const p=projectDepthPoint([0,0,z],.8,c);return{x:p.x*framing.backgroundScale+pan.x,y:p.y*framing.backgroundScale+pan.y};});
 assert.ok(Math.hypot(positions[0].x-positions[1].x,positions[0].y-positions[1].y)>.01);
 const near=projectDepthPoint(focus,.8,c);assert.ok(Math.hypot(near.x*framing.scale+pan.x,near.y*framing.scale+pan.y)<1e-6);
});
