import {createHash} from 'node:crypto';
import {generateDecoration,stickerPrompt} from './meta.mjs';
import {normalisePhoto,cutoutFromRaster} from './composition.mjs';
import {trimSticker} from './mask.mjs';
import {insist} from './errors.mjs';
import {addTestOutput} from './experiment-log.mjs';

export async function stickerGeneration(route,data,c,send){
 if(route!=='/stickers/generate')return false;
 const {store,jobs,models,library,modelReady,key,fetcher,cachedSegment}=c;
 await store.get(data.projectId);
 insist(typeof data.prompt==='string'&&data.prompt.trim()&&data.prompt.length<=500,'대상을 500자 이내로 설명해 주세요.');
 const prompt=data.prompt.trim();
 const fingerprint=createHash('sha256').update(JSON.stringify({route,projectId:data.projectId,prompt,retryFailed:!!data.retryFailed})).digest('hex');
 const result=await jobs.workflow(data.jobId,fingerprint,async()=>{
  // Retain the original generation even if the subsequent mask request fails.
  const generated=await models.run('image',{model:'muse-image-1.0',prompt:stickerPrompt(prompt),version:1},()=>{modelReady();return generateDecoration({key,prompt,sticker:true},fetcher);},{retryFailed:!!data.retryFailed});
  const image=(await normalisePhoto(generated.bytes)).bytes;
  const original=await library.put({source:image,cutout:image,label:prompt,kind:'generated',provenance:{prompt,model:generated.model,requestId:generated.requestId,experimentId:generated.experimentId}});
  const segmented=await cachedSegment(image,null,prompt,!!data.retryFailed);
  insist(segmented.masks.length>0,'대상을 찾지 못했어요. 사진에서 대상을 탭하거나 더 짧게 설명해 주세요.',422);
  const mask=segmented.masks.reduce((a,b)=>a.raster.reduce((n,v)=>n+v,0)>b.raster.reduce((n,v)=>n+v,0)?a:b);
  const cutout=await cutoutFromRaster(image,mask.raster,mask.box,mask.width,mask.height);
  const trimmed=await trimSticker(image,cutout);
  const asset=await library.put({source:trimmed.source,cutout:trimmed.bytes,label:prompt,kind:'generated-sticker',parentId:original.id,provenance:{prompt,imageModel:generated.model,imageRequestId:generated.requestId,samModel:segmented.model,samRequestId:segmented.requestId,experimentId:segmented.experimentId,generationReused:!!generated.reused,segmentationReused:!!segmented.reused}});
  if(segmented.experimentId)await addTestOutput(segmented.experimentId,trimmed.bytes,'Generated reusable sticker',segmented.logRoot);
  // Generation never edits the canvas. Addition is an explicit local action.
  return {projectId:data.projectId,assetId:asset.id};
 });
 send(200,{...await library.get(result.assetId),data:(await library.bytes(result.assetId)).toString('base64')});return true;
}
