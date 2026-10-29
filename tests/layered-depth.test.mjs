import test from 'node:test';
import assert from 'node:assert/strict';
import {layeredSurfaceDepth,crossesDepthBoundary,repairedLayerDepth} from '../src/layered-depth.ts';
import {surfaceMesh,projectDepthPoint,depthCamera} from '../src/depth-mesh.ts';
test('boundary repair keeps one continuous surface without a duplicate silhouette',()=>{
 const width=96,height=96,depth=Array.from({length:width*height},(_,i)=>i%width<48?40:210);
 const mesh=surfaceMesh({id:'subject',width:800,height:1000,gridWidth:width,gridHeight:height,depth,baseZ:.4,relief:.48});
 assert.equal(mesh.indices.length,(width-1)*(height-1)*6);
 assert.equal(mesh.edges.length,0);
 const base=layeredSurfaceDepth(depth,width,height),fixed=repairedLayerDepth(depth,width,height);
 assert.equal(fixed[48*width+12],base[48*width+12]);
 assert.equal(fixed[48*width+80],base[48*width+80]);
 assert.ok(Math.abs(fixed[48*width+48]-fixed[48*width+47])<15);
 for(let i=0;i<mesh.vertices.length;i+=5){
  const p=projectDepthPoint([...mesh.vertices.slice(i,i+3)],.8,depthCamera({x:0,y:0},.7));
  assert.ok(Math.abs(p.x-(mesh.vertices[i+3]*2-1))<1e-6);
  assert.ok(Math.abs(p.y-(1-mesh.vertices[i+4]*2))<1e-6);
 }
});

test('occlusion stays discontinuous instead of becoming a stretched ramp',()=>{
 const w=32,h=24,a=Array.from({length:w*h},(_,i)=>i%w<16?40:210),b=layeredSurfaceDepth(a,w,h);
 assert.ok(b[12*w+15]<41);assert.ok(b[12*w+16]>209);
 assert.equal(crossesDepthBoundary(b,[12*w+15,12*w+16,13*w+15]),true);
});
test('continuous curved volume survives and isolated depth spikes do not',()=>{
 const w=32,h=32,a=Array.from({length:w*h},(_,i)=>70+100*Math.sin(Math.PI*(i%w)/(w-1)));
 a[16*w+16]=255;const b=layeredSurfaceDepth(a,w,h);
 assert.ok(b[16*w+16]>160&&b[16*w+16]<180);
 assert.ok(b[16*w+16]-b[16*w+2]>60);
 assert.equal(crossesDepthBoundary(b,[16*w+15,16*w+16,17*w+15]),false);
});
