import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

const sourceCommit='0123456789abcdef0123456789abcdef01234567';
const nodeVersion=process.version;
const hash=value=>createHash('sha256').update(value).digest('hex');
const write=(root,file,value)=>{const target=path.join(root,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,value);};
const files=(root,dir='.')=>{
  const current=path.join(root,dir),entries=[];
  for(const entry of readdirSync(current,{withFileTypes:true})){
    const relative=path.join(dir,entry.name);
    if(entry.isDirectory())entries.push(...files(root,relative));
    else if(relative!=='SHA256SUMS.txt')entries.push(`./${relative.replaceAll('\\','/')}`);
  }
  return entries;
};
function checksum(root){
  const lines=files(root).sort().map(file=>`${hash(readFileSync(path.join(root,file.slice(2))))}  ${file}`);
  writeFileSync(path.join(root,'SHA256SUMS.txt'),`${lines.join('\n')}\n`);
}
function manifestFor(root,overrides={}){
  const policyHash=hash(readFileSync(path.join(root,'policies/live-execution-policy.json')));
  const lockfileHash=hash(readFileSync(path.join(root,'pnpm-lock.yaml')));
  const migrationHead='M0001_bootstrap.sql';
  const runtimePnpmVersion=execFileSync('pnpm',['--version'],{cwd:root,encoding:'utf8'}).trim();
  return {sourceCommit,policyHash,migrationCount:1,migrationHead,buildIdentity:hash(`${sourceCommit}\n${policyHash}\n${migrationHead}\n${lockfileHash}\n`),nodeVersion,pnpmVersion:runtimePnpmVersion,lockfileHash,...overrides};
}
function createFixture(t){
  const root=mkdtempSync(path.join(tmpdir(),'lpforge-runtime-identity-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  write(root,'scripts/verify-release-integrity.sh',readFileSync(path.resolve('scripts/verify-release-integrity.sh')));
  write(root,'scripts/verify-runtime-release-identity.mjs',readFileSync(path.resolve('scripts/verify-runtime-release-identity.mjs')));
  write(root,'.build/runtime.js','immutable compiled output\n');
  write(root,'policies/live-execution-policy.json','{"policy":"canonical"}\n');
  write(root,'pnpm-lock.yaml','lockfileVersion: 9.0\n');
  write(root,'packages/db/migrations/M0001_bootstrap.sql','select 1;\n');
  write(root,'SOURCE_REVISION.txt',`source_git_commit=${sourceCommit}\n`);
  write(root,'RELEASE_MANIFEST.json',`${JSON.stringify(manifestFor(root),null,2)}\n`);
  checksum(root);
  return root;
}
function resealChecksums(root){checksum(root);}
function run(root,env={}){return spawnSync(process.execPath,['scripts/verify-runtime-release-identity.mjs'],{cwd:root,env:{...process.env,...env},encoding:'utf8'});}
function passes(result){assert.equal(result.status,0,`${result.stderr}\n${result.stdout}`);}
function fails(result){assert.notEqual(result.status,0,'runtime identity verification unexpectedly passed');}

test('IDENTITY-001 / 015 valid immutable artifact derives runtime identity',t=>{
  const result=run(createFixture(t));passes(result);assert.match(result.stdout,/"artifactDerived"\s*:\s*true/);assert.match(result.stdout,new RegExp(sourceCommit));
});
test('IDENTITY-002 one byte changed in .build fails checksum verification',t=>{const root=createFixture(t);write(root,'.build/runtime.js','tampered\n');fails(run(root));});
test('IDENTITY-003 SOURCE_REVISION mutation fails',t=>{const root=createFixture(t);write(root,'SOURCE_REVISION.txt',`source_git_commit=${'f'.repeat(40)}\n`);resealChecksums(root);fails(run(root));});
test('IDENTITY-004 manifest source mismatch fails',t=>{const root=createFixture(t),manifest=JSON.parse(readFileSync(path.join(root,'RELEASE_MANIFEST.json'),'utf8'));manifest.sourceCommit='f'.repeat(40);write(root,'RELEASE_MANIFEST.json',`${JSON.stringify(manifest)}\n`);resealChecksums(root);fails(run(root));});
test('IDENTITY-005 false LPFORGE_SOURCE_COMMIT is rejected',t=>fails(run(createFixture(t),{LPFORGE_SOURCE_COMMIT:'f'.repeat(40)})));
test('IDENTITY-006 false LPFORGE_BUILD_ID is rejected',t=>fails(run(createFixture(t),{LPFORGE_BUILD_ID:'f'.repeat(64)})));
test('IDENTITY-007 changed lockfile fails explicit lockfile verification',t=>{const root=createFixture(t);write(root,'pnpm-lock.yaml','lockfileVersion: 9.1\n');resealChecksums(root);fails(run(root));});
test('IDENTITY-008 manifest lockfile hash mutation fails',t=>{const root=createFixture(t),manifest=JSON.parse(readFileSync(path.join(root,'RELEASE_MANIFEST.json'),'utf8'));manifest.lockfileHash='f'.repeat(64);write(root,'RELEASE_MANIFEST.json',`${JSON.stringify(manifest)}\n`);resealChecksums(root);fails(run(root));});
test('IDENTITY-009 Node version mismatch fails',t=>{const root=createFixture(t),manifest=JSON.parse(readFileSync(path.join(root,'RELEASE_MANIFEST.json'),'utf8'));manifest.nodeVersion='v0.0.0';write(root,'RELEASE_MANIFEST.json',`${JSON.stringify(manifest)}\n`);resealChecksums(root);fails(run(root));});
test('IDENTITY-010 policy mutation fails canonical policy verification',t=>{const root=createFixture(t);write(root,'policies/live-execution-policy.json','{"policy":"tampered"}\n');resealChecksums(root);fails(run(root));});
test('IDENTITY-011 / 012 migration head and count mismatch fail',t=>{const root=createFixture(t);write(root,'packages/db/migrations/M0002_next.sql','select 2;\n');resealChecksums(root);fails(run(root));});
test('IDENTITY-013 checksum member omission fails closed',t=>{const root=createFixture(t),lines=readFileSync(path.join(root,'SHA256SUMS.txt'),'utf8').trim().split('\n');write(root,'SHA256SUMS.txt',`${lines.filter(line=>!line.endsWith(' ./.build/runtime.js')).join('\n')}\n`);fails(run(root));});
test('IDENTITY-014 corrupted checksum fails closed',t=>{const root=createFixture(t);const lines=readFileSync(path.join(root,'SHA256SUMS.txt'),'utf8').split('\n');lines[0]=`f${lines[0].slice(1)}`;write(root,'SHA256SUMS.txt',lines.join('\n'));fails(run(root));});
test('PM2 startup and production runtime invoke the immutable gate',()=>{
  const ecosystem=readFileSync('ecosystem.config.cjs','utf8'),pm2Start=readFileSync('scripts/pm2-start.sh','utf8'),discoveryStart=readFileSync('scripts/pm2-start-discovery.sh','utf8'),production=readFileSync('apps/production/src/main.ts','utf8');
  assert.match(ecosystem,/scripts\/start-lpforge-service\.sh production/);assert.match(ecosystem,/scripts\/start-lpforge-service\.sh discovery/);assert.match(pm2Start,/verify-runtime-release-identity\.mjs/);assert.match(discoveryStart,/verify-runtime-release-identity\.mjs/);assert.match(production,/requireVerifiedRuntimeArtifactIdentity/);assert.match(production,/artifactBoundEnvironment/);
});
