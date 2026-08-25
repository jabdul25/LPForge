import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function walk(directory){const entries=await readdir(directory,{withFileTypes:true});const files=[];for(const entry of entries){const target=path.join(directory,entry.name);if(entry.isDirectory())files.push(...await walk(target));else if(/\.ts$/.test(entry.name))files.push(target);}return files;}
const allowed=new Set(['apps/operator/src/main.ts','apps/discovery-learning/src/main.ts','apps/discovery-learning/src/post-entry-telemetry-capture.ts','packages/db/src/index.ts','packages/post-entry-telemetry/src/index.ts']);
const offenders=[];
for(const file of [...await walk('apps'),...await walk('packages')]){
  if(file.startsWith('packages/phase3-forward-validation/'))continue;
  const source=await readFile(file,'utf8');
  if(source.includes('phase3-forward-validation')&&!allowed.has(file))offenders.push(file);
}
if(offenders.length)throw new Error(`LPFORGE_FORWARD_VALIDATION_AUTHORITY_BOUNDARY_BREACH:${offenders.join(',')}`);
console.log('PHASE3_FORWARD_VALIDATION_BOUNDARY_OK research_capture_and_learning_only=PASS');
