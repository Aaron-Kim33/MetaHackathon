import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {recordedModelFetch,readTestRecords,saveTestRecord,addTestOutput} from '../server/experiment-log.mjs';
import {summarizeTests} from '../scripts/render-ai-test-log.mjs';
const temporary=async()=>{await mkdir('.local/tests',{recursive:true});return mkdtemp(path.resolve('.local/tests/experiment-log-'));};

test('recorder archives exact prompts and assets, never keys, and records no-match image costs',async()=>{
 const root=await temporary();let calls=0;
 const response=await recordedModelFetch('https://api.meta.ai/v1/responses',{method:'POST',headers:{Authorization:'Bearer secret-not-for-log'},body:JSON.stringify({model:'sam-3.1',input:[{role:'user',content:[{type:'input_text',text:'background'},{type:'input_image',image_url:'data:image/png;base64,aGVsbG8='}]}],store:false})},{root,simulation:true,context:{approval:'Mock only, no live call'},fetcher:async()=>{calls++;return new Response(JSON.stringify({id:'mock-request',status:'completed',output_text:'',usage:{images_processed:1}}),{status:200});}});
 assert.equal(calls,1);const records=await readTestRecords(root),record=records[0];
 assert.equal(record.id,response.experimentId);assert.deepEqual(record.prompts,['background']);assert.equal(record.estimatedUsd,.0025);assert.equal(record.actualBilledUsd,null);assert.ok(record.elapsedMs>=0);
 assert.equal(await readFile(path.join(root,record.inputs[0].file),'utf8'),'hello');
 assert.ok(!(await readFile(path.join(root,'index.json'),'utf8')).includes('secret-not-for-log'));
 assert.equal(summarizeTests(records).inferenceCalls,0,'simulated calls never inflate live totals');
 await addTestOutput(record.id,Buffer.from('output'),'Final result',root);
 assert.equal((await readTestRecords(root))[0].outputs.length,1);
});

test('HTTP errors are logged once with unknown cost and never retried; string prompts are supported',async()=>{
 const root=await temporary();let calls=0;
 const response=await recordedModelFetch('https://api.meta.ai/v1/responses',{method:'POST',body:JSON.stringify({model:'muse-image-1.0',input:'one silver star'})},{root,simulation:true,fetcher:async()=>{calls++;return new Response(JSON.stringify({error:{message:'failed'}}),{status:503});}});
 assert.equal(response.status,503);assert.equal(calls,1);
 const [record]=await readTestRecords(root);assert.equal(record.status,'http_error');assert.equal(record.estimatedUsd,null);assert.deepEqual(record.prompts,['one silver star']);
});

test('summary separates live inference, metadata, local work and unconfirmed Billing',async()=>{
 const root=await temporary();
 for(const r of [{id:'sam',type:'inference',model:'sam-3.1',requestCount:6,estimatedUsd:.015},{id:'image',type:'inference',model:'muse-image-1.0',requestCount:1,estimatedUsd:.01},{id:'list',type:'metadata',requestCount:1,estimatedUsd:0},{id:'local',type:'postprocess',requestCount:0,estimatedUsd:0}])await saveTestRecord(r,root);
 const result=summarizeTests(await readTestRecords(root));assert.equal(result.inferenceCalls,7);assert.equal(result.estimatedUsd,.025);assert.equal(result.actualBilledUsd,null);assert.equal(result.metadataChecks,1);assert.equal(result.localPostprocesses,1);
 assert.ok((await readFile(path.join(root,'README.md'),'utf8')).includes('$0.0250'));
});
