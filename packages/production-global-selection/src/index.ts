/** Canonical Production pool selector. It is not a shadow/research lane. */
export const GLOBAL_POOL_SELECTION_POLICY_V1='global-pool-selection-v1';
export const POOL_REENTRY_CONTEXT_POLICY_V1='pool-reentry-context-v1';
export const GLOBAL_SELECTION_MAX_EVIDENCE_AGE_SECONDS=300;
export type CandidateState='INCLUDED'|'WARMING'|'NO_TRADE'|'REJECTED'|'EXCLUDED_STALE'|'EXCLUDED_REENTRY_EVIDENCE'|'NO_VALID_CANDIDATE'|'INCOMPARABLE';
export interface SettledPoolOutcome {lifecycleId:string;poolAddress:string;settledAt:string;realizedNetLamports:bigint;realizedReturnFraction?:number;closeReason?:string;oorDirection?:string;inventoryClassification?:string;grossFeesLamports?:bigint;inventoryPnlLamports?:bigint;}
export interface PoolHistoryContext {poolAddress:string;asOf:string;sourceLifecycleIds:string[];lastSettlementAt?:string;timeSinceLastSettlementSeconds?:number;lastRealizedNetLamports?:bigint;lastRealizedReturnFraction?:number;lastCloseReason?:string;lastOorDirection?:string;lastInventoryClassification?:string;entriesToday:number;recentWins:number;recentLosses:number;recentCumulativeNetLamports:bigint;recentTokenRiskCloseCount:number;recentBelowMinCloseCount:number;recentFeeCaptureLamports:bigint;recentInventoryPnlLamports:bigint;historyWindow:'UTC_DAY';}
export interface PoolCandidate {poolAddress:string;operationalState?:'ENTRY_READY'|'NO_TRADE'|'WARMING'|'REJECTED';operationalReasonCodes?:string[];recommendationId?:string;thesisId?:string;candidateId?:string;strategy?:string;orientation?:string;lowerBinId?:number;upperBinId?:number;activeBinId?:number;decisionAt?:string;expiresAt?:string;phase3State:string;phase4State?:string;/** Exact P4/operational entry result for this selection snapshot. */operationalEntryReady?:boolean;/** Capital actually allocated to this candidate, not its nominal ranking capital. */operationalCapitalAllocated?:number;capitalValue?:number;horizonMinutes?:number;riskAdjustedExpectedNetEv?:number;predictedFees?:number;predictedInventoryPnl?:number;uncertainty?:number;confidence?:number;oorRisk?:number;rankingPolicyId?:string;history:PoolHistoryContext;state:CandidateState;reasonCodes:string[];}
export interface GlobalSelection {policyVersion:string;decisionCutoff:string;crossPoolMetricsComparable:boolean;outcome:'GLOBAL_WINNER'|'GLOBAL_NO_TRADE';reasonCodes:string[];ranked:PoolCandidate[];winner?:PoolCandidate;}
const at=(s?:string)=>Date.parse(s??'');
const dayStart=(iso:string)=>{const d=new Date(iso);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())).getTime();};
export function fairProductionPoolOrder(pools:readonly string[],cycleKey:string):string[]{const values=[...new Set(pools.map(x=>x.trim()).filter(Boolean))].sort();if(values.length<2)return values;let h=0;for(const c of cycleKey)h=(h*31+c.charCodeAt(0))>>>0;const start=h%values.length;return values.map((_,i)=>values[(start+i)%values.length]!);}
export function deriveProductionPoolHistory(input:{poolAddress:string;asOf:string;outcomes:readonly SettledPoolOutcome[]}):PoolHistoryContext{
  const cutoff=at(input.asOf),start=dayStart(input.asOf);
  const rows=input.outcomes.filter(x=>x.poolAddress===input.poolAddress&&at(x.settledAt)<=cutoff&&at(x.settledAt)>=start).sort((a,b)=>at(b.settledAt)-at(a.settledAt));
  const last=rows[0],sum=(field:'realizedNetLamports'|'grossFeesLamports'|'inventoryPnlLamports')=>rows.reduce((n,x)=>n+(x[field]??0n),0n);
  return{poolAddress:input.poolAddress,asOf:input.asOf,sourceLifecycleIds:rows.map(x=>x.lifecycleId),...(last?{lastSettlementAt:last.settledAt,timeSinceLastSettlementSeconds:Math.max(0,Math.floor((cutoff-at(last.settledAt))/1000)),lastRealizedNetLamports:last.realizedNetLamports,...(last.realizedReturnFraction===undefined?{}:{lastRealizedReturnFraction:last.realizedReturnFraction}),...(last.closeReason?{lastCloseReason:last.closeReason}:{}),...(last.oorDirection?{lastOorDirection:last.oorDirection}:{}),...(last.inventoryClassification?{lastInventoryClassification:last.inventoryClassification}:{})}:{}),entriesToday:rows.length,recentWins:rows.filter(x=>x.realizedNetLamports>0n).length,recentLosses:rows.filter(x=>x.realizedNetLamports<0n).length,recentCumulativeNetLamports:sum('realizedNetLamports'),recentTokenRiskCloseCount:rows.filter(x=>x.closeReason==='OOR_TOKEN_EXPOSURE'||x.inventoryClassification==='OOR_TOKEN_EXPOSURE').length,recentBelowMinCloseCount:rows.filter(x=>x.oorDirection==='BELOW_MIN').length,recentFeeCaptureLamports:sum('grossFeesLamports'),recentInventoryPnlLamports:sum('inventoryPnlLamports'),historyWindow:'UTC_DAY'};
}
export function classifyProductionPoolCandidate(input:{candidate:Omit<PoolCandidate,'state'|'reasonCodes'>;cycleStartedAt:string;decisionCutoff:string}):PoolCandidate{
  const c=input.candidate,reasons:string[]=[];const decision=at(c.decisionAt),cutoff=at(input.decisionCutoff),started=at(input.cycleStartedAt),expires=at(c.expiresAt);
  const operationalReasons=c.operationalReasonCodes??[];
  if(c.operationalState==='WARMING')return{...c,state:'WARMING',reasonCodes:[...new Set([...operationalReasons,'GLOBAL_POOL_WARMING'])].sort()};
  if(c.operationalState==='NO_TRADE')return{...c,state:'NO_TRADE',reasonCodes:[...new Set([...operationalReasons,'GLOBAL_POOL_NO_TRADE'])].sort()};
  if(c.operationalState==='REJECTED')return{...c,state:'REJECTED',reasonCodes:[...new Set([...operationalReasons,'GLOBAL_POOL_REJECTED'])].sort()};
  if(c.phase3State!=='ENTRY_READY'||!c.candidateId)reasons.push('GLOBAL_NO_VALID_POOL_CANDIDATE');
  // GLOBAL_WINNER is an execution authority, not merely a ranking label. The
  // selection snapshot must therefore contain the final P4 decision and the
  // actual operational allocation that the producer would use for a plan.
  // Older fixtures can omit the explicit derived fields, in which case their
  // equivalent canonical P4/capital fields retain the same meaning.
  const entryReady=c.operationalEntryReady??c.phase4State==='ENTRY_READY';
  const allocated=c.operationalCapitalAllocated??c.capitalValue;
  if(c.phase4State!=='ENTRY_READY')reasons.push('GLOBAL_P4_NOT_ENTRY_READY');
  if(!entryReady)reasons.push('GLOBAL_OPERATIONAL_ENTRY_NOT_READY');
  if(!Number.isFinite(allocated)||allocated!<=0)reasons.push('GLOBAL_OPERATIONAL_CAPITAL_ALLOCATION_ZERO');
  if(!Number.isFinite(decision)||decision<started||decision>cutoff||cutoff-decision>GLOBAL_SELECTION_MAX_EVIDENCE_AGE_SECONDS*1000||Number.isFinite(expires)&&expires<=cutoff)reasons.push('GLOBAL_CANDIDATE_EVIDENCE_STALE');
  if(c.history.lastSettlementAt&&decision<=at(c.history.lastSettlementAt))reasons.push('GLOBAL_SAME_POOL_POST_SETTLEMENT_EVIDENCE_REQUIRED');
  if(!Number.isFinite(c.capitalValue)||!Number.isFinite(c.horizonMinutes)||!Number.isFinite(c.riskAdjustedExpectedNetEv))reasons.push('GLOBAL_ENTRY_READY_METRICS_INCOMPLETE');
  const state:CandidateState=reasons.includes('GLOBAL_CANDIDATE_EVIDENCE_STALE')?'EXCLUDED_STALE':reasons.includes('GLOBAL_SAME_POOL_POST_SETTLEMENT_EVIDENCE_REQUIRED')?'EXCLUDED_REENTRY_EVIDENCE':reasons.length?'NO_VALID_CANDIDATE':'INCLUDED';
  return{...c,state,reasonCodes:[...new Set([...operationalReasons,...reasons])].sort()};
}
export function selectProductionGlobalWinner(input:{decisionCutoff:string;candidates:readonly PoolCandidate[]}):GlobalSelection{
  const included=input.candidates.filter(x=>x.state==='INCLUDED');const capitals=new Set(included.map(x=>String(x.capitalValue))),horizons=new Set(included.map(x=>String(x.horizonMinutes)));
  const comparable=included.length>0&&capitals.size===1&&horizons.size===1;
  const ranked=[...input.candidates].sort((a,b)=>{const av=a.state==='INCLUDED'?a.riskAdjustedExpectedNetEv??-Infinity:-Infinity,bv=b.state==='INCLUDED'?b.riskAdjustedExpectedNetEv??-Infinity:-Infinity;return bv-av||a.history.entriesToday-b.history.entriesToday||a.history.recentTokenRiskCloseCount-b.history.recentTokenRiskCloseCount||a.poolAddress.localeCompare(b.poolAddress);});
  const winner=comparable?ranked.find(x=>x.state==='INCLUDED'):undefined;const reasonCodes=winner?[]:[...(included.length?['GLOBAL_CROSS_POOL_METRICS_INCOMPARABLE']:['GLOBAL_NO_VALID_POOL_CANDIDATE'])];
  return{policyVersion:GLOBAL_POOL_SELECTION_POLICY_V1,decisionCutoff:input.decisionCutoff,crossPoolMetricsComparable:comparable,outcome:winner?'GLOBAL_WINNER':'GLOBAL_NO_TRADE',reasonCodes,ranked,...(winner?{winner}:{})};
}
