import test from 'node:test';
import assert from 'node:assert/strict';
import {toIsoTimestamp} from '../.build/packages/db/src/index.js';

test('DB Date timestamps preserve exact millisecond provenance',()=>{
  const observedAt='2026-08-14T02:53:13.442Z';
  assert.equal(toIsoTimestamp(new Date(observedAt)),observedAt);
});
