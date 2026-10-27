import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { insist } from './errors.mjs';

export const validId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
export async function atomicJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}
export class Store {
  constructor(root) { this.root = root; }
  directory(id) { insist(validId(id), '프로젝트 ID가 올바르지 않아요.'); return path.join(this.root, 'projects', id); }
  async create(photo, provenance = 'user') {
    const project = { id: randomUUID(), createdAt: new Date().toISOString(), width: photo.width, height: photo.height, sourceFile: 'source.png', provenance, candidates: [], selectedId: null, decoration: false, options: provenance === 'user' ? { mode: 'plain', zoom: 1, x: 0, y: 0 } : null };
    await mkdir(this.directory(project.id), { recursive: true });
    await writeFile(path.join(this.directory(project.id), 'source.png'), photo.bytes);
    await this.save(project);
    return project;
  }
  async get(id) {
    try { return JSON.parse(await readFile(path.join(this.directory(id), 'project.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') insist(false, '프로젝트를 찾지 못했어요. 원본을 다시 선택해 주세요.', 404); throw error; }
  }
  save(project) { return atomicJson(path.join(this.directory(project.id), 'project.json'), project); }
  read(id, name) { return readFile(path.join(this.directory(id), name)); }
  write(id, name, bytes) { return writeFile(path.join(this.directory(id), name), bytes); }
}

// Reservations survive a crash. Uncertain requests consume their cap and are never auto-retried.
export class ModelJobs {
  constructor(file, caps) { this.file = file; this.caps = caps; this.active = false; this.tail = Promise.resolve(); }
  async init() {
    try { this.jobs = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.jobs = {}; }
    for (const job of Object.values(this.jobs)) if (job.status === 'running') { job.status = 'uncertain'; job.message = '서버 재시작으로 호출 결과가 미확인이에요. 자동 재호출하지 않아요.'; }
    await atomicJson(this.file, this.jobs);
  }
  exclusive(fn) {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
  usage() {
    return Object.fromEntries(['sam', 'image'].map(kind => [kind, { reserved: Object.values(this.jobs).filter(j => j.kind === kind).length, cap: this.caps[kind] }]));
  }
  async run(id, kind, fingerprint, execute) {
    insist(validId(id), '작업 ID가 올바르지 않아요.');
    const previous = await this.exclusive(async () => {
      const prior = this.jobs[id];
      if (prior) {
        insist(prior.fingerprint === fingerprint && prior.kind === kind, '같은 작업 ID로 다른 요청을 보낼 수 없어요.', 409);
        return prior;
      }
      insist(!this.active, '다른 AI 작업이 진행 중이에요. 완료 후 다시 시도해 주세요.', 409);
      const count = Object.values(this.jobs).filter(j => j.kind === kind).length;
      insist(count < this.caps[kind], '설정한 모델 호출 한도에 도달했어요. 기존 편집과 저장은 계속할 수 있어요.', 429);
      this.jobs[id] = { kind, fingerprint, status: 'running', startedAt: new Date().toISOString() };
      await atomicJson(this.file, this.jobs);
      this.active = true;
      return null;
    });
    if (previous) {
      insist(previous.status === 'succeeded', previous.message || '이 작업은 진행 중이거나 결과가 미확인이에요. 새로 호출하지 말고 상태를 확인해 주세요.', 409);
      return previous.result;
    }
    try {
      const result = await execute();
      this.jobs[id] = { ...this.jobs[id], status: 'succeeded', completedAt: new Date().toISOString(), result };
      await atomicJson(this.file, this.jobs);
      return result;
    } catch (error) {
      this.jobs[id] = { ...this.jobs[id], status: 'uncertain', message: error.message, completedAt: new Date().toISOString() };
      await atomicJson(this.file, this.jobs);
      throw error;
    } finally { this.active = false; }
  }
}
