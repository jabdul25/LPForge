import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath) throw new Error('LPFORGE_RUNTIME_RELEASE_IDENTITY_ARGUMENTS_REQUIRED');
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const sourceCommit = String(manifest.sourceCommit ?? '');
const buildIdentity = String(manifest.buildIdentity ?? '');
const liveExecutionPolicySha256 = String(manifest.policyHash ?? '');
if (!/^[0-9a-f]{40}$/i.test(sourceCommit) || !/^[0-9a-f]{64}$/i.test(buildIdentity) || !/^[0-9a-f]{64}$/i.test(liveExecutionPolicySha256)) {
  throw new Error('LPFORGE_RUNTIME_RELEASE_IDENTITY_MANIFEST_INVALID');
}
const identity = {
  schemaVersion: 1,
  sourceCommit,
  buildIdentity,
  liveExecutionPolicySha256,
  releaseManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
};
mkdirSync(dirname(outputPath), { recursive: true });
const temporary = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
writeFileSync(temporary, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o644 });
renameSync(temporary, outputPath);
