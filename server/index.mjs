import {detectFaceRegions} from './face-regions.mjs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import sharp from 'sharp';
import { AppError, insist } from './errors.mjs';
import { compose, normalisePhoto, settings, cutoutFromRaster } from './composition.mjs';
import { Store, ModelJobs, validId, atomicJson } from './store.mjs';
import { segment, generateDecoration, repairImage, repairPrompt } from './meta.mjs';
import { AssetLibrary, ReusableModels, imageHash, retainWhiteBackgroundDetails } from './reusable-assets.mjs';
import { repairRoutes } from './repair-routes.mjs';
import { stickerGeneration } from './sticker-generation.mjs';
import { addTestOutput } from './experiment-log.mjs';
import { COMPOSITION_VERSION } from '../src/composition-scene.ts';
import { subjectShadow } from './subject-shadow.mjs';
import { fixture } from './fixture.mjs';
import { spatialBackdrop, spatialFrame } from './depth.mjs';
import { spatialLayers } from './spatial-layers.mjs';
import { deviceMaskCutout, refineMask, validateStrokes, photoWithMaskEdits, contourCutout, trimSticker, alphaBounds, makeHitMask } from './mask.mjs';

const home = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function localToken(directory) {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'dev-token');
  try { return (await readFile(file, 'utf8')).trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const token = randomUUID();
    await writeFile(file, token, { mode: 0o600, flag: 'wx' });
    return token;
  }
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; insist(size <= 18000000, '사진은 12MB 이하로 선택해 주세요.', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(400, '요청 형식이 올바르지 않아요.'); }
}
const encoded = bytes => bytes.toString('base64');
const stickerLabel = project => {
  project.stickerSequence = Math.max(project.stickerSequence || 0, ...(project.stickers || []).map(item => Number(item.label?.match(/\d+$/)?.[0]) || 0)) + 1;
  return `스티커 ${project.stickerSequence}`;
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function createApp({ root = path.join(home, '.local'), token, key = process.env.MODEL_API_KEY, creditsConfirmed = process.env.HACKATHON_CREDITS_CONFIRMED === 'true', caps = { sam: Number(process.env.SAM_REQUEST_CAP || 0), image: Number(process.env.IMAGE_REQUEST_CAP || 0) }, fetcher, depthEstimator, faceDetector } = {}) {
  const pairing = token || process.env.POPOUT_TOKEN || await localToken(root);
  insist(Object.values(caps).every(n => Number.isSafeInteger(n) && n >= 0), '호출 한도는 0 이상의 정수여야 해요.');
  const store = new Store(root), jobs = new ModelJobs(path.join(root, 'model-jobs.json'), caps,{limitsDisabled:process.env.MODEL_REQUEST_LIMITS==='off'});
  await jobs.init();
  const library=new AssetLibrary(root),models=new ReusableModels(root,jobs,!!fetcher);
  const localFaces=faceDetector||(fetcher||depthEstimator?async()=>[]:async bytes=>{try{return await detectFaceRegions(bytes,root);}catch(error){console.warn('Local face protection unavailable:',error.code||error.name);return [];}});
  const modelReady=()=>{insist(key?.trim(),'Meta Model API 키가 아직 없어요. PC에서 npm run setup:model을 실행해 주세요.',503);insist(creditsConfirmed,'Billing의 대회 크레딧 지급을 확인한 뒤 PC에서 모델 설정을 완료해 주세요.',403);};
  const cachedSegment=async(image,point,prompt,retryFailed=false)=>{const m=await sharp(image).metadata();return models.run('sam',{model:'sam-3.1',image:imageHash(image),point:point||null,prompt:prompt||'person',settings:{mask_encoding:'one_bit'}},()=>{modelReady();return segment({key,image,width:m.width,height:m.height,point,prompt},fetcher);},{retryFailed});};
  let projectTail = Promise.resolve();
  function mutate(fn) { const next = projectTail.then(fn); projectTail = next.catch(() => {}); return next; }
  async function view(id, previewOnly = false) {
    const p = await store.get(id);
    const source = await store.read(id, p.sourceFile || 'source.png');
    const cutout = p.selectedId ? await store.read(id, p.maskEdits?.[p.selectedId] || `subject-${p.selectedId}.png`) : null;
    const photoSource = p.selectedId && p.maskEdits?.[p.selectedId]
      ? await photoWithMaskEdits(source, await store.read(id, `subject-${p.selectedId}.png`), cutout) : source;
    const decoration = p.decoration ? await store.read(id, 'decoration.png') : null;
    const stickers = await Promise.all((p.stickers || []).map(async sticker => ({ ...sticker, bytes: await store.read(id, sticker.maskFile || sticker.file) })));
    const pending = (p.imports || []).find(item => item.id === p.pendingImport);
    const pendingPhoto = pending ? { id: pending.id, width: pending.width, height: pending.height, source: encoded(await store.read(id, pending.file)) } : null;
    const backgroundPhoto = p.backgroundPhoto ? { ...p.backgroundPhoto, bytes: await store.read(id, p.backgroundPhoto.file) } : null;
    const shadow = cutout ? await subjectShadow(cutout) : null;
    const result = await compose({ source: photoSource, cutout, decoration, stickers, shadow, backgroundPhoto, options: p.options || undefined });
    const preview = { sceneVersion: COMPOSITION_VERSION, image: encoded(result.bytes), baseImage: encoded(result.baseBytes), primaryImage: encoded(result.primaryBytes), width: result.width, height: result.height, options: result.options, baseOptions: result.options, imageOptions: result.options };
    if (previewOnly) return preview;
    const decorationMeta = decoration ? await sharp(decoration).metadata() : null;
    if(decoration)await library.put({source:await store.read(id,'decoration-source.png'),cutout:decoration,label:'AI decoration',kind:'decoration',parentId:p.decorationProvenance?.image?.assetId||null,provenance:p.decorationProvenance||{}});
    preview.primaryAssetId=cutout?(await library.put({source:photoSource,cutout,label:'Cutout',provenance:{projectId:id,candidateId:p.selectedId}})).id:null;
    for(const item of stickers)item.assetId=(await library.put({source:await store.read(id,item.sourceFile),cutout:item.bytes,label:item.label,provenance:{projectId:id,stickerId:item.id}})).id;
    return { ...preview, backgroundPhoto: backgroundPhoto ? { data: encoded(backgroundPhoto.bytes), width: backgroundPhoto.width, height: backgroundPhoto.height } : null, subjectShadow: shadow ? encoded(shadow) : null, subjectHitMask: cutout ? await makeHitMask(cutout) : null, subjectBounds: cutout ? await alphaBounds(cutout) : null, project: p, stickers: await Promise.all(stickers.map(async ({ id, bytes, width, height, label, assetId }) => ({ id, data: encoded(bytes), width, height, label, assetId, bounds: await alphaBounds(bytes), hitMask: await makeHitMask(bytes) }))), pendingPhoto, image: encoded(result.bytes), width: result.width, height: result.height, source: encoded(source), photoSource: photoSource === source ? null : encoded(photoSource), subject: cutout ? encoded(cutout) : null, decorationImage: decoration ? { data: encoded(decoration), width: decorationMeta.width, height: decorationMeta.height } : null, options: result.options, usage: jobs.usage() };
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') { send(200, { service: 'reel-talk-popout', version: 4, capabilities: ['lightweight-options', 'contour-cutout', 'transparent-sticker', 'mask-photo-sync', 'multi-sticker', 'frame-depth'] }); return; }
      const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      const expected = Buffer.from(pairing);
      insist(supplied.length === expected.length && timingSafeEqual(supplied, expected), 'PC 연결 설정을 확인해 주세요.', 401);
      if (req.method === 'GET' && url.pathname === '/status') { send(200, { modelConfigured: !!key?.trim(), creditsConfirmed, usage: jobs.usage() }); return; }
      if(req.method==='GET'&&url.pathname==='/assets'){send(200,{assets:await library.list()});return;}
      if (req.method === 'GET' && url.pathname === '/editor-state') {
        let saved;
        try { saved = JSON.parse(await readFile(path.join(root, 'editor-state.json'), 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; send(200, { snapshot: null }); return; }
        send(200, { snapshot: { view: await view(saved.projectId), history: [], activeStickerId: 'primary', pendingJob: saved.pendingJob || null } }); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/jobs/')) {
        const id = url.pathname.split('/').at(-1); insist(validId(id), '작업 ID가 올바르지 않아요.');
        const job = jobs.jobs[id]; insist(job, '작업 기록을 찾지 못했어요.', 404);
        const appLimitBlocked=job.status==='uncertain'&&['설정한 모델 호출 한도에 도달했어요. 기존 편집과 저장은 계속할 수 있어요.','앱에서 정한 AI 호출 한도에 도달했어요. Meta 크레딧 잔액과는 별개예요. 저장된 소재는 계속 사용할 수 있어요.'].includes(job.message);
        send(200, {...job,appLimitBlocked}); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/projects/')) { send(200, await view(url.pathname.split('/').at(-1))); return; }
      insist(req.method === 'POST', '지원하지 않는 요청이에요.', 404);
      const data = await body(req);
      if(['/diagnostics/spatial','/diagnostics/cutout'].includes(url.pathname)){
        const event=String(data.event||'').slice(0,60),details=Object.fromEntries(Object.entries(data.details||{}).filter(([k,v])=>['frameKey','layers','width','height','error','glError','maxTextureSize','contextId','stage','supported','locked','pending','provider'].includes(k)&&['string','number','boolean'].includes(typeof v)).map(([k,v])=>[k,typeof v==='string'?v.slice(0,1500):v]));
        const kind=url.pathname.endsWith('/cutout')?'cutout':'spatial';
        await appendFile(path.join(root,`${kind}-client-diagnostics.jsonl`),JSON.stringify({time:new Date().toISOString(),event,details})+'\n');send(200,{ok:true});return;
      }
      if(await stickerGeneration(url.pathname,data,{store,jobs,models,library,modelReady,key,fetcher,cachedSegment},send))return;
      if(await repairRoutes(url.pathname,data,{root,library,models,jobs,store,mutate,view,modelReady,key,fetcher,cachedSegment},send))return;
      if (url.pathname === '/editor-state') {
        await store.get(data.projectId);
        insist(data.pendingJob == null || validId(data.pendingJob), '작업 ID가 올바르지 않아요.');
        await mutate(() => atomicJson(path.join(root, 'editor-state.json'), { projectId: data.projectId, pendingJob: data.pendingJob || null }));
        send(200, { saved: true }); return;
      }
      if (url.pathname === '/projects') {
        insist(typeof data.image === 'string' && /^[A-Za-z0-9+/=]+$/.test(data.image) && data.image.length <= 17000000, '올바른 사진을 선택해 주세요.');
        const photo = await normalisePhoto(Buffer.from(data.image, 'base64'));
        const project = await store.create(photo);
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/fixture') {
        const photo = await fixture(), project = await store.create(photo, 'synthetic-fixture');
        const subjectId = randomUUID();
        await store.write(project.id, `subject-${subjectId}.png`, photo.cutout);
        Object.assign(project, { selectedId: subjectId, candidates: [{ id: subjectId, label: '직접 그린 테스트 인물', provider: 'synthetic-fixture' }] });
        await store.save(project); send(200, await view(project.id)); return;
      }
      const project = await store.get(data.projectId);
      if (url.pathname === '/spatial') {
        const current = await view(project.id);
        const photo = current.backgroundPhoto;
        const backdrop = photo ? await spatialBackdrop(Buffer.from(photo.data, 'base64'), photo, current, current.options) : null;
        const result = await spatialFrame(Buffer.from(current.image, 'base64'), root, depthEstimator, backdrop);
        const sources = data.renderer === 'layered' ? Object.fromEntries(await Promise.all((current.project.stickers || []).map(async item => [item.id, (await store.read(project.id, item.sourceFile)).toString('base64')]))) : {};
        const layers = data.renderer === 'layered' ? await spatialLayers(current, root, sources, depthEstimator,localFaces) : undefined;
        send(200, { ...result, layers, projectId: project.id, options: current.options }); return;
      }
      if (url.pathname === '/source/replace') {
        insist(typeof data.image === 'string' && /^[A-Za-z0-9+/=]+$/.test(data.image) && data.image.length <= 17000000, '올바른 사진을 선택해 주세요.');
        insist(!jobs.active, 'AI 작업이 끝난 뒤 메인 사진을 변경해 주세요.', 409);
        const photo = await normalisePhoto(Buffer.from(data.image, 'base64'));
        const sourceFile = `source-${randomUUID()}.png`;
        await store.write(project.id, sourceFile, photo.bytes);
        await mutate(async () => {
          insist(!jobs.active, 'AI 작업이 끝난 뒤 메인 사진을 변경해 주세요.', 409);
          const latest = await store.get(project.id), options = settings(latest.options || undefined);
          Object.assign(latest, { sourceFile, width: photo.width, height: photo.height, selectedId: null, candidates: [], maskEdits: {}, maskRevision: (latest.maskRevision || 0) + 1, provenance: 'user' });
          latest.options = settings({ ...options, hidePrimary: false, photoRotation: 0, zoom: options.mode === 'frame' ? 1.2 : 1, x: options.mode === 'frame' ? 0.18 : 0, y: options.mode === 'frame' ? -0.17 : 0 });
          await store.save(latest);
        });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/background' || url.pathname === '/background/remove') {
        let backgroundPhoto = null;
        if (url.pathname === '/background') {
          insist(typeof data.image === 'string' && /^[A-Za-z0-9+/=]+$/.test(data.image) && data.image.length <= 17000000, '올바른 배경 사진을 선택해 주세요.');
          const photo = await normalisePhoto(Buffer.from(data.image, 'base64'));
          const file = `background-${randomUUID()}.png`;
          await store.write(project.id, file, photo.bytes);
          backgroundPhoto = { file, width: photo.width, height: photo.height };
        }
        await mutate(async () => {
          const latest = await store.get(project.id);
          latest.backgroundPhoto = backgroundPhoto;
          latest.options = settings({ ...(latest.options || {}), backgroundZoom: 1, backgroundX: 0.5, backgroundY: 0.5 });
          await store.save(latest);
        });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/imports') {
        insist(typeof data.image === 'string' && /^[A-Za-z0-9+/=]+$/.test(data.image) && data.image.length <= 17000000, '올바른 사진을 선택해 주세요.');
        const photo = await normalisePhoto(Buffer.from(data.image, 'base64'));
        await mutate(async () => {
          const latest = await store.get(project.id);
          insist((latest.stickers || []).length < 16, '스티커는 최대 16개까지 가능해요.');
          const id = randomUUID(), file = `import-${id}.png`;
          await store.write(project.id, file, photo.bytes);
          latest.imports ||= []; latest.imports.push({ id, file, width: photo.width, height: photo.height }); latest.pendingImport = id;
          await store.save(latest);
        });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/stickers/edit') {
        const sticker = (project.stickers || []).find(item => item.id === data.stickerId);
        insist(sticker, '스티커를 찾지 못했어요.');
        const result = await view(project.id);
        result.source = encoded(await store.read(project.id, sticker.sourceFile));
        result.subject = encoded(await store.read(project.id, sticker.maskFile || sticker.file));
        result.project = { ...result.project, width: sticker.width, height: sticker.height };
        send(200, result); return;
      }
      if (url.pathname === '/stickers/remove') {
        const updatedOptions = data.options ? settings(data.options) : null;
        await mutate(async () => {
          const latest = await store.get(project.id);
          insist((latest.stickers || []).some(item => item.id === data.stickerId), '스티커를 찾지 못했어요.');
          latest.stickers = latest.stickers.filter(item => item.id !== data.stickerId);
          latest.options = updatedOptions || settings(latest.options || undefined);
          insist(latest.options.stickerTransforms.every(t => t.id === data.stickerId || latest.stickers.some(item => item.id === t.id)), '스티커 목록이 변경됐어요.', 409);
          latest.options.stickerTransforms = latest.options.stickerTransforms.filter(item => item.id !== data.stickerId);
          await store.save(latest);
        });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/cutout/device') {
        insist(!jobs.active, 'AI 작업이 끝난 뒤 기기 자동 분리를 적용해 주세요.', 409);
        insist(['apple-vision', 'android-mlkit', 'android-mediapipe-cpu'].includes(data.provider), '자동 누끼 제공자를 확인해 주세요.');
        insist(typeof data.mask === 'string' && /^[A-Za-z0-9+/=]+$/.test(data.mask) && data.mask.length <= 17000000, '올바른 누끼 마스크가 필요해요.');
        const asset = data.assetId ? (project.imports || []).find(item => item.id === data.assetId) : null;
        insist(!data.assetId || asset, '가져온 사진을 찾지 못했어요.');
        const sticker = data.stickerId ? (project.stickers || []).find(item => item.id === data.stickerId) : null;
        insist(!data.stickerId || sticker, '스티커가 변경됐어요. 다시 선택해 주세요.', 409);
        insist(!(asset && sticker), '분리할 사진 하나를 선택해 주세요.');
        insist(asset || ((sticker || data.sourceFile === (project.sourceFile || 'source.png')) && data.baseRevision === (project.maskRevision || 0)), '사진 또는 누끼가 변경됐어요. 다시 분리해 주세요.', 409);
        const source = await store.read(project.id, asset ? asset.file : sticker ? sticker.sourceFile : project.sourceFile || 'source.png');
        const cutout = await deviceMaskCutout(source, Buffer.from(data.mask, 'base64'));
        await mutate(async () => {
          const latest = await store.get(project.id), id = randomUUID();
          insist(!jobs.active, 'AI 작업이 끝난 뒤 기기 자동 분리를 적용해 주세요.', 409);
          const target = sticker && (latest.stickers || []).find(item => item.id === sticker.id);
          insist(asset || ((sticker ? target && target.sourceFile === sticker.sourceFile : (latest.sourceFile || 'source.png') === data.sourceFile) && (latest.maskRevision || 0) === data.baseRevision), '사진 또는 누끼가 변경됐어요. 다시 분리해 주세요.', 409);
          if (target) {
            const file = 'sticker-' + id + '.png';
            await store.write(project.id, file, cutout);
            target.file = file; delete target.maskFile; target.provider = data.provider;
            latest.maskRevision = (latest.maskRevision || 0) + 1;
          } else if (asset) {
            insist((latest.stickers || []).length < 16, '스티커는 최대 16개까지 가능해요.');
            const file = 'sticker-' + id + '.png', sourceFile = 'sticker-source-' + id + '.png', trimmed = await trimSticker(source, cutout);
            await store.write(project.id, file, trimmed.bytes); await store.write(project.id, sourceFile, trimmed.source);
            latest.stickers ||= []; latest.stickers.push({ id, file, sourceFile, width: trimmed.width, height: trimmed.height, label: stickerLabel(latest), provider: data.provider });
            latest.options = settings(latest.options || undefined);
            latest.options.stickerTransforms.push({ id, x: 0.5, y: 0.45, scale: 0.65 });
            if (latest.pendingImport === asset.id) latest.pendingImport = null;
          } else {
            await store.write(project.id, 'subject-' + id + '.png', cutout);
            latest.candidates.push({ id, label: '기기에서 자동 분리', provider: data.provider }); latest.selectedId = id;
            latest.maskRevision = (latest.maskRevision || 0) + 1; latest.maskEdits = {};
            latest.options = settings({ ...(latest.options || {}), hidePrimary: false });
          }
          await store.save(latest);
        });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/cutout') {
        const asset = data.assetId ? (project.imports || []).find(item => item.id === data.assetId) : null;
        insist(!data.assetId || asset, '가져온 사진을 찾지 못했어요.');
        const source = await store.read(project.id, asset ? asset.file : project.sourceFile || 'source.png');
        const cutout = await contourCutout(source, data.points);
        await mutate(async () => {
          const latest = await store.get(project.id), id = randomUUID();
          insist(asset || (latest.sourceFile || 'source.png') === (project.sourceFile || 'source.png'), '메인 사진이 변경됐어요. 새 사진에서 다시 잘라 주세요.', 409);
          if (asset) {
            insist((latest.stickers || []).length < 16, '스티커는 최대 16개까지 가능해요.');
            const file = `sticker-${id}.png`, sourceFile = `sticker-source-${id}.png`, trimmed = await trimSticker(source, cutout);
            await store.write(project.id, file, trimmed.bytes);
            await store.write(project.id, sourceFile, trimmed.source);
            latest.stickers ||= []; latest.stickers.push({ id, file, sourceFile, width: trimmed.width, height: trimmed.height, label: stickerLabel(latest) });
            latest.options = settings(latest.options || undefined);
            latest.options.stickerTransforms.push({ id, x: 0.5, y: 0.45, scale: 0.65 });
            if (latest.pendingImport === asset.id) latest.pendingImport = null;
            await store.save(latest); return;
          }
          await store.write(project.id, `subject-${id}.png`, cutout);
          latest.candidates.push({ id, label: '직접 자른 스티커', provider: 'manual-contour' });
          latest.selectedId = id;
          latest.maskRevision = (latest.maskRevision || 0) + 1;
          latest.options = settings(latest.options || undefined);
          latest.options.hidePrimary = false;
          await store.save(latest);
        });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/mask' || url.pathname === '/mask/reset') {
        insist(project.selectedId || data.stickerId, '보정할 피사체를 먼저 선택해 주세요.');
        if (url.pathname === '/mask') validateStrokes(data.strokes);
        insist(Number.isSafeInteger(data.baseRevision) && data.baseRevision >= 0, '보정 버전을 확인해 주세요.');
        await mutate(async () => {
          const latest = await store.get(project.id);
          if (data.stickerId) {
            const sticker = (latest.stickers || []).find(item => item.id === data.stickerId);
            insist(sticker && (latest.maskRevision || 0) === data.baseRevision, '스티커가 변경됐어요. 다시 열어 주세요.', 409);
            if (url.pathname === '/mask/reset') delete sticker.maskFile;
            else {
              const source = await store.read(project.id, sticker.sourceFile), cutout = await store.read(project.id, sticker.maskFile || sticker.file);
              const file = `mask-${randomUUID()}.png`;
              await store.write(project.id, file, await refineMask(source, cutout, data.strokes)); sticker.maskFile = file;
            }
            latest.maskRevision = (latest.maskRevision || 0) + 1;
            await store.save(latest); return;
          }
          insist(latest.selectedId === data.candidateId && (latest.maskRevision || 0) === data.baseRevision, '피사체가 변경됐어요. 최신 누끼를 불러온 뒤 다시 보정해 주세요.', 409);
          latest.maskEdits ||= {};
          if (url.pathname === '/mask/reset') delete latest.maskEdits[latest.selectedId];
          else {
            const source = await store.read(project.id, latest.sourceFile || 'source.png');
            const cutout = await store.read(project.id, latest.maskEdits[latest.selectedId] || `subject-${latest.selectedId}.png`);
            const corrected = await refineMask(source, cutout, data.strokes);
            const name = `mask-${randomUUID()}.png`;
            await store.write(project.id, name, corrected);
            latest.maskEdits[latest.selectedId] = name;
          }
          latest.maskRevision = (latest.maskRevision || 0) + 1;
          latest.options = settings(latest.options || undefined);
          latest.options.hidePrimary = false;
          await store.save(latest);
        });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/render' || url.pathname === '/options') {
        let options = settings(data.options);
        await mutate(async () => {
          const latest = await store.get(project.id);
          if (!Object.hasOwn(data.options, 'stickerTransforms')) options.stickerTransforms = latest.options?.stickerTransforms || [];
          insist(options.stickerTransforms.every(t => (latest.stickers || []).some(item => item.id === t.id)), '스티커 목록이 변경됐어요. 작업을 다시 열어 주세요.', 409);
          for (const sticker of latest.stickers || []) if (!options.stickerTransforms.some(item => item.id === sticker.id)) {
            options.stickerTransforms.push(latest.options?.stickerTransforms?.find(item => item.id === sticker.id) || { id: sticker.id, x: 0.5, y: 0.45, scale: 0.65 });
          }
          options = settings(options); latest.options = options; await store.save(latest);
        });
        send(200, url.pathname === '/options' ? { options } : await view(project.id, !!data.previewOnly)); return;
      }
      if (url.pathname === '/select') {
        insist(project.candidates.some(c => c.id === data.candidateId), '피사체 후보를 다시 선택해 주세요.');
        await mutate(async () => { const latest = await store.get(project.id); latest.selectedId = data.candidateId; latest.options = settings(latest.options || undefined); latest.options.hidePrimary = false; await store.save(latest); });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/decoration/remove') {
        await mutate(async () => { const latest = await store.get(project.id); latest.decoration = false; await store.save(latest); });
        send(200, await view(project.id)); return;
      }
      insist(['/segment', '/decoration', '/decoration/segment'].includes(url.pathname), '지원하지 않는 요청이에요.', 404);
      const importedAsset = data.assetId ? (project.imports || []).find(item => item.id === data.assetId) : null;
      insist(!data.assetId || (url.pathname === '/segment' && importedAsset), '가져온 사진을 찾지 못했어요.');
      if (importedAsset) insist((project.stickers || []).length < 16, '스티커는 최대 16개까지 가능해요.');
      // Validate before reserving any potential paid call.
      if (url.pathname === '/decoration' || (!data.point && url.pathname === '/segment')) insist(typeof data.prompt === 'string' && data.prompt.trim() && data.prompt.length <= 500, '대상을 500자 이내로 설명해 주세요.');
      if (data.point) insist(Number.isFinite(data.point.x) && Number.isFinite(data.point.y) && data.point.x >= 0 && data.point.x <= 1 && data.point.y >= 0 && data.point.y <= 1, '사진 안에서 대상을 선택해 주세요.');
      await jobs.workflow(data.jobId, hash({ path: url.pathname, projectId: project.id, assetId: data.assetId, prompt: data.prompt, point: data.point }), async () => {
        if (url.pathname === '/decoration') {
          const result = await models.run('image',{model:'muse-image-1.0',prompt:data.prompt,version:1},()=>{modelReady();return generateDecoration({ key, prompt: data.prompt }, fetcher);});
          const generated = await normalisePhoto(result.bytes);
          const generatedAsset=await library.put({source:generated.bytes,cutout:generated.bytes,label:'Generated image',kind:'generated',provenance:{model:result.model,requestId:result.requestId,prompt:data.prompt}});
          await store.write(project.id, 'decoration-source.png', generated.bytes);
          await mutate(async () => { const latest = await store.get(project.id); latest.decorationPending = { prompt: data.prompt, model: result.model, requestId: result.requestId, assetId:generatedAsset.id,width: generated.width, height: generated.height }; latest.decoration = false; await store.save(latest); });
          return { projectId: project.id, requestId: result.requestId };
        }
        const isDecoration = url.pathname === '/decoration/segment';
        insist(!isDecoration || project.decorationPending, '장식을 먼저 생성해 주세요.');
        const image = await store.read(project.id, isDecoration ? 'decoration-source.png' : importedAsset ? importedAsset.file : project.sourceFile || 'source.png');
        const m = await sharp(image).metadata();
        const result = await cachedSegment(image,isDecoration ? null : data.point,isDecoration ? project.decorationPending.prompt : data.prompt);
        insist(result.masks.length > 0, '대상을 찾지 못했어요. 사진에서 대상을 탭하거나 더 짧게 설명해 주세요.', 422);
        insist(result.masks.length <= 16, '대상이 너무 많아요. 사진에서 하나를 탭해 주세요.', 422);
        const selectedMasks = isDecoration ? [result.masks.reduce((a, b) => a.raster.reduce((n, v) => n + v, 0) > b.raster.reduce((n, v) => n + v, 0) ? a : b)] : result.masks;
        const candidates = [];
        for (const mask of selectedMasks) {
          const bytes = await cutoutFromRaster(image, mask.raster, mask.box, mask.width, mask.height);
          const id = randomUUID();
          await store.write(project.id, isDecoration ? 'decoration.png' : `subject-${id}.png`, bytes);
          if(result.experimentId)await addTestOutput(result.experimentId,bytes,`Cutout ${mask.objectId}`,result.logRoot);
          candidates.push({ id, label: `대상 ${mask.objectId}`, box: mask.box, provider: result.model, requestId: result.requestId });
        }
        await mutate(async () => {
          const latest = await store.get(project.id);
          if (importedAsset) {
            insist((latest.stickers || []).length + candidates.length <= 16, '스티커는 최대 16개까지 가능해요.');
            latest.stickers ||= []; latest.options = settings(latest.options || undefined);
            for (const candidate of candidates) {
              const trimmed = await trimSticker(image, await store.read(project.id, `subject-${candidate.id}.png`));
              const file = `sticker-${candidate.id}.png`, sourceFile = `sticker-source-${candidate.id}.png`;
              await store.write(project.id, file, trimmed.bytes); await store.write(project.id, sourceFile, trimmed.source);
              latest.stickers.push({ id: candidate.id, file, sourceFile, width: trimmed.width, height: trimmed.height, label: stickerLabel(latest), provider: candidate.provider, requestId: candidate.requestId });
              latest.options.stickerTransforms.push({ id: candidate.id, x: 0.5, y: 0.45, scale: 0.65 });
            }
            if (latest.pendingImport === importedAsset.id) latest.pendingImport = null;
            await store.save(latest); return;
          }
          if (isDecoration) { latest.decoration = true; latest.decorationProvenance = { image: latest.decorationPending, segmentation: { model: result.model, requestId: result.requestId } }; latest.decorationPending = null; }
          else { insist((latest.sourceFile || 'source.png') === (project.sourceFile || 'source.png'), '메인 사진이 변경됐어요. 새 사진에서 다시 분리해 주세요.', 409); latest.candidates = candidates; latest.selectedId = candidates.length === 1 ? candidates[0].id : null; latest.options = settings(latest.options || undefined); latest.options.hidePrimary = false; }
          await store.save(latest);
        });
        return { projectId: project.id, requestId: result.requestId };
      });
      send(200, await view(project.id));
    } catch (error) {
      if (!(error instanceof AppError)) console.error('Pop-out request failed:', error.name);
      send(error.status || 500, { error: error.status ? error.message : '작업을 완료하지 못했어요. 기존 사진과 작업은 보관돼 있어요.', code: error.code || 'internal_error' });
    }
  });
  server.requestTimeout = 150000;
  return { server, store, jobs, token: pairing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const port = Number(process.env.POPOUT_PORT || 4180), host = process.env.POPOUT_HOST || '127.0.0.1';
  app.server.listen(port, host, () => console.log(`Pop-out API ready at http://${host}:${port} · Model key ${process.env.MODEL_API_KEY ? 'configured' : 'not configured'}`));
}
