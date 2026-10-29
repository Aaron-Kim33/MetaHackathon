import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/index.mjs';
const wire='<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3\'7`e.ioeAf6-k/#Xd8%dX9x(|>';

test('generated stickers preserve stages, preview without editing, and remain reusable across projects and restarts',async t=>{
 await mkdir('.local/tests',{recursive:true});const root=await mkdtemp(path.resolve('.local/tests/generated-stickers-'));
 const image=await sharp({create:{width:320,height:334,channels:3,background:'#7755cc'}}).png().toBuffer();
 const counts={image:0,sam:0};let failSam=true;
 const fetcher=async(_url,init)=>{
  const body=JSON.parse(init.body);
  if(body.model==='muse-image-1.0'){counts.image++;return new Response(JSON.stringify({status:'completed',id:'mock-image',output:[{type:'image_generation_call',result:image.toString('base64')}]}));}
  counts.sam++;if(failSam){failSam=false;return new Response('{}',{status:503});}
  return new Response(JSON.stringify({status:'completed',id:'mock-sam',output_text:wire}));
 };
 let app=await createApp({root,token:'test',key:'mock',creditsConfirmed:true,caps:{image:1,sam:2},fetcher});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
 const call=async(route,data)=>{const r=await fetch(`http://127.0.0.1:${app.server.address().port}${route}`,{method:data?'POST':'GET',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};};
 const project=(await call('/projects',{image:image.toString('base64')})).data;
 const prompt='A purple butterfly',jobId=randomUUID();
 let response=await call('/stickers/generate',{projectId:project.project.id,prompt,jobId});assert.equal(response.status,502);assert.deepEqual(counts,{image:1,sam:1});
 let assets=(await call('/assets')).data.assets;assert.ok(assets.some(a=>a.kind==='generated'&&a.label===prompt),'generated source survives segmentation failure');
 response=await call('/stickers/generate',{projectId:project.project.id,prompt,jobId});assert.equal(response.status,409);assert.deepEqual(counts,{image:1,sam:1},'same uncertain job never retries');
 response=await call('/stickers/generate',{projectId:project.project.id,prompt,jobId:randomUUID(),retryFailed:true});assert.equal(response.status,200,response.data.error);
 assert.deepEqual(counts,{image:1,sam:2},'explicit retry executes only failed SAM stage');
 const asset=response.data;assert.equal(asset.kind,'generated-sticker');assert.ok(asset.data);assert.ok(asset.width<320&&asset.height<334,'transparent margins trimmed');
 const untouched=(await call(`/projects/${project.project.id}`)).data;assert.deepEqual(untouched.options,project.options);assert.equal(untouched.stickers.length,0,'preview does not alter canvas');
 assets=(await call('/assets')).data.assets;assert.ok(assets.some(a=>a.id===asset.id&&a.thumbnail));
 const added=(await call('/assets/add',{projectId:project.project.id,assetId:asset.id})).data;
 const options={...added.options,mode:'frame',tilt:8,frameScale:.85};await call('/options',{projectId:project.project.id,options});
 const another=(await call('/assets/add',{projectId:project.project.id,assetId:asset.id})).data;assert.equal(another.stickers.length,2);assert.deepEqual(another.options.stickerTransforms[0],options.stickerTransforms[0]);assert.equal(another.options.tilt,8);assert.equal(another.options.frameScale,.85);assert.deepEqual(counts,{image:1,sam:2});
 await new Promise(r=>app.server.close(r));
 app=await createApp({root,token:'test',key:'',creditsConfirmed:false,caps:{image:0,sam:0},fetcher:async()=>{throw Error('No provider call allowed');}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const second=(await call('/projects',{image:image.toString('base64')})).data;
 const reused=await call('/stickers/generate',{projectId:second.project.id,prompt,jobId:randomUUID()});assert.equal(reused.status,200,reused.data.error);assert.equal(reused.data.id,asset.id);
 const placed=await call('/assets/add',{projectId:second.project.id,assetId:asset.id});assert.equal(placed.status,200,placed.data.error);assert.equal(placed.data.stickers.length,1);
 const denied=await call('/stickers/generate',{projectId:second.project.id,prompt:'A new object',jobId:randomUUID()});assert.equal(denied.status,429);assert.deepEqual(counts,{image:1,sam:2});
});
