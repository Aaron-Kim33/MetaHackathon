import sharp from 'sharp';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {settings,cutoutFromRaster,normalisePhoto} from './composition.mjs';
import {photoWithMaskEdits,trimSticker} from './mask.mjs';
import {repairImage,repairPrompt,retouchImage,retouchPrompt} from './meta.mjs';
import {imageHash,retainWhiteBackgroundDetails} from './reusable-assets.mjs';
import {insist} from './errors.mjs';
import {addTestOutput,saveTestAsset,saveTestRecord} from './experiment-log.mjs';
const encoded=b=>b.toString('base64');
export async function repairRoutes(route,data,c,send){
 if(!['/assets/get','/assets/add','/assets/apply','/repair','/retouch'].includes(route))return false;
 const {library,models,jobs,store,mutate,view,modelReady,fetcher,cachedSegment}=c;
 const asset=await library.get(data.assetId);
 if(route==='/assets/get'){send(200,{...asset,data:encoded(await library.bytes(asset.id))});return true;}
 if(route==='/retouch'){
  const instruction=data.instruction;insist(typeof instruction==='string'&&instruction.trim()&&instruction.length<=500,'대상을 500자 이내로 설명해 주세요.');
  const outcome=await jobs.workflow(data.jobId,createHash('sha256').update(JSON.stringify({workflow:'retouch',assetId:asset.id,instruction,retryFailed:!!data.retryFailed})).digest('hex'),async()=>{
   const cutout=await library.bytes(asset.id),meta=await sharp(cutout).metadata();
   const reference=await sharp(cutout).flatten({background:'#ffffff'}).png().toBuffer();
   const generated=await models.run('image',{model:'muse-image-1.0',image:imageHash(reference),prompt:retouchPrompt(instruction),version:1},()=>{modelReady();return retouchImage({key:c.key,image:reference,instruction},fetcher);},{retryFailed:!!data.retryFailed});
   const intermediate=await library.put({source:generated.bytes,cutout:generated.bytes,label:'Retouch generated image',kind:'generated',parentId:asset.id,provenance:{instruction,model:generated.model,requestId:generated.requestId,experimentId:generated.experimentId}});
   const alpha=await sharp(cutout).ensureAlpha().extractChannel(3).raw().toBuffer();
   const source=await sharp(generated.bytes).resize(meta.width,meta.height,{fit:'fill'}).removeAlpha().png().toBuffer();
   const result=await sharp(source).joinChannel(alpha,{raw:{width:meta.width,height:meta.height,channels:1}}).png().toBuffer();
   const saved=await library.put({source,cutout:result,label:instruction,kind:'retouch',parentId:asset.id,provenance:{instruction,model:generated.model,requestId:generated.requestId,experimentId:generated.experimentId,generatedAssetId:intermediate.id,reused:!!generated.reused,localCorrection:'Resized to original asset bounds and retained exact original alpha; no SAM request'}});
   if(generated.experimentId)await addTestOutput(generated.experimentId,result,'Retouch preview with original alpha',generated.logRoot);
   return {assetId:saved.id};
  });
  const saved=await library.get(outcome.assetId);send(200,{...saved,data:encoded(await library.bytes(saved.id))});return true;
 }
 if(route==='/repair'){
  const instruction=data.instruction;insist(typeof instruction==='string'&&instruction.trim()&&instruction.length<=500,'대상을 500자 이내로 설명해 주세요.');
  const outcome=await jobs.workflow(data.jobId,createHash('sha256').update(JSON.stringify({assetId:asset.id,instruction,retryFailed:!!data.retryFailed})).digest('hex'),async()=>{
   const source=await library.bytes(asset.id,'source'),cutout=await library.bytes(asset.id);
   const generated=await models.run('image',{model:'muse-image-1.0',source:imageHash(source),cutout:imageHash(cutout),prompt:repairPrompt(instruction),version:1},()=>{modelReady();return repairImage({key:c.key,source,cutout,instruction},fetcher);},{retryFailed:!!data.retryFailed});
   const image=(await normalisePhoto(generated.bytes)).bytes;
   const intermediate=await library.put({source:image,cutout:image,label:'Generated image',kind:'generated',parentId:asset.id,provenance:{model:generated.model,requestId:generated.requestId,instruction}});
   const segmented=await cachedSegment(image,null,'complete object',!!data.retryFailed);
   insist(segmented.masks.length>0,'대상을 찾지 못했어요. 사진에서 대상을 탭하거나 더 짧게 설명해 주세요.',422);
   const mask=segmented.masks.reduce((a,b)=>a.raster.reduce((n,v)=>n+v,0)>b.raster.reduce((n,v)=>n+v,0)?a:b);
   let repaired=await cutoutFromRaster(image,mask.raster,mask.box,mask.width,mask.height);
   repaired=await retainWhiteBackgroundDetails(image,repaired);
   const fit={width:asset.width,height:asset.height,fit:'contain',background:'#00000000'};
   const fittedSource=await sharp(image).resize(fit).png().toBuffer(),fittedCutout=await sharp(repaired).resize(fit).png().toBuffer();
   const saved=await library.put({source:fittedSource,cutout:fittedCutout,label:'Repaired cutout',kind:'repair',parentId:asset.id,provenance:{instruction,generatedAssetId:intermediate.id,imageRequestId:generated.requestId,samRequestId:segmented.requestId,generationReused:!!generated.reused,segmentationReused:!!segmented.reused,localCorrection:'Retained non-white attached details from the white-background generated image'}});
   if(segmented.experimentId)await addTestOutput(segmented.experimentId,fittedCutout,'Final repaired asset',segmented.logRoot);
   return {assetId:saved.id,parentId:asset.id};
  });
  send(200,{...await library.get(outcome.assetId),data:encoded(await library.bytes(outcome.assetId))});return true;
 }
 const started=performance.now();
 await mutate(async()=>{
  const p=await store.get(data.projectId),source=await library.bytes(asset.id,'source'),cutout=await library.bytes(asset.id),id=randomUUID();
  p.options=settings(p.options||undefined);p.stickers ||= [];
  if(route==='/assets/add'){
   insist(p.stickers.length<16,'스티커는 최대 16개까지 가능해요.');
   const trimmed=await trimSticker(source,cutout),saved=await library.put({source:trimmed.source,cutout:trimmed.bytes,label:asset.label,kind:asset.kind,parentId:asset.id});
   const file=`sticker-${id}.png`,sourceFile=`sticker-source-${id}.png`;await store.write(p.id,file,trimmed.bytes);await store.write(p.id,sourceFile,trimmed.source);
   p.stickers.push({id,file,sourceFile,width:trimmed.width,height:trimmed.height,label:asset.label,provider:'asset-library',assetId:saved.id});p.options.stickerTransforms.push({id,x:.5,y:.45,scale:.65});
  }else{
   const target=data.stickerId&&data.stickerId!=='primary'?p.stickers.find(s=>s.id===data.stickerId):null;
   insist(!data.stickerId||data.stickerId==='primary'||target,'스티커가 변경됐어요. 다시 선택해 주세요.',409);
   const oldSource=await store.read(p.id,target?target.sourceFile:p.sourceFile||'source.png');
   const oldCutout=target?await store.read(p.id,target.maskFile||target.file):p.selectedId?await store.read(p.id,p.maskEdits?.[p.selectedId]||`subject-${p.selectedId}.png`):null;
   insist(oldCutout,'보정할 피사체를 먼저 선택해 주세요.');
   // Compare raw cutout identity before changing any project references.
   const currentSource=!target&&p.maskEdits?.[p.selectedId]?await photoWithMaskEdits(oldSource,await store.read(p.id,`subject-${p.selectedId}.png`),oldCutout):oldSource;
   const current=await library.put({source:currentSource,cutout:oldCutout});
   if(data.expectedAssetId)insist(current.id===data.expectedAssetId,'피사체가 변경됐어요. 최신 누끼를 불러온 뒤 다시 보정해 주세요.',409);
   const m=await sharp(oldCutout).metadata(),fit={width:m.width,height:m.height,fit:'contain',background:'#00000000'};
   const pixels=asset.width===m.width&&asset.height===m.height?cutout:await sharp(cutout).resize(fit).png().toBuffer();
   const sourcePixels=asset.width===m.width&&asset.height===m.height?source:await sharp(source).resize(fit).png().toBuffer();
   const file=`${target?'sticker':'subject'}-${id}.png`,sourceFile=`source-${id}.png`;await store.write(p.id,file,pixels);await store.write(p.id,sourceFile,sourcePixels);
   if(target){target.file=file;target.sourceFile=sourceFile;delete target.maskFile;target.assetId=asset.id;target.provider='asset-library';}
   else{p.sourceFile=sourceFile;p.candidates=[{id,label:asset.label,provider:'asset-library'}];p.selectedId=id;p.maskEdits={};}
   p.maskRevision=(p.maskRevision||0)+1;
  }
  await store.save(p);
 });
 const logRoot=path.join(c.root,'ai-tests'),saved=await saveTestAsset(logRoot,await library.bytes(asset.id));
 await saveTestRecord({id:`reuse-${randomUUID()}`,type:'reuse',group:'asset-library',status:'reused',model:null,requestCount:0,estimatedUsd:0,actualBilledUsd:null,startedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-started),durationScope:'Local asset application, no inference',simulation:!!fetcher,sourceExperimentId:asset.provenance?.experimentId||null,context:{assetId:asset.id,projectId:data.projectId,action:route},prompts:[],inputs:[],outputs:[{...saved,label:'Reused asset'}]},logRoot);
 send(200,await view(data.projectId));return true;
}
