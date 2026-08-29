import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('completeAutonomousPlan binds terminal journal state as canonical text for PostgreSQL jsonb_build_object',async()=>{
  const source=await readFile('packages/db/src/index.ts','utf8');
  const start=source.indexOf('async completeAutonomousPlan(v)');
  const end=source.indexOf('async upsertOwnedPosition(v)');
  assert.ok(start>=0&&end>start);
  const method=source.slice(start,end);
  assert.match(method,/jsonb_build_object\('terminalPlanState',\$4::text,'terminalizedAt',\$3::text\)/);
});
