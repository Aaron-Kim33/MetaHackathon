import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {alphaBounds,makeHitMask,trimSticker} from '../server/mask.mjs';
import {hitLayer,hitMaskBounds} from '../src/hit-testing.ts';
import {stickerRect,visibleStickerRect,keepStickerVisible} from '../src/layout.ts';
import {rotatePoint} from '../src/rotation.ts';
import {settings} from '../server/composition.mjs';

async function cutout(){
 const rgba=Buffer.alloc(100*100*4);
 for(let y=20;y<80;y++)for(let x=60;x<80;x++){if(x>=66&&x<74&&y>=40&&y<60)continue;const i=(y*100+x)*4;rgba.set([230,20,30,255],i);}
 rgba.set([255,255,255,4],0);
 return sharp(rgba,{raw:{width:100,height:100,channels:4}}).png().toBuffer();
}
test('visible bounds and fresh stickers ignore transparent padding and nearly invisible alpha noise',async()=>{
 const bytes=await cutout(),bounds=await alphaBounds(bytes),trimmed=await trimSticker(bytes,bytes);
 assert.deepEqual(bounds,{x:.6,y:.2,width:.2,height:.6});assert.equal(trimmed.width,20);assert.equal(trimmed.height,60);
 const mask=await makeHitMask(bytes);assert.equal(mask.width,128);
 const legacyBounds=hitMaskBounds(mask);assert.ok(legacyBounds.x>.57&&legacyBounds.width<.25);
 const opaque=await sharp({create:{width:10,height:12,channels:3,background:'#fff'}}).png().toBuffer();assert.deepEqual(await alphaBounds(opaque),{x:0,y:0,width:1,height:1});
});
test('transparent padding and internal holes select the layer underneath, including after rotation',async()=>{
 const bytes=await cutout(),mask=await makeHitMask(bytes),bounds=await alphaBounds(bytes),size={width:100,height:100};
 for(const rotation of [0,40,90]){
  const transform={id:'top',x:.5,y:.5,scale:.7,rotation},bottom={id:'bottom',x:.5,y:.5,scale:1};
  const options={...settings({mode:'plain',hidePrimary:true}),stickerTransforms:[bottom,transform],layerOrder:['primary','bottom','top']};
  const view={project:size,stickers:[{id:'bottom',...size},{id:'top',...size,hitMask:mask,bounds}]};
  const rect=stickerRect(size,transform,{width:1080,height:1350}),center={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  for(const [u,v,expected]of [[.7,.3,'top'],[.7,.5,'bottom'],[.2,.3,'bottom']]){
   const p=rotatePoint({x:rect.x+u*rect.width,y:rect.y+v*rect.height},center,rotation);
   assert.equal(hitLayer(view,options,p,1080),expected);
  }
 }
});
test('tight selection rotates around the original image pivot, and off-canvas recovery follows visible pixels',()=>{
 const source={width:100,height:100,bounds:{x:.6,y:.2,width:.2,height:.6}},canvas={width:1080,height:1350},t={id:'one',x:.5,y:.5,scale:.7,rotation:90};
 const full=stickerRect(source,t,canvas),tight=visibleStickerRect(source,t,canvas);
 const center=rotatePoint({x:full.x+.7*full.width,y:full.y+.5*full.height},{x:full.x+full.width/2,y:full.y+full.height/2},90);
 assert.ok(Math.abs(tight.x+tight.width/2-center.x)<1e-6);assert.ok(Math.abs(tight.y+tight.height/2-center.y)<1e-6);
 assert.ok(Math.abs(tight.width-full.height*.6)<1e-6);assert.ok(Math.abs(tight.height-full.width*.2)<1e-6);
 const moved=keepStickerVisible(source,{...t,x:-.3,y:-.3,rotation:0},canvas),visible=visibleStickerRect(source,moved,canvas);
 assert.ok(visible.x+visible.width>=Math.min(140,visible.width)-1);assert.ok(visible.y+visible.height>=Math.min(140,visible.height)-1);
});
