import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {validateFreshPhase7ExecutionControl} from '../.build/packages/phase6-claim-guard/src/index.js';

const production='packages/phase7-production-service/src/index.ts';
const claimGuard='packages/phase6-claim-guard/src/index.ts';

test('health, drift and the control decision persist before the canonical global Production cycle',()=>{
  const src=fs.readFileSync(production,'utf8');
  // Success-path ids end in a backtick+comma; the :failure-suffixed variants
  // in the catch block must not satisfy these anchors.
  const healthAt=src.indexOf('insertPhase7HealthAssessment({assessmentId:`${input.runtimeId}:${input.cycleKey}:health`,');
  const driftAt=src.indexOf('insertPhase7DriftAssessment({assessmentId:`${input.runtimeId}:${input.cycleKey}:drift`,');
  const controlAt=src.indexOf('insertPhase7ControlDecision({decisionId:`${input.runtimeId}:${input.cycleKey}:control`,');
  const probeAt=src.indexOf('let operator:Phase7OperatorProbe;');
  const runAt=src.indexOf('runProductionGlobalSelectionCycle({store:input.store');
  assert.ok(healthAt>=0&&driftAt>healthAt&&controlAt>driftAt,'health → drift → control assessment order');
  assert.ok(probeAt>controlAt,'the operator probe starts only after the control decision is durable');
  assert.ok(runAt>probeAt,'the global cycle lives inside the post-control block');
  assert.ok(probeAt<src.indexOf('runPhase7RecoveryRuntimeTick({store:input.store,runtimeId:input.runtimeId,instanceId:input.instanceId,cycleKey:input.cycleKey,now:new Date().toISOString(),leaseTtlMs:ttl,restarted:input.restarted,control:{authorityMode:control.authorityMode,healthStatus:control.healthStatus'),'the runtime tick follows the global cycle');
});

test('drift reads lagged decoder telemetry from the prior evidence snapshot, falling back to the prior drift payload',()=>{
  const src=fs.readFileSync(production,'utf8');
  const evidenceAt=src.indexOf('priorEvidenceRow=await input.store.loadLatestPhase7EvidenceSnapshot(input.runtimeId)');
  const skipAt=src.indexOf('const decoderSkipRate=');
  assert.ok(evidenceAt>=0&&skipAt>evidenceAt,'the previous cycle evidence snapshot is read before drift computes its decoder skip rate');
  assert.ok(src.includes('priorEvidencePayload.operatorEventDecodeWarnings??priorDriftPayload.operatorEventDecodeWarnings'),'telemetry falls back to the prior drift payload for pre-release rows');
  assert.match(src,/const decoderSkipRate=Number\.isFinite\(telemetryWarnings\)&&Number\.isFinite\(telemetrySwaps\)\?telemetryWarnings\/Math\.max\(1,telemetryWarnings\+telemetrySwaps\):undefined;/,'skip rate is undefined, not assumed, when telemetry has never been observed');
});

test('drift retains management/health visibility while the Production selector evaluates its bounded dynamic fair set',()=>{
  const src=fs.readFileSync(production,'utf8');
  assert.match(src,/const newEntryAdmissionSnapshots=await getProductionNewEntryAdmissionSnapshots\(input\.store,input\.env,input\.cycleKey\),newEntryPoolAddresses=newEntryAdmissionSnapshots\.map\(snapshot=>snapshot\.poolAddress\),managementPoolAddresses=productionManagementPoolAddresses\(input\.env,\[\.\.\.openPools\]\),driftPoolAddresses=\[\.\.\.new Set\(\[input\.cfg\.smokePoolAddress,\.\.\.managementPoolAddresses,\.\.\.newEntryPoolAddresses\]\)\];/,'dynamic new-entry eligibility is isolated from owned/static management visibility and frozen before selection');
  assert.ok(src.includes('runProductionGlobalSelectionCycle'),'the immutable universe is passed to the canonical global selector');
  assert.ok(src.includes('fairProductionPoolOrder'),'the selector has deterministic fair rotation rather than a static first pool');
  assert.ok(src.includes('significant:poolAddress===input.cfg.smokePoolAddress||capitalPools.has(poolAddress)||openPools.has(poolAddress)'),'smoke pool, deployed capital and open positions are the significance criteria');
  assert.ok(src.includes("rank(p.status)>rank('WATCH')?'WATCH':p.status"),'idle pools are capped at WATCH');
  assert.ok(src.includes('`P7_LIVE_DRIFT_POOL_${p.status}`'),'non-stable pools surface a per-pool reason code');
  assert.ok(src.includes('poolDrift:cappedDrift.map('),'the persisted drift payload carries the per-pool fold');
  assert.ok(src.includes('rawStatus:p.rawStatus'),'the uncapped per-pool status survives for the executor target-pool check');
  assert.ok(src.includes('probedPoolAddresses:driftPoolAddresses'),'the probed pool set is persisted with the drift payload');
  assert.ok(src.includes('if(!smokeLive)throw new Error(\'LPFORGE_P7_DRIFT_SMOKE_POOL_MISSING\');'),'the smoke pool assessment is mandatory');
});

test('the control payload carries the previous cycle operator observability, one cycle lagged',()=>{
  const src=fs.readFileSync(production,'utf8');
  assert.ok(src.includes('operator:priorControlPayload.operator??null'),'control payload keeps operator data from the prior control decision');
  assert.ok(src.includes('priorControlRow=await input.store.loadLatestPhase7ControlDecision(input.runtimeId)'),'the prior control is read at persist time');
});

test('the evidence snapshot stores the probe telemetry for the next cycle and failure rows carry the last-known values',()=>{
  const src=fs.readFileSync(production,'utf8');
  assert.ok(src.includes('operatorEventDecodeWarnings:operator.eventDecodeWarnings,operatorDecodedSwapEvents:operator.decodedSwapEvents,operatorOutputBytes:operator.outputBytes,probedPoolAddresses:operator.poolAddresses'),'success snapshots persist decoder telemetry and the probed pools');
  assert.ok(src.includes('operatorEventDecodeWarnings:Number.isFinite(telemetryWarnings)?telemetryWarnings:null'),'failure snapshots carry the last-known telemetry forward');
});

test('probe failure persists suffixed assessment ids so the DO NOTHING inserts still become the latest rows',()=>{
  const src=fs.readFileSync(production,'utf8');
  assert.ok(src.includes('`${input.runtimeId}:${input.cycleKey}:health:failure`'),'failure health id is suffixed');
  assert.ok(src.includes('`${input.runtimeId}:${input.cycleKey}:drift:failure`'),'failure drift id is suffixed');
  assert.ok(src.includes('`${input.runtimeId}:${input.cycleKey}:control:failure`'),'failure control id is suffixed');
});

test('the claim guard binds a plan to the P7 control that existed before its operator decision',()=>{
  const src=fs.readFileSync(claimGuard,'utf8');
  assert.ok(!src.includes('P6_CLAIM_P7_CONTROL_PREDATES_PLAN'),'timestamp ordering is not used as a false binding rule');
  assert.ok(src.includes('P6_CLAIM_P7_CONTROL_BINDING_MISSING'),'missing plan/control binding fails closed');
  assert.ok(src.includes('P6_CLAIM_P7_POOL_DRIFT_BLOCK'),'target-pool raw BLOCK is independently enforced');
  const control={authorityMode:'PRODUCTION',healthStatus:'HEALTHY',driftStatus:'STABLE',safetyMode:'NORMAL',newEconomicActionAllowed:true,observedAt:'2026-08-13T00:04:30.000Z'};
  const now=control.observedAt;
  assert.deepEqual(validateFreshPhase7ExecutionControl(control,now,60_000),[],'freshness evaluates the current P7 control only; identity binding is checked against plan provenance');
});
