import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/index.mjs';
import { settings, compose } from '../server/composition.mjs';
import { buildCompositionScene } from '../src/composition-scene.ts';
import { backgroundPhotoRect } from '../src/layout.ts';
import { PHOTO_FRAME_PRESET } from '../src/frame-preset.ts';
import { SnapshotJournal } from '../src/snapshot-journal.ts';
const photo = async (color, width=80,height=120) => sharp({create:{width,height,channels:3,background:color}}).png().toBuffer();
test('background photo survives replacement, removal, reopen and main-photo changes without touching stickers or masks',async t=>{
  await mkdir('.local/tests',{recursive:true});
  const app=await createApp({root:await mkdtemp(path.resolve('.local/tests/background-')),token:'background',key:'',caps:{sam:0,image:0}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>app.server.close(r)));
  const post=async(route,data)=>{const r=await fetch(`http://127.0.0.1:${app.server.address().port}${route}`,{method:'POST',headers:{Authorization:'Bearer background','Content-Type':'application/json'},body:JSON.stringify(data)});const v=await r.json();assert.equal(r.status,200,v.error);return v;};
  const initial=await post('/fixture',{}),projectId=initial.project.id;
  const imported=await post('/imports',{projectId,image:(await photo('#0000ff')).toString('base64')});
  const cut=await post('/cutout',{projectId,assetId:imported.pendingPhoto.id,points:[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}]});
  const added=await post('/background',{projectId,image:(await photo('#00ff00')).toString('base64')});
  assert.deepEqual(added.options,cut.options);assert.equal(added.source,cut.source);assert.equal(added.subject,cut.subject);assert.deepEqual(added.stickers,cut.stickers);
  assert.equal(added.backgroundPhoto.width,80);assert.notEqual(added.image,cut.image);
  const moved=await post('/render',{projectId,options:{...added.options,x:.27,backgroundZoom:1.5,backgroundX:.2,backgroundDim:.2}});
  assert.equal(moved.backgroundPhoto.data,added.backgroundPhoto.data);
  const reloaded=await app.store.get(projectId);assert.ok(reloaded.backgroundPhoto.file.startsWith('background-'));assert.equal(reloaded.options.backgroundX,.2);
  const replaced=await post('/background',{projectId,image:(await photo('#ff0000',150,80)).toString('base64')});
  assert.notEqual(replaced.backgroundPhoto.data,added.backgroundPhoto.data);assert.equal(replaced.options.x,.27);assert.deepEqual(replaced.stickers,cut.stickers);
  const main=await post('/source/replace',{projectId,image:(await photo('#ffffff')).toString('base64')});assert.equal(main.backgroundPhoto.data,replaced.backgroundPhoto.data);
  const removed=await post('/background/remove',{projectId});assert.equal(removed.backgroundPhoto,null);assert.equal(removed.source,main.source);assert.deepEqual(removed.stickers,cut.stickers);
  assert.equal(app.jobs.usage().sam.reserved,0);assert.equal(app.jobs.usage().image.reserved,0);
});
test('background covers every ratio and is independent of foreground movement and phone transforms',()=>{
 for(const ratio of ['portrait','story','square']) for(const source of [{width:400,height:200},{width:200,height:400}]) {
  const content={source,backdrop:source,subject:true,shadow:true,stickers:[]},o=settings({mode:'frame',ratio});
  const a=buildCompositionScene(content,o),b=buildCompositionScene(content,{...o,x:.5,y:.3,tilt:12,frameX:.2});
  assert.deepEqual(a.background.find(n=>n.key==='background-photo'),b.background.find(n=>n.key==='background-photo'));
  for(const backgroundX of [0,.5,1])for(const backgroundY of [0,.5,1]) {const r=backgroundPhotoRect(source,a,{backgroundZoom:1.4,backgroundX,backgroundY});assert.ok(r.x<=0&&r.y<=0&&r.x+r.width>=a.width&&r.y+r.height>=a.height);}
  assert.ok(!buildCompositionScene(content,{...o,mode:'sticker'}).background.some(n=>n.key==='background-photo'));
 }
});
test('export actually renders background pixels and transparent exports omit them',async()=>{
 const source=await photo('#ffffff'),backgroundPhoto={bytes:await photo('#00ff00'),width:80,height:120};
 const a=await compose({source,backgroundPhoto,options:{mode:'plain',zoom:1,x:0,y:0,backgroundDim:0}});
 assert.deepEqual([...await sharp(a.bytes).extract({left:0,top:0,width:1,height:1}).raw().toBuffer()],[0,255,0,255]);
 const b=await compose({source,backgroundPhoto,options:{mode:'sticker'}});assert.equal((await sharp(b.bytes).ensureAlpha().raw().toBuffer())[3],0);
});
test('new frame preset upgrades untouched old poses while preserving customized poses',()=>{
 assert.equal(settings({mode:'frame'}).frameScale,PHOTO_FRAME_PRESET.frameScale);
 assert.equal(settings({mode:'frame',zoom:1.55,x:0,y:-.15}).frameScale,PHOTO_FRAME_PRESET.frameScale);
 const custom=settings({mode:'frame',zoom:1.8,x:.2,y:-.3,tilt:11});assert.equal(custom.frameScale,1);assert.equal(custom.x,.2);assert.equal(custom.tilt,11);
});
test('background media is cached once and restored without inflating draft metadata',async()=>{
 const files=new Map(),writes=[];const storage={ensure:async()=>{},read:async n=>files.get(n),write:async(n,d)=>{files.set(n,d);writes.push(n);},list:async()=>[...files.keys()],remove:async n=>files.delete(n)};
 const options=settings({mode:'plain'}),view={project:{id:'test'},image:'IMAGE',source:'SOURCE',options,backgroundPhoto:{data:'B'.repeat(300000),width:80,height:120}};
 const journal=new SnapshotJournal(storage),snapshot={view,draft:options,history:[],pendingJob:null,activeStickerId:'primary'};
 await journal.save(snapshot);const count=writes.filter(n=>n.endsWith('.b64')).length;await journal.save({...snapshot,draft:{...options,backgroundX:.2}});assert.equal(writes.filter(n=>n.endsWith('.b64')).length,count);
 assert.ok([...files].filter(([n])=>n.endsWith('.json')).every(([,d])=>d.length<6000));assert.equal((await new SnapshotJournal(storage).restore()).view.backgroundPhoto.data,view.backgroundPhoto.data);
});
