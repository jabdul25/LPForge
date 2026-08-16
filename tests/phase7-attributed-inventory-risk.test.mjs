import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('attributed wallet inventory remains token exposure and missing valuation fails closed',()=>{
  const db=fs.readFileSync('packages/db/src/index.ts','utf8');
  const service=fs.readFileSync('packages/phase7-production-service/src/index.ts','utf8');
  assert.match(db,/loadOwnerPositionInventoryLots/);
  assert.match(db,/remaining_raw_amount>0/);
  for(const token of ['inventoryLots','inventoryExposureLamports','P7_PORTFOLIO_INVENTORY_VALUATION_MISSING','tokenExposureLamports'])assert.match(service,new RegExp(token));
});
