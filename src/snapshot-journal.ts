import type { ProjectView } from './client';
import { lastEdit } from './snapshot.ts';
import type { Snapshot } from './snapshot';
export type JournalStorage = { ensure: () => Promise<void>; read: (name: string) => Promise<string>; write: (name: string, data: string) => Promise<void>; list: () => Promise<string[]>; remove: (name: string) => Promise<void> };
type Entry = { snapshot: Snapshot; critical: boolean; waiters: { resolve: () => void; reject: (error: unknown) => void }[] };
const assetName = /^asset-\d+-\d+\.b64$/;
export class SnapshotJournal {
  private revision = 0;
  private serial = 0;
  private running = false;
  private queue: Entry[] = [];
  private cache = new Map<string, { data: string; name: string }>();
  private storage: JournalStorage;
  constructor(storage: JournalStorage) { this.storage = storage; }
  save(snapshot: Snapshot, critical = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const tail = this.queue.at(-1);
      if (!critical && tail && !tail.critical) { tail.snapshot = snapshot; tail.waiters.push({ resolve, reject }); }
      else this.queue.push({ snapshot, critical, waiters: [{ resolve, reject }] });
      if (!this.running) { this.running = true; void Promise.resolve().then(() => this.drain()); }
    });
  }
  private async drain() {
    while (this.queue.length) {
      const entry = this.queue.shift()!;
      try { await this.writeSnapshot(entry.snapshot); entry.waiters.forEach(item => item.resolve()); }
      catch (error) { entry.waiters.forEach(item => item.reject(error)); }
    }
    this.running = false;
  }
  private async media(view: ProjectView | null, encode: boolean): Promise<ProjectView | null> {
    if (!view) return null;
    const result = { ...view };
    const field = async (role: string, data?: string | null): Promise<string | null | undefined> => {
      if (!data) return data;
      const key = `${view.project.id}:${role}`;
      if (!encode) {
        if (!data.startsWith('@asset/')) return data;
        const name = data.slice(7);
        if (!assetName.test(name)) throw new Error('Invalid cached media reference');
        const pixels = await this.storage.read(name);
        this.cache.set(key, { name, data: pixels }); return pixels;
      }
      const cached = this.cache.get(key);
      if (cached?.data === data) return `@asset/${cached.name}`;
      const name = `asset-${this.revision}-${++this.serial}.b64`;
      await this.storage.write(name, data);
      this.cache.set(key, { name, data }); return `@asset/${name}`;
    };
    const [image, source, subject, photoSource, baseImage, primaryImage, subjectShadow, stickers, decorationImage, pendingPhoto] = await Promise.all([
      field('image', view.image), field('source', view.source), field('subject', view.subject), field('photoSource', view.photoSource), field('baseImage', view.baseImage), field('primaryImage', view.primaryImage), field('subjectShadow', view.subjectShadow),
      Promise.all((view.stickers || []).map(async item => ({ ...item, data: (await field(`sticker:${item.id}`, item.data))! }))),
      view.decorationImage ? field('decoration', view.decorationImage.data).then(data => ({ ...view.decorationImage!, data: data! })) : view.decorationImage,
      view.pendingPhoto ? field(`pending:${view.pendingPhoto.id}`, view.pendingPhoto.source).then(source => ({ ...view.pendingPhoto!, source: source! })) : view.pendingPhoto,
    ]);
    return { ...result, image: image!, source: source!, subject, photoSource, baseImage, primaryImage, subjectShadow, stickers, decorationImage, pendingPhoto };
  }
  private async writeSnapshot(snapshot: Snapshot) {
    await this.storage.ensure();
    const revision = ++this.revision;
    const saved = lastEdit(snapshot);
    const view = await this.media(saved.view, true);
    await this.storage.write(`draft-${revision % 2}.json`, JSON.stringify({ version: 3, revision, snapshot: { ...saved, view } }));
    await this.clean().catch(() => {});
  }
  async restore(): Promise<Snapshot | null> {
    const items = await Promise.all([0, 1].map(async slot => {
      try {
        const value = JSON.parse(await this.storage.read(`draft-${slot}.json`));
        return [1, 2, 3].includes(value.version) && Number.isSafeInteger(value.revision) && value.snapshot && 'view' in value.snapshot ? value as { revision: number; snapshot: Snapshot } : null;
      } catch { return null; }
    }));
    const candidates = items.filter(item => item !== null).sort((a, b) => b.revision - a.revision);
    this.revision = Math.max(this.revision, ...candidates.map(item => item.revision));
    for (const candidate of candidates) {
      try { return lastEdit({ ...candidate.snapshot, view: await this.media(candidate.snapshot.view, false) }); }
      catch { /* Try the previous intact journal if a media write was interrupted. */ }
    }
    return null;
  }
  private async clean() {
    const keep = new Set<string>();
    const collect = (value: unknown) => {
      if (typeof value === 'string' && value.startsWith('@asset/') && assetName.test(value.slice(7))) keep.add(value.slice(7));
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    for (const slot of [0, 1]) { try { collect(JSON.parse(await this.storage.read(`draft-${slot}.json`))); } catch {} }
    for (const name of await this.storage.list()) if (assetName.test(name) && !keep.has(name)) await this.storage.remove(name);
    for (const [key, item] of this.cache) if (!keep.has(item.name)) this.cache.delete(key);
  }
}
