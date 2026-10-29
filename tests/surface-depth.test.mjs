import test from 'node:test';
import assert from 'node:assert/strict';
import {stableSurfaceDepth} from '../src/surface-depth.ts';
import {surfaceMesh,projectDepthPoint,depthCamera} from '../src/depth-mesh.ts';

test('depth grid chatter and isolated spikes are removed while broad depth remains',()=>{
 const w=96,h=96,input=Array.from({length:w*h},(_,i)=>Math.floor(i/w)<h/2?40:210);
 const noisy=input.map((v,i)=>v+((i%w+Math.floor(i/w))%2?12:-12));noisy[25*w+25]=255;
 const result=stableSurfaceDepth(noisy,w,h);
 assert.ok(Math.abs(result[25*w+25]-40)<25,'isolated spike is suppressed');
 assert.ok(Math.abs(result[20*w+20]-40)<1);
 assert.ok(Math.abs(result[75*w+75]-210)<1,'large depth separation is retained');
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;for(const j of [x+1<w?i+1:-1,y+1<h?i+w:-1])if(j>=0)assert.ok(Math.abs(result[i]-result[j])<=1200/w+1e-8);
 }
 assert.deepEqual(noisy.slice(0,3),[28,52,28],'input is immutable');
});
test('background perimeter transitions continuously into its existing rigid boundary',()=>{
 const w=96,h=96,result=stableSurfaceDepth(Array(w*h).fill(250),w,h,true);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;if(x===0||y===0||x===w-1||y===h-1)assert.equal(result[i],128);
  for(const j of [x+1<w?i+1:-1,y+1<h?i+w:-1])if(j>=0)assert.ok(Math.abs(result[i]-result[j])<=1200/w+1e-8);
 }
 assert.equal(result[48*w+48],250,'interior relief is not flattened');
});
test('conditioned geometry preserves neutral photo alignment and rigid phone exactly',()=>{
 const surface={id:'subject',width:800,height:1000,gridWidth:96,gridHeight:120,depth:Array.from({length:96*120},(_,i)=>(i%7)*40),baseZ:.4,relief:.48};
 const mesh=surfaceMesh(surface);
 for(let i=0;i<mesh.vertices.length;i+=5){
  const p=projectDepthPoint([...mesh.vertices.slice(i,i+3)],.8,depthCamera({x:0,y:0},.7));
  assert.ok(Math.abs(p.x-(mesh.vertices[i+3]*2-1))<1e-6);assert.ok(Math.abs(p.y-(1-mesh.vertices[i+4]*2))<1e-6);
 }
 const phone=surfaceMesh({...surface,id:'phone',baseZ:0,relief:0});
 assert.equal(phone.vertices.length,20);for(let i=2;i<phone.vertices.length;i+=5)assert.equal(phone.vertices[i],0);
});
