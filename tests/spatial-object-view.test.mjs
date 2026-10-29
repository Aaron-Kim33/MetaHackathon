import test from 'node:test';
import assert from 'node:assert/strict';
import {createDepthFraming,depthCamera,orbitDepthPoint,projectDepthPoint,spatialObjectView,spatialPreviewSurface} from '../src/depth-mesh.ts';
const background=spatialPreviewSurface({id:'backdrop',width:800,height:1000,baseZ:-.6,relief:.18,bounds:{x:-.12,y:-.12,width:1.24,height:1.24}});
test('object viewing angle changes while its focus and foreground framing remain stable',()=>{
 const pivot=[.1,-.1,.45],framing=createDepthFraming(background,pivot);
 const neutral=projectDepthPoint(pivot,.8,depthCamera({x:0,y:0},.7));
 for(const x of [-1,-.5,0,.5,1])for(const y of [-1,0,1]){
  const motion={x,y},view=spatialObjectView(motion,.7),point=orbitDepthPoint(pivot,pivot,view),p=projectDepthPoint(point,.8,depthCamera(motion,.7)),pan=framing.pan(motion,.7);
  assert.deepEqual(point,pivot);assert.ok(Math.abs(p.x*framing.scale+pan.x-neutral.x*framing.scale)<1e-6);assert.ok(Math.abs(p.y*framing.scale+pan.y-neutral.y*framing.scale)<1e-6);assert.equal(framing.scale,1.12);
 }
 assert.ok(Math.abs(spatialObjectView({x:1,y:0},.7).yaw+depthCamera({x:1,y:0},.7).yaw)*180/Math.PI>13);
});
test('surface sides change perspective rather than sliding a fixed photo',()=>{
 const pivot=[0,0,.45],motion={x:1,y:0},camera=depthCamera(motion,.7),view=spatialObjectView(motion,.7);
 const height=(x,orbit)=>{
  const project=point=>projectDepthPoint(orbit?orbitDepthPoint(point,pivot,view):point,.8,camera);
  return Math.abs(project([x,.4,.45]).y-project([x,-.4,.45]).y);
 };
 const oldRatio=height(.4,false)/height(-.4,false),newRatio=height(.4,true)/height(-.4,true);
 assert.ok(newRatio>1.06);assert.ok(newRatio>oldRatio+.03,'near and far sides must change scale differently');
 const oldGap=Math.abs(projectDepthPoint([0,0,.55],.8,camera).x-projectDepthPoint([0,0,.35],.8,camera).x);
 const newGap=Math.abs(projectDepthPoint(orbitDepthPoint([0,0,.55],pivot,view),.8,camera).x-projectDepthPoint(orbitDepthPoint([0,0,.35],pivot,view),.8,camera).x);
 assert.ok(newGap>oldGap*1.3,'the existing relief produces stronger depth-dependent movement');
});
