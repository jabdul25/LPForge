import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { assessLifecycleSettlement } from '../.build/packages/db/src/index.js';
import { reconcileTerminalSettlementChainEffects } from '../.build/packages/phase6-live-worker/src/index.js';

const OWNER='OWNER',POSITION='POSITION',PLAN='close-plan',SIGNATURE='claim-signature';
function claimReceipt({gross=801_666n,fee=5_000n}={}){
  return {slot:1,version:0,transaction:{message:{accountKeys:[OWNER]}},meta:{err:null,fee:Number(fee),preBalances:[1_000_000],postBalances:[Number(1_000_000n+gross-fee)],loadedAddresses:{writable:[],readonly:[]},preTokenBalances:[],postTokenBalances:[],innerInstructions:[]}};
}
function input({includeClaim=true}={}){
  const cashflows=[
    {cashflowId:'entry',planId:'entry-plan',flowType:'OPEN_CONTRIBUTION',lamports:30_000_000n},
    {cashflowId:'cost',planId:PLAN,flowType:'TX_COST',lamports:5_000n,payload:{signature:SIGNATURE}},
  ];
  if(includeClaim)cashflows.push({cashflowId:'terminal-claim',planId:PLAN,flowType:'FEE_CLAIM',lamports:801_666n,payload:{signature:SIGNATURE,transactionId:'close:claim'}});
  return {lifecycle:{lifecycleId:'life',positionAddress:POSITION,ownerAddress:OWNER,poolAddress:'pool',status:'CLOSED'},cashflows,inventoryLots:[],transactions:[{transactionId:'close:claim',signature:SIGNATURE,state:'CONFIRMED',planId:PLAN,planRole:'CLOSE',kind:'METEORA_CLAIM'}],reconciliationClean:true,reservationClean:true};
}
test('terminal claim receipt is independently reconciled and cannot be omitted from DB cashflows',async()=>{
  const connection={async getTransaction(){return claimReceipt();}};
  const ok=await reconcileTerminalSettlementChainEffects({connection,plan:{planId:PLAN,ownerAddress:OWNER},positionAddress:POSITION,settlementInput:input()});
  assert.equal(ok.ok,true);assert.equal(ok.chainSolInLamports,801_666n);assert.equal(ok.chainSolOutLamports,5_000n);assert.equal(ok.dbSolInLamports,801_666n);
  const missing=await reconcileTerminalSettlementChainEffects({connection,plan:{planId:PLAN,ownerAddress:OWNER},positionAddress:POSITION,settlementInput:input({includeClaim:false})});
  assert.equal(missing.ok,false);assert.ok(missing.reasonCodes.includes('SETTLEMENT_CHAIN_TERMINAL_CLAIM_MISSING:close:claim'));assert.ok(missing.reasonCodes.includes('SETTLEMENT_CHAIN_CASHFLOW_TOTAL_MISMATCH'));
});
test('HVEbGM terminal cashflow regression is -1,925,242 lamports, not the stale -2,726,908',()=>{
  const result=assessLifecycleSettlement({lifecycle:{lifecycleId:'hve',positionAddress:'HVE',ownerAddress:OWNER,poolAddress:'pool',status:'CLOSED'},positionAbsent:true,positionCheckedAt:'2026-08-31T18:07:00.000Z',reconciliationClean:true,reservationClean:true,inventoryLots:[],transactions:[],cashflows:[
    {cashflowId:'entry',flowType:'OPEN_CONTRIBUTION',lamports:30_000_000n},
    {cashflowId:'prior-claims',flowType:'FEE_CLAIM',lamports:122_976n},
    {cashflowId:'terminal-claim',flowType:'FEE_CLAIM',lamports:801_666n},
    {cashflowId:'primary-unwind',flowType:'SWAP_PROCEEDS',lamports:26_820_629n},
    {cashflowId:'residual-unwind',flowType:'SWAP_PROCEEDS',lamports:374_489n},
    {cashflowId:'costs',flowType:'TX_COST',lamports:45_002n},
  ]});
  assert.equal(result.ready,true);assert.equal(result.realizedSolPnlLamports,-1_925_242n);
  const omitted=assessLifecycleSettlement({...{lifecycle:{lifecycleId:'hve',positionAddress:'HVE',ownerAddress:OWNER,poolAddress:'pool',status:'CLOSED'},positionAbsent:true,positionCheckedAt:'2026-08-31T18:07:00.000Z',reconciliationClean:true,reservationClean:true,inventoryLots:[],transactions:[]},cashflows:[
    {cashflowId:'entry',flowType:'OPEN_CONTRIBUTION',lamports:30_000_000n},{cashflowId:'prior-claims',flowType:'FEE_CLAIM',lamports:122_976n},{cashflowId:'primary-unwind',flowType:'SWAP_PROCEEDS',lamports:26_820_629n},{cashflowId:'residual-unwind',flowType:'SWAP_PROCEEDS',lamports:374_489n},{cashflowId:'costs',flowType:'TX_COST',lamports:45_002n},
  ]});
  assert.equal(omitted.realizedSolPnlLamports,-2_726_908n);
});
test('terminal implementation is receipt-bound and final settlement requires chain reconciliation',()=>{
  const worker=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8');
  assert.match(worker,/CONFIRMED_TERMINAL_CLAIM_RECEIPT/);
  assert.match(worker,/SETTLEMENT_CHAIN_TERMINAL_CLAIM_MISSING/);
  assert.match(worker,/SETTLEMENT_CASHFLOW_RECONCILIATION_REQUIRED/);
  assert.match(worker,/upsertLifecycleSettlementChainReconciliation/);
});
