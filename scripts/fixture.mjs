import { mkdir, writeFile } from 'node:fs/promises';
import { fixture } from '../server/fixture.mjs';
import { compose } from '../server/composition.mjs';
const sample = await fixture();
await mkdir('.local/fixtures', { recursive: true });
await writeFile('.local/fixtures/source.png', sample.bytes);
await writeFile('.local/fixtures/cutout.png', sample.cutout);
for (const ratio of ['portrait', 'story', 'square']) {
  const result = await compose({ source: sample.bytes, cutout: sample.cutout, options: { ratio } });
  await writeFile(`.local/fixtures/${ratio}.png`, result.bytes);
}
console.log('Created original vector fixture and three composition ratios in .local/fixtures. Not an AI result.');
