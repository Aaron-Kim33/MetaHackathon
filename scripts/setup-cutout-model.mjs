import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const url = 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task';
const digest = '38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03';
const target = new URL('../modules/subject-lift/android/src/main/assets/interactive_segmentation.task', import.meta.url);
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
let valid = false;
try { valid = checksum(await readFile(target)) === digest; } catch {}
if (!valid) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error(`CPU cutout model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (checksum(bytes) !== digest) throw Error('CPU cutout model checksum mismatch');
  await mkdir(new URL('.', target), { recursive: true });
  const temporary = new URL('./interactive_segmentation.task.tmp', target);
  await writeFile(temporary, bytes); await rename(temporary, target);
}
console.log('CPU cutout model ready (MagicTouch v2, version 1, SHA256 verified)');
