import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {ModelJobs} from '../server/store.mjs';
import {AssetLibrary,ReusableModels} from '../server/reusable-assets.mjs';
import {repairRoutes} from '../server/repair-routes.mjs';
import {recordedModelFetch} from '../server/experiment-log.mjs';
test('retouch is preview-only, preserves alpha, and reuses a saved generation without SAM',async()=>{
 await mkdir('.local/tests',{recursive:true});const root=await mkdtemp(path.resolve('.local/tests/retouch-'));
 const raw=Buffer.alloc(8*8*4);for(let i=0;i<64;i++){raw[i*4]=200;raw[i*4+3]=i%8<4?255:0;}
 const original=await sharp(raw,{raw:{width:8,height:8,channels:4}}).png().toBuffer(),generated=await sharp({create:{width:16,height:16,channels:3,background:'#2040a0'}}).png().toBuffer();
 const library=new AssetLibrary(root),asset=await library.put({source:original,cutout:original});
 const jobs=new ModelJobs(path.join(root,'jobs.json'),{image:1,sam:0});await jobs.init();const models=new ReusableModels(root,jobs,true);let calls=0,result;
 const fetcher=(url,options)=>recordedModelFetch(url,options,{root:path.join(root,'ai-tests'),simulation:true,fetcher:async(_url,opts)=>{calls++;assert.equal(JSON.parse(opts.body).model,'muse-image-1.0');return new Response(JSON.stringify({status:'completed',output:[{type:'image_generation_call',result:generated.toString('base64')}]}),{status:200,headers:{'Content-Type':'application/json'}});}});
 const context={library,models,jobs,fetcher,key:'mock-only',modelReady:()=>{},cachedSegment:()=>{throw Error('SAM must not run');}};
 const execute=async(id)=>repairRoutes('/retouch',{assetId:asset.id,instruction:'warmer lighting',jobId:id},context,(_status,body)=>{result=body;});
 const id=randomUUID();await execute(id);assert.equal(result.kind,'retouch');assert.notEqual(result.id,asset.id);
 const output=await sharp(await library.bytes(result.id)).ensureAlpha().raw().toBuffer();for(let i=0;i<64;i++)assert.equal(output[i*4+3],raw[i*4+3]);
 assert.deepEqual(await library.bytes(asset.id),original);assert.equal(jobs.usage().sam.reserved,0);
 await execute(id);await execute(randomUUID());assert.equal(calls,1);assert.equal(jobs.usage().image.reserved,1);
});
