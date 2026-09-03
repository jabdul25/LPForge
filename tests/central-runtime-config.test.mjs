import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = await import('../.build/packages/config/src/index.js');

test('enforced releases use only the stable LPForge runtime root', () => {
  const env = {
    LPFORGE_HOME: '/srv/lpforge',
    LPFORGE_RUNTIME_CONFIG_ENFORCED: 'true',
    LPFORGE_EXECUTION_POLICY_PATH: '/release/policies/override.json',
  };
  assert.deepEqual(config.resolveRuntimeConfigPaths(env), {
    home: '/srv/lpforge',
    envFile: '/srv/lpforge/.env',
    executionEnvFile: '/srv/lpforge/.env.execution',
    executionPolicyFile: '/srv/lpforge/policy/live-execution-policy.json',
  });
  assert.equal(config.resolveLiveExecutionPolicyPath(env), '/srv/lpforge/policy/live-execution-policy.json');
});

test('development callers retain explicit policy fixtures without weakening production enforcement', () => {
  assert.equal(config.resolveLiveExecutionPolicyPath({ LPFORGE_EXECUTION_POLICY_PATH: '/tmp/fixture-policy.json' }), '/tmp/fixture-policy.json');
  assert.throws(() => config.resolveRuntimeConfigPaths({ LPFORGE_HOME: 'relative-root' }), /ABSOLUTE_PATH_REQUIRED/);
});

test('production launchers never load release-local environment files', () => {
  for (const file of ['scripts/start-lpforge-service.sh', 'scripts/pm2-start.sh', 'scripts/pm2-start-discovery.sh', 'scripts/pm2-start-execution.sh']) {
    const text = readFileSync(file, 'utf8');
    assert.match(text, /runtime-config-paths\.sh/);
    assert.doesNotMatch(text, /--env-file=\.env(?:\s|$)/);
    assert.doesNotMatch(text, /--env-file=\.env\.execution(?:\s|$)/);
  }
});

test('release integrity rejects release-local runtime environments', () => {
  const text = readFileSync('scripts/verify-release-integrity.sh', 'utf8');
  assert.match(text, /\.env must not be present in release/);
  assert.match(text, /\.env\.execution must not be present in release/);
  assert.match(text, /LPFORGE_RUNTIME_CONFIG_ENFORCED/);
});

test('nested immutable release layout is required for activation and installation', () => {
  const paths = readFileSync('scripts/runtime-config-paths.sh', 'utf8');
  const installer = readFileSync('scripts/install-production-release.sh', 'utf8');
  const guard = readFileSync('scripts/verify-release-layout.sh', 'utf8');
  assert.match(paths, /LPFORGE_RELEASE_LAYOUT_REQUIRED/);
  assert.match(paths, /\$LPFORGE_HOME"\/releases\/\*/);
  assert.match(installer, /\$lpforge_home\/releases\/\$source_sha/);
  assert.doesNotMatch(installer, /LPForge-release-\$\{?source_sha/);
  assert.match(guard, /LPFORGE_RELEASE_LAYOUT_FORBIDDEN/);
  assert.match(guard, /LPFORGE_RELEASE_LAYOUT_NODE_MODULES_INVALID/);
});
