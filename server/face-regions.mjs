import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {atomicJson} from './store.mjs';
import {randomUUID} from 'node:crypto';
import {saveTestAsset,saveTestRecord} from './experiment-log.mjs';
const sessions=new Map();
function overlap(a,b){const intersection=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));return intersection/(a.width*a.height+b.width*b.height-intersection);}
export function faceBoxes(scores,boxes,threshold=.8){
 const candidates=[];
 for(let i=0;i<scores.length/2;i++)if(scores[i*2+1]>=threshold){
  const x=Math.max(0,Math.min(1,boxes[i*4])),y=Math.max(0,Math.min(1,boxes[i*4+1]));
  const width=Math.max(0,Math.min(1,boxes[i*4+2])-x),height=Math.max(0,Math.min(1,boxes[i*4+3])-y);
  if(width>0&&height>0)candidates.push({x,y,width,height,confidence:scores[i*2+1]});
 }
 candidates.sort((a,b)=>b.confidence-a.confidence);const selected=[];
 for(const candidate of candidates)if(selected.every(face=>overlap(face,candidate)<.3)){selected.push(candidate);if(selected.length>=16)break;}
 return selected;
}
export async function detectFaceRegions(bytes,root){
 const key=createHash('sha256').update('ultraface-rfb320-34cd7e60-v1').update(bytes).digest('hex'),cache=path.join(root,'face-cache',key+'.json');
 try{return JSON.parse(await readFile(cache,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const started=performance.now(),startedAt=new Date().toISOString();
 const model=path.join(root,'face-model','version-RFB-320.onnx');
 if(!sessions.has(model))sessions.set(model,ort.InferenceSession.create(model,{executionProviders:['cpu'],intraOpNumThreads:1,interOpNumThreads:1,logSeverityLevel:3}));
 let session;try{session=await sessions.get(model);}catch(error){sessions.delete(model);throw error;}
 const pixels=await sharp(bytes).flatten({background:'#808080'}).removeAlpha().toColourspace('srgb').resize(320,240,{fit:'fill'}).raw().toBuffer(),data=new Float32Array(3*320*240);
 for(let i=0;i<320*240;i++)for(let c=0;c<3;c++)data[c*320*240+i]=(pixels[i*3+c]-127)/128;
 const output=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',data,[1,3,240,320])});
 const scores=Object.values(output).find(value=>value.dims.at(-1)===2),boxes=Object.values(output).find(value=>value.dims.at(-1)===4);
 if(!scores||!boxes)throw Error('Invalid face detector outputs');
 const result=faceBoxes(scores.data,boxes.data);await atomicJson(cache,result);
 const logRoot=path.join(root,'ai-tests'),snapshot=await saveTestAsset(logRoot,bytes);
 await saveTestRecord({id:`local-face-${randomUUID()}`,type:'local-inference',group:'face-protection',model:'UltraFace RFB-320 CPU',status:'success',startedAt,elapsedMs:Math.round(performance.now()-started),durationScope:'Local preprocessing and CPU face location inference',requestCount:0,localInferenceCount:1,estimatedUsd:0,actualBilledUsd:0,prompts:[],inputs:[{...snapshot,label:'Immutable face detection source'}],outputs:[],context:{purpose:'Face location only, no identity or personal-attribute analysis',faces:result,cacheKey:key,modelSha256:'34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017',externalRequests:0}},logRoot);
 return result;
}
export async function faceMaskImage(bytes,faces){
 const {width,height}=await sharp(bytes).metadata();
 const pixels=Buffer.alloc(width*height);
 const smooth=(a,b,n)=>{const t=Math.max(0,Math.min(1,(n-a)/(b-a)));return t*t*(3-2*t);};
 for(const face of faces){
  const cx=(face.x+face.width/2)*width,cy=(face.y+face.height/2)*height,rx=face.width*width*.8,ry=face.height*height*.95;
  const chin=(face.y+face.height)*height,fh=face.height*height;
  if(rx<=0||ry<=0)continue;
  for(let y=Math.max(0,Math.floor(cy-ry));y<Math.min(height,Math.ceil(chin+fh*.12));y++)for(let x=Math.max(0,Math.floor(cx-rx));x<Math.min(width,Math.ceil(cx+rx));x++){
   const r=Math.hypot((x+.5-cx)/rx,(y+.5-cy)/ry);
   const weight=(1-smooth(.82,1,r))*(1-smooth(chin-fh*.02,chin+fh*.12,y+.5));
   const i=y*width+x;pixels[i]=Math.max(pixels[i],Math.round(weight*255));
  }
 }
 return sharp(pixels,{raw:{width,height,channels:1}}).png().toBuffer();
}
