import * as FS from 'expo-file-system/legacy';
import type { ProjectView } from './client';
import type { Snapshot } from './snapshot';
import { SnapshotJournal } from './snapshot-journal';
export type { Snapshot } from './snapshot';
const folder = `${FS.documentDirectory}popout/`;
const journal = new SnapshotJournal({
  ensure: () => FS.makeDirectoryAsync(folder, { intermediates: true }),
  read: name => FS.readAsStringAsync(folder + name),
  write: (name, data) => FS.writeAsStringAsync(folder + name, data),
  list: () => FS.readDirectoryAsync(folder),
  remove: name => FS.deleteAsync(folder + name, { idempotent: true }),
});
export const restore = () => journal.restore();
export const persist = (snapshot: Snapshot, critical = false) => journal.save(snapshot, critical);
export async function exportPhoto(view: ProjectView): Promise<string> {
  await FS.makeDirectoryAsync(folder, { intermediates: true });
  const uri = `${folder}popout-${view.project.id}.png`;
  await FS.writeAsStringAsync(uri, view.image, { encoding: FS.EncodingType.Base64 });
  return uri;
}
