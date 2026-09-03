import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolveRuntimeConfigPaths, runtimeConfigDiagnostics } from '../.build/packages/config/src/index.js';

const paths = resolveRuntimeConfigPaths();
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const output = runtimeConfigDiagnostics();
const policyExists = existsSync(paths.executionPolicyFile);
let policy;
if (policyExists) {
  try {
    const value = JSON.parse(readFileSync(paths.executionPolicyFile, 'utf8'));
    policy = {
      source: paths.executionPolicyFile,
      sha256: hash(paths.executionPolicyFile),
      maxOpenPositions: value.maxOpenPositions ?? value.productionCapital?.maxOpenPositions ?? null,
      maxInitialPositionSol: value.productionCapital?.maxInitialPositionSol ?? null,
    };
  } catch {
    policy = { source: paths.executionPolicyFile, invalid: true };
  }
}
console.log(JSON.stringify({
  event: 'lpforge_runtime_config_diagnostics',
  ...output,
  envExists: existsSync(paths.envFile),
  executionEnvExists: existsSync(paths.executionEnvFile),
  policy: policy ?? { source: paths.executionPolicyFile, exists: false },
}, null, 2));
