// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
export interface Phase7PortfolioPolicy {minReserveLamports:bigint;maxDeployedBps:number;maxPoolBps:number;maxTokenBps:number;maxDailyDrawdownBps:number;maxRollingDrawdownBps:number;maxOpenPositions:number;maxSnapshotAgeMs:number;permitTtlMs:number;}
export interface Phase7PortfolioSnapshot {observedAt:string;walletBalanceLamports:bigint;deployedLamports:bigint;pendingReservedLamports:bigint;poolExposureLamports:Record<string,bigint>;poolPendingLamports:Record<string,bigint>;tokenExposureLamports:Record<string,bigint>;tokenPendingLamports:Record<string,bigint>;dailyStartEquityLamports:bigint;currentEquityLamports:bigint;peakEquityLamports:bigint;openPositions:number;unresolvedReconciliationDebt:number;}
export interface Phase7CapitalRequest {requestId:string;pool:string;token:string;requestedLamports:bigint;action:'OPEN'|'INCREASE'|'SCALE_STEP';now:string;}
export interface Phase7PortfolioPermit {permitId:string;requestId:string;pool:string;token:string;approvedLamports:bigint;issuedAt:string;expiresAt:string;singleUse:true;autonomousScaling:false;}
export interface Phase7PortfolioDecision {decision:'APPROVE'|'BLOCK';approvedLamports:bigint;reasonCodes:string[];permit?:Phase7PortfolioPermit;}
function validBps(v:number){return Number.isInteger(v)&&v>=0&&v<=10_000;}
function limit(total:bigint,bps:number):bigint{return total*BigInt(bps)/10_000n;}
function drawdown(start:bigint,current:bigint):bigint{return start>current?start-current:0n;}
export function governPhase7Portfolio(snapshot:Phase7PortfolioSnapshot,request:Phase7CapitalRequest,policy:Phase7PortfolioPolicy):Phase7PortfolioDecision{
  for(const b of [policy.maxDeployedBps,policy.maxPoolBps,policy.maxTokenBps,policy.maxDailyDrawdownBps,policy.maxRollingDrawdownBps])if(!validBps(b))throw new Error('LPFORGE_P7_PORTFOLIO_POLICY_BPS');
  if(policy.maxOpenPositions<1||policy.maxSnapshotAgeMs<1||policy.permitTtlMs<1000||policy.permitTtlMs>300_000||policy.minReserveLamports<0n)throw new Error('LPFORGE_P7_PORTFOLIO_POLICY');
  if(request.requestedLamports<=0n)throw new Error('LPFORGE_P7_PORTFOLIO_REQUEST');
  const reasons:string[]=[];const nowMs=Date.parse(request.now),obsMs=Date.parse(snapshot.observedAt);
  if(!Number.isFinite(nowMs)||!Number.isFinite(obsMs)||obsMs>nowMs)reasons.push('P7_PORTFOLIO_TIME_INVALID');
  else if(nowMs-obsMs>policy.maxSnapshotAgeMs)reasons.push('P7_PORTFOLIO_SNAPSHOT_STALE');
  if(snapshot.unresolvedReconciliationDebt>0)reasons.push('P7_PORTFOLIO_RECONCILIATION_DEBT');
  if(snapshot.openPositions>=policy.maxOpenPositions&&request.action==='OPEN')reasons.push('P7_PORTFOLIO_POSITION_LIMIT');
  const walletCapacity=snapshot.walletBalanceLamports-policy.minReserveLamports-snapshot.pendingReservedLamports;
  if(walletCapacity<request.requestedLamports)reasons.push('P7_PORTFOLIO_WALLET_RESERVE');
  const totalEquity=snapshot.currentEquityLamports>0n?snapshot.currentEquityLamports:snapshot.walletBalanceLamports+snapshot.deployedLamports;
  const projectedDeployed=snapshot.deployedLamports+snapshot.pendingReservedLamports+request.requestedLamports;
  if(projectedDeployed>limit(totalEquity,policy.maxDeployedBps))reasons.push('P7_PORTFOLIO_GLOBAL_EXPOSURE');
  const poolProjected=(snapshot.poolExposureLamports[request.pool]??0n)+(snapshot.poolPendingLamports[request.pool]??0n)+request.requestedLamports;
  if(poolProjected>limit(totalEquity,policy.maxPoolBps))reasons.push('P7_PORTFOLIO_POOL_EXPOSURE');
  const tokenProjected=(snapshot.tokenExposureLamports[request.token]??0n)+(snapshot.tokenPendingLamports[request.token]??0n)+request.requestedLamports;
  if(tokenProjected>limit(totalEquity,policy.maxTokenBps))reasons.push('P7_PORTFOLIO_TOKEN_EXPOSURE');
  if(drawdown(snapshot.dailyStartEquityLamports,snapshot.currentEquityLamports)>limit(snapshot.dailyStartEquityLamports,policy.maxDailyDrawdownBps))reasons.push('P7_PORTFOLIO_DAILY_DRAWDOWN');
  if(drawdown(snapshot.peakEquityLamports,snapshot.currentEquityLamports)>limit(snapshot.peakEquityLamports,policy.maxRollingDrawdownBps))reasons.push('P7_PORTFOLIO_ROLLING_DRAWDOWN');
  if(reasons.length)return{decision:'BLOCK',approvedLamports:0n,reasonCodes:[...new Set(reasons)].sort()};
  const expiresAt=new Date(nowMs+policy.permitTtlMs).toISOString();
  return{decision:'APPROVE',approvedLamports:request.requestedLamports,reasonCodes:['P7_PORTFOLIO_APPROVED'],permit:{permitId:`p7-cap-${request.requestId}`,requestId:request.requestId,pool:request.pool,token:request.token,approvedLamports:request.requestedLamports,issuedAt:request.now,expiresAt,singleUse:true,autonomousScaling:false}};
}
