import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {atomicJson} from './store.mjs';
import {renderTestLog} from '../scripts/render-ai-test-log.mjs';

export const experimentRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.local/ai-tests');
export const pricing={verifiedDate:'2026-10-28',source:'https://dev.meta.ai/docs/pricing-rate-limits','sam-3.1':{unit:'processed image',usd:.0025},'muse-image-1.0':{unit:'returned image',usd:.01}};
export async function saveTestAsset(root,bytes,extension='png'){
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const relative=`assets/${sha256}.${extension}`;await mkdir(path.join(root,'assets'),{recursive:true});
  await writeFile(path.join(root,relative),bytes,{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  return {file:relative,sha256};
}
export async function snapshotTestFile(root,file){return saveTestAsset(root,await readFile(file),path.extname(file).slice(1)||'bin');}
export async function saveTestRecord(record,root=experimentRoot){
  if(!/^[a-zA-Z0-9_-]+$/.test(record.id))throw Error('Invalid experiment ID');
  await atomicJson(path.join(root,'records',`${record.id}.json`),{schemaVersion:1,...record});
  await renderTestLog(root,await readTestRecords(root));return record;
}
export async function updateTestRecord(id,patch,root=experimentRoot){
  const file=path.join(root,'records',`${id}.json`);const record=JSON.parse(await readFile(file,'utf8'));return saveTestRecord({...record,...patch},root);
}
export async function readTestRecords(root=experimentRoot){
  await mkdir(path.join(root,'records'),{recursive:true});
  const files=(await readdir(path.join(root,'records'))).filter(f=>f.endsWith('.json'));
  const records=await Promise.all(files.map(f=>readFile(path.join(root,'records',f),'utf8').then(JSON.parse)));
  return records.sort((a,b)=>(a.order??Infinity)-(b.order??Infinity)||(a.startedAt||'').localeCompare(b.startedAt||'')||a.id.localeCompare(b.id));
}
export async function addTestOutput(id,bytes,label,root=experimentRoot){
  const asset=await saveTestAsset(root,bytes);const record=JSON.parse(await readFile(path.join(root,'records',`${id}.json`),'utf8'));
  return updateTestRecord(id,{outputs:[...(record.outputs||[]),{...asset,label}]},root);
}
async function archiveMedia(value,root,assets){
  if(Array.isArray(value))return Promise.all(value.map(v=>archiveMedia(v,root,assets)));
  if(value&&typeof value==='object'){
    const result={};for(const [key,item]of Object.entries(value)){
      if(/^(authorization|api_key|MODEL_API_KEY|pairingToken|POPOUT_TOKEN)$/i.test(key))continue;
      if(key==='result'&&value.type==='image_generation_call'&&typeof item==='string'){
        const asset=await saveTestAsset(root,Buffer.from(item,'base64'));assets.push({...asset,label:'Generated image'});result[key]={asset:asset.file};
      }else result[key]=await archiveMedia(item,root,assets);
    }return result;
  }
  if(typeof value==='string'){
    const match=/^data:image\/(png|jpeg|webp);base64,([\s\S]+)$/.exec(value);
    if(match){const asset=await saveTestAsset(root,Buffer.from(match[2],'base64'),match[1]);assets.push(asset);return {asset:asset.file};}
  }
  return value;
}
// No retries. Archive exact prompts and image snapshots BEFORE sending a request.
// This wrapper never stores HTTP headers or API keys. Injected test fetchers must
// explicitly use simulation:true so mock runs cannot inflate live usage totals.
export async function recordedModelFetch(url,options,{root=experimentRoot,fetcher=fetch,context={},simulation=false}={}){
  const body=JSON.parse(options.body),id=`request-${randomUUID()}`,inputs=[];
  const request=await archiveMedia(body,root,inputs),startedAt=new Date().toISOString();
  const prompts=typeof body.input==='string'?[body.input]:(body.input||[]).flatMap(m=>m.content||[]).filter(p=>p.type==='input_text').map(p=>p.text);
  await saveTestRecord({id,type:'inference',group:context.group||'app',model:body.model,status:'prepared',startedAt,inputs,outputs:[],request,prompts,context,simulation,requestCount:0,estimatedUsd:null,actualBilledUsd:null,pricing},root);
  const start=performance.now();
  try{
    await updateTestRecord(id,{status:'running',requestCount:1},root);
    const response=await fetcher(url,options),httpElapsedMs=Math.round(performance.now()-start);
    const raw=await response.clone().text();let decoded;try{decoded=JSON.parse(raw);}catch{decoded={unparsed:raw};}
    const outputs=[],archived=await archiveMedia(decoded,root,outputs);
    await mkdir(path.join(root,'responses'),{recursive:true});await atomicJson(path.join(root,'responses',id+'.json'),archived);
    const units=body.model==='sam-3.1'?decoded.usage?.images_processed:outputs.length;
    const estimatedUsd=response.ok&&typeof units==='number'&&pricing[body.model]?units*pricing[body.model].usd:null;
    await updateTestRecord(id,{status:response.ok?'response_received':'http_error',completedAt:new Date().toISOString(),httpElapsedMs,elapsedMs:Math.round(performance.now()-start),durationScope:'Client HTTP request plus response archive, not pure model compute',httpStatus:response.status,requestId:response.headers.get('x-request-id')||decoded.id||null,usage:decoded.usage||null,units:units??null,estimatedUsd,outputs,responseFile:`responses/${id}.json`},root);
    Object.defineProperty(response,'experimentId',{value:id});Object.defineProperty(response,'experimentRoot',{value:root});return response;
  }catch(error){
    await updateTestRecord(id,{status:'uncertain',completedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-start),error:error.name,estimatedUsd:null},root);throw error;
  }
}
