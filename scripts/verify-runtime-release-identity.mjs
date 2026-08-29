import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const result=spawnSync('bash',['scripts/verify-release-integrity.sh'],{
  cwd:process.cwd(),
  env:{...process.env,LPFORGE_RUNTIME_RELEASE_VERIFY:'true'},
  encoding:'utf8',
});
if(result.status!==0){
  process.stderr.write(result.stderr||result.stdout||'LPFORGE_RUNTIME_RELEASE_INTEGRITY_FAILED\n');
  process.exit(result.status??1);
}
const manifest=JSON.parse(readFileSync('RELEASE_MANIFEST.json','utf8'));
const revision=readFileSync('SOURCE_REVISION.txt','utf8').trim().replace(/^source_git_commit=/,'');
if(revision!==manifest.sourceCommit)throw new Error('LPFORGE_RUNTIME_ARTIFACT_SOURCE_IDENTITY_MISMATCH');
console.log(JSON.stringify({event:'lpforge_runtime_release_identity_verified',artifactDerived:true,sourceCommit:revision,buildIdentity:manifest.buildIdentity,policyHash:manifest.policyHash,migrationHead:manifest.migrationHead,migrationCount:manifest.migrationCount},null,2));
