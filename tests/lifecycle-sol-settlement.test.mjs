import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assessLifecycleSettlement,lifecycleSettlementEvidenceHash} from '../.build/packages/db/src/index.js';

const lifecycle={lifecycleId:'life-1',positionAddress:'position-1',entryPlanId:'entry-1',ownerAddress:'owner',poolAddress:'pool',status:'CLOSED'};
const base={lifecycle,positionAbsent:true,positionCheckedAt:'2026-08-16T00:00:00.000Z',reconciliationClean:true,reservationClean:true,inventoryLots:[],transactions:[{transactionId:'open',signature:'sig-open',state:'CONFIRMED'},{transactionId:'close',signature:'sig-close',state:'CONFIRMED'}]};
const assess=(cashflows,more={})=>assessLifecycleSettlement({...base,cashflows,...more});

// Fixture A: 30m in, 33m out, 0.4m network cost = +2.6m exactly.
{
  const r=assess([{cashflowId:'in',flowType:'OPEN_CONTRIBUTION',lamports:30_000_000n},{cashflowId:'out',flowType:'CLOSE_WITHDRAWAL',lamports:33_000_000n},{cashflowId:'fee',flowType:'TX_COST',lamports:400_000n}]);
  assert.equal(r.ready,true); assert.equal(r.realizedSolPnlLamports,2_600_000n);
}
// Fixture B: X is valued only by actual Jupiter output, never a market price.
{
  const r=assess([{cashflowId:'in',flowType:'OPEN_CONTRIBUTION',lamports:30_000_000n},{cashflowId:'y',flowType:'CLOSE_WITHDRAWAL',lamports:10_000_000n},{cashflowId:'x',flowType:'CLOSE_WITHDRAWAL',tokenMint:'ABC',tokenAmountRaw:'100'},{cashflowId:'swap',flowType:'SWAP_PROCEEDS',lamports:23_000_000n},{cashflowId:'cost',flowType:'TX_COST',lamports:1_000_000n}]);
  assert.equal(r.ready,true);assert.equal(r.realizedSolPnlLamports,2_000_000n);
}
// Fixture E: refundable rent affects PnL exactly once through the gross flows.
{
  const full=assess([{cashflowId:'lock',flowType:'RENT_LOCK',lamports:2_000_000n},{cashflowId:'return',flowType:'RENT_RECOVERY',lamports:2_000_000n}]);
  assert.equal(full.netRentCostLamports,0n);assert.equal(full.realizedSolPnlLamports,0n);
  const partial=assess([{cashflowId:'lock',flowType:'RENT_LOCK',lamports:2_000_000n},{cashflowId:'return',flowType:'RENT_RECOVERY',lamports:1_800_000n}]);
  assert.equal(partial.netRentCostLamports,200_000n);assert.equal(partial.realizedSolPnlLamports,-200_000n);
}
// Fixtures C/D/H: any attributable dust (including with manual wallet token
// contamination) prevents settlement, while a transferred successor lot is
// explicitly admissible only at zero remaining raw amount.
{
  const lot={lotId:'claim-x',positionAddress:'position-1',planId:'claim',ownerAddress:'owner',poolAddress:'pool',tokenMint:'ABC',tokenSide:'X',sourceEvent:'FEE_CLAIM',rawAmount:100n,remainingRawAmount:1n,decimals:6,acquiredAt:'2026-08-16T00:00:00.000Z',status:'PARTIALLY_SETTLED',payload:{}};
  const r=assess([], {inventoryLots:[lot]});assert.equal(r.ready,false);assert.match(r.reasonCodes.join(','),/SETTLEMENT_INVENTORY_REMAINS:claim-x/);
  assert.equal(assess([], {inventoryLots:[{...lot,remainingRawAmount:0n,status:'TRANSFERRED',payload:{terminalSettlement:{successorPositionAddress:'position-2',transferredRawAmount:'100'}}}]}).ready,true);
  assert.equal(assess([], {inventoryLots:[{...lot,remainingRawAmount:0n,status:'SETTLED'}]}).ready,false);
  assert.equal(assess([], {inventoryLots:[{...lot,remainingRawAmount:0n,status:'SETTLED',payload:{terminalSettlement:{transactionSignature:'swap-sig'}}}]}).ready,true);
}
// Fixture F: an uncertain child signature is a hard terminal boundary.
assert.equal(assess([], {transactions:[{transactionId:'unwind',signature:'sig',state:'UNKNOWN'}]}).ready,false);
// Fixture G: a missing PositionV2 absence proof is a hard terminal boundary.
assert.equal(assess([], {positionAbsent:false}).ready,false);

// Final close terminalization must not be circularly blocked by the position's
// own temporary RECONCILIATION_REQUIRED marker. The worker may ignore only
// that marker after chain account absence; every child transaction, inventory
// lot, cashflow, and capital reservation remains assessed by this authority.
{
  const worker=fs.readFileSync("packages/phase6-live-worker/src/index.ts","utf8");
  assert.match(worker,/reconciliationClean:true,positionAbsent:true/);
  assert.match(worker,/self-referential/);
  const blocked=assess([], {reconciliationClean:false});
  assert.equal(blocked.ready,false);
  assert.match(blocked.reasonCodes.join(","),/SETTLEMENT_RECONCILIATION_REQUIRED/);
}

// Repeated recovery uses immutable economic evidence, not a new wall-clock
// timestamp, so it can return the single stored settlement deterministically.
{
  const input={...base,cashflows:[{cashflowId:'in',flowType:'OPEN_CONTRIBUTION',lamports:30n}],positionCheckedAt:'2026-08-16T00:00:00.000Z'};
  const r=assessLifecycleSettlement(input);
  const h1=await lifecycleSettlementEvidenceHash(input,r);
  const h2=await lifecycleSettlementEvidenceHash({...input,positionCheckedAt:'2026-08-16T00:01:00.000Z'},r);
  assert.equal(h1,h2);
}
const migration=fs.readFileSync('packages/db/migrations/M0041_lifecycle_sol_settlements.sql','utf8');
assert.match(migration,/CREATE TABLE IF NOT EXISTS execution\.position_lifecycles/);
assert.match(migration,/UNIQUE\(lifecycle_id,settlement_version\)/);
assert.match(migration,/prevent_lifecycle_settlement_mutation/);
assert.match(migration,/SOL_SETTLED/);

console.log('LIFECYCLE_SOL_SETTLEMENT_OK');
