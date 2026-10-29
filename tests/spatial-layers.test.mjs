import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { extendInvisibleDepth, padTransparentColours } from '../server/spatial-layers.mjs';
import { createDepthFraming, surfaceMesh, depthCamera, projectDepthPoint } from '../src/depth-mesh.ts';
import { createApp } from '../server/index.mjs';

test('invisible depth and RGB extension preserve alpha and every original visible pixel', () => {
  const pixels = Buffer.from([0,0,0,0, 180,20,30,255, 0,0,0,0]);
  assert.deepEqual(extendInvisibleDepth(pixels,3,1), [180,180,180]);
  const padded = padTransparentColours(pixels,3,1);
  assert.deepEqual([...padded], [180,20,30,0,180,20,30,255,180,20,30,0]);
  assert.equal(pixels[0],0);
});

test('rigid phone geometry stays a plane while subject relief remains continuous and neutrally aligned', () => {
  const surface = { id:'phone', width:800,height:1000,gridWidth:3,gridHeight:3,depth:[0,20,240,50,90,150,10,210,255],baseZ:0,relief:0 };
  const phone = surfaceMesh(surface); assert.equal(phone.vertices.length,20); assert.equal(phone.indices.length,6);
  for(let i=2;i<phone.vertices.length;i+=5) assert.equal(phone.vertices[i],0);
  const subject = surfaceMesh({...surface,id:'subject',baseZ:.4,relief:.3});
  assert.equal(subject.edges.length,0,'alpha boundaries do not use disconnected crack-producing triangles');
  for(let i=0;i<subject.vertices.length;i+=5){
    const p=projectDepthPoint([...subject.vertices.slice(i,i+3)],.8,depthCamera({x:0,y:0},.7));
    assert.ok(Math.abs(p.x-(subject.vertices[i+3]*2-1))<1e-6);
    assert.ok(Math.abs(p.y-(1-subject.vertices[i+4]*2))<1e-6);
  }
});

test('tilt keeps original zoom and full camera motion while real image UVs remain bounded', () => {
  const surface = { id:'backdrop',width:800,height:1000,gridWidth:4,gridHeight:4,depth:Array(16).fill(128),baseZ:-.6,relief:.18 };
  const mesh=surfaceMesh(surface);
  for(let i=0;i<mesh.vertices.length;i+=5) {
    assert.ok(mesh.vertices[i+3]>=0 && mesh.vertices[i+3]<=1);
    assert.ok(mesh.vertices[i+4]>=0 && mesh.vertices[i+4]<=1);
  }
  const zero=depthCamera({x:0,y:0},.7), up=depthCamera({x:0,y:1},.7), down=depthCamera({x:0,y:-1},.7);
  assert.equal(up.pitch,-.10*.7); assert.equal(down.pitch,.10*.7);
  assert.equal(up.shiftY,-.18*.7); assert.equal(down.shiftY,.18*.7);
  const p=[0,-1,0];
  assert.equal(projectDepthPoint(p,.8,zero).y,-1);
  const views=[up,down].map(camera=>projectDepthPoint(p,.8,camera).y);
  assert.ok(Math.max(...views)>-.98,'tilt must be able to bring the bottom edge back into view');
  assert.ok(Math.min(...views)<-1,'bottom edge cannot be pinned by an adaptive crop');
});

test('real background margins extend world coverage without inventing texture pixels or changing neutral alignment', () => {
  const s={id:'backdrop',width:800,height:1000,gridWidth:3,gridHeight:3,depth:Array(9).fill(128),baseZ:-.6,relief:.18,bounds:{x:-.1,y:-.12,width:1.2,height:1.24}};
  const mesh=surfaceMesh(s);
  for(let i=0;i<mesh.vertices.length;i+=5){
    const u=mesh.vertices[i+3],v=mesh.vertices[i+4];
    assert.ok(u>=0&&u<=1&&v>=0&&v<=1);
    const p=projectDepthPoint([...mesh.vertices.slice(i,i+3)],.8,depthCamera({x:0,y:0},1));
    assert.ok(Math.abs(p.x-((s.bounds.x+u*s.bounds.width)*2-1))<1e-6);
    assert.ok(Math.abs(p.y-(1-(s.bounds.y+v*s.bounds.height)*2))<1e-6);
  }
});

test('fixed initial crop reveals margins on tilt without live zoom or exposed background edges', () => {
  for (const bounds of [undefined,{x:-.1,y:-.12,width:1.2,height:1.24}]) {
    const s={id:'backdrop',width:800,height:1000,gridWidth:4,gridHeight:4,depth:[0,255,0,255,255,10,240,0,0,245,20,255,255,0,255,0],baseZ:-.6,relief:.18,bounds};
    const mesh=surfaceMesh(s), framing=createDepthFraming(s), fixedScale=framing.scale;
    assert.ok(fixedScale>=1.12 && fixedScale<1.4,'modest crop is selected once');
    const centered=framing.pan({x:0,y:0},.7);assert.ok(Math.abs(centered.x)+Math.abs(centered.y)<1e-8);
    const indices=[0,3,15,12];
    for(const i of indices) assert.ok(Math.abs(mesh.vertices[i*5+2]-s.baseZ)<1e-6,'noisy depth cannot bend the source boundary');
    for(let y=-1;y<=1.001;y+=.1)for(let x=-1;x<=1.001;x+=.1)for(const strength of [.3,.7,1]) {
      const input={x,y}, pan=framing.pan(input,strength), camera=depthCamera(input,strength);
      const quad=indices.map(i=>{const p=projectDepthPoint([...mesh.vertices.slice(i*5,i*5+3)],.8,camera);return{x:p.x*fixedScale+pan.x,y:p.y*fixedScale+pan.y};});
      for(const corner of [{x:-1,y:-1},{x:1,y:-1},{x:1,y:1},{x:-1,y:1}])for(let i=0;i<4;i++) {
        const p=quad[i],q=quad[(i+1)%4];
        assert.ok((q.x-p.x)*(corner.y-p.y)-(q.y-p.y)*(corner.x-p.x)<1e-5,'viewport remains inside real source pixels');
      }
      assert.equal(framing.scale,fixedScale,'tilt never changes magnification');
    }
    const up=framing.pan({x:0,y:1},1),down=framing.pan({x:0,y:-1},1);
    assert.ok(up.y<-.05 && down.y>.05,'tilting reveals opposite cropped margins instead of pinning the view');
    if(bounds) {
      const point=[0,-1,0], neutral=projectDepthPoint(point,.8,depthCamera({x:0,y:0},1)).y*fixedScale;
      const tilted=projectDepthPoint(point,.8,depthCamera({x:0,y:-1},1)).y*fixedScale+down.y;
      assert.ok(neutral<-1 && tilted>-1,'bottom of composition starts cropped and can be revealed');
    }
  }
});

test('layered preview preserves the neutral composite, phone rigidity, project data and Meta usage', async t => {
  await mkdir('.local/tests',{recursive:true});const root=await mkdtemp(path.resolve('.local/tests/layers-3d-'));
  const app=await createApp({root,token:'layers-3d',key:'',caps:{sam:0,image:0},faceDetector:async()=>[{x:.3,y:.15,width:.3,height:.3,confidence:1}],depthEstimator:async()=>({width:2,height:2,depth:Uint8Array.from([0,80,160,255])})});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const post=async(route,data)=>{const r=await fetch(`http://127.0.0.1:${app.server.address().port}${route}`,{method:'POST',headers:{Authorization:'Bearer layers-3d','Content-Type':'application/json'},body:JSON.stringify(data)});const v=await r.json();assert.equal(r.status,200,v.error);return v;};
  const view=await post('/fixture',{}), before=await app.store.get(view.project.id);
  const frame=await post('/spatial',{projectId:view.project.id,renderer:'layered'});
  assert.deepEqual(frame.layers.map(s=>s.id),['backdrop','phone','primary-plane']);
  assert.equal(frame.layers[1].relief,0);assert.ok(frame.layers[2].relief>0);
  assert.ok(frame.layers[2].faceMask?.some(value=>value>=128),'source face mask follows the composition into its foreground layer');
  assert.ok(frame.layers[2].focus?.weight>0,'foreground focus is measured from visible alpha rather than transparent padding');
  for(const layer of frame.layers){
    surfaceMesh(layer);const meta=await sharp(Buffer.from(layer.textureImage,'base64')).metadata();
    assert.equal(meta.width&(meta.width-1),0);assert.equal(meta.height&(meta.height-1),0);
  }
  const composite=await sharp({create:{width:frame.width,height:frame.height,channels:4,background:'#00000000'}}).composite(frame.layers.map(s=>({input:Buffer.from(s.image,'base64')}))).raw().toBuffer();
  const expected=await sharp(Buffer.from(frame.image,'base64')).ensureAlpha().raw().toBuffer();
  let total=0;for(let i=0;i<expected.length;i++)total+=Math.abs(expected[i]-composite[i]);
  assert.ok(total/expected.length<1,'separating the scene must preserve the original neutral composition');
  assert.deepEqual(await app.store.get(view.project.id),before);assert.equal(app.jobs.usage().sam.reserved,0);
  const background=await sharp({create:{width:80,height:160,channels:3,background:'#1265ab'}}).png().toBuffer();
  await post('/background',{projectId:view.project.id,image:background.toString('base64')});
  const wide=await post('/spatial',{projectId:view.project.id,renderer:'layered'});
  const bounds=wide.layers[0].bounds;
  assert.ok(bounds.y<0 && bounds.y+bounds.height>1,'uncropped original background pixels must be available above and below the viewport');
  assert.ok(wide.layers[0].surfaceImage);
});
