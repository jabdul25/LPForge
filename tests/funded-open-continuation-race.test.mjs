import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {phase7ExecutionControlFromRow,validateFreshFundedOpenContinuation} from '../.build/packages/phase6-claim-guard/src/index.js';
import {deriveFundedOpenContinuationControlFacts,phase7RecoveryBlocksNewEntries} from '../.build/packages/phase7-production-service/src/index.js';
import {loadFreshExecutionSafetyFacts,checkFreshOpenSubmissionSafety,classifyFundedOpenPositionReconciliation} from '../.build/packages/phase6-live-worker/src/index.js';

const fundedAt='2026-09-13T05:22:10.000Z';
const now='2026-09-13T05:22:25.000Z';
const identity={planId:'plan-funded',ownerAddress:'owner',poolAddress:'pool',tokenMint:'mint',fundingSignature:'funding-signature',capitalLamports:30_000_000n,lowerBinId:-667,upperBinId:-595,fundedAt,expiresAt:'2026-09-13T05:23:10.000Z',generatedPositionAddress:'position'};
const continuation={...identity,capitalLamports:identity.capitalLamports.toString(),allowed:true,reasonCodes:[]};
const control=(overrides={})=>({decision_id:'control',cycle_key:'cycle',authority_mode:'PRODUCTION',health_status:'HEALTHY',drift_status:'STABLE',safety_mode:'NORMAL',new_economic_action_allowed:false,observed_at:now,payload:{releaseIdentity:{valid:true},portfolio:{valid:true},fundedOpenContinuations:[continuation]},...overrides});
const plan={planId:'plan-funded',intentId:'intent',idempotencyKey:'idem',action:'OPEN',poolAddress:'pool',ownerAddress:'owner',thesisId:'thesis',observedAt:fundedAt,expiresAt:'2026-09-13T05:30:00.000Z',planPayload:{provenance:{phase7Control:{decisionId:'control'}},intent:{capitalLamports:'30000000',candidateId:'candidate'}},intentPayload:{},steps:[]};
const config={rpcUrl:'http://unused',programId:'program',maxOpenPositions:2,controlledCanary:undefined};
const portfolio={deployedLamports:0n,pendingReservedLamports:30_000_000n,pendingExecutionCount:1,openPositions:0,unresolvedReconciliationDebt:1,poolExposureLamports:{},poolPendingLamports:{pool:30_000_000n},tokenExposureLamports:{mint:30_000_000n},tokenPendingLamports:{mint:30_000_000n}};
const store=row=>({loadLatestPhase7ControlDecision:async()=>row,loadPhase7ControlDecision:async()=>row,loadPhase7PortfolioFacts:async()=>portfolio});

test('funded continuation bypasses only the global new-entry flag for its exact identity',()=>{
 const parsed=phase7ExecutionControlFromRow(control());
 assert.deepEqual(validateFreshFundedOpenContinuation({current:parsed,identity,now}),[]);
 assert.ok(validateFreshFundedOpenContinuation({current:parsed,identity:{...identity,planId:'plan-other'},now}).includes('P6_CLAIM_P7_FUNDED_CONTINUATION_NOT_AUTHORIZED'));
 assert.ok(validateFreshFundedOpenContinuation({current:parsed,identity:{...identity,tokenMint:'other-mint'},now}).includes('P6_CLAIM_P7_FUNDED_CONTINUATION_NOT_AUTHORIZED'));
 assert.ok(validateFreshFundedOpenContinuation({current:parsed,identity:{...identity,expiresAt:now},now}).includes('P6_CLAIM_P7_FUNDED_CONTINUATION_EXPIRED'));
});

test('P6 keeps current hard gates while allowing the identity-bound funded child through the generic portfolio block',async()=>{
 const connection={getLatestBlockhash:async()=>({blockhash:'x',lastValidBlockHeight:1})};
 const safe=await loadFreshExecutionSafetyFacts({store:store(control()),plan,config,connection,now,protocolCompatibility:async()=>true,fundedOpenContinuation:identity});
 assert.equal(safe.globalKillSwitch,false);assert.equal(safe.walletTruthConsistent,true);assert.equal(safe.reconciliationRequired,false);
 const submit=await checkFreshOpenSubmissionSafety({store:store(control()),plan,config,permitExpiresAt:'2026-09-13T05:22:40.000Z',now,fundedOpenContinuation:identity});
 assert.equal(submit.approved,true);
 const critical=control({health_status:'CRITICAL'});
 const blocked=await checkFreshOpenSubmissionSafety({store:store(critical),plan,config,permitExpiresAt:'2026-09-13T05:22:40.000Z',now,fundedOpenContinuation:identity});
 assert.equal(blocked.approved,false);assert.ok(blocked.reasonCodes.includes('P6_CLAIM_P7_HEALTH_NOT_HEALTHY'));
});

test('P7 emits a continuation only for confirmed, unexpired, non-conflicting same-plan funding',()=>{
 const row={plan_id:'plan-funded',owner_address:'owner',pool_address:'pool',token_mint:'mint',funding_signature:'funding-signature',intended_capital_lamports:'30000000',funded_at:fundedAt,intended_range:{lowerBinId:-667,upperBinId:-595},payload:{fundedOpenContinuation:{generatedPositionAddress:'position'}},plan_state:'RECOVERING',funding_confirmed:true,position_open:false};
 const allowed=deriveFundedOpenContinuationControlFacts({rows:[row],now,deadlineSeconds:60,baseControlAllowsContinuation:true,recoveryQueueCount:0,unknownSubmissionCount:0,unresolvedReconciliationDebt:0,partialEntryRecoveryCount:0});
 assert.equal(allowed.length,1);assert.equal(allowed[0].allowed,true);assert.equal(allowed[0].expiresAt,'2026-09-13T05:23:10.000Z');
 const debt=deriveFundedOpenContinuationControlFacts({rows:[row],now,deadlineSeconds:60,baseControlAllowsContinuation:true,recoveryQueueCount:1,unknownSubmissionCount:0,unresolvedReconciliationDebt:0,partialEntryRecoveryCount:0});
 assert.equal(debt[0].allowed,false);assert.ok(debt[0].reasonCodes.includes('P7_FUNDED_OPEN_UNRELATED_RECOVERY_PENDING'));
 const expired=deriveFundedOpenContinuationControlFacts({rows:[row],now:'2026-09-13T05:23:10.000Z',deadlineSeconds:60,baseControlAllowsContinuation:true,recoveryQueueCount:0,unknownSubmissionCount:0,unresolvedReconciliationDebt:0,partialEntryRecoveryCount:0});
 assert.equal(expired[0].allowed,false);assert.ok(expired[0].reasonCodes.includes('P7_FUNDED_OPEN_CONTINUATION_EXPIRED'));
});

test('a funded continuation blocks unrelated new entries without becoming generic recovery debt',()=>{
 const clean={recoveryQueueCount:0,unknownSubmissionCount:0,unresolvedReconciliationDebt:0,partialEntryRecoveryCount:0,fundedOpenContinuations:[]};
 assert.equal(phase7RecoveryBlocksNewEntries(clean),false);
 assert.equal(phase7RecoveryBlocksNewEntries({...clean,fundedOpenContinuations:[{}]}),true);
});

test('an absent generated position proceeds to bounded unwind while an RPC or identity failure holds fail-closed',()=>{
 assert.deepEqual(classifyFundedOpenPositionReconciliation({accountReadSucceeded:true,accountPresent:false,expectedOwner:'owner',expectedPool:'pool'}),{kind:'ABSENT'});
 assert.deepEqual(classifyFundedOpenPositionReconciliation({accountReadSucceeded:false,accountPresent:false,expectedOwner:'owner',expectedPool:'pool'}),{kind:'HOLD',reasonCode:'P6_FUNDED_OPEN_POSITION_RECONCILIATION_UNAVAILABLE'});
 assert.deepEqual(classifyFundedOpenPositionReconciliation({accountReadSucceeded:true,accountPresent:true,positionReadSucceeded:true,position:{owner:'other',pool:'pool'},expectedOwner:'owner',expectedPool:'pool'}),{kind:'HOLD',reasonCode:'P6_FUNDED_OPEN_POSITION_IDENTITY_CONFLICT'});
 assert.deepEqual(classifyFundedOpenPositionReconciliation({accountReadSucceeded:true,accountPresent:true,positionReadSucceeded:true,position:{owner:'owner',pool:'pool'},expectedOwner:'owner',expectedPool:'pool'}),{kind:'EXISTS'});
});

test('terminal and P6 retain the bounded, no-repeat continuation design',()=>{
  const worker=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8'),terminal=fs.readFileSync('apps/terminal/src/main.ts','utf8'),db=fs.readFileSync('packages/db/src/index.ts','utf8');
 assert.match(worker,/P6_FUNDED_OPEN_CONTINUATION_EXPIRED/);assert.match(worker,/FUNDED_OPEN_CONTINUATION_UNSAFE/);assert.match(worker,/fundingSignature/);
 assert.match(terminal,/r\.state='ENTRY_FUNDED_NOT_OPEN'/);assert.match(db,/fundedOpenContinuations/);
  assert.doesNotMatch(worker,/executeRequiredJupiterSwap[\s\S]{0,500}FUNDED_OPEN_CONTINUATION/);
});

test('receipt-confirmed funded unwind terminalizes its parent and cannot remain actionable recovery debt',()=>{
 const worker=fs.readFileSync('packages/phase6-live-worker/src/index.ts','utf8'),db=fs.readFileSync('packages/db/src/index.ts','utf8'),terminal=fs.readFileSync('apps/terminal/src/main.ts','utf8');
 assert.match(worker,/terminalizeAbortedFundedOpenPlan/);
 assert.match(worker,/recovery:'FUNDED_OPEN_UNWIND_CONFIRMED'/);
 for(const source of [db,terminal])assert.match(source,/r\.state='ABORTED_SOL_SETTLED'/);
 assert.match(db,/p\.state NOT IN \('RECONCILED','COMPLETED','EXPIRED','FAILED','BLOCKED'\)/);
});
