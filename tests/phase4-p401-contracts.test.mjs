import test from 'node:test';
import assert from 'node:assert/strict';
import { phase4Capabilities } from '../.build/packages/config/src/index.js';
test('P4-01 capability boundary is paper-only and non-signing',()=>{
 const c=phase4Capabilities();
 assert.equal(c.phase,'P4'); assert.equal(c.paperOnly,true); assert.equal(c.liveSigning,false);
 assert.ok(c.allowed.includes('entry_timing')); assert.ok(c.allowed.includes('risk_governor'));
 assert.ok(c.prohibited.includes('transaction_sign')); assert.ok(c.prohibited.includes('live_entry'));
});
