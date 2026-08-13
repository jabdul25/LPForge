import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('P5-12 UNKNOWN submission persistence casts polymorphic JSON parameter explicitly',async()=>{
  const src=await readFile(new URL('../packages/db/src/index.ts',import.meta.url),'utf8');
  assert.match(src,/jsonb_build_object\('submission_error',\$3::text\)/);
});
