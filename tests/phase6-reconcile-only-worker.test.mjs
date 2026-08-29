import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('disabled execution worker starts the signer-free reconciliation path',()=>{
  const source=fs.readFileSync('apps/execution/src/main.ts','utf8');
  const launcher=fs.readFileSync('scripts/pm2-start-execution.sh','utf8');
  assert.match(source,/async function reconcileOnlyOnce\(\)/);
  assert.match(source,/RECONCILE_ONLY_START/);
  assert.match(source,/reconcileWalletWidePositions/);
  assert.match(source,/LPFORGE_P6_EXECUTION_RUNNER_ENABLED/);
  const observeSection=source.slice(source.indexOf('async function reconcileOnlyOnce'),source.indexOf('async function start'));
  assert.doesNotMatch(observeSection,/signerFromEnvironment\(/);
  assert.doesNotMatch(observeSection,/dispatchOne\(/);
  assert.match(launcher,/assert-observe-launchable/);
  assert.doesNotMatch(launcher,/assert-launchable/);
});
