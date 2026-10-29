import {mkdir,readFile,writeFile,readdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {serialize,deserialize} from 'node:v8';
import sharp from 'sharp';
import {atomicJson,validId} from './store.mjs';
import {insist} from './errors.mjs';
import {saveTestRecord} from './experiment-log.mjs';
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const uuid=hash=>`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
export class ReusableModels {
 constructor(root,jobs,simulation=false){this.root=root;this.jobs=jobs;this.simulation=simulation;}
 async run(kind,spec,execute,{retryFailed=false}={}){
  const started=performance.now();
  const key=createHash('sha256').update(stable(spec)).digest('hex'),file=path.join(this.root,'reuse-cache',key+'.bin');
  let cached;
  try{cached=deserialize(await readFile(file));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(cached){
   const value=cached,id=`reuse-${randomUUID()}`;
   await saveTestRecord({id,type:'reuse',group:'app',model:value.model,status:'reused',requestCount:0,estimatedUsd:0,actualBilledUsd:null,startedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-started),durationScope:'Local cache lookup; no model request',simulation:this.simulation,sourceExperimentId:value.experimentId||null,cacheKey:key,prompts:[spec.prompt||''],inputs:[],outputs:[]},path.join(this.root,'ai-tests'));
   return {...value,reused:true,experimentId:id,logRoot:path.join(this.root,'ai-tests')};
  }
  let id=uuid(key),previous=this.jobs.jobs[id];
  if(retryFailed&&previous?.status==='uncertain')id=randomUUID();
  await this.jobs.run(id,kind,key,async()=>{
   const value=await execute();await mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,serialize(value));await rename(temporary,file);return {cacheKey:key};
  });
  return deserialize(await readFile(file));
 }
}
export class AssetLibrary {
 constructor(root){this.folder=path.join(root,'asset-library');}
 async put({source,cutout,label='Cutout',kind='cutout',parentId=null,provenance={}}){
  const hash=createHash('sha256').update(source).update(cutout).digest('hex'),id=uuid(hash),folder=path.join(this.folder,id);
  try{return await this.get(id);}catch(error){if(error.code!=='ENOENT')throw error;}
  const meta=await sharp(cutout).metadata(),parent=parentId?await this.get(parentId):null;
  await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'source.png'),source);await writeFile(path.join(folder,'cutout.png'),cutout);
  const thumbnail=await sharp(cutout).resize({width:180,height:180,fit:'inside',withoutEnlargement:true}).png().toBuffer();await writeFile(path.join(folder,'thumbnail.png'),thumbnail);
  const asset={id,label,kind,parentId,originId:parent?.originId||id,createdAt:new Date().toISOString(),width:meta.width,height:meta.height,provenance};await atomicJson(path.join(folder,'asset.json'),asset);return asset;
 }
 async get(id){insist(validId(id),'스티커 ID를 확인해 주세요.');return JSON.parse(await readFile(path.join(this.folder,id,'asset.json'),'utf8'));}
 async bytes(id,name='cutout'){await this.get(id);insist(['source','cutout','thumbnail'].includes(name),'지원하지 않는 요청이에요.');return readFile(path.join(this.folder,id,name+'.png'));}
 async list(){await mkdir(this.folder,{recursive:true});const ids=(await readdir(this.folder)).filter(validId);const assets=await Promise.all(ids.map(async id=>({...await this.get(id),thumbnail:(await this.bytes(id,'thumbnail')).toString('base64')})));return assets.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
}
export const imageHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function retainWhiteBackgroundDetails(image,cutout){
 const pixels=await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true}),alpha=await sharp(cutout).ensureAlpha().extractChannel(3).raw().toBuffer();
 for(let i=0;i<alpha.length;i++){const p=i*4;pixels.data[p+3]=Math.max(alpha[i],Math.min(255,Math.max(0,250-Math.min(pixels.data[p],pixels.data[p+1],pixels.data[p+2]))*16));}
 return sharp(pixels.data,{raw:pixels.info}).png().toBuffer();
}
