import assert from 'node:assert/strict';
import test from 'node:test';
import {validateClaimedPlan,validateFreshPhase7ExecutionControl} from '../.build/packages/phase6-claim-guard/src/index.js';
import {assertControlledCanaryOpen} from '../.build/packages/phase6-live-worker/src/index.js';

const policy={schemaVersion:1,policyId:'p',status:'ENABLED',approvalTtlMs:15000,minDevnetConfirmedRuns:1,maxActionsPerDay:2,maxOpenPositions:2,pools:[{address:'POOL',maxCapitalLamports:20_000_000n,maxOpenPositions:1}],productionAdmission:{enabled:true,eligibleTiers:['A'],maxCandidates:1,maxCandidateAgeMs:900000,maxCapitalLamports:20_000_000n,maxOpenPositions:1}};
const controlObservedAt='2026-08-13T00:04:30.000Z';
const base={planId:'p',intentId:'i',idempotencyKey:'k',action:'OPEN',poolAddress:'POOL',ownerAddress:'OWNER',thesisId:'t',observedAt:'2026-08-13T00:04:45.000Z',expiresAt:'2026-08-13T00:09:45.000Z',intentPayload:{},planPayload:{provenance:{producer:'LPFORGE_PRODUCTION',schemaVersion:1,intentId:'i',poolAddress:'POOL',observedAt:'2026-08-13T00:04:45.000Z',phase7Control:{decisionId:'control-1',cycleKey:'cycle-1',observedAt:controlObservedAt}},intent:{capitalLamports:'20000000'}},steps:[]};
const now='2026-08-13T00:05:00.000Z',control={decisionId:'control-1',cycleKey:'cycle-1',authorityMode:'PRODUCTION',healthStatus:'HEALTHY',driftStatus:'WATCH',safetyMode:'NORMAL',newEconomicActionAllowed:true,observedAt:controlObservedAt};
const admittedStatic=[{poolAddress:'POOL',state:'ACTIVE_CANDIDATE',tier:'A',lastSeenAt:'2026-08-13T00:04:00.000Z',tokenYMint:'So11111111111111111111111111111111111111112',pairedTokenMint:'TOKEN'}];
test('claim guard rejects forged provenance, non-admitted pools, excess capital and position limits',()=>{const input={policy,ownedPositions:[],productionCandidates:admittedStatic,phase7Control:control,now};assert.equal(validateClaimedPlan({plan:base,...input}).approved,true);assert.ok(validateClaimedPlan({plan:{...base,planPayload:{}},...input}).reasonCodes.includes('P6_CLAIM_PROVENANCE_INVALID'));assert.ok(validateClaimedPlan({plan:{...base,poolAddress:'OTHER'},...input}).reasonCodes.includes('P6_CLAIM_PRODUCTION_ADMISSION_INVALID'));assert.ok(validateClaimedPlan({plan:base,policy,ownedPositions:[],productionCandidates:[],phase7Control:control,now}).reasonCodes.includes('P6_CLAIM_PRODUCTION_ADMISSION_INVALID'),'static membership alone cannot admit a new entry');assert.ok(validateClaimedPlan({plan:{...base,planPayload:{...base.planPayload,intent:{capitalLamports:'20000001'}}},...input}).reasonCodes.includes('P6_CLAIM_CAPITAL_EXCEEDS_POOL_POLICY'));assert.ok(validateClaimedPlan({plan:base,policy,ownedPositions:[{lifecycle_state:'OPEN',pool_address:'POOL'}],productionCandidates:admittedStatic,phase7Control:control,now}).reasonCodes.includes('P6_CLAIM_POSITION_LIMIT'));});
test('controlled canary admits exactly one 30,000,000-lamport OPEN and blocks a second or replacement exposure',()=>{
 const canaryPolicy={...policy,maxOpenPositions:1,pools:[{address:'POOL',maxCapitalLamports:30_000_000n,maxOpenPositions:1}],controlledCanary:{maxConcurrentPositions:1,exactLiquidityCapitalLamports:30_000_000n,replacementOpenAllowed:false}};
 const plan={...base,planPayload:{...base.planPayload,intent:{capitalLamports:'30000000'}}};
 const common={policy:canaryPolicy,ownedPositions:[],phase7Control:control,now,controlledCanary:true};
 assert.equal(validateClaimedPlan({...common,plan,pendingExecutionCount:1}).approved,true,'the single exact-capital canary OPEN is admitted');
 for(const amount of ['29999999','30000001'])assert.ok(validateClaimedPlan({...common,plan:{...plan,planPayload:{...plan.planPayload,intent:{capitalLamports:amount}}},pendingExecutionCount:1}).reasonCodes.includes('P6_CONTROLLED_CANARY_EXACT_CAPITAL_REQUIRED'));
 assert.ok(validateClaimedPlan({...common,plan,pendingExecutionCount:2}).reasonCodes.includes('P6_CONTROLLED_CANARY_UNRESOLVED_OPEN_EXISTS'),'a planned/signed/submitted second OPEN is blocked');
 assert.ok(validateClaimedPlan({...common,plan,pendingExecutionCount:1,ownedPositions:[{lifecycle_state:'RECONCILIATION_REQUIRED'}]}).reasonCodes.includes('P6_CONTROLLED_CANARY_POSITION_ALREADY_EXISTS'),'an unresolved confirmed position blocks a second OPEN');
 for(const action of ['ADD','RESHAPE','REBALANCE'])assert.ok(validateClaimedPlan({...common,plan:{...plan,action},pendingExecutionCount:1}).reasonCodes.includes('P6_CONTROLLED_CANARY_REPLACEMENT_OPEN_BLOCKED'),`${action} cannot create replacement exposure`);
});
test('controlled-canary transaction boundary rejects a rebuilt route with any capital other than exactly 30,000,000 lamports',()=>{
 const config={controlledCanary:{maxConcurrentPositions:1,exactLiquidityCapitalLamports:30_000_000n,replacementOpenAllowed:false}};
 assert.doesNotThrow(()=>assertControlledCanaryOpen(config,30_000_000n));
 for(const amount of [29_999_999n,30_000_001n])assert.throws(()=>assertControlledCanaryOpen(config,amount),/CONTROLLED_CANARY_EXACT_CAPITAL_REQUIRED/);
});
test('controlled-canary campaign preserves attempt 1 and permits only an audited zero-exposure replacement',async()=>{
 const db=await import('node:fs/promises').then(fs=>fs.readFile('packages/db/src/index.ts','utf8'));
 const execution=await import('node:fs/promises').then(fs=>fs.readFile('apps/execution/src/main.ts','utf8'));
 assert.match(db,/reserveControlledCanaryCampaignOpen/);
 assert.match(db,/pg_advisory_xact_lock/,'the campaign ID remains a cross-process database boundary');
 assert.match(db,/canary_pre_sign_replacements/,'one replacement requires a separate audited record');
 assert.match(db,/PRE_SIGN_ZERO_EXPOSURE_REPLACEMENT/,'replacement is explicitly classified as pre-sign zero exposure');
 assert.match(db,/any_submission===false/,'any durable submission prevents a replacement');
 assert.match(db,/any_confirmation===false/,'any confirmation prevents a replacement');
 assert.match(db,/any_position===false/,'any owned position prevents a replacement');
 assert.match(db,/maximumEconomicOpens:1/,'plan attempts never raise the one economic-OPEN ceiling');
 assert.match(execution,/LPFORGE_P6_CONTROLLED_CANARY_CAMPAIGN_ID_REQUIRED/);
 assert.match(execution,/P6_CONTROLLED_CANARY_CAMPAIGN_OPEN_CONSUMED/,'a second campaign OPEN is terminally blocked before execution');
});
test('bounded unattended production retains the live Phase-6 gate while removing only the retired campaign reservation',async()=>{
 const [execution,operator]=await Promise.all(['apps/execution/src/main.ts','apps/operator/src/main.ts'].map(async path=>(await import('node:fs/promises')).readFile(path,'utf8')));
 assert.match(execution,/LPFORGE_BOUNDED_UNATTENDED_PRODUCTION/);
 assert.match(execution,/if\(boundedUnattendedProduction\(\)\)return undefined/,'bounded mode has no campaign identifier or one-open campaign allowance');
 assert.match(execution,/yes\(process\.env\.LPFORGE_MAINNET_CANARY\)&&!boundedUnattendedProduction\(\)/,'the legacy mainnet-live gate remains required while canary-only claim constraints are disabled');
 assert.match(operator,/const boundedUnattended=process\.env\.LPFORGE_BOUNDED_UNATTENDED_PRODUCTION==='true'/);
 assert.match(operator,/const controlledCanaryPlan=!boundedUnattended/,'plans in bounded mode are bound to the ordinary fresh P7 control, not one campaign authorization');
});
test('terminal recovery binds its timestamp consistently when expiring an unsent journal',async()=>{
 const db=await import('node:fs/promises').then(fs=>fs.readFile('packages/db/src/index.ts','utf8'));
 assert.match(db,/terminalizedAt',\$3::timestamptz/);
 assert.match(db,/terminalPlanState',\$4::text/);
});
test('claim guard requires LPForge ownership and exact chain position truth for every management action',()=>{const plan={...base,action:'CLOSE',positionAddress:'POS',planPayload:{...base.planPayload,intent:{capitalLamports:'0'}}};assert.ok(validateClaimedPlan({plan,policy,ownedPositions:[]}).reasonCodes.includes('P6_CLAIM_POSITION_NOT_OWNED'));assert.equal(validateClaimedPlan({plan,policy,ownedPositions:[{lifecycle_state:'OPEN',position_address:'POS',owner_address:'OWNER',pool_address:'POOL'}],positionTruth:{owner:'OWNER',pool:'POOL'}}).approved,true);});
test('claim guard admits only fresh WSOL-token-Y Tier-A pools under the versioned execution policy',()=>{const admitted={...policy,productionAdmission:{enabled:true,eligibleTiers:['A'],maxCandidates:1,maxCandidateAgeMs:900000,maxCapitalLamports:20_000_000n,maxOpenPositions:1}},plan={...base,poolAddress:'DISCOVERED',planPayload:{...base.planPayload,provenance:{...base.planPayload.provenance,poolAddress:'DISCOVERED'}}},fresh=[{poolAddress:'DISCOVERED',state:'ACTIVE_CANDIDATE',tier:'A',lastSeenAt:'2026-08-13T00:04:00.000Z',tokenYMint:'So11111111111111111111111111111111111111112',pairedTokenMint:'TOKEN'}];assert.equal(validateClaimedPlan({plan,policy:admitted,ownedPositions:[],productionCandidates:fresh,phase7Control:control,now}).approved,true);assert.ok(validateClaimedPlan({plan,policy:admitted,ownedPositions:[],productionCandidates:[{...fresh[0],tokenYMint:'TOKEN'}],phase7Control:control,now}).reasonCodes.includes('P6_PRODUCTION_REQUIRES_WSOL_TOKEN_Y'));assert.ok(validateClaimedPlan({plan,policy:admitted,ownedPositions:[],productionCandidates:[{...fresh[0],state:'PREFILTERED'}],phase7Control:control,now}).reasonCodes.includes('P6_CLAIM_PRODUCTION_ADMISSION_INVALID'));assert.ok(validateClaimedPlan({plan,policy:admitted,ownedPositions:[],productionCandidates:[{...fresh[0],lastSeenAt:'2026-08-12T23:40:00.000Z'}],phase7Control:control,now}).reasonCodes.includes('P6_CLAIM_PRODUCTION_ADMISSION_INVALID'));assert.ok(validateClaimedPlan({plan,policy:{...policy,productionAdmission:undefined},ownedPositions:[],productionCandidates:fresh,phase7Control:control,now}).reasonCodes.includes('P6_CLAIM_PRODUCTION_ADMISSION_INVALID'));});
test('a fresh qualified global winner may bridge lease transition only through its exact verified selection binding',()=>{
 const plan={...base,poolAddress:'DISCOVERED',planPayload:{...base.planPayload,provenance:{...base.planPayload.provenance,poolAddress:'DISCOVERED',globalSelection:{globalCycleId:'global-1',selectedCandidateId:'candidate-1'}},intent:{capitalLamports:'20000000',candidateId:'candidate-1'}}};
 const qualified=[{poolAddress:'DISCOVERED',state:'PREFILTERED',tier:'A',lastSeenAt:'2026-08-13T00:04:00.000Z',tokenYMint:'So11111111111111111111111111111111111111112',pairedTokenMint:'TOKEN'}];
 const common={plan,policy,ownedPositions:[],productionCandidates:qualified,phase7Control:control,now};
 assert.ok(validateClaimedPlan(common).reasonCodes.includes('P6_CLAIM_PRODUCTION_ADMISSION_INVALID'),'lease transition alone never admits an OPEN');
 assert.equal(validateClaimedPlan({...common,globalWinnerAdmission:{globalCycleId:'global-1',poolAddress:'DISCOVERED',candidateId:'candidate-1',verified:true}}).approved,true,'the exact canonical global winner remains eligible across ACTIVE-to-PREFILTERED transition');
 for(const admission of [{globalCycleId:'other',poolAddress:'DISCOVERED',candidateId:'candidate-1',verified:true},{globalCycleId:'global-1',poolAddress:'DISCOVERED',candidateId:'other',verified:true},{globalCycleId:'global-1',poolAddress:'DISCOVERED',candidateId:'candidate-1',verified:false}])assert.ok(validateClaimedPlan({...common,globalWinnerAdmission:admission}).reasonCodes.includes('P6_CLAIM_PRODUCTION_ADMISSION_INVALID'),'forged or unverified global selection cannot bridge admission');
 assert.ok(validateClaimedPlan({...common,productionCandidates:[{...qualified[0],state:'REJECTED'}],globalWinnerAdmission:{globalCycleId:'global-1',poolAddress:'DISCOVERED',candidateId:'candidate-1',verified:true}}).reasonCodes.includes('P6_CLAIM_PRODUCTION_ADMISSION_INVALID'),'terminally ineligible pools remain blocked');
});
test('risk-increasing claims require fresh Phase-7 production control and enforce daily action limit',()=>{assert.deepEqual(validateFreshPhase7ExecutionControl(control,now),[]);assert.ok(validateClaimedPlan({plan:base,policy,ownedPositions:[],productionCandidates:admittedStatic,now}).reasonCodes.includes('P6_CLAIM_P7_CONTROL_MISSING'));assert.ok(validateClaimedPlan({plan:{...base,planPayload:{...base.planPayload,provenance:{...base.planPayload.provenance,phase7Control:undefined}}},policy,ownedPositions:[],productionCandidates:admittedStatic,phase7Control:control,now}).reasonCodes.includes('P6_CLAIM_P7_CONTROL_BINDING_MISSING'));assert.ok(validateFreshPhase7ExecutionControl({...control,safetyMode:'EMERGENCY_ONLY'},now).includes('P6_CLAIM_P7_SAFETY_NOT_NORMAL'));assert.ok(validateFreshPhase7ExecutionControl({...control,observedAt:'2026-08-12T23:00:00.000Z'},now).includes('P6_CLAIM_P7_CONTROL_STALE'));assert.ok(validateClaimedPlan({plan:base,policy,ownedPositions:[],productionCandidates:admittedStatic,phase7Control:{...control,newEconomicActionAllowed:false},actionsToday:2,now}).reasonCodes.includes('P6_CLAIM_P7_NEW_ACTION_BLOCKED'));assert.ok(validateClaimedPlan({plan:base,policy,ownedPositions:[],productionCandidates:admittedStatic,phase7Control:control,actionsToday:2,now}).reasonCodes.includes('P6_CLAIM_DAILY_ACTION_LIMIT'));});
test('risk-increasing claims bind to the exact authenticated P7 decision across newer controls and recovery',()=>{
 const input={plan:base,policy,ownedPositions:[],productionCandidates:admittedStatic,now};
 assert.equal(validateClaimedPlan({...input,phase7Control:control}).approved,true,'the exact fresh decision passes the binding check');
 const newer={...control,decisionId:'control-2',cycleKey:'cycle-2',observedAt:'2026-08-13T00:04:50.000Z'};
 const older={...control,decisionId:'control-0',cycleKey:'cycle-0',observedAt:'2026-08-13T00:04:20.000Z'};
 for(const phase7Control of [newer,older])assert.ok(validateClaimedPlan({...input,phase7Control}).reasonCodes.includes('P6_CLAIM_P7_CONTROL_BINDING_MISMATCH'),'a different P7 decision never substitutes for the bound decision');
 assert.ok(validateClaimedPlan({...input,phase7Control:{...control,decisionId:undefined}}).reasonCodes.includes('P6_CLAIM_P7_CONTROL_ID_MISSING'),'a control without an id fails closed');
 assert.ok(validateClaimedPlan({...input,phase7Control:{...control,observedAt:'2026-08-13T00:00:00.000Z'}}).reasonCodes.includes('P6_CLAIM_P7_CONTROL_STALE'),'identity does not bypass freshness');
 assert.ok(validateClaimedPlan({...input,phase7Control:{...control,safetyMode:'EMERGENCY_ONLY'}}).reasonCodes.includes('P6_CLAIM_P7_SAFETY_NOT_NORMAL'),'identity does not bypass safety');
 assert.ok(validateClaimedPlan({...input,phase7Control:{...control,authorityMode:'OBSERVE_ONLY'}}).reasonCodes.includes('P6_CLAIM_P7_AUTHORITY_NOT_PRODUCTION'),'identity does not bypass authority');
 assert.ok(validateClaimedPlan({...input,phase7Control:{...control,newEconomicActionAllowed:false}}).reasonCodes.includes('P6_CLAIM_P7_NEW_ACTION_BLOCKED'),'identity does not bypass new-action policy');
 // validateClaimedPlan is stateless: this models a persisted A-bound plan
 // claimed after an execution-process restart under a newer control B.
 assert.ok(validateClaimedPlan({...input,phase7Control:newer}).reasonCodes.includes('P6_CLAIM_P7_CONTROL_BINDING_MISMATCH'),'restart/recovery cannot rebind the persisted plan');
});
test('P7_CONTROLLED_CANARY_CONTROL_CONTINUITY keeps exactly one bound OPEN claimable across harmless snapshots',()=>{
 const canaryPolicy={...policy,maxOpenPositions:1,pools:[{address:'POOL',maxCapitalLamports:30_000_000n,maxOpenPositions:1}],controlledCanary:{maxConcurrentPositions:1,exactLiquidityCapitalLamports:30_000_000n,replacementOpenAllowed:false}};
 const bound={...control,decisionId:'control-a',cycleKey:'cycle-a',observedAt:'2026-08-13T00:04:30.000Z'};
 const current={...bound,decisionId:'control-b',cycleKey:'cycle-b',authorityMode:'OBSERVE_ONLY',newEconomicActionAllowed:false,observedAt:'2026-08-13T00:04:50.000Z',activeIncidentIds:[],releaseIntegrityValid:true,portfolioValid:true,revokedApprovalIds:[]};
 const plan={...base,planId:'canary-plan-a',planPayload:{...base.planPayload,provenance:{...base.planPayload.provenance,phase7Control:{decisionId:'control-a',cycleKey:'cycle-a',observedAt:bound.observedAt},controlledCanaryAuthorization:{schemaVersion:1,approvalId:'approval-a',action:'PROMOTE_PRODUCTION',operatorId:'operator',issuedAt:'2026-08-13T00:04:30.000Z',expiresAt:'2026-08-13T00:05:20.000Z',boundControlDecisionId:'control-a',planId:'canary-plan-a',wallet:'OWNER',pool:'POOL',candidateId:'candidate-a',thesisId:'t',intentId:'i',capitalLamports:'30000000',maxConcurrentPositions:1}},intent:{capitalLamports:'30000000',candidateId:'candidate-a'}},steps:[]};
 const input={plan,policy:canaryPolicy,ownedPositions:[],phase7Control:current,boundPhase7Control:bound,pendingExecutionCount:1,unresolvedReconciliationDebt:0,controlledCanary:true,now};
 assert.equal(validateClaimedPlan(input).approved,true,'new OBSERVE_ONLY telemetry cannot erase a valid, still-bounded plan A');
 const harmlessLater={...current,decisionId:'control-c',cycleKey:'cycle-c',observedAt:'2026-08-13T00:04:55.000Z'};
 assert.equal(validateClaimedPlan({...input,phase7Control:harmlessLater}).approved,true,'multiple harmless snapshots retain only the bound plan');
 const second={...plan,planId:'canary-plan-b'};
 assert.ok(validateClaimedPlan({...input,plan:second}).reasonCodes.includes('P6_CANARY_AUTHORIZATION_SCOPE_MISMATCH'),'the authorization cannot claim a second plan');
 for(const changed of [
  {...plan,poolAddress:'OTHER'},
  {...plan,ownerAddress:'OTHER'},
  {...plan,planPayload:{...plan.planPayload,intent:{capitalLamports:'30000001',candidateId:'candidate-a'}}},
  {...plan,planPayload:{...plan.planPayload,intent:{capitalLamports:'30000000',candidateId:'candidate-b'}}},
 ])assert.ok(validateClaimedPlan({...input,plan:changed}).reasonCodes.includes('P6_CANARY_AUTHORIZATION_SCOPE_MISMATCH'),'wallet, pool, candidate, and capital are immutable canary scope');
 assert.ok(validateClaimedPlan({...input,pendingExecutionCount:2}).reasonCodes.includes('P6_CONTROLLED_CANARY_UNRESOLVED_OPEN_EXISTS'),'a second unresolved OPEN is rejected');
});
test('bound controlled-canary OPEN preserves hard P7 revocation and expiry',()=>{
 const canaryPolicy={...policy,maxOpenPositions:1,pools:[{address:'POOL',maxCapitalLamports:30_000_000n,maxOpenPositions:1}],controlledCanary:{maxConcurrentPositions:1,exactLiquidityCapitalLamports:30_000_000n,replacementOpenAllowed:false}};
 const bound={...control,decisionId:'control-a',cycleKey:'cycle-a',observedAt:'2026-08-13T00:04:30.000Z'};
 const make=(expiresAt='2026-08-13T00:05:20.000Z')=>({...base,planId:'canary-plan-a',planPayload:{...base.planPayload,provenance:{...base.planPayload.provenance,phase7Control:{decisionId:'control-a',cycleKey:'cycle-a',observedAt:bound.observedAt},controlledCanaryAuthorization:{schemaVersion:1,approvalId:'approval-a',action:'PROMOTE_PRODUCTION',operatorId:'operator',issuedAt:'2026-08-13T00:04:30.000Z',expiresAt,boundControlDecisionId:'control-a',planId:'canary-plan-a',wallet:'OWNER',pool:'POOL',candidateId:'candidate-a',thesisId:'t',intentId:'i',capitalLamports:'30000000',maxConcurrentPositions:1}},intent:{capitalLamports:'30000000',candidateId:'candidate-a'}},steps:[]});
 const current={...bound,decisionId:'control-b',authorityMode:'OBSERVE_ONLY',newEconomicActionAllowed:false,observedAt:'2026-08-13T00:04:50.000Z',activeIncidentIds:[],releaseIntegrityValid:true,portfolioValid:true,revokedApprovalIds:[]};
 const common={policy:canaryPolicy,ownedPositions:[],phase7Control:current,boundPhase7Control:bound,pendingExecutionCount:1,unresolvedReconciliationDebt:0,controlledCanary:true,now};
 assert.ok(validateClaimedPlan({...common,plan:make(),phase7Control:{...current,healthStatus:'CRITICAL'}}).reasonCodes.includes('P6_CANARY_CURRENT_HEALTH_NOT_HEALTHY'),'critical health revokes');
 assert.ok(validateClaimedPlan({...common,plan:make(),phase7Control:{...current,driftStatus:'BLOCK'}}).reasonCodes.includes('P6_CANARY_CURRENT_DRIFT_BLOCK'),'drift block revokes');
 assert.ok(validateClaimedPlan({...common,plan:make(),phase7Control:{...current,safetyMode:'EMERGENCY_ONLY'}}).reasonCodes.includes('P6_CANARY_CURRENT_SAFETY_NOT_NORMAL'),'emergency safety mode revokes');
 assert.ok(validateClaimedPlan({...common,plan:make(),phase7Control:{...current,activeIncidentIds:['incident-a']}}).reasonCodes.includes('P6_CANARY_CURRENT_ACTIVE_INCIDENT'),'active incident revokes');
 assert.ok(validateClaimedPlan({...common,plan:make(),phase7Control:{...current,releaseIntegrityValid:false}}).reasonCodes.includes('P6_CANARY_CURRENT_RELEASE_INTEGRITY_UNAVAILABLE'),'release mismatch revokes');
 assert.ok(validateClaimedPlan({...common,plan:make(),phase7Control:{...current,portfolioValid:false}}).reasonCodes.includes('P6_CANARY_CURRENT_PORTFOLIO_UNAVAILABLE'),'portfolio failure revokes');
 assert.ok(validateClaimedPlan({...common,plan:make(),phase7Control:{...current,revokedApprovalIds:['approval-a']}}).reasonCodes.includes('P6_CANARY_APPROVAL_REVOKED'),'explicit approval revocation wins');
 assert.ok(validateClaimedPlan({...common,plan:make('2026-08-13T00:04:59.000Z')}).reasonCodes.includes('P6_CANARY_APPROVAL_EXPIRED'),'approval expiry rejects before signing');
 assert.ok(validateClaimedPlan({...common,plan:{...make(),expiresAt:'2026-08-13T00:04:59.000Z'}}).reasonCodes.includes('P6_CANARY_PLAN_EXPIRED'),'plan expiry rejects before signing');
 assert.ok(validateClaimedPlan({...common,plan:make(),unresolvedReconciliationDebt:1}).reasonCodes.includes('P6_CONTROLLED_CANARY_RECONCILIATION_DEBT'),'reconciliation debt revokes entry');
});
test('de-admitted dynamic pools remain closable only through owned-position protective actions',()=>{
 const dynamicPolicy={...policy,pools:[],productionAdmission:{enabled:true,eligibleTiers:['A'],maxCandidates:1,maxCandidateAgeMs:900000,maxCapitalLamports:20_000_000n,maxOpenPositions:1}};
 const deAdmitted=[];
 const owned=[{lifecycle_state:'OPEN',position_address:'POS',owner_address:'OWNER',pool_address:'DYNAMIC'}];
 const protective=action=>({...base,action,poolAddress:'DYNAMIC',positionAddress:'POS',planPayload:{...base.planPayload,provenance:{...base.planPayload.provenance,poolAddress:'DYNAMIC'},intent:{capitalLamports:'0'}}});
 for(const action of ['CLOSE','EMERGENCY_CLOSE','REDUCE','CLAIM']){
  const result=validateClaimedPlan({plan:protective(action),policy:dynamicPolicy,ownedPositions:owned,positionTruth:{owner:'OWNER',pool:'DYNAMIC'},productionCandidates:deAdmitted,now});
  assert.equal(result.approved,true,`${action} remains available after dynamic de-admission`);
  assert.ok(!result.reasonCodes.some(x=>['P6_CLAIM_POOL_NOT_ALLOWLISTED','P6_CLAIM_PRODUCTION_ADMISSION_INVALID','P6_PRODUCTION_REQUIRES_WSOL_TOKEN_Y'].includes(x)));
 }
 assert.ok(validateClaimedPlan({plan:protective('CLOSE'),policy:dynamicPolicy,ownedPositions:[],positionTruth:{owner:'OWNER',pool:'DYNAMIC'},productionCandidates:deAdmitted,now}).reasonCodes.includes('P6_CLAIM_POSITION_NOT_OWNED'));
 assert.ok(validateClaimedPlan({plan:protective('CLOSE'),policy:dynamicPolicy,ownedPositions:owned,productionCandidates:deAdmitted,now}).reasonCodes.includes('P6_CLAIM_POSITION_TRUTH_MISSING'));
 assert.ok(validateClaimedPlan({plan:protective('CLOSE'),policy:dynamicPolicy,ownedPositions:owned,positionTruth:{owner:'OTHER',pool:'DYNAMIC'},productionCandidates:deAdmitted,now}).reasonCodes.includes('P6_CLAIM_POSITION_TRUTH_MISMATCH'));
 const deAdmittedOpen={...base,poolAddress:'DYNAMIC',planPayload:{...base.planPayload,provenance:{...base.planPayload.provenance,poolAddress:'DYNAMIC'}}};
 for(const action of ['OPEN','ADD','RESHAPE','REBALANCE'])assert.ok(validateClaimedPlan({plan:{...deAdmittedOpen,action},policy:dynamicPolicy,ownedPositions:[],productionCandidates:deAdmitted,phase7Control:control,now}).reasonCodes.includes('P6_CLAIM_PRODUCTION_ADMISSION_INVALID'),`${action} remains admission-blocked`);
});
test('protective actions are exempt from the daily action cap',()=>{const owned=[{lifecycle_state:'OPEN',position_address:'POS',owner_address:'OWNER',pool_address:'POOL'}];for(const action of ['CLOSE','EMERGENCY_CLOSE','REDUCE','CLAIM']){const plan={...base,action,positionAddress:'POS',planPayload:{...base.planPayload,intent:{capitalLamports:'0'}}};assert.equal(validateClaimedPlan({plan,policy,ownedPositions:owned,positionTruth:{owner:'OWNER',pool:'POOL'},actionsToday:2,now}).approved,true,`${action} must never be starved by the daily cap`);}assert.ok(validateClaimedPlan({plan:base,policy,ownedPositions:[],productionCandidates:admittedStatic,phase7Control:control,actionsToday:2,now}).reasonCodes.includes('P6_CLAIM_DAILY_ACTION_LIMIT'));});
test('operator separates risk-increasing P7 authority from protective management dispatch',async()=>{const src=await import('node:fs/promises').then(fs=>fs.readFile('apps/operator/src/main.ts','utf8'));assert.ok(src.includes('allowRiskIncreasingPlans'),'new or increased exposure requires the P7 new-economic-action permit');assert.ok(src.includes('allowProtectiveManagementPlans'),'CLOSE/REDUCE/CLAIM have their independent protective dispatch path');assert.ok(src.includes('capitalLamports: position.initialCapitalLamports'),'management plans carry their remaining economic basis for execution-cost checks');assert.ok(src.includes("LPFORGE_CONTROLLED_CANARY_PLAN==='true'"),'the read-only controlled-canary probe retains exact-capital plan enforcement');});
