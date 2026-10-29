import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../server/composition.mjs';
import { gestureFrame, photoLayout } from '../src/layout.ts';
import { frameMatrix } from '../src/frame.ts';
import { framePreviewMatrix } from '../src/native-composition-plan.ts';
import { hitPhone } from '../src/hit-testing.ts';

const source={width:800,height:1200};
test('story phone leaves horizontal breathing room and stays the same physical aspect ratio',()=>{
  const o=settings({mode:'frame',ratio:'story'}),g=photoLayout(source,o);
  assert.ok(g.screen.width/g.width<.54);
  assert.ok(Math.abs(g.screen.width/g.screen.height-.56)<.002);
});

test('phone gestures change the frame without changing the photo crop, stickers or background',()=>{
  const before=settings({mode:'frame',ratio:'story',frameScale:1,frameX:0,frameY:0,tilt:-6});
  const after=gestureFrame(before,360,{dx:24,dy:-20,factor:1.15,rotation:10});
  assert.equal(after.frameScale,1.15);assert.equal(after.tilt,4);
  assert.equal(after.frameX,24/360);assert.equal(after.frameY,-60/1920);
  for(const key of Object.keys(before).filter(k=>!['frameScale','frameX','frameY','tilt'].includes(k)))assert.deepEqual(after[key],before[key]);
  const extreme=gestureFrame(before,360,{dx:10000,dy:-10000,factor:100,rotation:100});
  assert.equal(extreme.frameScale,1.5);assert.equal(extreme.tilt,18);assert.equal(extreme.frameX,.35);assert.equal(extreme.frameY,-.25);
});

test('cached phone preview matches the committed frame projection and remains touchable after rotation',()=>{
  for(const ratio of ['portrait','story','square']){
    const before=settings({mode:'frame',ratio,frameScale:1.15}),after=gestureFrame(before,360,{dx:15,dy:12,factor:.82,rotation:11});
    const g=photoLayout(source,before),n=photoLayout(source,after),m=frameMatrix(after),unit=360/g.width,preview=framePreviewMatrix(source,before,after,unit);
    for(const [u,v] of [[0,0],[.5,.5],[1,1]]){
      const px=(g.screen.x+u*g.screen.width-g.width/2)*unit,py=(g.screen.y+v*g.screen.height-g.height/2)*unit;
      const actual={x:preview[0]*px+preview[4]*py+preview[12],y:preview[1]*px+preview[5]*py+preview[13]};
      const nx=n.screen.x+u*n.screen.width-n.width/2,ny=n.screen.y+v*n.screen.height-n.height/2;
      const expected={x:(m.a*nx+m.c*ny)*unit,y:(m.b*nx+m.d*ny)*unit};
      assert.ok(Math.hypot(actual.x-expected.x,actual.y-expected.y)<.5,'release cannot jump away from the cached preview');
      assert.equal(hitPhone({project:source},after,{x:expected.x+n.width/2*unit,y:expected.y+n.height/2*unit},360),true);
    }
    assert.equal(hitPhone({project:source},after,{x:355,y:5},360),false);
    assert.equal(hitPhone({project:source},{...after,mode:'plain'},{x:180,y:200},360),false);
  }
});
