import {readFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {AssetLibrary,imageHash} from '../server/reusable-assets.mjs';
const root=path.resolve('.local'),library=new AssetLibrary(root),archive=path.join(root,'ai-tests');
const index=JSON.parse(await readFile(path.join(archive,'index.json'),'utf8'));
const state=JSON.parse(await readFile(path.join(root,'editor-state.json'),'utf8')),projectFolder=path.join(root,'projects',state.projectId),project=JSON.parse(await readFile(path.join(projectFolder,'project.json'),'utf8'));
const originalByHash=new Map();
for(const sticker of project.stickers||[]){const source=await readFile(path.join(projectFolder,sticker.sourceFile)),cutout=await readFile(path.join(projectFolder,sticker.maskFile||sticker.file));const asset=await library.put({source,cutout,label:sticker.label,provenance:{projectId:project.id,stickerId:sticker.id}});originalByHash.set(imageHash(cutout),asset);}
let imported=0;
const generatedRecord=index.records.find(r=>r.id==='008-cup-image-repair');
if(generatedRecord?.outputs?.[0]){const bytes=await readFile(path.join(archive,generatedRecord.outputs[0].file)),parent=originalByHash.get(generatedRecord.inputs[0].sha256);await library.put({source:bytes,cutout:bytes,label:'Generated image',kind:'generated',parentId:parent?.id||null,provenance:{experimentId:generatedRecord.id,requestId:generatedRecord.requestId}});}
for(const record of index.records){
 if(!['inference','postprocess'].includes(record.type)||!record.inputs?.length)continue;
 for(const output of record.outputs||[]){
  if(!output.file.endsWith('.png')||!/cutout|Object|matched|transparent PNG|Raw SAM/i.test(output.label||''))continue;
  let cutout=await readFile(path.join(archive,output.file));const m=await sharp(cutout).metadata();if(!m.hasAlpha)continue;
  const a=await sharp(cutout).extractChannel(3).stats();if(a.channels[0].min===255)continue;
  const sourceRef=record.type==='postprocess'?record.inputs[1]:record.inputs[0];let source=await readFile(path.join(archive,sourceRef.file));const sm=await sharp(source).metadata();if(sm.width!==m.width||sm.height!==m.height)continue;
  let parentId=null;
  if(record.type==='postprocess'){
   const before=index.records.find(r=>r.id==='008-cup-image-repair')?.inputs?.[0];const parent=before?originalByHash.get(before.sha256):null;
   if(parent){parentId=parent.id;const fit={width:parent.width,height:parent.height,fit:'contain',background:'#00000000'};source=await sharp(source).resize(fit).png().toBuffer();cutout=await sharp(cutout).resize(fit).png().toBuffer();}
  }
  await library.put({source,cutout,label:record.type==='postprocess'?'Repaired cutout':'SAM result',kind:record.type==='postprocess'?'repair':'cutout',parentId,provenance:{experimentId:record.id,requestId:record.requestId,review:record.review}});imported++;
 }
}
console.log(JSON.stringify({processedOutputs:imported,totalAssets:(await library.list()).length,newModelCalls:0}));
