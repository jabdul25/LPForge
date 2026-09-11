// LPFORGE_PHASE7_OPERATIONAL_ALERTING_MODULE
// Telegram is observational only. Delivery errors never alter trading state.
import { createHash } from 'node:crypto';

export type Phase7AlertSeverity='INFO'|'WARNING'|'CRITICAL';
export type Phase7AlertEntityType='POSITION'|'PLAN'|'POOL'|'RUNTIME';
export type Phase7AlertTopic='TRADES'|'RISK'|'SYSTEM';
export interface Phase7TelegramConfig {enabled:boolean;botToken?:string;chatId?:string;threadId?:number;tradesThreadId?:number;riskThreadId?:number;systemThreadId?:number;minSeverity:Phase7AlertSeverity;timeoutMs:number;cooldownMs:number;notifyStartup:boolean;returnMilestones:number[];maxRetries:number;retryBaseMs:number;}
export interface PostTradeReportData {
  lifecycleId:string;
  settlementId:string;
  settlementVersion:number;
  correction?:{previousSettlementVersion:number;previousPnlLamports:bigint;previousReturnFraction?:number;reason?:string};
  positionAddress:string;
  poolAddress:string;
  poolDisplay:string;
  entryPlanId?:string;
  closePlanId?:string;
  openedAt:string;
  settledAt:string;
  capitalLamports:bigint;
  realizedPnlLamports:bigint;
  realizedReturnFraction?:number;
  peakMfeFraction?:number;
  lpFeesLamports?:bigint;
  inventoryPnlLamports?:bigint;
  transactionCostsLamports?:bigint;
  protection:{ts5:'CONFIRMED'|'ARMED_NOT_CONFIRMED'|'NOT_TRIGGERED'|'UNAVAILABLE';oorP4:'CONFIRMED'|'NOT_TRIGGERED'|'UNAVAILABLE';triggerPeakFraction?:number;triggerReturnFraction?:number;closeDecisionReturnFraction?:number;exitReasonCodes:string[]};
  execution:{decisionAt?:string;planCreatedAt?:string;submittedAt?:string;confirmedAt?:string};
  running:{settled:number;wins:number;losses:number;breakEven:number;netPnlLamports:bigint;grossProfitLamports:bigint;grossLossLamports:bigint;avgWinnerReturnFraction?:number;avgLoserReturnFraction?:number};
  provenance:{policyVersion?:string;policyHash?:string;releaseSha?:string;accountingVersion?:string};
}
export interface Phase7Alert {severity:Phase7AlertSeverity;code:string;title:string;message:string;observedAt:string;entityType?:Phase7AlertEntityType;entityId?:string;transitionKey?:string;topic?:Phase7AlertTopic;runtimeId?:string;instanceId?:string;cycleKey?:string;poolAddress?:string;positionId?:string;positionAddress?:string;planId?:string;reasonCodes?:string[];details?:Record<string,string|number|boolean|null|undefined>;/** Presentation-only overrides for dense post-trade reports. */icon?:string;preformattedMessage?:boolean;suppressContext?:boolean;suppressFooter?:boolean;postTradeReport?:PostTradeReportData;}
const rank:Record<Phase7AlertSeverity,number>={INFO:0,WARNING:1,CRITICAL:2};
const bool=(v:string|undefined,f=false)=>v==null?f:['1','true','yes','on'].includes(v.trim().toLowerCase());
const integer=(v:string|undefined,f:number,min:number,max:number)=>{const n=Number(v??f);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):f;};
const thread=(v:string|undefined)=>{const n=Number(v?.trim());return Number.isInteger(n)&&n>0?n:undefined;};
const milestones=(v:string|undefined)=>[...new Set((v??'').split(',').map(x=>Number(x.trim())).filter(x=>Number.isFinite(x)&&x>0&&x<1))].sort((a,b)=>a-b);
export function loadPhase7TelegramConfig(env:NodeJS.ProcessEnv=process.env):Phase7TelegramConfig{const raw=(env.LPFORGE_TELEGRAM_MIN_SEVERITY??'WARNING').trim().toUpperCase(),minSeverity:Phase7AlertSeverity=raw==='INFO'||raw==='CRITICAL'?raw:'WARNING',token=(env.LPFORGE_TELEGRAM_BOT_TOKEN??env.TELEGRAM_BOT_TOKEN)?.trim(),chatId=(env.LPFORGE_TELEGRAM_CHAT_ID??env.TELEGRAM_CHAT_ID)?.trim(),base=thread(env.LPFORGE_TELEGRAM_THREAD_ID),trades=thread(env.LPFORGE_TELEGRAM_TRADES_THREAD_ID),risk=thread(env.LPFORGE_TELEGRAM_RISK_THREAD_ID),system=thread(env.LPFORGE_TELEGRAM_SYSTEM_THREAD_ID);return{enabled:bool(env.LPFORGE_TELEGRAM_ALERTS_ENABLED),...(token?{botToken:token}:{}),...(chatId?{chatId}:{}),...(base?{threadId:base}:{}),...(trades?{tradesThreadId:trades}:{}),...(risk?{riskThreadId:risk}:{}),...(system?{systemThreadId:system}:{}),minSeverity,timeoutMs:integer(env.LPFORGE_TELEGRAM_TIMEOUT_MS,5000,1000,30000),cooldownMs:integer(env.LPFORGE_TELEGRAM_COOLDOWN_MS,300000,0,86400000),notifyStartup:bool(env.LPFORGE_TELEGRAM_NOTIFY_STARTUP,true),returnMilestones:milestones(env.LPFORGE_TELEGRAM_RETURN_MILESTONES),maxRetries:integer(env.LPFORGE_TELEGRAM_MAX_RETRIES,8,0,100),retryBaseMs:integer(env.LPFORGE_TELEGRAM_RETRY_BASE_MS,30000,1000,3600000)};}
export function validatePhase7TelegramConfig(c:Phase7TelegramConfig){if(!c.enabled)return;if(!c.botToken)throw new Error('LPFORGE_TELEGRAM_BOT_TOKEN_REQUIRED');if(!c.chatId)throw new Error('LPFORGE_TELEGRAM_CHAT_ID_REQUIRED');}
const clean=(v:unknown)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
const cleanMultiline=(v:unknown)=>String(v??'').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g,' ').split('\n').map(line=>line.replace(/\s+/g,' ').trimEnd()).join('\n').trim();
const short=(v:unknown)=>{const s=clean(v);return s.length>18?`${s.slice(0,8)}…${s.slice(-6)}`:s;};
/** Internal reason codes are durable diagnostics, not operator prose.  Keep
 * their exact values in the alert outbox/logs, but render only an actionable,
 * non-technical explanation to Telegram. */
const operatorReason=(code:string):string|undefined=>{
  const c=clean(code);
  if(!c||c==='EXEC_GLOBAL_KILL_SWITCH'||c==='P6_WALLET_SWEEP_INTERVAL_NOT_DUE')return undefined;
  if(c.startsWith('LPFORGE_P6_SWAP_RISK_BLOCKED:'))return operatorReason(c.slice('LPFORGE_P6_SWAP_RISK_BLOCKED:'.length));
  if(c.includes(','))return c.split(',').map(operatorReason).find(Boolean);
  if(c==='P6_CLAIM_P7_CONTROL_STALE')return 'Safety status was briefly out of date.';
  if(c.startsWith('P6_CLAIM_P7_'))return 'Current production safety checks did not permit a new entry.';
  if(c.includes('P6_SWAP_QUOTE_MIN_OUTPUT_INSUFFICIENT')||c.includes('P6_PROTECTED_FUNDING_INFEASIBLE_WITHIN_EXACT_CAPITAL'))return 'The current swap price could not safely buy enough of the paired token for this position.';
  if(c.includes('P6_SWAP_QUOTE_PRICE_IMPACT_EXCEEDED'))return 'The swap needed to fund this position would move the price too much.';
  if(c.includes('P6_SWAP_QUOTE_INPUT_FEE_EXCEEDED'))return 'The swap fee needed to fund this position was too high.';
  if(c.includes('P6_SWAP_QUOTE_UNAVAILABLE'))return 'A fresh swap price was unavailable, so LPForge skipped this entry safely.';
  if(c==='P6_CONFIRMATION_PENDING')return 'Chain confirmation is taking longer than usual.';
  if(c.includes('DISCOVERY_REGISTRY_NEWER_TERMINAL_DISQUALIFICATION'))return 'Newer market evidence made this pool ineligible for entry.';
  if(c.includes('DISCOVERY_REGISTRY'))return 'This pool was not eligible for a new entry.';
  if(c.includes('PARTIAL_UNWIND_RECONCILED'))return 'The verified entry funding was safely converted back to SOL.';
  if(c.includes('PARTIAL_UNWIND_STATUS_READ_UNKNOWN')||c.includes('PARTIAL_UNWIND_CONFIRMATION_PENDING'))return 'The funding unwind is awaiting final chain confirmation.';
  if(c.includes('PARTIAL_UNWIND_REQUIRED'))return 'Verified entry funding needs safe conversion back to SOL before new entries resume.';
  if(c.includes('PARTIAL_ENTRY_REQUIRES_POSITION_RECOVERY')||c.includes('OPEN_CHUNK_DISPOSITION_PENDING')||c.includes('OPEN_CHUNK_CHAIN_TRUTH_UNRESOLVED')||c.includes('OPEN_CHUNK_NOT_CONFIRMED'))return 'The LP-position open is still being verified against canonical chain truth.';
  if(c.includes('OPEN_CHUNK_PROVEN_NOT_LANDED'))return 'The LP-position open did not land, so LPForge is safely reconciling the verified entry funding.';
  if(c.includes('ACCOUNT_CLOSE_ONLY_INVENTORY_REMAINS'))return 'The position account is closed, but remaining position inventory still needs settlement.';
  if(c.includes('TERMINALIZATION_DEBT'))return 'Final settlement is still being verified before the position can be fully closed.';
  if(c.includes('RECOVERY_OPEN_POSITION_ADOPTED'))return 'An already-open position was confirmed and linked safely.';
  if(c.includes('CLOSE_PENDING_STAGE_RECONCILIATION_REQUIRED')||c.includes('CLOSE_SETTLEMENT_RECONCILIATION_REQUIRED'))return 'The close is being verified before settlement is finalized.';
  if(c.includes('RECONCILIATION_REQUIRED')||c.includes('UNKNOWN'))return 'LPForge needs to verify the exact chain result before it can continue.';
  if(c.includes('EXECUTION_AUTHORITY_EXPIRED'))return 'The plan expired before it could be safely executed.';
  if(c.includes('PROVENANCE_HMAC_INVALID'))return 'The plan failed an integrity check and was safely rejected.';
  if(c.includes('IDEMPOTENCY_IDENTITY_CONFLICT'))return 'LPForge detected an execution identity conflict and safely stopped this plan.';
  return 'An internal safety check stopped this step.';
};
export function operatorReasonSummary(reasonCodes:string[]|undefined):string[]{return [...new Set((reasonCodes??[]).map(operatorReason).filter((v):v is string=>Boolean(v)))].slice(0,3);}
export function phase7AlertTopic(a:Phase7Alert):Phase7AlertTopic{if(a.topic)return a.topic;if(a.code.startsWith('POSITION_'))return a.code.includes('EMERGENCY')?'RISK':'TRADES';if(a.code.includes('RECONCILIATION')||a.code.includes('UNKNOWN')||a.code.includes('EMERGENCY'))return'RISK';return'SYSTEM';}
export function phase7AlertFingerprint(a:Phase7Alert){return createHash('sha256').update([a.code,a.entityType??'RUNTIME',a.entityId??a.runtimeId??'lpforge',a.transitionKey??(a.reasonCodes??[]).slice().sort().join(',')].join('|')).digest('hex');}
type RpcPressureRow={pressure_until?:unknown;pressure_level?:unknown;last_429_at?:unknown;updated_at?:unknown};
export type RpcAlertLane='DISCOVERY'|'PRODUCTION'|'EXECUTION';
const asIso=(value:unknown)=>{const ms=Date.parse(String(value??''));return Number.isFinite(ms)?new Date(ms).toISOString():undefined;};
const laneLabel:Record<RpcAlertLane,string>={DISCOVERY:'Discovery evidence',PRODUCTION:'Production position monitoring',EXECUTION:'Execution and recovery'};
/**
 * Converts existing coordinator telemetry into operator alerts. It never
 * probes RPC. The durable outbox emits one warning and one recovery per 429.
 */
export function alertsForRpcQuotaPressure(input:{lane:RpcAlertLane;runtimeId:string;providerKey:string;observedAt:string;successfulRead:boolean;state?:RpcPressureRow;recoveryMaxAgeMs?:number;previousWarningTransitionKey?:string}):Phase7Alert[]{
  const last429At=asIso(input.state?.last_429_at),pressureUntil=asIso(input.state?.pressure_until),observedMs=Date.parse(input.observedAt),last429Ms=last429At?Date.parse(last429At):NaN;
  if(!last429At||!Number.isFinite(observedMs)||!Number.isFinite(last429Ms))return[];
  const entityId=`rpc:${input.lane}:${input.providerKey.slice(0,16)}`,transitionKey=`HTTP_429:${last429At}`,label=laneLabel[input.lane],level=Number(input.state?.pressure_level??0);
  const maxAge=Math.max(60_000,input.recoveryMaxAgeMs??15*60_000);
  const pressureActive=Boolean(pressureUntil&&Date.parse(pressureUntil)>observedMs),warningIsNew=input.previousWarningTransitionKey!==transitionKey;
  if((pressureActive||warningIsNew)&&observedMs-last429Ms<=maxAge)return[{severity:'WARNING',code:'LPFORGE_RPC_USAGE_QUOTA_EXCEEDED',title:'RPC usage limit reached',message:`${label} is being temporarily throttled by its RPC provider. LPForge will slow down and retry safely; it will not bypass provider limits.\nAction needed: none unless this persists.`,observedAt:input.observedAt,entityType:'RUNTIME',entityId,transitionKey,topic:'SYSTEM',runtimeId:input.runtimeId,reasonCodes:['RPC_HTTP_429'],details:{Lane:label,'Provider response':'HTTP 429 (rate limit / quota)','Retry handling':'Automatic bounded backoff',...(pressureUntil?{'Retry window until':pressureUntil}:{}),...(Number.isFinite(level)&&level>0?{'Pressure level':level}:{}),}}];
  if(!input.successfulRead||observedMs-last429Ms>maxAge||input.previousWarningTransitionKey!==transitionKey)return[];
  return[{severity:'INFO',code:'LPFORGE_RPC_USAGE_QUOTA_RECOVERED',title:'RPC access recovered',message:`${label} is responding normally again after a temporary rate limit.\nAction needed: none.`,observedAt:input.observedAt,entityType:'RUNTIME',entityId,transitionKey,topic:'SYSTEM',runtimeId:input.runtimeId,reasonCodes:['RPC_HTTP_429_RECOVERED'],details:{Lane:label,'Previous provider response':'HTTP 429 (rate limit / quota)',Status:'Normal reads resumed'}}];
}
/** Per-process, bounded observer; durable outbox deduplication remains the cross-restart authority. */
export class RpcQuotaAlertObserver{
  private lastCheckMs=-Infinity;private lastWarningTransitionKey:string|undefined;
  due(nowMs=Date.now(),minIntervalMs=30_000){if(nowMs-this.lastCheckMs<minIntervalMs)return false;this.lastCheckMs=nowMs;return true;}
  alerts(input:{lane:RpcAlertLane;runtimeId:string;providerKey:string;observedAt:string;successfulRead:boolean;state?:RpcPressureRow}){
    const all=alertsForRpcQuotaPressure({...input,...(this.lastWarningTransitionKey?{previousWarningTransitionKey:this.lastWarningTransitionKey}:{})});
    const warning=all.find(a=>a.code==='LPFORGE_RPC_USAGE_QUOTA_EXCEEDED');
    if(warning)this.lastWarningTransitionKey=warning.transitionKey;
    const recovery=all.find(a=>a.code==='LPFORGE_RPC_USAGE_QUOTA_RECOVERED');
    if(recovery)this.lastWarningTransitionKey=undefined;
    return all;
  }
}
const sol=(lamports:bigint,places=6,signed=false)=>{
  const sign=lamports<0n?'-':signed&&lamports>0n?'+':'',absolute=lamports<0n?-lamports:lamports,whole=absolute/1_000_000_000n,fraction=(absolute%1_000_000_000n).toString().padStart(9,'0').slice(0,Math.max(0,Math.min(9,places)));
  return `${sign}${whole}.${fraction.padEnd(places,'0')}`;
};
/** Persisted execution costs are positive cost magnitudes; Telegram presents
 * them as economic outflows without changing the canonical value. */
const costSol=(lamports:bigint,places=6)=>sol(lamports>0n?-lamports:lamports,places,true);
const percent=(fraction:number|undefined)=>fraction===undefined||!Number.isFinite(fraction)?'n/a':`${fraction>=0?'+':''}${(fraction*100).toFixed(2)}%`;
const pp=(fraction:number|undefined)=>fraction===undefined||!Number.isFinite(fraction)?'n/a':`${(fraction*100).toFixed(2)}pp`;
const shortPosition=(value:string)=>value.length>10?`${value.slice(0,6)}…${value.slice(-4)}`:value;
const utc=(value:string)=>{const date=new Date(value);return Number.isFinite(date.getTime())?`${String(date.getUTCDate()).padStart(2,'0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getUTCMonth()]} ${String(date.getUTCHours()).padStart(2,'0')}:${String(date.getUTCMinutes()).padStart(2,'0')} UTC`:'n/a';};
const duration=(from:string,to:string)=>{const ms=Date.parse(to)-Date.parse(from);if(!Number.isFinite(ms)||ms<0)return'n/a';const seconds=Math.floor(ms/1000),days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);return days>0?`${days}d ${hours}h ${minutes}m`:hours>0?`${hours}h ${minutes}m`:`${minutes}m`;};
const latency=(from:string|undefined,to:string|undefined)=>{const ms=from&&to?Date.parse(to)-Date.parse(from):NaN;return Number.isFinite(ms)&&ms>=0?`${(ms/1000).toFixed(1)}s`:'n/a';};
const result=(pnl:bigint)=>pnl>0n?'WIN':pnl<0n?'LOSS':'BREAK-EVEN';
const reportStatus=(value:PostTradeReportData['protection']['ts5']|PostTradeReportData['protection']['oorP4'])=>value==='ARMED_NOT_CONFIRMED'?'Armed, not confirmed':value==='NOT_TRIGGERED'?'Not triggered':value==='UNAVAILABLE'?'n/a':value;
/**
 * Formats a settlement from the durable, canonical report object.  It never
 * performs accounting or changes authority; the full object is retained in
 * the alert outbox payload for later forensic retrieval.
 */
export function postTradeSettlementAlert(report:PostTradeReportData):Phase7Alert{
  const settledResult=result(report.realizedPnlLamports),icon=settledResult==='WIN'?'✅':settledResult==='LOSS'?'❌':'⚪',returnFraction=report.realizedReturnFraction,
    peakGiveback=report.peakMfeFraction===undefined||returnFraction===undefined?undefined:report.peakMfeFraction-returnFraction,
    r=report.running,denominator=r.wins+r.losses,winRate=denominator>0?r.wins/denominator:undefined,
    profitFactor=r.grossLossLamports<0n?Number(r.grossProfitLamports)/Number(-r.grossLossLamports):undefined,
    exitReason=report.protection.exitReasonCodes[0]??'n/a';
  if(report.correction){
    const previous=report.correction;
    const correctionLines=[
      `Pool: ${report.poolDisplay}`,
      `Position: ${shortPosition(report.positionAddress)}`,
      `Settlement: v${previous.previousSettlementVersion} → v${report.settlementVersion}`,
      '',
      `Previous PnL:   ${sol(previous.previousPnlLamports,6,true)} SOL`,
      `Corrected PnL:  ${sol(report.realizedPnlLamports,6,true)} SOL`,
      `Previous return: ${percent(previous.previousReturnFraction)}`,
      `Corrected return: ${percent(returnFraction)}`,
      '',
      `Reason: ${previous.reason??'Canonical settlement version updated'}`,
      '',
      runningLines(r,winRate,profitFactor),
    ];
    return{severity:'INFO',code:'POSITION_SETTLEMENT_CORRECTED',title:'Post-Trade Report Corrected',message:correctionLines.join('\n'),observedAt:report.settledAt,entityType:'POSITION',entityId:`POST_TRADE_REPORT:${report.lifecycleId}:${report.settlementVersion}`,transitionKey:`CORRECTED_TO_V${report.settlementVersion}`,topic:'TRADES',positionAddress:report.positionAddress,poolAddress:report.poolAddress,...(report.closePlanId?{planId:report.closePlanId}:{}),icon:'♻️',preformattedMessage:true,suppressContext:true,suppressFooter:true,postTradeReport:report};
  }
  const lines=[
    `Pool: ${report.poolDisplay}`,
    `Position: ${shortPosition(report.positionAddress)}`,
    `Result: ${settledResult}`,
    '',
    `Capital:        ${sol(report.capitalLamports,6)} SOL`,
    `Realized PnL:  ${sol(report.realizedPnlLamports,6,true)} SOL`,
    `Return:         ${percent(returnFraction)}`,
    '',
    `Opened:  ${utc(report.openedAt)}`,
    `Closed:  ${utc(report.settledAt)}`,
    `Held:    ${duration(report.openedAt,report.settledAt)}`,
    '',
    'TRADE ECONOMICS',
    `Peak MFE:        ${percent(report.peakMfeFraction)}`,
    `LP Fees:         ${report.lpFeesLamports===undefined?'n/a':`${sol(report.lpFeesLamports,6,true)} SOL`}`,
    `Inventory PnL:   ${report.inventoryPnlLamports===undefined?'n/a':`${sol(report.inventoryPnlLamports,6,true)} SOL`}`,
    `Tx Costs:        ${report.transactionCostsLamports===undefined?'n/a':`${costSol(report.transactionCostsLamports,6)} SOL`}`,
    `Peak Giveback:   ${pp(peakGiveback)}`,
    '',
    'PROTECTION',
    `TS-5:            ${reportStatus(report.protection.ts5)}`,
  ];
  if(report.protection.ts5==='CONFIRMED'){
    lines.push(`Peak at trigger: ${percent(report.protection.triggerPeakFraction)}`,`Trigger return:  ${percent(report.protection.triggerReturnFraction)}`,`Close decision: ${percent(report.protection.closeDecisionReturnFraction)}`,`Settled return: ${percent(returnFraction)}`);
  }
  lines.push('',`OOR-P4:          ${reportStatus(report.protection.oorP4)}`,`Exit reason:     ${exitReason}`,'','EXECUTION',`Decision → Plan:       ${latency(report.execution.decisionAt,report.execution.planCreatedAt)}`,`Plan → Submission:     ${latency(report.execution.planCreatedAt,report.execution.submittedAt)}`,`Submission → Confirm:  ${latency(report.execution.submittedAt,report.execution.confirmedAt)}`,'',runningLines(r,winRate,profitFactor));
  return{severity:'INFO',code:'POSITION_SETTLED_REPORT',title:'Position Settled',message:lines.join('\n'),observedAt:report.settledAt,entityType:'POSITION',entityId:`POST_TRADE_REPORT:${report.lifecycleId}:${report.settlementVersion}`,transitionKey:'SETTLED',topic:'TRADES',positionAddress:report.positionAddress,poolAddress:report.poolAddress,...(report.closePlanId?{planId:report.closePlanId}:{}),icon,preformattedMessage:true,suppressContext:true,suppressFooter:true,postTradeReport:report};
}
function runningLines(r:PostTradeReportData['running'],winRate:number|undefined,profitFactor:number|undefined){return['RUNNING RESULTS',`Settled:       ${r.settled}`,`Wins / Losses: ${r.wins} / ${r.losses}`,...(r.breakEven>0?[`Break-even:    ${r.breakEven}`]:[]),`Win rate:      ${winRate===undefined?'n/a':`${(winRate*100).toFixed(2)}%`}`,`Net PnL:       ${sol(r.netPnlLamports,6,true)} SOL`,`Profit factor: ${profitFactor===undefined?'n/a (no realized losses)':profitFactor.toFixed(2)}`,`Avg winner:    ${percent(r.avgWinnerReturnFraction)}`,`Avg loser:     ${percent(r.avgLoserReturnFraction)}`].join('\n');}
export function renderPhase7TelegramAlert(a:Phase7Alert){const icon=a.icon??(a.severity==='CRITICAL'?'🚨':a.severity==='WARNING'?'⚠️':'ℹ️'),message=a.preformattedMessage?cleanMultiline(a.message):clean(a.message),lines=[`${icon} LPFORGE — ${clean(a.title)}`,'',message];if(!a.suppressContext){const entity=a.positionAddress??a.positionId??a.planId??a.entityId;if(entity)lines.push(`Entity: ${short(entity)}`);if(a.poolAddress)lines.push(`Pool: ${short(a.poolAddress)}`);if(a.planId&&a.planId!==entity)lines.push(`Plan: ${short(a.planId)}`);const details=Object.entries(a.details??{}).filter(([,v])=>v!==undefined&&v!==null&&clean(v));if(details.length){lines.push('');for(const [k,v] of details.slice(0,18))lines.push(`${clean(k)}: ${clean(v)}`);}const reasons=operatorReasonSummary(a.reasonCodes);if(reasons.length)lines.push('',`Why: ${reasons.join(' ')}`);}if(!a.suppressFooter)lines.push('',`Observed: ${clean(a.observedAt)}`,`Reference: ${clean(a.code)}`);return lines.join('\n').slice(0,4096);}
export class Phase7TelegramDeliveryError extends Error{constructor(readonly retryable:boolean,readonly retryAfterMs?:number,message='LPFORGE_TELEGRAM_DELIVERY_FAILED'){super(message);}}
export class Phase7TelegramAlerter{private readonly lastSent=new Map<string,number>();constructor(readonly config=loadPhase7TelegramConfig()){}shouldSend(a:Phase7Alert,now=Date.now()){if(!this.config.enabled||rank[a.severity]<rank[this.config.minSeverity])return false;const p=this.lastSent.get(phase7AlertFingerprint(a));return p===undefined||now-p>=this.config.cooldownMs;}private topicThread(a:Phase7Alert){const t=phase7AlertTopic(a);return t==='TRADES'?this.config.tradesThreadId??this.config.threadId:t==='RISK'?this.config.riskThreadId??this.config.threadId:this.config.systemThreadId??this.config.threadId;}async deliver(a:Phase7Alert){validatePhase7TelegramConfig(this.config);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);try{const body:Record<string,unknown>={chat_id:this.config.chatId,text:renderPhase7TelegramAlert(a),disable_web_page_preview:true},topic=this.topicThread(a);if(topic)body.message_thread_id=topic;let r:Response;try{r=await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});}catch(e){throw new Phase7TelegramDeliveryError(true,undefined,`LPFORGE_TELEGRAM_NETWORK:${e instanceof Error?e.name:'ERROR'}`);}if(!r.ok){let delay:number|undefined;try{const b=await r.json() as {parameters?:{retry_after?:unknown}},s=Number(b.parameters?.retry_after);if(Number.isFinite(s)&&s>0)delay=Math.min(86400000,Math.floor(s*1000));}catch{}throw new Phase7TelegramDeliveryError(r.status===429||r.status>=500,delay,`LPFORGE_TELEGRAM_HTTP_${r.status}`);}}finally{clearTimeout(timer);}}async send(a:Phase7Alert){if(!this.shouldSend(a))return{sent:false,reason:'disabled_below_threshold_or_cooldown'};await this.deliver(a);this.lastSent.set(phase7AlertFingerprint(a),Date.now());return{sent:true};}}
type Pg={query:(q:string,p?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>;end:()=>Promise<void>;};
async function connect(url:string):Promise<Pg>{const m=await import('pg') as unknown as {Client:new(v:{connectionString:string})=>Pg};const c=new m.Client({connectionString:url});await (c as unknown as {connect:()=>Promise<void>}).connect();return c;}
export const serializePhase7Alert=(alert:Phase7Alert)=>JSON.stringify(alert,(_,value)=>typeof value==='bigint'?value.toString():value);
export class Phase7DurableAlertOutbox{constructor(readonly databaseUrl:string,readonly config=loadPhase7TelegramConfig()){}async enqueue(a:Phase7Alert){if(!this.config.enabled||rank[a.severity]<rank[this.config.minSeverity])return{queued:false};const c=await connect(this.databaseUrl);try{const fingerprint=phase7AlertFingerprint(a),r=await c.query(`INSERT INTO execution.phase7_telegram_alert_outbox(alert_id,fingerprint,code,severity,entity_type,entity_id,transition_key,observed_at,status,next_attempt_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$8,$9::jsonb) ON CONFLICT(fingerprint) DO NOTHING RETURNING alert_id`,[`telegram:${fingerprint}`,fingerprint,a.code,a.severity,a.entityType??'RUNTIME',a.entityId??a.runtimeId??'lpforge',a.transitionKey??null,a.observedAt,serializePhase7Alert(a)]);return{queued:Boolean(r.rows[0]),fingerprint};}finally{await c.end();}}async drain(alerter:Phase7TelegramAlerter,limit=8){if(!this.config.enabled)return{sent:0,failed:0};const c=await connect(this.databaseUrl);let sent=0,failed=0;try{for(let i=0;i<Math.max(1,Math.min(50,limit));i++){const q=await c.query(`WITH c AS (SELECT alert_id FROM execution.phase7_telegram_alert_outbox WHERE ((status IN ('PENDING','RETRY_PENDING') AND next_attempt_at<=now()) OR (status='DISPATCHING' AND last_attempt_at<now()-interval '5 minutes')) ORDER BY observed_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE execution.phase7_telegram_alert_outbox o SET status='DISPATCHING',attempt_count=o.attempt_count+1,last_attempt_at=now(),updated_at=now() FROM c WHERE o.alert_id=c.alert_id RETURNING o.alert_id,o.attempt_count,o.payload`),row=q.rows[0];if(!row)break;try{await alerter.deliver(row.payload as Phase7Alert);await c.query(`UPDATE execution.phase7_telegram_alert_outbox SET status='SENT',sent_at=now(),last_error=NULL,updated_at=now() WHERE alert_id=$1`,[row.alert_id]);sent++;}catch(err){const e=err instanceof Phase7TelegramDeliveryError?err:new Phase7TelegramDeliveryError(false,undefined,err instanceof Error?err.message:String(err)),attempt=Number(row.attempt_count),retry=e.retryable&&attempt<=this.config.maxRetries,delay=e.retryAfterMs??Math.min(86400000,this.config.retryBaseMs*2**Math.max(0,attempt-1));await c.query(`UPDATE execution.phase7_telegram_alert_outbox SET status=$2,next_attempt_at=now()+($3::bigint*interval '1 millisecond'),last_error=$4,updated_at=now() WHERE alert_id=$1`,[row.alert_id,retry?'RETRY_PENDING':'FAILED',delay,e.message.slice(0,500)]);failed++;}}return{sent,failed};}finally{await c.end();}}}
export async function enqueueAndDispatchPhase7Alert(v:{databaseUrl?:string|undefined;alert:Phase7Alert;config?:Phase7TelegramConfig}){const cfg=v.config??loadPhase7TelegramConfig();if(!cfg.enabled||!v.databaseUrl)return{queued:false,sent:0,failed:0};const outbox=new Phase7DurableAlertOutbox(v.databaseUrl,cfg);await outbox.enqueue(v.alert);return outbox.drain(new Phase7TelegramAlerter(cfg));}
export function alertsForPhase7ProductionResult(r:{runtimeId:string;instanceId:string;cycleKey:string;observedAt:string;operatorFailure?:true;health?:{status:string;reasonCodes:string[]};drift?:{status:string;reasonCodes:string[]};control?:{reasonCodes?:string[];newEconomicActionAllowed?:boolean};runtime:{leaseAcquired?:boolean;plan?:string;reasonCodes?:string[]};evidence?:{statuses?:Record<string,string>;reasonCodes?:string[]}}):Phase7Alert[]{const common={runtimeId:r.runtimeId,instanceId:r.instanceId,cycleKey:r.cycleKey,observedAt:r.observedAt,entityType:'RUNTIME' as const,entityId:r.runtimeId,topic:'SYSTEM' as const},out:Phase7Alert[]=[];if(r.operatorFailure)out.push({...common,severity:'CRITICAL',code:'P7_OPERATOR_FAILURE',title:'Production operator cycle failed',message:'The read-only operator probe failed. LPForge remains fail-closed.',transitionKey:'OPERATOR->FAILED',reasonCodes:r.health?.reasonCodes??[]});if(r.health?.status==='CRITICAL')out.push({...common,severity:'CRITICAL',code:'P7_PRODUCTION_BLOCKED',title:'Production entry authority blocked',message:'New economic actions are blocked until canonical safety facts recover.',transitionKey:'ALLOWED->BLOCKED',reasonCodes:r.health.reasonCodes});if(r.control?.newEconomicActionAllowed===true)out.push({...common,severity:'INFO',code:'P7_PRODUCTION_RESTORED',title:'Production entry authority restored',message:'Canonical P7 gates permit economic action; portfolio capacity remains independently enforced.',transitionKey:'BLOCKED->ALLOWED',reasonCodes:r.control.reasonCodes??[]});if(r.drift?.status==='BLOCK')out.push({...common,severity:'CRITICAL',code:'P7_DRIFT_BLOCK',title:'Phase 7 drift gate blocked entries',message:'Drift evidence blocks new entries. No automatic policy retuning occurred.',transitionKey:'DRIFT->BLOCK',reasonCodes:r.drift.reasonCodes});return out;}
export interface ExecutionRecoveryAlertItem{planId:string;reasonCodes?:string[];}
/**
 * Execution recovery is entity-specific.  These transitions deliberately use
 * the plan identity and durable recovery phase so the outbox reports meaningful
 * progress once, rather than paging the same runtime-level warning every loop.
 * Alert delivery remains observational and never affects recovery authority.
 */
export function alertsForExecutionRecovery(r:{observedAt:string;runtimeId?:string;partial?:ExecutionRecoveryAlertItem[];plans?:ExecutionRecoveryAlertItem[];walletReasonCodes?:string[]}):Phase7Alert[]{
  const runtimeId=r.runtimeId??'lpforge-execution',out:Phase7Alert[]=[],seen=new Set<string>(),partialIds=new Set((r.partial??[]).map(x=>x.planId));
  const add=(a:Phase7Alert)=>{const key=[a.code,a.entityId,a.transitionKey].join('|');if(!seen.has(key)){seen.add(key);out.push(a);}};
  const common=(item:ExecutionRecoveryAlertItem)=>({runtimeId,observedAt:r.observedAt,entityType:'PLAN' as const,entityId:item.planId,planId:item.planId,topic:'RISK' as const,reasonCodes:[...new Set(item.reasonCodes??[])]});
  for(const item of r.partial??[]){
    const codes=item.reasonCodes??[],has=(fragment:string)=>codes.some(code=>code.includes(fragment)),c=common(item);
    if(has('PARTIAL_ABORTED_SOL_SETTLED_LEARNING_RECORDED'))continue;
    if(has('PARTIAL_UNWIND_RECONCILED')){
      add({...c,severity:'INFO',code:'P6_PARTIAL_ENTRY_RECOVERY_RESOLVED',title:'Partial entry safely unwound',message:'The LP-position open did not complete. LPForge confirmed the funding unwind on chain; no LP position remains and no duplicate entry was sent.\nAction needed: none.',transitionKey:'PARTIAL_ENTRY->ABORTED_SOL_SETTLED',details:{'Recovery result':'Funding unwind confirmed','LP position':'Not opened'}});
    }else if(has('PARTIAL_RESUME_RECONCILED')||has('OPEN_RECOVERED')||has('PARTIAL_RECOVERY_SUPERSEDED_BY_SUCCESSFUL_ENTRY')){
      add({...c,severity:'INFO',code:'P6_PARTIAL_ENTRY_RECOVERY_RESOLVED',title:'Partial entry reconciled',message:'LPForge verified the existing entry on chain and reconciled it without creating a duplicate position.\nAction needed: none.',transitionKey:'PARTIAL_ENTRY->OPEN_RECONCILED'});
    }else if(has('PARTIAL_UNWIND_STATUS_READ_UNKNOWN')||has('PARTIAL_UNWIND_CONFIRMATION_PENDING')){
      add({...c,severity:'WARNING',code:'P6_PARTIAL_ENTRY_UNWIND_PENDING',title:'Funding unwind awaiting confirmation',message:'LPForge sent the recovery unwind and is checking that exact transaction. It will not send a duplicate unwind or entry.\nAction needed: none right now.',transitionKey:'UNWIND_SUBMITTED->CHAIN_TRUTH_PENDING'});
    }else if(has('PARTIAL_UNWIND_REQUIRED')){
      add({...c,severity:'WARNING',code:'P6_PARTIAL_ENTRY_UNWIND_PENDING',title:'Partial entry funding is being unwound',message:'The LP-position open did not complete. LPForge is safely converting the verified entry funding back to SOL and will not send another entry.\nAction needed: none right now.',transitionKey:'PARTIAL_ENTRY->UNWIND_PENDING'});
    }else if(has('PARTIAL_ENTRY_REQUIRES_POSITION_RECOVERY')||has('OPEN_CHUNK_DISPOSITION_PENDING')||has('OPEN_CHUNK_CHAIN_TRUTH_UNRESOLVED')||has('OPEN_CHUNK_NOT_CONFIRMED')){
      add({...c,severity:'WARNING',code:'P6_PARTIAL_ENTRY_RECOVERY_PENDING',title:'Partial entry is being verified',message:'Funding was confirmed, but the LP-position open has not been confirmed. LPForge is checking the exact transaction and will either reconcile the existing position or safely unwind the verified funding. It will not send a second entry.\nAction needed: none right now.',transitionKey:'FUNDING_CONFIRMED->CHAIN_TRUTH_PENDING'});
    }else{
      add({...c,severity:'WARNING',code:'P6_EXECUTION_RECOVERY_PENDING',title:'Execution recovery is being verified',message:'LPForge is verifying this earlier plan before it accepts new entries. It will not recreate or duplicate an economic action; existing protective closes continue.\nAction needed: none right now.',transitionKey:`RECOVERY->${[...codes].sort().join(',')||'PENDING'}`});
    }
  }
  for(const item of r.plans??[]){if(partialIds.has(item.planId))continue;const c=common(item),codes=c.reasonCodes??[];add({...c,severity:'WARNING',code:'P6_EXECUTION_RECOVERY_PENDING',title:'Execution recovery is being verified',message:'LPForge is verifying this earlier plan before it accepts new entries. It will not recreate or duplicate an economic action; existing protective closes continue.\nAction needed: none right now.',transitionKey:`RECOVERY->${[...codes].sort().join(',')||'PENDING'}`});}
  if((r.walletReasonCodes??[]).length)add({severity:'WARNING',code:'P6_WALLET_RECONCILIATION_PENDING',title:'Wallet reconciliation is being verified',message:'LPForge is reconciling an earlier wallet observation before accepting new entries. No replacement transaction is being created.\nAction needed: none right now.',runtimeId,observedAt:r.observedAt,entityType:'RUNTIME',entityId:runtimeId,topic:'RISK',transitionKey:`WALLET->${[...(r.walletReasonCodes??[])].sort().join(',')}`,reasonCodes:[...new Set(r.walletReasonCodes??[])]});
  return out;
}
export function alertsForExecutionResult(r:{status:string;observedAt:string;planId?:string|undefined;reasonCodes?:string[]|undefined;transactionSubmitted?:boolean|undefined;runtimeId?:string|undefined;positionAddress?:string|undefined;poolAddress?:string|undefined}):Phase7Alert[]{const c={runtimeId:r.runtimeId??'lpforge-execution',observedAt:r.observedAt,reasonCodes:r.reasonCodes??[],entityType:'PLAN' as const,entityId:r.planId??'unknown-plan',...(r.planId?{planId:r.planId}:{}),...(r.positionAddress?{positionAddress:r.positionAddress}:{}),...(r.poolAddress?{poolAddress:r.poolAddress}:{}),topic:'RISK' as const},confirmedFundingPartial=(r.reasonCodes??[]).includes('P6_CONFIRMED_FUNDING_PARTIAL_ENTRY');if(r.status==='BLOCKED')return[{...c,severity:r.transactionSubmitted?'CRITICAL':'WARNING',code:'P6_EXECUTION_PLAN_BLOCKED',title:r.transactionSubmitted?'Execution paused for reconciliation':'Entry skipped safely',message:r.transactionSubmitted?'A prior transaction was submitted. LPForge will verify it before taking any further action. It will not send a duplicate.\nAction needed: none right now.':'No transaction was sent and no funds moved. LPForge will wait for a fresh eligible opportunity.\nAction needed: none.',transitionKey:'PLAN->BLOCKED'}];if(confirmedFundingPartial)return[{...c,severity:'CRITICAL',code:'P6_PARTIAL_ENTRY_RECOVERY_REQUIRED',title:'Partial entry recovery required',message:'Funding was confirmed, but the LP position was not created. LPForge will reconcile or safely unwind; it will not resend blindly.\nAction needed: none right now.',transitionKey:'FUNDING_CONFIRMED->PARTIAL_ENTRY'}];if(r.status==='UNKNOWN')return[{...c,severity:'CRITICAL',code:'P6_EXECUTION_SUBMISSION_UNKNOWN',title:'Transaction submitted — awaiting confirmation',message:'A transaction was sent, but its final chain result is not known yet. LPForge is checking that exact transaction and will not send it again.\nAction needed: none right now.',transitionKey:'SUBMITTED->UNKNOWN'}];if(r.status==='SUBMITTED')return[{...c,severity:'INFO',code:'P6_EXECUTION_SUBMITTED',title:'Transaction submitted',message:'A transaction was sent for chain confirmation. LPForge will not treat the action as complete until the chain confirms it.\nAction needed: none.',transitionKey:'PLAN->SUBMITTED',topic:'TRADES'}];if(r.status==='RECONCILED')return[{...c,severity:'INFO',code:'P6_EXECUTION_RECONCILED',title:'Execution recovery resolved',message:'The chain result was verified safely. LPForge did not send a duplicate transaction.\nAction needed: none.',transitionKey:'UNKNOWN->RESOLVED'}];return[];}
