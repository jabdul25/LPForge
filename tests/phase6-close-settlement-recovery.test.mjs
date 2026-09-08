import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeTerminalSettlementCashflows,
  canResumePreSubmissionClose,
  isLegacySequentialCloseJournalRecovery,
  mutationRiskPlanExpiry,
  shouldResumeCloseSettlement,
} from '../.build/packages/phase6-live-worker/src/index.js';

test('only an exact unsigned OPEN/MATCH close snapshot may resume multi-remove construction', () => {
  const base = {
    action: 'CLOSE', planState: 'RECONCILIATION_REQUIRED',
    stage: 'CLOSE_INVENTORY_SNAPSHOTTED', hasPendingChild: false,
    journalState: 'PLAN_CREATED', hasJournalSignature: false,
    positionExists: true, positionOwner: 'owner', positionPool: 'pool',
    planOwner: 'owner', planPool: 'pool', hasCanonicalCloseWorkflow: true,
    removeChildrenHaveSignatures: false,
  };
  assert.equal(canResumePreSubmissionClose(base), true);
  for (const incompatible of [
    {hasJournalSignature: true},
    {removeChildrenHaveSignatures: true},
    {positionOwner: 'other'},
    {positionPool: 'other'},
    {stage: 'CLOSE_LIQUIDITY_REMOVED'},
    {planState: 'FAILED'},
    {planState: 'BLOCKED'},
    {action: 'OPEN'},
  ]) assert.equal(canResumePreSubmissionClose({...base, ...incompatible}), false);
  assert.equal(canResumePreSubmissionClose({...base, planState: 'BLOCKED', blockedPreSubmissionResume: true}), true);
  assert.equal(canResumePreSubmissionClose({...base, planState: 'BLOCKED', stage: 'CLAIM_GUARD', blockedPreSubmissionResume: true}), false);
  assert.equal(canResumePreSubmissionClose({...base, planState: 'RECONCILIATION_REQUIRED', stage: 'CLAIM_GUARD', journalState: 'FAILED', blockedPreSubmissionResume: true}), true);
  assert.equal(canResumePreSubmissionClose({...base, planState: 'RECONCILIATION_REQUIRED', stage: 'CLAIM_GUARD', journalState: 'PLAN_CREATED', blockedPreSubmissionResume: true}), false);
});

test('an exact unsnapshotted protective close resumes only when its complete unsigned workflow is durable', () => {
  const base = {
    action: 'CLOSE', planState: 'RECONCILIATION_REQUIRED', stage: undefined,
    hasPendingChild: false, journalState: 'PLAN_CREATED', hasJournalSignature: false,
    positionExists: true, positionOwner: 'owner', positionPool: 'pool',
    planOwner: 'owner', planPool: 'pool', hasCanonicalCloseWorkflow: true,
    removeChildrenHaveSignatures: false,
  };
  assert.equal(canResumePreSubmissionClose(base), true);
  assert.equal(canResumePreSubmissionClose({...base, hasCanonicalCloseWorkflow: false}), false);
  assert.equal(canResumePreSubmissionClose({...base, removeChildrenHaveSignatures: true}), false);
  assert.equal(canResumePreSubmissionClose({...base, hasJournalSignature: true}), false);
  assert.equal(canResumePreSubmissionClose({...base, positionPool: 'other'}), false);
});

test('multi-remove close construction persists all children and fingerprints before any child dispatch', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  assert.match(source, /closeRemoveConstructionFingerprint/);
  assert.match(source, /for\(const child of children\)await input\.store\.ensureExecutionTransactionStep/);
  assert.match(source, /for\(const child of children\)\{/);
  assert.match(source, /loadConfirmedSubmissionByTransactionId\(child\.transactionId\)/);
  assert.match(source, /P6_CLOSE_REMOVE_CHILD_CONSTRUCTION_MISMATCH/);
  assert.match(source, /P6_CLOSE_MULTI_REMOVE_PRE_SUBMISSION_RESUME_READY/);
  assert.match(source, /const recoveryCloseStage=closeStage\?\?/);
  assert.match(source, /value\.stage===undefined&&value\.hasCanonicalCloseWorkflow/);
  assert.match(source, /if\(recoveryCloseStage!==undefined\)resumePayload\.stage/);
  assert.match(db, /async resumePreSubmissionClosePlan/);
});

test('pre-submission protective resume preserves signed expiry and uses only the narrow close lease', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  assert.match(db, /expires_at=\(SELECT i\.expires_at FROM execution\.intents/);
  assert.match(db, /i\.action IN \('CLOSE','EMERGENCY_CLOSE'\).*preSubmissionResume/s);
  assert.match(db, /p\.state='BLOCKED'.*preSubmissionResume/s);
  assert.match(db, /state='FAILED' AND signature IS NULL[\s\S]*terminalPlanState'='BLOCKED'/);
  const recovery = source.slice(source.indexOf('const preSubmissionCloseCandidate'), source.indexOf('// Historical compatibility', source.indexOf('const preSubmissionCloseCandidate')));
  assert.doesNotMatch(recovery, /expiresAt:/);
  assert.match(recovery, /P6_CLOSE_MULTI_REMOVE_PRE_SUBMISSION_RESUME_READY/);
});

for (const stage of [
  'CLOSE_LIQUIDITY_REMOVED',
  'CLOSE_CLAIMS_SETTLED',
  'CLOSE_INVENTORY_MEASURED',
  'CLOSE_INVENTORY_UNWOUND',
]) {
  test(`confirmed ${stage} resumes only the next close-settlement stage`, () => {
    assert.equal(
      shouldResumeCloseSettlement({
        action: 'CLOSE',
        stage,
        positionExists: true,
        confirmationStatus: 'CONFIRMED',
      }),
      true,
    );
  });
}

test('close recovery never resumes an unconfirmed, absent, or unsnapshotted stage', () => {
  for (const value of [
    {action: 'CLOSE', stage: 'CLOSE_INVENTORY_SNAPSHOTTED', positionExists: true, confirmationStatus: 'CONFIRMED'},
    {action: 'CLOSE', stage: 'CLOSE_CLAIMS_SETTLED', positionExists: true, confirmationStatus: 'UNKNOWN'},
    {action: 'CLOSE', stage: 'CLOSE_INVENTORY_UNWOUND', positionExists: false, confirmationStatus: 'FINALIZED'},
    {action: 'OPEN', stage: 'CLOSE_LIQUIDITY_REMOVED', positionExists: true, confirmationStatus: 'CONFIRMED'},
  ]) assert.equal(shouldResumeCloseSettlement(value), false);
});

test('close workflow preserves every durable settlement stage and resumes from it', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  for (const stage of [
    'CLOSE_INVENTORY_SNAPSHOTTED',
    'CLOSE_LIQUIDITY_REMOVED',
    'CLOSE_CLAIMS_SETTLED',
    'CLOSE_INVENTORY_MEASURED',
    'CLOSE_INVENTORY_UNWOUND',
  ]) assert.match(source, new RegExp(stage));
  assert.match(source, /RESUME_CLOSE_SETTLEMENT/);
  assert.match(source, /P6_RECOVERY_CLOSE_STAGE_RESUME_READY/);
  assert.match(db, /COALESCE\(payload->'autonomous_dispatch','\{\}'::jsonb\)\|\|\$4::jsonb/);
});

test('pending close-child recovery queries its durable child signature, not an older parent journal signature', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  assert.match(source,/const pendingSignature = closeSettlementPending\(plan\)\?\.signature;/);
  assert.match(source,/let recoverySignature = pendingSignature \?\? journal\.signature;/);
  assert.match(source,/getSignatureStatus\(recoverySignature/);
});

test('only the exact legacy sequential-close journal failure can be rehydrated', () => {
  const plan = {
    action: 'EMERGENCY_CLOSE',
    state: 'RECONCILIATION_REQUIRED',
    planPayload: {autonomous_dispatch: {
      error: 'LPFORGE_EXECUTION_JOURNAL_INVALID_TRANSITION:CONFIRMED->SIGNING',
      stage: 'CLOSE_POSITION_PENDING',
      closeSettlementIncomplete: true,
      tokenXMint: 'mint',
      attributableTokenX: '944088938',
      tokenXBefore: '3023417042',
    }},
  };
  const journal = {state: 'FAILED'};
  assert.equal(isLegacySequentialCloseJournalRecovery({plan, journal, positionExists: true}), true);
  for (const value of [
    {plan: {...plan, action: 'OPEN'}, journal, positionExists: true},
    {plan, journal: {state: 'CONFIRMED'}, positionExists: true},
    {plan, journal, positionExists: false},
    {plan: {...plan, planPayload: {autonomous_dispatch: {...plan.planPayload.autonomous_dispatch, error: 'OTHER'}}}, journal, positionExists: true},
  ]) assert.equal(isLegacySequentialCloseJournalRecovery(value), false);
});

test('legacy sequential-close recovery verifies the exact durable unwind before rehydrating the journal', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  assert.match(source,/loadConfirmedSubmissionByTransactionId\(unwindStep\.transactionId\)/);
  assert.match(source,/reconcileConfirmedCloseUnwind\(/);
  assert.match(source,/P6_LEGACY_CLOSE_JOURNAL_RECOVERED_FROM_CONFIRMED_UNWIND/);
  assert.match(source,/priorJournalState: journal\.state/);
  assert.match(db,/async loadConfirmedSubmissionByTransactionId/);
  assert.match(db,/a\.transaction_id=\$1/);
});

test('terminal OPEN_RECOVERED attribution remains off the recurring queue and is read only by exact entry-plan id', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  assert.match(source,/loadPartialEntryRecovery\(entryPlanId\)/);
  assert.match(source,/recoveryRow\.state\)!=="OPEN_RECOVERED"/);
  assert.match(source,/\(recoveryRow\.payload \?\? \{\}\) as Record<string,unknown>\)\.partialEntry!==true/);
  assert.match(db,/async loadPartialEntryRecovery\(planId\)/);
  assert.match(db,/WHERE plan_id=\$1/);
});

test('a normal reconciled funded OPEN cannot be misclassified as a recovered partial entry at close time', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  const normalOpen = source.slice(
    source.indexOf('await persistOpenResidualInventory'),
    source.indexOf('await input.store.completeAutonomousPlan', source.indexOf('await persistOpenResidualInventory')),
  );
  assert.doesNotMatch(normalOpen,/upsertPartialEntryRecovery/);
  assert.match(source,/partialEntry!==true/);
});

test('a transient recovery RPC failure at execution startup does not terminate the autonomous runner', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('apps/execution/src/main.ts', 'utf8'));
  const startup = source.slice(source.indexOf('const startupAt=new Date().toISOString();'), source.indexOf('for (;;) {', source.indexOf('const startupAt=new Date().toISOString();')));
  assert.match(startup,/P6_EXECUTION_DAEMON_START_FAILURE/);
  assert.match(startup,/will retry\. No blind resend is permitted/);
  assert.doesNotMatch(startup,/P6_EXECUTION_START_FAILURE'\]\}\);throw error/);
});

test('an unsigned deterministic preflight rejection is terminal no-chain-effect evidence, not an active UNKNOWN', async () => {
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  const runtime = await import('node:fs/promises').then(fs => fs.readFile('apps/execution/src/main.ts', 'utf8'));
  assert.match(db,/recoverNoEffectPreflightSubmissionAttempts/);
  assert.match(db,/state='EXPIRED'/);
  assert.match(db,/state='UNKNOWN' AND signature IS NULL/);
  assert.match(db,/submission_error' LIKE 'Simulation failed\.%%?'/);
  assert.match(runtime,/preflightNoEffectRecovered=await store\.recoverNoEffectPreflightSubmissionAttempts/);
});

test('expired entry deadlines never strand an existing protective close, but still bind OPEN', () => {
  const input = {planExpiresAt: '2026-08-29T00:00:00.000Z', now: '2026-08-29T01:00:00.000Z', protectivePermitTtlMs: 5_000};
  assert.equal(
    mutationRiskPlanExpiry({...input, action: 'EMERGENCY_CLOSE', positionAddress: 'position'}),
    '2026-08-29T01:00:05.000Z',
  );
  assert.equal(
    mutationRiskPlanExpiry({...input, action: 'CLOSE'}),
    input.planExpiresAt,
  );
  assert.equal(
    mutationRiskPlanExpiry({...input, action: 'OPEN', positionAddress: 'position'}),
    input.planExpiresAt,
  );
});

test('a temporary risk block after a confirmed close child remains reconciliation debt', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  assert.match(source,/P6_PROTECTIVE_CLOSE_CHILD_RISK_RETRY/);
  assert.match(source,/state: "RECONCILIATION_REQUIRED"/);
  assert.match(source,/closeSettlementStage\(input\.plan\) !== undefined/);
});

test('completion terminalization binds its shared timestamp parameter consistently', async () => {
  const db = await import('node:fs/promises').then(fs => fs.readFile('packages/db/src/index.ts', 'utf8'));
  assert.match(
    db,
    /updated_at=\$3::timestamptz,payload=payload\|\|jsonb_build_object\('terminalPlanState',\$4::text,'terminalizedAt',\$3::text\)/,
  );
});

test('recovered final account close materializes the same SOL settlement as the direct close path', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  assert.match(source,/async function finalizeClosedPositionSettlement/);
  assert.match(source,/const settlement=await finalizeClosedPositionSettlement\(\{\.\.\.input,connection\}\)/);
  assert.match(source,/const settlement=await finalizeClosedPositionSettlement\(\{store:input\.store,plan,positionAddress:recoveryPositionAddress/);
  assert.match(source,/persistLifecycleSolSettlement/);
  assert.match(source,/createLiveSolSettledLearningOutcome/);
});

test('expired account-close child rehydrates the normal close sequence when confirmed remove and claim still need a receipt-bound entry residual unwind', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  assert.match(source,/P6_CLOSE_REHYDRATED_FOR_RECEIPT_BOUND_OPEN_RESIDUAL_UNWIND/);
  assert.match(source,/claimSkipped\|\|claimConfirmed/);
  assert.match(source,/!unwindConfirmed/);
  assert.match(source,/stage:'CLOSE_CLAIMS_SETTLED'/);
});

test('confirmed residual unwind followed by an expired account-close identity creates only a fresh account-close successor', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  assert.match(source,/P6_CLOSE_ACCOUNT_RETRY_SUCCESSOR_CREATED/);
  assert.match(source,/terminalDispatch\.error==='LPFORGE_DUPLICATE_SUBMISSION_ATTEMPT'/);
  assert.match(source,/loadConfirmedSubmissionByTransactionId\(unwindStep\.transactionId\)/);
  assert.match(source,/createAccountCloseOnlySuccessor/);
});

test('terminal successor accounting deduplicates only exact repeated receipt cashflows', () => {
  const duplicate={flowType:'CLOSE_WITHDRAWAL',lamports:29866726n,payload:{signature:'remove'}},
    canonicalize=canonicalizeTerminalSettlementCashflows([duplicate,{...duplicate}, {flowType:'FEE_CLAIM',lamports:1033408n,tokenMint:'So11111111111111111111111111111111111111112',payload:{signature:'claim'}},{flowType:'FEE_CLAIM',lamports:1033408n,tokenMint:'So11111111111111111111111111111111111111112',payload:{signature:'claim'}},{flowType:'FEE_CLAIM',lamports:5n,payload:{signature:'other-claim'}}]);
  assert.equal(canonicalize.length,3);
});

test('account-close successor replays only terminal accounting after a restart, never another mutation', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('packages/phase6-live-worker/src/index.ts', 'utf8'));
  assert.match(source,/ACCOUNT_CLOSE_ONLY_SETTLEMENT_RECONCILED/);
  assert.match(source,/SOL_SETTLEMENT_CHAIN_RECONCILIATION_BLOCKED/);
  assert.match(source,/SOL_SETTLEMENT_BLOCKED/);
  assert.match(source,/finalizeClosedPositionSettlement/);
});
