import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const version=process.argv[2]||'1';
if(!['1','2'].includes(version))throw Error('Version must be 1 or 2');
const root=process.cwd(), backup=path.join(root,'.local/backups/tilt-version-'+version);
const manifest=JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'));
// Restore only the renderer files changed by this experiment. Project data,
// assets, credentials and subsequent unrelated editor work are never restored.
const files=['src/depth-mesh.ts','src/DepthSpatialCanvas.tsx','src/surface-depth.ts','server/spatial-layers.mjs',...(version==='2'?['src/layered-depth.ts']:[])];
for(const file of files){
 const record=manifest.files.find(r=>r.path.replaceAll('\\','/')===file);
 const bytes=await fs.readFile(path.join(backup,'source',file));
 if(!record||createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error('Backup integrity failure: '+file);
}
const safety=path.join(root,'.local/backups','before-restore-'+Date.now());
for(const file of files){
 await fs.mkdir(path.dirname(path.join(safety,file)),{recursive:true});
 await fs.copyFile(path.join(root,file),path.join(safety,file));
 await fs.copyFile(path.join(backup,'source',file),path.join(root,file));
}
console.log('Restored tilt version '+version+'. Restart API and run npm run reload.');
