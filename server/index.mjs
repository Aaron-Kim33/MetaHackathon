import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { AppError, insist } from './errors.mjs';
import { compose, normalisePhoto, settings, cutoutFromRaster } from './composition.mjs';
import { Store, ModelJobs, validId } from './store.mjs';
import { segment, generateDecoration } from './meta.mjs';
import { fixture } from './fixture.mjs';
import { refineMask, validateStrokes, photoWithMaskEdits, contourCutout } from './mask.mjs';

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
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function createApp({ root = path.join(home, '.local'), token, key = process.env.MODEL_API_KEY, creditsConfirmed = process.env.HACKATHON_CREDITS_CONFIRMED === 'true', caps = { sam: Number(process.env.SAM_REQUEST_CAP || 0), image: Number(process.env.IMAGE_REQUEST_CAP || 0) }, fetcher } = {}) {
  const pairing = token || process.env.POPOUT_TOKEN || await localToken(root);
  insist(Object.values(caps).every(n => Number.isSafeInteger(n) && n >= 0), '호출 한도는 0 이상의 정수여야 해요.');
  const store = new Store(root), jobs = new ModelJobs(path.join(root, 'model-jobs.json'), caps);
  await jobs.init();
  let projectTail = Promise.resolve();
  function mutate(fn) { const next = projectTail.then(fn); projectTail = next.catch(() => {}); return next; }
  async function view(id) {
    const p = await store.get(id);
    const source = await store.read(id, 'source.png');
    const cutout = p.selectedId ? await store.read(id, p.maskEdits?.[p.selectedId] || `subject-${p.selectedId}.png`) : null;
    const photoSource = p.selectedId && p.maskEdits?.[p.selectedId]
      ? await photoWithMaskEdits(source, await store.read(id, `subject-${p.selectedId}.png`), cutout) : source;
    const decoration = p.decoration ? await store.read(id, 'decoration.png') : null;
    const result = await compose({ source: photoSource, cutout, decoration, options: p.options || undefined });
    const decorationMeta = decoration ? await sharp(decoration).metadata() : null;
    return { project: p, image: encoded(result.bytes), width: result.width, height: result.height, source: encoded(source), photoSource: photoSource === source ? null : encoded(photoSource), subject: cutout ? encoded(cutout) : null, decorationImage: decoration ? { data: encoded(decoration), width: decorationMeta.width, height: decorationMeta.height } : null, options: result.options, usage: jobs.usage() };
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') { send(200, { service: 'reel-talk-popout', version: 2, capabilities: ['contour-cutout', 'transparent-sticker', 'mask-photo-sync'] }); return; }
      const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      const expected = Buffer.from(pairing);
      insist(supplied.length === expected.length && timingSafeEqual(supplied, expected), 'PC 연결 설정을 확인해 주세요.', 401);
      if (req.method === 'GET' && url.pathname === '/status') { send(200, { modelConfigured: !!key?.trim(), creditsConfirmed, usage: jobs.usage() }); return; }
      if (req.method === 'GET' && url.pathname.startsWith('/jobs/')) {
        const id = url.pathname.split('/').at(-1); insist(validId(id), '작업 ID가 올바르지 않아요.');
        const job = jobs.jobs[id]; insist(job, '작업 기록을 찾지 못했어요.', 404); send(200, job); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/projects/')) { send(200, await view(url.pathname.split('/').at(-1))); return; }
      insist(req.method === 'POST', '지원하지 않는 요청이에요.', 404);
      const data = await body(req);
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
      if (url.pathname === '/cutout') {
        const source = await store.read(project.id, 'source.png');
        const cutout = await contourCutout(source, data.points);
        await mutate(async () => {
          const latest = await store.get(project.id), id = randomUUID();
          await store.write(project.id, `subject-${id}.png`, cutout);
          latest.candidates.push({ id, label: '직접 자른 스티커', provider: 'manual-contour' });
          latest.selectedId = id;
          latest.maskRevision = (latest.maskRevision || 0) + 1;
          latest.options = settings({ ...latest.options, mode: 'sticker', zoom: 1, x: 0, y: 0 });
          await store.save(latest);
        });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/mask' || url.pathname === '/mask/reset') {
        insist(project.selectedId, '보정할 피사체를 먼저 선택해 주세요.');
        if (url.pathname === '/mask') validateStrokes(data.strokes);
        insist(Number.isSafeInteger(data.baseRevision) && data.baseRevision >= 0, '보정 버전을 확인해 주세요.');
        await mutate(async () => {
          const latest = await store.get(project.id);
          insist(latest.selectedId === data.candidateId && (latest.maskRevision || 0) === data.baseRevision, '피사체가 변경됐어요. 최신 누끼를 불러온 뒤 다시 보정해 주세요.', 409);
          latest.maskEdits ||= {};
          if (url.pathname === '/mask/reset') delete latest.maskEdits[latest.selectedId];
          else {
            const source = await store.read(project.id, 'source.png');
            const cutout = await store.read(project.id, latest.maskEdits[latest.selectedId] || `subject-${latest.selectedId}.png`);
            const corrected = await refineMask(source, cutout, data.strokes);
            const name = `mask-${randomUUID()}.png`;
            await store.write(project.id, name, corrected);
            latest.maskEdits[latest.selectedId] = name;
          }
          latest.maskRevision = (latest.maskRevision || 0) + 1;
          await store.save(latest);
        });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/render') {
        const options = settings(data.options);
        await mutate(async () => { const latest = await store.get(project.id); latest.options = options; await store.save(latest); });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/select') {
        insist(project.candidates.some(c => c.id === data.candidateId), '피사체 후보를 다시 선택해 주세요.');
        await mutate(async () => { const latest = await store.get(project.id); latest.selectedId = data.candidateId; await store.save(latest); });
        send(200, await view(project.id)); return;
      }
      if (url.pathname === '/decoration/remove') {
        await mutate(async () => { const latest = await store.get(project.id); latest.decoration = false; await store.save(latest); });
        send(200, await view(project.id)); return;
      }
      insist(['/segment', '/decoration', '/decoration/segment'].includes(url.pathname), '지원하지 않는 요청이에요.', 404);
      insist(key?.trim(), 'Meta Model API 키가 아직 없어요. PC에서 npm run setup:model을 실행해 주세요.', 503);
      insist(creditsConfirmed, 'Billing의 대회 크레딧 지급을 확인한 뒤 PC에서 모델 설정을 완료해 주세요.', 403);
      // Validate before reserving any potential paid call.
      if (url.pathname === '/decoration' || (!data.point && url.pathname === '/segment')) insist(typeof data.prompt === 'string' && data.prompt.trim() && data.prompt.length <= 500, '대상을 500자 이내로 설명해 주세요.');
      if (data.point) insist(Number.isFinite(data.point.x) && Number.isFinite(data.point.y) && data.point.x >= 0 && data.point.x <= 1 && data.point.y >= 0 && data.point.y <= 1, '사진 안에서 대상을 선택해 주세요.');
      const kind = url.pathname === '/decoration' ? 'image' : 'sam';
      await jobs.run(data.jobId, kind, hash({ path: url.pathname, projectId: project.id, prompt: data.prompt, point: data.point }), async () => {
        if (url.pathname === '/decoration') {
          const result = await generateDecoration({ key, prompt: data.prompt }, fetcher);
          const generated = await normalisePhoto(result.bytes);
          await store.write(project.id, 'decoration-source.png', generated.bytes);
          await mutate(async () => { const latest = await store.get(project.id); latest.decorationPending = { prompt: data.prompt, model: result.model, requestId: result.requestId, width: generated.width, height: generated.height }; latest.decoration = false; await store.save(latest); });
          return { projectId: project.id, requestId: result.requestId };
        }
        const isDecoration = url.pathname === '/decoration/segment';
        insist(!isDecoration || project.decorationPending, '장식을 먼저 생성해 주세요.');
        const image = await store.read(project.id, isDecoration ? 'decoration-source.png' : 'source.png');
        const m = await sharp(image).metadata();
        const result = await segment({ key, image, width: m.width, height: m.height, point: isDecoration ? null : data.point, prompt: isDecoration ? project.decorationPending.prompt : data.prompt }, fetcher);
        insist(result.masks.length > 0, '대상을 찾지 못했어요. 사진에서 대상을 탭하거나 더 짧게 설명해 주세요.', 422);
        insist(result.masks.length <= 16, '대상이 너무 많아요. 사진에서 하나를 탭해 주세요.', 422);
        const selectedMasks = isDecoration ? [result.masks.reduce((a, b) => a.raster.reduce((n, v) => n + v, 0) > b.raster.reduce((n, v) => n + v, 0) ? a : b)] : result.masks;
        const candidates = [];
        for (const mask of selectedMasks) {
          const bytes = await cutoutFromRaster(image, mask.raster, mask.box, mask.width, mask.height);
          const id = randomUUID();
          await store.write(project.id, isDecoration ? 'decoration.png' : `subject-${id}.png`, bytes);
          candidates.push({ id, label: `대상 ${mask.objectId}`, box: mask.box, provider: result.model, requestId: result.requestId });
        }
        await mutate(async () => {
          const latest = await store.get(project.id);
          if (isDecoration) { latest.decoration = true; latest.decorationProvenance = { image: latest.decorationPending, segmentation: { model: result.model, requestId: result.requestId } }; latest.decorationPending = null; }
          else { latest.candidates = candidates; latest.selectedId = candidates.length === 1 ? candidates[0].id : null; }
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
