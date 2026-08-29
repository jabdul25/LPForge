import assert from 'node:assert/strict';
import test from 'node:test';
import {shouldRebuildExpiredResidualUnwind,selectCanonicalRecoveredResidualLot} from '../.build/packages/phase6-live-worker/src/index.js';

test('expired residual child with position still present is rebuildable',()=>{
  assert.equal(shouldRebuildExpiredResidualUnwind({signatureStatusReadUnknown:false,confirmationStatus:'EXPIRED',positionExists:true,pendingStage:'CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED'}),true);
});

test('unknown, failed, confirmed, unreadable, or non-residual close children are never rebuilt',()=>{
  for(const input of [
    {signatureStatusReadUnknown:false,confirmationStatus:'UNKNOWN',positionExists:true,pendingStage:'CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED'},
    {signatureStatusReadUnknown:false,confirmationStatus:'FAILED',positionExists:true,pendingStage:'CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED'},
    {signatureStatusReadUnknown:false,confirmationStatus:'CONFIRMED',positionExists:true,pendingStage:'CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED'},
    {signatureStatusReadUnknown:true,confirmationStatus:'EXPIRED',positionExists:true,pendingStage:'CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED'},
    {signatureStatusReadUnknown:false,confirmationStatus:'EXPIRED',positionExists:false,pendingStage:'CLOSE_OPEN_RESIDUAL_UNWIND_SUBMITTED'},
    {signatureStatusReadUnknown:false,confirmationStatus:'EXPIRED',positionExists:true,pendingStage:'CLOSE_UNWIND_SUBMITTED'},
  ]) assert.equal(shouldRebuildExpiredResidualUnwind(input),false);
});

test('recovery source preserves completed close children and uses a fresh retry identity',async()=>{
  const fs=await import('node:fs/promises'); const source=await fs.readFile('packages/phase6-live-worker/src/index.ts','utf8'); const db=await fs.readFile('packages/db/src/index.ts','utf8');
  assert.match(source,/P6_CLOSE_RECOVERED_OPEN_RESIDUAL_EXPIRED_NO_CHAIN_EFFECT/);
  assert.match(source,/stage: "CLOSE_INVENTORY_UNWOUND"/);
  assert.match(source,/recovered-open-residual-unwind:retry-/);
  assert.match(source,/pendingStage: null/);
  assert.match(source,/CLOSE_RECOVERED_OPEN_RESIDUAL_PARENT_JOURNAL_REHYDRATED/);
  assert.match(source,/state: "CONFIRMED"/);
  assert.match(db,/CLOSE_PENDING_STAGE_EXPIRED_NO_CHAIN_EFFECT/);
});


test("measured OPEN residual remains canonical and duplicate recovery representation is transferred",()=>{
  const selected=selectCanonicalRecoveredResidualLot({entryPlanId:"entry",tokenMint:"mint",rawAmount:1966694n,lots:[
    {lotId:"open",planId:"entry",tokenMint:"mint",sourceEvent:"OPEN_RESIDUAL",remainingRawAmount:1966694n,status:"OPEN"},
    {lotId:"recovery",planId:"entry",tokenMint:"mint",sourceEvent:"RECOVERY_RESIDUAL",remainingRawAmount:1966694n,status:"OPEN"},
  ]});
  assert.equal(selected.canonicalLotId,"open");
  assert.deepEqual(selected.duplicateLotIds,["recovery"]);
});


test("terminal assessment preserves expired no-effect evidence and accepts audited residual deduplication",async()=>{
  const {assessLifecycleSettlement}=await import("../.build/packages/db/src/index.js");
  const base={lifecycle:{lifecycleId:"l",positionAddress:"p",status:"CLOSED"},cashflows:[],positionAbsent:true,positionCheckedAt:"2026-08-29T00:00:00.000Z",reconciliationClean:true,reservationClean:true};
  const assessment=assessLifecycleSettlement({...base,transactions:[{transactionId:"expired",state:"FAILED_FINAL"}],inventoryLots:[{lotId:"duplicate",positionAddress:"p",planId:"entry",ownerAddress:"owner",poolAddress:"pool",tokenMint:"mint",tokenSide:"X",sourceEvent:"RECOVERY_RESIDUAL",rawAmount:1n,remainingRawAmount:0n,decimals:6,acquiredAt:"2026-08-29T00:00:00.000Z",status:"TRANSFERRED",payload:{terminalSettlement:{source:"P6_RECOVERED_OPEN_RESIDUAL_DEDUPLICATION",canonicalLotId:"original",rawAmount:"1"}}}]});
  assert.equal(assessment.ready,true);
});
