import assert from 'node:assert/strict';
import test from 'node:test';
import {loadPhase7TelegramConfig,operatorReasonSummary,phase7AlertFingerprint,phase7AlertTopic,renderPhase7TelegramAlert,Phase7TelegramDeliveryError} from '../.build/packages/phase7-alerting/src/index.js';

test('terminal close transition awaits the durable Telegram outbox but contains delivery failures', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('apps/operator/src/main.ts', 'utf8'));
  assert.match(source, /async function queueLifecycleAlert/);
  assert.match(source, /await enqueueAndDispatchPhase7Alert/);
  assert.match(source, /await queueLifecycleAlert\(\{\.\.\.alertBase,severity:decision\.action==='EMERGENCY_CLOSE'/);
  assert.match(source, /lpforge_telegram_alert_failed/);
});

const base={severity:'WARNING',code:'POSITION_OOR_STARTED',title:'Position out of range',message:'Canonical range lifecycle changed.',observedAt:'2026-09-06T00:00:00.000Z',entityType:'POSITION',transitionKey:'IN_RANGE->OUT_OF_RANGE',reasonCodes:['POSITION_OOR_STARTED']};
test('same lifecycle code for two positions has distinct durable identities',()=>{
  assert.notEqual(phase7AlertFingerprint({...base,entityId:'position-a'}),phase7AlertFingerprint({...base,entityId:'position-b'}));
  assert.equal(phase7AlertFingerprint({...base,entityId:'position-a'}),phase7AlertFingerprint({...base,entityId:'position-a'}));
});
test('topic routing honors dedicated thread configuration with fallback',()=>{
  const cfg=loadPhase7TelegramConfig({LPFORGE_TELEGRAM_ALERTS_ENABLED:'true',LPFORGE_TELEGRAM_BOT_TOKEN:'x',LPFORGE_TELEGRAM_CHAT_ID:'1',LPFORGE_TELEGRAM_THREAD_ID:'11',LPFORGE_TELEGRAM_TRADES_THREAD_ID:'12',LPFORGE_TELEGRAM_RISK_THREAD_ID:'13'});
  assert.equal(cfg.threadId,11);assert.equal(cfg.tradesThreadId,12);assert.equal(cfg.riskThreadId,13);
  assert.equal(phase7AlertTopic({...base,entityId:'p'}),'TRADES');
  assert.equal(phase7AlertTopic({...base,code:'EXECUTION_RECONCILIATION_REQUIRED',entityId:'plan'}),'RISK');
});
test('settlement wording distinguishes fully realized from cash-only facts supplied by canonical detail',()=>{
  const complete=renderPhase7TelegramAlert({...base,severity:'INFO',code:'POSITION_SETTLED',title:'Position settled',entityId:'p',details:{Settlement:'FULLY_REALIZED / SOL_SETTLED','Realized economic PnL SOL':'+0.001'}});
  const partial=renderPhase7TelegramAlert({...base,severity:'INFO',code:'POSITION_SETTLED',title:'Position settled',entityId:'p',details:{Settlement:'MARKED_WITH_RESIDUALS','Native SOL cashflow':'-0.001','Residual attributable inventory':'+0.002'}});
  assert.match(complete,/FULLY_REALIZED/);assert.match(partial,/MARKED_WITH_RESIDUALS/);assert.doesNotMatch(partial,/Realized economic PnL/);
});
test('delivery error carries bounded retry semantics including Telegram retry_after',()=>{const e=new Phase7TelegramDeliveryError(true,120000,'LPFORGE_TELEGRAM_HTTP_429');assert.equal(e.retryable,true);assert.equal(e.retryAfterMs,120000);});
test('Telegram render is bounded to Telegram message length',()=>{assert.ok(renderPhase7TelegramAlert({...base,entityId:'p',message:'x'.repeat(10000)}).length<=4096);});
test('Telegram renders plain-language operator reasons instead of raw internal codes',()=>{
  const rendered=renderPhase7TelegramAlert({...base,entityId:'p',reasonCodes:['EXEC_GLOBAL_KILL_SWITCH','P6_CLAIM_P7_CONTROL_STALE','P6_WALLET_SWEEP_INTERVAL_NOT_DUE']});
  assert.match(rendered,/Why: Safety status was briefly out of date\./);
  assert.doesNotMatch(rendered,/EXEC_GLOBAL_KILL_SWITCH|P6_CLAIM_P7_CONTROL_STALE|P6_WALLET_SWEEP_INTERVAL_NOT_DUE/);
  assert.match(rendered,/Reference: POSITION_OOR_STARTED/);
  assert.deepEqual(operatorReasonSummary(['LPFORGE_P6_SWAP_RISK_BLOCKED:EXEC_GLOBAL_KILL_SWITCH,P6_CLAIM_P7_CONTROL_STALE']),['Safety status was briefly out of date.']);
});
