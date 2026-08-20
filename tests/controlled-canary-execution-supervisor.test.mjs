import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('controlled canary supervisor reads the persisted P7 control from operations', async () => {
  const script = await readFile(new URL('../scripts/controlled-canary-execution-supervisor.sh', import.meta.url), 'utf8');
  assert.match(script, /FROM operations\.phase7_control_decisions/);
  assert.doesNotMatch(script, /FROM governance\.phase7_control_decisions/);
});
