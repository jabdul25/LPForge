import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {computePlanProvenanceHmac,verifyPlanProvenanceHmac} from '../.build/packages/execution-contracts/src/index.js';
import {validateClaimedPlan} from '../.build/packages/phase6-claim-guard/src/index.js';

const contracts='packages/execution-contracts/src/index.ts';
const operator='apps/operator/src/main.ts';
const claimGuard='packages/phase6-claim-guard/src/index.ts';
const execution='apps/execution/src/main.ts';

const secret='lpforge-test-provenance-secret';
const phase7Control={decisionId:'control-1',cycleKey:'cycle-1',observedAt:'2026-08-13T00:04:30.000Z'};
const fields={producer:'LPFORGE_PRODUCTION',schemaVersion:1,intentId:'i',poolAddress:'POOL',observedAt:'2026-08-13T00:04:45.000Z',action:'OPEN',ownerAddress:'OWNER',positionAddress:null,expiresAt:'2026-08-13T00:09:45.000Z',immutablePlan:{intentPayload:{},planIntent:{capitalLamports:'20000000',activeBinId:100,binStep:80},steps:[]},phase7Control};

test('provenance HMACs round-trip over a canonical sorted serialization and reject any tampering',()=>{
  const hmac=computePlanProvenanceHmac(fields,secret);
  assert.match(hmac,/^[0-9a-f]{64}$/,'the stamp is a 64-char hex digest');
  assert.equal(verifyPlanProvenanceHmac(fields,secret,hmac),true);
  assert.equal(verifyPlanProvenanceHmac({...fields,intentId:'forged'},secret,hmac),false,'a changed intentId breaks the stamp');
  assert.equal(verifyPlanProvenanceHmac({...fields,action:'CLOSE'},secret,hmac),false,'a changed action breaks the stamp');
  assert.equal(verifyPlanProvenanceHmac({...fields,ownerAddress:'OTHER'},secret,hmac),false,'a changed owner breaks the stamp');
  assert.equal(verifyPlanProvenanceHmac({...fields,positionAddress:'POS'},secret,hmac),false,'a changed position breaks the stamp');
  assert.equal(verifyPlanProvenanceHmac({...fields,phase7Control:{...phase7Control,decisionId:'forged-control'}},secret,hmac),false,'a changed P7 binding breaks the stamp');
  assert.equal(verifyPlanProvenanceHmac({...fields,expiresAt:'2026-08-13T00:06:00.000Z'},secret,hmac),false,'a changed expiry breaks the stamp');
  assert.equal(verifyPlanProvenanceHmac(fields,'wrong-secret',hmac),false,'a different secret breaks the stamp');
  assert.equal(verifyPlanProvenanceHmac(fields,secret,'deadbeef'),false,'non-hex input fails closed');
  const canaryAuthorization={schemaVersion:1,approvalId:'approval-a',action:'PROMOTE_PRODUCTION',operatorId:'operator',issuedAt:'2026-08-13T00:04:30.000Z',expiresAt:'2026-08-13T00:05:20.000Z',boundControlDecisionId:'control-1',planId:'p',wallet:'OWNER',pool:'POOL',candidateId:'candidate-a',thesisId:'t',intentId:'i',capitalLamports:'20000000',maxConcurrentPositions:1};
  const canaryHmac=computePlanProvenanceHmac({...fields,controlledCanaryAuthorization:canaryAuthorization},secret);
  assert.equal(verifyPlanProvenanceHmac({...fields,controlledCanaryAuthorization:canaryAuthorization},secret,canaryHmac),true,'the one-plan approval envelope is authenticated');
  assert.equal(verifyPlanProvenanceHmac({...fields,controlledCanaryAuthorization:{...canaryAuthorization,planId:'second-plan'}},secret,canaryHmac),false,'the envelope cannot be retargeted to another plan');
  const src=fs.readFileSync(contracts,'utf8');
  assert.match(src,/sort\(\(\[a\],\[b\]\)=>a\.localeCompare\(b\)\)/,'keys serialize in sorted order so the canonical form is stable');
});

test('provenance HMAC survives the JSONB round trip used by protective management plans',()=>{
 const beforePersistence={...fields,immutablePlan:{intentPayload:{required:'value',optional:undefined,nested:{keep:1,omit:undefined},array:['keep',undefined]},planIntent:{capitalLamports:'30000000'},steps:[]}};
 const hmac=computePlanProvenanceHmac(beforePersistence,secret);
 const afterPersistence=JSON.parse(JSON.stringify(beforePersistence));
 assert.equal(verifyPlanProvenanceHmac(afterPersistence,secret,hmac),true,'undefined JSON fields must not invalidate a plan after PostgreSQL JSONB persistence');
});

test('provenance HMAC uses the persisted null candidate identity for protective plans',()=>{
 const source={...fields,action:'EMERGENCY_CLOSE',positionAddress:'POSITION',immutablePlan:{intentPayload:{requestedManagementAction:'EMERGENCY_CLOSE'},planIntent:{capitalLamports:'30000000',candidateId:null},steps:[]}};
 const hmac=computePlanProvenanceHmac(source,secret);
 const afterPersistence=JSON.parse(JSON.stringify(source));
 assert.equal(verifyPlanProvenanceHmac(afterPersistence,secret,hmac),true,'a no-candidate protective plan must remain authenticated after PostgreSQL JSONB persistence');
});

test('the operator stamps the complete immutable plan when the provenance secret is configured',()=>{
  const src=fs.readFileSync(operator,'utf8');
  assert.ok(src.includes("const provenanceSecret=(process.env.LPFORGE_PLAN_PROVENANCE_SECRET??'').trim();"),'the operator reads the shared secret from the environment');
  assert.ok(src.includes('hmac: computePlanProvenanceHmac('),'the provenance carries the stamp');
  assert.ok(src.includes('...(provenanceSecret'),'the stamp is conditional on the secret being set');
  assert.ok(src.includes('action: plan.intent.action'),'the stamp covers the plan action');
  assert.ok(src.includes('positionAddress: plan.intent.positionAddress ?? null'),'the stamp covers the optional position address');
  assert.ok(src.includes('candidateId:plan.intent.candidateId??null'),'the HMAC uses the persisted null candidate representation for protective plans');
  assert.ok(src.includes('expiresAt: plan.expiresAt'),'the stamp covers plan expiry');
  assert.ok(src.includes('immutablePlan'),'the stamp covers immutable plan economics and transaction instructions');
  assert.ok(src.includes('controlledCanaryAuthorization'),'the stamp includes the single-plan canary envelope when present');
});

test('the claim guard verifies the stamp fail-closed once the secret is configured and stays backward compatible without it',()=>{
  const src=fs.readFileSync(claimGuard,'utf8');
  assert.ok(src.includes('P6_CLAIM_PROVENANCE_HMAC_MISSING')&&src.includes('P6_CLAIM_PROVENANCE_HMAC_INVALID'),'missing and invalid stamps get distinct reason codes');
  assert.ok(src.includes('input.provenanceSecret'),'verification only runs when the secret is provided');
  assert.ok(src.includes('positionAddress: p.positionAddress ?? null'),'the guard recomputes over the row it is about to authorize');
  const policy={schemaVersion:1,policyId:'p',status:'ENABLED',approvalTtlMs:15000,minDevnetConfirmedRuns:1,maxActionsPerDay:2,maxOpenPositions:2,pools:[{address:'POOL',maxCapitalLamports:20_000_000n,maxOpenPositions:1}]};
  const control={decisionId:'control-1',cycleKey:'cycle-1',authorityMode:'PRODUCTION',healthStatus:'HEALTHY',driftStatus:'WATCH',safetyMode:'NORMAL',newEconomicActionAllowed:true,observedAt:'2026-08-13T00:04:30.000Z'};
  const plan={planId:'p',intentId:'i',idempotencyKey:'k',action:'OPEN',poolAddress:'POOL',ownerAddress:'OWNER',thesisId:'t',observedAt:fields.observedAt,expiresAt:fields.expiresAt,intentPayload:{},planPayload:{provenance:{producer:'LPFORGE_PRODUCTION',schemaVersion:1,intentId:'i',poolAddress:'POOL',observedAt:fields.observedAt,phase7Control:{decisionId:'control-1',cycleKey:'cycle-1',observedAt:control.observedAt}},intent:{capitalLamports:'20000000',activeBinId:100,binStep:80}},steps:[]};
  const now='2026-08-13T00:05:00.000Z';
  assert.equal(validateClaimedPlan({plan,policy,ownedPositions:[],phase7Control:control,now}).approved,true,'without the secret the guard keeps prior behavior');
  const stamped={...plan,planPayload:{...plan.planPayload,provenance:{...plan.planPayload.provenance,hmac:computePlanProvenanceHmac(fields,secret)}}};
  assert.equal(validateClaimedPlan({plan:stamped,policy,ownedPositions:[],phase7Control:control,provenanceSecret:secret,now}).approved,true,'a valid stamp passes');
  assert.ok(validateClaimedPlan({plan,policy,ownedPositions:[],phase7Control:control,provenanceSecret:secret,now}).reasonCodes.includes('P6_CLAIM_PROVENANCE_HMAC_MISSING'),'a missing stamp fails closed');
  const forged={...stamped,planPayload:{...stamped.planPayload,intent:{capitalLamports:'19999999'}}};
  assert.ok(validateClaimedPlan({plan:forged,policy,ownedPositions:[],phase7Control:control,provenanceSecret:secret,now}).reasonCodes.includes('P6_CLAIM_PROVENANCE_HMAC_INVALID'),'a stamp over different fields fails closed');
  const forgedMarket={...stamped,planPayload:{...stamped.planPayload,intent:{...stamped.planPayload.intent,activeBinId:101}}};
  assert.ok(validateClaimedPlan({plan:forgedMarket,policy,ownedPositions:[],phase7Control:control,provenanceSecret:secret,now}).reasonCodes.includes('P6_CLAIM_PROVENANCE_HMAC_INVALID'),'the planned market state is authenticated too');
  const forgedControl={...stamped,planPayload:{...stamped.planPayload,provenance:{...stamped.planPayload.provenance,phase7Control:{...phase7Control,decisionId:'forged-control'}}}};
  assert.ok(validateClaimedPlan({plan:forgedControl,policy,ownedPositions:[],phase7Control:control,provenanceSecret:secret,now}).reasonCodes.includes('P6_CLAIM_PROVENANCE_HMAC_INVALID'),'P7-control provenance is authenticated too');
});

test('the executor forwards the configured provenance secret into the claim guard',()=>{
  const src=fs.readFileSync(execution,'utf8');
  assert.ok(src.includes("const provenanceSecret=(process.env.LPFORGE_PLAN_PROVENANCE_SECRET??'').trim();"),'the executor reads the shared secret');
  assert.ok(src.includes('...(provenanceSecret?{provenanceSecret}:{})'),'the secret reaches the claim guard input');
  assert.ok(src.includes('loadPhase7ControlDecision(runtimeId,boundControlDecisionId)'),'the executor resolves the immutable control by its persisted identity rather than assuming latest wins');
  assert.ok(src.includes('boundPhase7Control'),'the bound record is delivered separately from the latest hard-revocation control');
});
