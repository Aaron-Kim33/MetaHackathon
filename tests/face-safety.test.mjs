import test from 'node:test';
import assert from 'node:assert/strict';
import {rigidFaceDepth} from '../src/face-safety.ts';
import {surfaceMesh,depthCamera,projectDepthPoint} from '../src/depth-mesh.ts';
import sharp from 'sharp';
import {faceMaskImage} from '../server/face-regions.mjs';
test('head mask ends just below the detected chin instead of covering clavicles',async()=>{
 const bytes=await sharp({create:{width:200,height:200,channels:3,background:'white'}}).png().toBuffer();
 const face={x:.3,y:.2,width:.3,height:.3};
 const mask=await sharp(await faceMaskImage(bytes,[face])).extractChannel(0).raw().toBuffer();
 assert.equal(mask[65*200+90],255);
 for(let y=108;y<200;y++)for(let x=0;x<200;x++)assert.equal(mask[y*200+x],0);
 assert.ok(mask.some(v=>v>0&&v<255),'feather is inside the bounded mask');
});
test('face correction never propagates into unmasked neck or torso',()=>{
 const w=20,h=20,depth=Array.from({length:w*h},(_,i)=>i%w*8),mask=Array(w*h).fill(0);
 mask[5*w+8]=255;mask[5*w+9]=255;mask[6*w+8]=80;
 const result=rigidFaceDepth(depth,mask,w,h);
 for(let i=0;i<mask.length;i++)if(mask[i]===0)assert.equal(result[i],depth[i]);
 assert.ok(Math.abs(result[6*w+8]-depth[6*w+8])<Math.abs(result[5*w+8]-depth[5*w+8]));
});
test('each face stays internally rigid while distant body relief survives',()=>{
 const w=32,h=24,a=Array.from({length:w*h},(_,i)=>40+i%w*5),mask=Array(w*h).fill(0);
 for(let y=5;y<12;y++)for(let x=5;x<12;x++)mask[y*w+x]=255;
 for(let y=5;y<12;y++)for(let x=22;x<28;x++)mask[y*w+x]=255;
 const b=rigidFaceDepth(a,mask,w,h);let first,second;
 for(let y=5;y<12;y++)for(let x=5;x<12;x++){first??=b[y*w+x];assert.equal(b[y*w+x],first);}
 for(let y=5;y<12;y++)for(let x=22;x<28;x++){second??=b[y*w+x];assert.equal(b[y*w+x],second);}
 assert.notEqual(first,second);assert.equal(b[23*w],a[23*w]);assert.notEqual(b[23*w],b[23*w+31]);
});
test('protection preserves source UV and neutral projection without rear copies or holes',()=>{
 const w=32,h=24,s={id:'subject',width:800,height:1000,gridWidth:w,gridHeight:h,depth:Array.from({length:w*h},(_,i)=>40+i%w*5),faceMask:Array(w*h).fill(255),baseZ:.4,relief:.48};
 const mesh=surfaceMesh(s);assert.equal(mesh.indices.length,(w-1)*(h-1)*6);assert.equal(mesh.edges.length,0);
 const z=mesh.vertices[2];for(let i=0;i<mesh.vertices.length;i+=5){assert.equal(mesh.vertices[i+2],z);const p=projectDepthPoint([...mesh.vertices.slice(i,i+3)],.8,depthCamera({x:0,y:0},.7));assert.ok(Math.abs(p.x-(mesh.vertices[i+3]*2-1))<1e-6);assert.ok(Math.abs(p.y-(1-mesh.vertices[i+4]*2))<1e-6);}
});
