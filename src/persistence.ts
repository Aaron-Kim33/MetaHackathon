import * as FS from 'expo-file-system/legacy';
import type { ProjectView } from './client';
import { lastEdit } from './snapshot';
import type { Snapshot } from './snapshot';
export type { Snapshot } from './snapshot';

const folder = `${FS.documentDirectory}popout/`;
let saving: Promise<void> = Promise.resolve();
let revision = 0;
export async function restore(): Promise<Snapshot | null> {
  const candidates = await Promise.all([0, 1].map(async slot => {
    try {
      const item = JSON.parse(await FS.readAsStringAsync(`${folder}draft-${slot}.json`));
      if (![1, 2].includes(item.version) || !Number.isSafeInteger(item.revision) || !item.snapshot || !('view' in item.snapshot)) return null;
      return item as { revision: number; snapshot: Snapshot };
    } catch { return null; }
  }));
  const latest = candidates.filter(item => item !== null).sort((a, b) => b.revision - a.revision)[0];
  revision = latest?.revision || 0;
  return latest ? lastEdit(latest.snapshot) : null;
}
export function persist(snapshot: Snapshot): Promise<void> {
  const nextRevision = ++revision;
  const contents = JSON.stringify({ version: 2, revision: nextRevision, snapshot: lastEdit(snapshot) });
  const next = saving.then(async () => {
    await FS.makeDirectoryAsync(folder, { intermediates: true });
    await FS.writeAsStringAsync(`${folder}draft-${nextRevision % 2}.json`, contents);
  });
  saving = next.catch(() => {});
  return next;
}
export async function exportPhoto(view: ProjectView): Promise<string> {
  await FS.makeDirectoryAsync(folder, { intermediates: true });
  const uri = `${folder}popout-${view.project.id}.png`;
  await FS.writeAsStringAsync(uri, view.image, { encoding: FS.EncodingType.Base64 });
  return uri;
}
