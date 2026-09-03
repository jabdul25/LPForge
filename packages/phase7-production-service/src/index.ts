// LPFORGE_PHASE7_RUNTIME_INTEGRATION_MODULE
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {PublicKey} from '@solana/web3.js';
import {loadDeploymentPolicyFile,type MainnetCanaryDeploymentPolicy} from '../../deployment-policy/src/index.js';
import {createMeteoraDataApi} from '../../data-api/src/index.js';
import type {Phase1Config} from '../../config/src/index.js';
import {isPhase3ReadyConsumptionPending,isPostEvidenceEvaluationEligible,type Phase1Store} from '../../db/src/index.js';
import {createGovernedConnection,createMeteoraReadAdapter,createSolanaRpcClient} from '../../meteora/src/index.js';
import {derivePositionMarkToMarket} from '../../live-exit-governor/src/index.js';
import {loadPhase7ControlConfig,loadPhase7ManualApproval,resolvePhase7Authority} from '../../phase7-authority/src/index.js';
import type {Phase7DriftAssessment,Phase7EvaluationMetrics} from '../../phase7-drift/src/index.js';
import {assessPhase7Health,defaultPhase7HealthPolicy,type Phase7HealthAssessment} from '../../phase7-health/src/index.js';
import type {Phase7Incident} from '../../phase7-incidents/src/index.js';
import {assessPhase7LiveDrift,defaultPhase7LiveDriftPolicy} from '../../phase7-live-drift/src/index.js';
import {buildPhase7LiveControlDecision,derivePhase7AutomaticIncidents,reconcilePhase7AutomaticIncidents} from '../../phase7-live-control/src/index.js';
import {buildPhase7RuntimeEvidence} from '../../phase7-live-evidence/src/index.js';
import {collectPhase7LiveHealthObservations} from '../../phase7-live-health/src/index.js';
import {runPhase7RecoveryRuntimeTick} from '../../phase7-live-runtime/src/index.js';
import {governPhase7Portfolio} from '../../phase7-portfolio-governor/src/index.js';
import {GLOBAL_POOL_SELECTION_POLICY_V1,POOL_REENTRY_CONTEXT_POLICY_V1,classifyProductionPoolCandidate,deriveProductionPoolHistory,fairProductionPoolOrder,selectProductionGlobalWinner,type PoolCandidate,type SettledPoolOutcome} from '../../production-global-selection/src/index.js';

export interface Phase7OperatorProbe {exitCode:number;eventDecodeWarnings:number;transactionsScanned:number;decodedSwapEvents:number;operationalCycleComplete:boolean;outputBytes:number;poolAddresses:string[];}
export interface Phase7ProductionOnceResult {runtimeId:string;instanceId:string;cycleKey:string;observedAt:string;operator?:Phase7OperatorProbe;operatorFailure?:true;health?:Phase7HealthAssessment;drift?:Phase7DriftAssessment;control?:ReturnType<typeof buildPhase7LiveControlDecision>;runtime:Awaited<ReturnType<typeof runPhase7RecoveryRuntimeTick>>;evidence?:Awaited<ReturnType<typeof buildPhase7RuntimeEvidence>>;globalSelection?:{globalCycleId:string;outcome:string;winnerPoolAddress?:string;eligiblePoolCount:number;evaluatedPoolCount:number;concurrency:number};directSigner:false;directTransactionSend:false;mainnetTransactionSent:false;}
export interface ApprovedReleaseIdentity {sourceCommit:string;policyHash:string;migrationCount:number;migrationHead:string;buildIdentity:string;}
export interface ControlledCanaryWatchAuthorization {entryEvaluationId:string;thesisId:string;poolAddress:string;observedAt:string;expiresAt:string;confidence:number;reasonCodes:string[];payload:Record<string,unknown>;}
export interface ControlledCanaryPortfolioFacts {openPositions:number;pendingExecutionCount:number;pendingReservedLamports:bigint;unresolvedReconciliationDebt:number;}
export interface ControlledCanaryWatchDecision {enabled:boolean;activate:boolean;reasonCodes:string[];authorization?:ControlledCanaryWatchAuthorization;approval?:{approvalId:string;action:'PROMOTE_PRODUCTION';operatorId:string;issuedAt:string;expiresAt:string;reason:string};}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const enabled=(value:string|undefined)=>String(value??'').trim().toLowerCase()==='true';
/**
 * P7's hard DECISION boundary is 120 seconds. A canary control must leave
 * enough of that unchanged boundary for the observed plan-persistence path
 * (under 12 seconds), the bounded five-second executor poll, and one ordinary
 * revalidation round trip. This is intentionally stricter than health; it
 * never makes aged evidence acceptable.
 */
export const P7_CONTROLLED_CANARY_CLAIM_FRESHNESS_BUDGET_MS=30_000;
/** The established P7 decision freshness boundary; global selection must fit it. */
export const P7_GLOBAL_SELECTION_CYCLE_DEADLINE_MS=120_000;
export function phase7DecisionHealthPoolAddress(input:{smokePoolAddress:string;priorControlPayload?:Record<string,unknown>}):string{
  const prior=String(input.priorControlPayload?.decisionHealthPoolAddress??'').trim();
  return prior||input.smokePoolAddress;
}
export function phase7DecisionHealthProbePoolAddresses(input:{smokePoolAddress:string;priorControlPayload?:Record<string,unknown>}):string[]{
  const persisted=input.priorControlPayload?.decisionHealthProbePoolAddresses;
  const scheduled=Array.isArray(persisted)?persisted.map(value=>String(value).trim()).filter(Boolean):[];
  return[...new Set([...scheduled,phase7DecisionHealthPoolAddress(input)])];
}
/**
 * A scheduled target becomes a valid health source only after its operator run
 * has durably written a new decision. Prefer the newest verified decision among
 * that exact prior probe set.  Falling back to the fixed smoke anchor does not
 * relax DECISION freshness: the anchor is assessed normally and still
 * hard-revokes when it is genuinely stale.
 */
export function phase7VerifiedDecisionHealthPoolAddress(input:{smokePoolAddress:string;priorControlPayload?:Record<string,unknown>;priorControlObservedAt?:string;latestDecisionAtByPool?:Record<string,string>}):{poolAddress:string;targetPoolAddress:string;targetVerified:boolean}{
  const targets=phase7DecisionHealthProbePoolAddresses(input),controlAt=Date.parse(input.priorControlObservedAt??'');
  let selected:{poolAddress:string;observedAt:number}|undefined;
  if(Number.isFinite(controlAt))for(const poolAddress of targets){const observedAt=Date.parse(input.latestDecisionAtByPool?.[poolAddress]??'');if(Number.isFinite(observedAt)&&observedAt>controlAt&&(!selected||observedAt>selected.observedAt||observedAt===selected.observedAt&&poolAddress.localeCompare(selected.poolAddress)>0))selected={poolAddress,observedAt};}
  if(selected)return{poolAddress:selected.poolAddress,targetPoolAddress:selected.poolAddress,targetVerified:true};
  return{poolAddress:input.smokePoolAddress,targetPoolAddress:phase7DecisionHealthPoolAddress(input),targetVerified:phase7DecisionHealthPoolAddress(input)===input.smokePoolAddress};
}
export function phase7NextDecisionHealthPoolAddress(input:{fallbackPoolAddress:string;probePoolAddresses:string[]}):string{
  return input.probePoolAddresses.at(-1)?.trim()||input.fallbackPoolAddress;
}
/**
 * The DECISION health domain is hard-stale after 120 seconds. A serialized
 * operator probe can take material time, so probing the complete eligible
 * universe in one P7 cycle can make the producer miss its own freshness
 * contract. Schedule exactly one deterministic target per cycle instead.
 * This changes producer cadence only; it does not alter the candidate
 * universe, economics, or any safety threshold.
 */
export function phase7BoundedDecisionHealthProbePoolAddresses(input:{fallbackPoolAddress:string;priorControlPayload?:Record<string,unknown>;evaluationPoolAddresses:string[]}):string[]{
  const pools=[...new Set(input.evaluationPoolAddresses.map(value=>value.trim()).filter(Boolean))];
  if(!pools.length)return[input.fallbackPoolAddress];
  const prior=phase7DecisionHealthPoolAddress({smokePoolAddress:input.fallbackPoolAddress,...(input.priorControlPayload?{priorControlPayload:input.priorControlPayload}:{})});
  const priorIndex=pools.indexOf(prior);
  return[pools[priorIndex<0?0:(priorIndex+1)%pools.length]!];
}
const finite=(value:unknown):number|undefined=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))?Number(value):undefined;
const strings=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string') : [];
export function controlledCanaryRevokedApprovalIds(env:NodeJS.ProcessEnv=process.env):string[]{
  return [...new Set((env.LPFORGE_P7_CONTROLLED_CANARY_REVOKED_APPROVAL_IDS??'').split(',').map(value=>value.trim()).filter(Boolean))].sort();
}

/**
 * A deliberately narrow, pre-authorized one-position bridge.  It does not
 * create research evidence, amend Phase-4, sign, submit, or grant a general
 * production mode.  It can activate only for the next durable, unexpired
 * ENTRY_TIMING_APPROVED record while the portfolio remains empty.
 */
export function resolveControlledCanaryWatch(input:{env:NodeJS.ProcessEnv;now:string;authorization?:ControlledCanaryWatchAuthorization;portfolio:ControlledCanaryPortfolioFacts;decisionObservedAt?:string}):ControlledCanaryWatchDecision{
  if(!enabled(input.env.LPFORGE_P7_CONTROLLED_CANARY_WATCH_ENABLED))return{enabled:false,activate:false,reasonCodes:['P7_CONTROLLED_CANARY_WATCH_DISABLED']};
  const operatorId=input.env.LPFORGE_P7_CONTROLLED_CANARY_APPROVED_BY?.trim()??'';
  const maxPositions=Number(input.env.LPFORGE_P7_CONTROLLED_CANARY_MAX_POSITIONS??'1');
  const maxCapital=String(input.env.LPFORGE_P7_CONTROLLED_CANARY_MAX_LP_CAPITAL_LAMPORTS??'30000000');
  const reasons:string[]=[];
  if((input.env.LPFORGE_P7_MODE??'OBSERVE_ONLY').trim()!=='OBSERVE_ONLY')reasons.push('P7_CONTROLLED_CANARY_WATCH_REQUIRES_OBSERVE_BASE');
  if(!operatorId)reasons.push('P7_CONTROLLED_CANARY_APPROVER_REQUIRED');
  if(maxPositions!==1)reasons.push('P7_CONTROLLED_CANARY_POSITION_LIMIT_INVALID');
  if(maxCapital!=='30000000')reasons.push('P7_CONTROLLED_CANARY_CAPITAL_LIMIT_INVALID');
  if(input.portfolio.openPositions!==0||input.portfolio.pendingExecutionCount!==0||input.portfolio.pendingReservedLamports!==0n||input.portfolio.unresolvedReconciliationDebt!==0)reasons.push('P7_CONTROLLED_CANARY_PORTFOLIO_NOT_EMPTY');
  const a=input.authorization;
  if(!a)reasons.push('P7_CONTROLLED_CANARY_NO_FRESH_AUTHORIZATION');
  else {
    if(Date.parse(a.expiresAt)<=Date.parse(input.now))reasons.push('P7_CONTROLLED_CANARY_AUTHORIZATION_EXPIRED');
    if(!a.reasonCodes.includes('ENTRY_TIMING_APPROVED'))reasons.push('P7_CONTROLLED_CANARY_TIMING_NOT_APPROVED');
    if(a.reasonCodes.some(code=>code.startsWith('WAIT_')||code.includes('BLOCK')))reasons.push('P7_CONTROLLED_CANARY_AUTHORIZATION_NOT_CLEAN');
  }
  const decisionObservedAt=input.decisionObservedAt;
  const decisionAt=Date.parse(decisionObservedAt??''),nowAt=Date.parse(input.now),decisionMaxAgeMs=defaultPhase7HealthPolicy.maxAgeMs.DECISION;
  if(!Number.isFinite(decisionAt)||!Number.isFinite(nowAt)||decisionMaxAgeMs===undefined)reasons.push('P7_CONTROLLED_CANARY_DECISION_FRESHNESS_MISSING');
  else if(decisionAt>nowAt||nowAt-decisionAt+P7_CONTROLLED_CANARY_CLAIM_FRESHNESS_BUDGET_MS>decisionMaxAgeMs)reasons.push('P7_CONTROLLED_CANARY_DECISION_FRESHNESS_INSUFFICIENT');
  if(reasons.length)return{enabled:true,activate:false,reasonCodes:reasons.sort(),...(a?{authorization:a}:{})};
  const approvalExpiry=new Date(Math.min(Date.parse(a!.expiresAt),Date.parse(input.now)+60_000)).toISOString();
  return{enabled:true,activate:true,reasonCodes:['P7_CONTROLLED_CANARY_FRESH_PHASE4_AUTHORIZATION'],authorization:a!,approval:{approvalId:`canary-watch-${a!.entryEvaluationId}`,action:'PROMOTE_PRODUCTION',operatorId,issuedAt:input.now,expiresAt:approvalExpiry,reason:'Controlled single-position 0.03 SOL live canary'}};
}
/** Compare the executing tree to the immutable release record. Any absence or
 * mismatch blocks only new exposure; protective paths remain available. */
export function assessPhase7ReleaseIdentity(input:{cwd:string;env:NodeJS.ProcessEnv;sourceCommit?:string;policyHash?:string}){const reasons:string[]=[];let approved:ApprovedReleaseIdentity|undefined;try{approved=JSON.parse(readFileSync(path.resolve(input.cwd,input.env.LPFORGE_APPROVED_RELEASE_IDENTITY_PATH?.trim()||'RELEASE_MANIFEST.json'),'utf8')) as ApprovedReleaseIdentity;}catch{reasons.push('P7_RELEASE_IDENTITY_MISSING');return{valid:false,reasonCodes:reasons};}const migrations=readdirSync(path.resolve(input.cwd,'packages/db/migrations')).filter(x=>/^M\d{4}_.+\.sql$/.test(x)).sort();const runtimePolicyHash=input.policyHash?.trim()||sha(readFileSync(path.resolve(input.cwd,input.env.LPFORGE_EXECUTION_POLICY_PATH?.trim()||'policies/live-execution-policy.json'),'utf8'));const runtimeBuild=input.env.LPFORGE_BUILD_ID?.trim();if(!input.sourceCommit?.trim()||approved.sourceCommit!==input.sourceCommit.trim())reasons.push('P7_RELEASE_SOURCE_MISMATCH');if(approved.policyHash!==runtimePolicyHash)reasons.push('P7_RELEASE_POLICY_MISMATCH');if(approved.migrationCount!==migrations.length||approved.migrationHead!==migrations.at(-1))reasons.push('P7_RELEASE_MIGRATION_MISMATCH');if(!runtimeBuild||approved.buildIdentity!==runtimeBuild)reasons.push('P7_RELEASE_BUILD_MISMATCH');return{valid:reasons.length===0,reasonCodes:reasons.sort(),approved,runtime:{sourceCommit:input.sourceCommit??'',policyHash:runtimePolicyHash,migrationCount:migrations.length,migrationHead:migrations.at(-1)??'',buildIdentity:runtimeBuild??''}};}
const WSOL_MINT='So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM_ID='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export function positionUsdValueToSolLamports(currentEconomicValueUsd:number,solPriceUsd:number):bigint{
  if(!Number.isFinite(currentEconomicValueUsd)||currentEconomicValueUsd<0||!Number.isFinite(solPriceUsd)||solPriceUsd<=0)throw new Error('P7_PORTFOLIO_POSITION_VALUATION_UNAVAILABLE');
  return BigInt(Math.floor(currentEconomicValueUsd/solPriceUsd*1_000_000_000));
}
export function assessPortfolioValuationCoverage(input:{walletBalanceLamports:bigint|undefined;walletTokenAccountCount:number;positionCount:number;inventoryLotCount:number;deployedLamports:bigint;pendingReservedLamports:bigint;pendingExecutionCount:number;unresolvedReconciliationDebt:number;poolExposureLamports:Record<string,bigint>;poolPendingLamports:Record<string,bigint>;tokenExposureLamports:Record<string,bigint>;tokenPendingLamports:Record<string,bigint>;solPriceUsd:number|undefined}){
  if(input.walletBalanceLamports===undefined)throw new Error('P7_PORTFOLIO_WALLET_FACTS_UNAVAILABLE');
  const allZero=(values:Record<string,bigint>)=>Object.values(values).every(value=>value===0n);
  const solOnlyBootstrap=input.positionCount===0&&input.inventoryLotCount===0&&input.walletTokenAccountCount===0&&input.deployedLamports===0n&&input.pendingReservedLamports===0n&&input.pendingExecutionCount===0&&input.unresolvedReconciliationDebt===0&&allZero(input.poolExposureLamports)&&allZero(input.poolPendingLamports)&&allZero(input.tokenExposureLamports)&&allZero(input.tokenPendingLamports);
  if(solOnlyBootstrap)return{mode:'SOL_ONLY_BOOTSTRAP' as const,requiresSolPrice:false};
  if(!Number.isFinite(input.solPriceUsd)||Number(input.solPriceUsd)<=0)throw new Error('P7_PORTFOLIO_INVENTORY_VALUATION_MISSING');
  return{mode:'CROSS_ASSET_VALUATION' as const,requiresSolPrice:true};
}
async function assessLivePortfolioAuthority(input:{store:Phase1Store;cfg:Phase1Config;env:NodeJS.ProcessEnv;now:string}){
  const owner=input.env.LPFORGE_OPERATOR_OWNER_ADDRESS?.trim();
  if(!owner)return{valid:false,reasonCodes:['P7_PORTFOLIO_OWNER_MISSING']};
  try{
    const policy=loadDeploymentPolicyFile(input.env.LPFORGE_EXECUTION_POLICY_PATH?.trim()||'policies/live-execution-policy.json'),capital=policy.productionCapital;
    if(!capital)return{valid:false,reasonCodes:['P7_PORTFOLIO_CAPITAL_POLICY_MISSING']};
    const connection=createGovernedConnection({rpcUrl:input.cfg.solanaRpcHttpUrl,priority:'P2_POSITION_MANAGEMENT'});
    const [facts,prior,wallet,walletTokenAccounts,positions,ownedPoolHistory,inventoryLots]=await Promise.all([
      input.store.loadPhase7PortfolioFacts(owner),
      input.store.loadPhase7PortfolioRiskState(owner),
      connection.getBalance(new PublicKey(owner),'confirmed'),
      connection.getParsedTokenAccountsByOwner(new PublicKey(owner),{programId:new PublicKey(TOKEN_PROGRAM_ID)},'confirmed'),
      input.store.loadOwnedPositions(owner),
      input.store.loadOwnedPoolHistory(owner),
      input.store.loadOwnerPositionInventoryLots(owner),
    ]);
    const adapter=createMeteoraReadAdapter({rpcUrl:input.cfg.solanaRpcHttpUrl,cluster:input.cfg.cluster,programId:input.cfg.programId,expectedSdkVersion:input.cfg.expectedSdkVersion,rpcTimeoutMs:input.cfg.rpcTimeoutMs,priority:'P2_POSITION_MANAGEMENT'});
    const api=createMeteoraDataApi({baseUrl:input.cfg.meteoraDataApiUrl,maxRps:input.cfg.dataApiMaxRps,timeoutMs:input.cfg.httpTimeoutMs});
    const valuations=await Promise.all(positions.map(async row=>{
      const poolAddress=String(row.pool_address),positionAddress=String(row.position_address);
      const [position,pool,account,cashflows]=await Promise.all([adapter.getPositionV2(poolAddress,positionAddress),api.getPool(poolAddress),connection.getAccountInfo(new PublicKey(positionAddress),'confirmed'),input.store.loadPositionCashflows(positionAddress)]);
      const sol=[pool.token_x,pool.token_y].find(token=>token?.address===WSOL_MINT);
      // Wallet balances below already contain every claim, reduction, close
      // withdrawal and swap output.  Only assets still in PositionV2 belong
      // here; including lifecycle economics would double count those flows.
      const mark=derivePositionMarkToMarket({position,pool,observedAt:input.now});
      return {positionAddress,pool,lamports:positionUsdValueToSolLamports(mark.currentPositionValueUsd??Number.NaN,sol?.price??Number.NaN),recoverableRentLamports:BigInt(account?.lamports??0),cashflowCount:cashflows.length};
    }));
    if(positions.length!==facts.openPositions)throw new Error('P7_PORTFOLIO_POSITION_FACT_MISMATCH');
    const positionValueLamports=valuations.reduce((sum,value)=>sum+value.lamports,0n);
    // Wallet token balances are priced with the same pool feed that prices the
    // owned positions. Tokens unknown to the feed, and tokens without a WSOL
    // conversion price, are excluded rather than overstating NAV with guesses.
    const tokenPrices=new Map<string,number>();
    for(const value of valuations)for(const token of [value.pool.token_x,value.pool.token_y])if(token?.address&&typeof token.price==='number'&&Number.isFinite(token.price)&&token.price>0)tokenPrices.set(token.address,token.price);
    // A paired-token balance can outlive its LP account after CLOSE/CLAIM.
    // Keep every LPForge-owned pool as a price source so that residual wallet
    // inventory remains in NAV even when there are no open positions.
    for(const history of ownedPoolHistory)try{const pool=await api.getPool(history.poolAddress);for(const token of [pool.token_x,pool.token_y])if(token?.address&&typeof token.price==='number'&&Number.isFinite(token.price)&&token.price>0)tokenPrices.set(token.address,token.price);}catch{/* a missing historical price is excluded conservatively */}
    const solPriceUsd=tokenPrices.get(WSOL_MINT);
    const coverage=assessPortfolioValuationCoverage({walletBalanceLamports:BigInt(wallet),walletTokenAccountCount:walletTokenAccounts.value.length,positionCount:positions.length,inventoryLotCount:inventoryLots.length,deployedLamports:facts.deployedLamports,pendingReservedLamports:facts.pendingReservedLamports,pendingExecutionCount:facts.pendingExecutionCount,unresolvedReconciliationDebt:facts.unresolvedReconciliationDebt,poolExposureLamports:facts.poolExposureLamports,poolPendingLamports:facts.poolPendingLamports,tokenExposureLamports:facts.tokenExposureLamports,tokenPendingLamports:facts.tokenPendingLamports,solPriceUsd}),valuationSolPriceUsd=solPriceUsd??0;
    const inventoryExposureLamports:{[mint:string]:bigint}={};
    for(const lot of inventoryLots){
      const price=tokenPrices.get(lot.tokenMint);
      if(price===undefined)throw new Error('P7_PORTFOLIO_INVENTORY_VALUATION_MISSING');
      const usd=Number(lot.remainingRawAmount)/10**lot.decimals*price;
      if(!Number.isFinite(usd)||usd<0)throw new Error('P7_PORTFOLIO_INVENTORY_VALUATION_MISSING');
      inventoryExposureLamports[lot.tokenMint]=(inventoryExposureLamports[lot.tokenMint]??0n)+positionUsdValueToSolLamports(usd,valuationSolPriceUsd);
    }
    const tokenExposureLamports={...facts.tokenExposureLamports};
    for(const [mint,lamports] of Object.entries(inventoryExposureLamports))tokenExposureLamports[mint]=(tokenExposureLamports[mint]??0n)+lamports;
    let walletTokenValueLamports=0n;const valuedWalletTokens:{mint:string;amount:string;usdValue:number;lamports:string}[]=[];
    if(solPriceUsd)for(const account of walletTokenAccounts.value){
      const info=(account.account.data.parsed as {info?:{mint?:string;tokenAmount?:{amount?:string;decimals?:number}}}).info;
      const mint=info?.mint,amount=info?.tokenAmount?.amount,decimals=info?.tokenAmount?.decimals;
      if(!mint||!amount||typeof decimals!=='number')continue;
      const price=tokenPrices.get(mint);
      if(price===undefined)continue;
      const usd=Number(amount)/10**decimals*price;
      if(!Number.isFinite(usd)||usd<0)continue;
      const lamports=positionUsdValueToSolLamports(usd,valuationSolPriceUsd);
      walletTokenValueLamports+=lamports;
      valuedWalletTokens.push({mint,amount,usdValue:usd,lamports:lamports.toString()});
    }
    // Rent locked in open position accounts is book-value equity: it returns to
    // the operator when the position is closed.
    const rentReserveLamports=valuations.reduce((sum,value)=>sum+value.recoverableRentLamports,0n);
    const valuationMethod=coverage.mode==='SOL_ONLY_BOOTSTRAP'?'SOL_ONLY_BOOTSTRAP_V1':'POSITION_MARK_TO_MARKET_PLUS_WALLET_LIFECYCLE_V3',priorPayload=(prior?.payload??{}) as Record<string,unknown>,dayStart=new Date(Date.UTC(new Date(input.now).getUTCFullYear(),new Date(input.now).getUTCMonth(),new Date(input.now).getUTCDate())).toISOString(),sameDay=Boolean(prior&&new Date(String(prior.day_start)).toISOString()===dayStart&&priorPayload.valuationMethod===valuationMethod),current=BigInt(wallet)+positionValueLamports+walletTokenValueLamports+rentReserveLamports,daily=sameDay?BigInt(String(prior!.daily_start_equity_lamports)):current,peak=sameDay?([BigInt(String(prior!.peak_equity_lamports)),current].reduce((a,b)=>a>b?a:b)):current;
    const decision=governPhase7Portfolio({observedAt:input.now,walletBalanceLamports:BigInt(wallet),deployedLamports:facts.deployedLamports,pendingReservedLamports:facts.pendingReservedLamports,poolExposureLamports:facts.poolExposureLamports,poolPendingLamports:facts.poolPendingLamports,tokenExposureLamports,tokenPendingLamports:facts.tokenPendingLamports,dailyStartEquityLamports:daily,currentEquityLamports:current,peakEquityLamports:peak,openPositions:facts.openPositions,unresolvedReconciliationDebt:facts.unresolvedReconciliationDebt},{requestId:`p7-health-${input.now}`,pool:'__P7_HEALTH__',token:'__P7_HEALTH__',requestedLamports:1n,action:'OPEN',now:input.now},{minReserveLamports:capital.reserveLamports,maxDeployedBps:10000,maxPoolBps:10000,maxTokenBps:10000,maxDailyDrawdownBps:Number(input.env.LPFORGE_P7_MAX_DAILY_DRAWDOWN_BPS??600),maxRollingDrawdownBps:Number(input.env.LPFORGE_P7_MAX_ROLLING_DRAWDOWN_BPS??1000),maxOpenPositions:policy.maxOpenPositions,maxSnapshotAgeMs:60_000,permitTtlMs:60_000});
    await input.store.upsertPhase7PortfolioRiskState({ownerAddress:owner,dayStart,dailyStartEquityLamports:daily,peakEquityLamports:peak,currentEquityLamports:current,observedAt:input.now,valuationState:'RECONCILED',reasonCodes:[...(sameDay?[]:['P7_PORTFOLIO_VALUATION_BASELINE_RESET']),...decision.reasonCodes],payload:{valuationMethod,walletLamports:String(wallet),positionValueLamports:positionValueLamports.toString(),valuedPositions:valuations.map(value=>({positionAddress:value.positionAddress,lamports:value.lamports.toString(),recoverableRentLamports:value.recoverableRentLamports.toString(),cashflowCount:value.cashflowCount})),walletTokenValueLamports:walletTokenValueLamports.toString(),valuedWalletTokens,rentReserveLamports:rentReserveLamports.toString(),deployedLamports:facts.deployedLamports.toString(),pendingReservedLamports:facts.pendingReservedLamports.toString()}});
    return{valid:decision.decision==='APPROVE',reasonCodes:decision.reasonCodes,facts:{...facts,tokenExposureLamports}};
  }catch(error){
    const code=error instanceof Error?error.message:'';
    return{valid:false,reasonCodes:[code==='P7_PORTFOLIO_POSITION_VALUATION_UNAVAILABLE'?code:'P7_PORTFOLIO_FACTS_UNAVAILABLE']};
  }
}
function healthFromRow(row:Record<string,unknown>):Phase7HealthAssessment{const payload=(row.payload??{}) as Record<string,unknown>;return{status:String(row.status) as Phase7HealthAssessment['status'],observedAt:new Date(String(row.observed_at)).toISOString(),domainStatus:(row.domain_status??{}) as Phase7HealthAssessment['domainStatus'],staleDomains:(payload.staleDomains??[]) as Phase7HealthAssessment['staleDomains'],missingDomains:(payload.missingDomains??[]) as Phase7HealthAssessment['missingDomains'],reasonCodes:(row.reason_codes??[]) as string[],newEntriesAllowed:Boolean(row.new_entries_allowed),managementWritesAllowed:Boolean(row.management_writes_allowed),emergencyCloseAllowed:true};}
function driftFromRow(row:Record<string,unknown>):Phase7DriftAssessment{return{status:String(row.status) as Phase7DriftAssessment['status'],reasonCodes:(row.reason_codes??[]) as string[],observedAt:new Date(String(row.observed_at)).toISOString(),sampleCount:Number(row.sample_count),newEntriesAllowed:String(row.status)!=='BLOCK',managementAllowed:true,policyMutationAllowed:false,automaticPolicyPromotion:false,deltas:(row.deltas??{}) as Record<string,number>};}
function incidentFromRow(row:Record<string,unknown>):Phase7Incident{return{incidentId:String(row.incident_id),type:String(row.incident_type) as Phase7Incident['type'],severity:String(row.severity) as Phase7Incident['severity'],openedAt:new Date(String(row.opened_at)).toISOString(),status:String(row.status) as Phase7Incident['status'],reasonCodes:(row.reason_codes??[]) as string[],...(row.pool_address?{pool:String(row.pool_address)}:{}),...(row.token_mint?{token:String(row.token_mint)}:{}),...(row.resolved_at?{resolvedAt:new Date(String(row.resolved_at)).toISOString()}:{}),...((row.payload as Record<string,unknown>|undefined)?.acknowledgedBy?{acknowledgedBy:String((row.payload as Record<string,unknown>).acknowledgedBy)}:{})};}
/**
 * Static policy membership is retained exclusively for explicitly scoped
 * health-check / canary diagnostics.  It is deliberately not part of the
 * new-entry universe; discovery admission is the sole authority there.
 */
export function productionPolicyHealthcheckPoolAddressesFromPolicy(policy:Pick<MainnetCanaryDeploymentPolicy,'pools'>){return[...new Set(policy.pools.map(pool=>pool.address))];}
export function productionPolicyHealthcheckPoolAddresses(env:NodeJS.ProcessEnv){const path=env.LPFORGE_EXECUTION_POLICY_PATH?.trim()||'policies/live-execution-policy.json';return productionPolicyHealthcheckPoolAddressesFromPolicy(loadDeploymentPolicyFile(path));}
/** Owned/open pools remain observable for management and recovery even after
 * their discovery admission expires.  They have no new-entry authority. */
export function productionManagementPoolAddresses(env:NodeJS.ProcessEnv,ownedPoolAddresses:readonly string[]=[]){return[...new Set([...productionPolicyHealthcheckPoolAddresses(env),...ownedPoolAddresses].map(value=>value.trim()).filter(Boolean))];}
/**
 * Canonical dynamic new-entry universe.  A pool earns evaluation only through
 * the existing Tier-A discovery/evidence lifecycle; static policy membership
 * and owned-position management never seed this set.
 */
/** A completed dynamic evidence attempt gets one bounded chance to reach Phase 3.
 * It remains QUALIFIED and consumes no ACTIVE evidence capacity. */
export function isPostEvidenceProductionEvaluationCandidate(candidate:{state:string;tier:string;payload:Record<string,unknown>},observedAt:string):boolean{return candidate.state==='QUALIFIED'&&candidate.tier==='A'&&isPostEvidenceEvaluationEligible(candidate.payload,observedAt);}
/** A ready dynamic lease keeps collection ownership while it waits for a real
 * Phase-3 decision, and is first in the bounded production probe set. */
export function isPhase3ReadyProductionEvaluationCandidate(candidate:{state:string;tier:string;payload:Record<string,unknown>},observedAt:string):boolean{return candidate.state==='ACTIVE_CANDIDATE'&&candidate.tier==='A'&&isPhase3ReadyConsumptionPending(candidate.payload,observedAt);}
const readyAt=(candidate:{payload:Record<string,unknown>})=>Date.parse(String(candidate.payload.liveEvidencePhase3ReadyAt??''));
export interface ProductionSelectionAdmissionSnapshot {poolAddress:string;tier:string;state:string;dynamicEligible:boolean;}
/** Freeze the exact dynamic Tier-A facts used to admit this global-selection cycle. */
export async function getProductionNewEntryAdmissionSnapshots(store:Pick<Phase1Store,'listDiscoveryCandidates'>,env:NodeJS.ProcessEnv,rotationKey=''):Promise<ProductionSelectionAdmissionSnapshot[]>{if((env.LPFORGE_DISCOVERY_OPERATOR_ENABLED??'false').toLowerCase()!=='true')return[];const candidates=await store.listDiscoveryCandidates(['A']),observedAt=new Date().toISOString(),ready=candidates.filter(candidate=>isPhase3ReadyProductionEvaluationCandidate(candidate,observedAt)).sort((a,b)=>readyAt(a)-readyAt(b)||a.poolAddress.localeCompare(b.poolAddress)),completed=candidates.filter(candidate=>isPostEvidenceProductionEvaluationCandidate(candidate,observedAt)).sort((a,b)=>Date.parse(String(a.payload.postEvidenceEvaluationEligibleAt??''))-Date.parse(String(b.payload.postEvidenceEvaluationEligibleAt??''))||a.poolAddress.localeCompare(b.poolAddress)),active=candidates.filter(candidate=>candidate.state==='ACTIVE_CANDIDATE'&&!isPhase3ReadyProductionEvaluationCandidate(candidate,observedAt)),max=Math.max(1,Math.min(10,Number(env.LPFORGE_PRODUCTION_OPERATOR_MAX_POOLS??10)));if(ready.length+completed.length+active.length===0)return[];const rotation=[...rotationKey].reduce((sum,char)=>(sum*31+char.charCodeAt(0))>>>0,0)%Math.max(1,active.length),rotatedActive=Array.from({length:Math.min(Math.max(0,max-ready.length-completed.length),active.length)},(_,index)=>active[(rotation+index)%active.length]!),selected=[...ready.slice(0,max),...completed.slice(0,Math.max(0,max-ready.length)),...rotatedActive].slice(0,max),byPool=new Map<string,ProductionSelectionAdmissionSnapshot>();for(const candidate of selected)if(!byPool.has(candidate.poolAddress))byPool.set(candidate.poolAddress,{poolAddress:candidate.poolAddress,tier:candidate.tier,state:candidate.state,dynamicEligible:true});return[...byPool.values()];}
export async function getProductionNewEntryEligiblePools(store:Pick<Phase1Store,'listDiscoveryCandidates'>,env:NodeJS.ProcessEnv,rotationKey=''){return(await getProductionNewEntryAdmissionSnapshots(store,env,rotationKey)).map(snapshot=>snapshot.poolAddress);}
export function parsePhase7OperatorProbeOutput(combined:string,exitCode:number,poolAddress?:string):Phase7OperatorProbe{const legacyWarnings=(combined.match(/meteora_event_decode_quarantined/g)??[]).length;const machineLine=combined.split(/\r?\n/).find(line=>line.includes('\"event\":\"lpforge_operator_machine_summary\"'));const legacyLine=combined.split(/\r?\n/).find(line=>line.includes('\"event\":\"meteora_ingestion_summary\"'));let transactionsScanned=0,decodedSwapEvents=0,eventDecodeWarnings=legacyWarnings,complete=false;for(const line of [machineLine,legacyLine]){if(!line)continue;try{const x=JSON.parse(line) as Record<string,unknown>;transactionsScanned=Number(x.transactionsScanned??transactionsScanned);decodedSwapEvents=Number(x.decodedSwapEvents??decodedSwapEvents);eventDecodeWarnings=Number(x.eventDecodeWarnings??eventDecodeWarnings);if(x.event==='lpforge_operator_machine_summary')complete=true;}catch{}}if(!complete)complete=combined.includes('operational_cycle_complete');return{exitCode,eventDecodeWarnings,transactionsScanned,decodedSwapEvents,operationalCycleComplete:complete,outputBytes:combined.length,poolAddresses:poolAddress?[poolAddress]:[]};}
function redactProbeFailureDetail(value:string){return value.replace(/https?:\/\/[^\s"']+/gi,'<redacted-url>').replace(/(?:api[-_]?key|token|secret|password)=[^\s&"']+/gi,'$1=<redacted>').replace(/\s+/g,' ').trim().slice(-500);}
export async function runAutonomousDecisionProbe(input:{cwd:string;env:NodeJS.ProcessEnv;poolAddress?:string;timeoutMs?:number}):Promise<Phase7OperatorProbe>{
  // The operator needs only the public owner address to persist a plan.  It never
  // receives signing authority; the separately supervised execution worker is
  // the only process that loads the local signer configuration.
  const poolAddress=input.poolAddress??input.env.LPFORGE_SMOKE_POOL_ADDRESS?.trim();const configuredBackfill=Number(input.env.LPFORGE_P7_OPERATOR_EVENT_BACKFILL_LIMIT??input.env.EVENT_BACKFILL_LIMIT??10),productionRpcInterval=input.env.LPFORGE_PRODUCTION_RPC_MIN_INTERVAL_MS??input.env.RPC_MIN_INTERVAL_MS;const childEnv:{[key:string]:string|undefined}={...input.env,LIVE_SIGNING:'false',LPFORGE_LIVE_EXECUTION:'false',LPFORGE_MAINNET_CANARY:'false',LPFORGE_DATA_MODE:'LIVE_READ_ONLY',LPFORGE_OPERATOR_MACHINE_SUMMARY:'true',EVENT_BACKFILL_LIMIT:String(Math.max(1,Math.min(10,configuredBackfill)),),...(productionRpcInterval?{RPC_MIN_INTERVAL_MS:productionRpcInterval}:{}),...(poolAddress?{LPFORGE_SMOKE_POOL_ADDRESS:poolAddress}:{})};delete childEnv.LPFORGE_PREPARE_POSITION_ADDRESS;
  const timeoutMs=input.timeoutMs===undefined?Math.max(30_000,Math.min(300_000,Number(input.env.LPFORGE_P7_OPERATOR_PROBE_TIMEOUT_MS??120_000))):Math.max(30_000,Math.min(300_000,input.timeoutMs));
  return new Promise((resolve,reject)=>{const child=spawn('node',['--enable-source-maps','.build/apps/operator/src/main.js','live-once'],{cwd:input.cwd,env:childEnv,stdio:['ignore','pipe','pipe']});let out='',err='',settled=false;const timeout=setTimeout(()=>{if(settled)return;settled=true;(child as unknown as {kill:(signal:string)=>boolean}).kill('SIGTERM');reject(new Error(`LPFORGE_P7_OPERATOR_PROBE_TIMEOUT:${timeoutMs}:${redactProbeFailureDetail(err||out)}`));},timeoutMs);const done=(fn:()=>void)=>{if(settled)return;settled=true;clearTimeout(timeout);fn();};child.stdout?.on('data',x=>{out+=String(x);});child.stderr?.on('data',x=>{err+=String(x);});child.on('error',error=>done(()=>reject(error)));child.on('close',code=>done(()=>{const combined=out+'\n'+err;const exitCode=code??1;if(exitCode!==0)return reject(new Error(`LPFORGE_P7_OPERATOR_PROBE_FAILED:${exitCode}:${redactProbeFailureDetail(err||out)}`));resolve(parsePhase7OperatorProbeOutput(combined,exitCode,poolAddress));}));});
}
/**
 * The one canonical Production pool-selection cycle. Every included pool is
 * evaluated with the existing Candidate-Primary implementation; no result can
 * prepare an OPEN plan during this collection step. The persisted winner is
 * therefore the only pool-selection authority, while P4/P7/execution retain
 * their existing downstream controls.
 */
export async function runProductionGlobalSelectionCycle(input:{store:Pick<Phase1Store,'loadProductionGlobalCandidateFacts'|'loadProductionPoolSettlementHistory'|'insertProductionGlobalSelection'>;cwd:string;env:NodeJS.ProcessEnv;cycleKey:string;eligiblePoolAddresses:string[];selectionAdmissionSnapshots?:ProductionSelectionAdmissionSnapshot[];sourceCommit?:string;buildId?:string}){
  const globalCycleId=`production-global:${input.cycleKey}`,startedAt=new Date().toISOString(),ordered=fairProductionPoolOrder(input.eligiblePoolAddresses,input.cycleKey);
  const concurrency=Math.max(1,Math.min(2,Math.floor(Number(input.env.LPFORGE_GLOBAL_POOL_SELECTION_CONCURRENCY??2))));
  // P7's existing hard decision boundary is 120 seconds.  A global cycle may
  // stop short of the eligible universe, but it may never turn freshness into
  // a multi-minute queue.  Partial coverage is persisted and fails closed.
  const deadlineAt=Date.now()+P7_GLOBAL_SELECTION_CYCLE_DEADLINE_MS;
  const probes:Phase7OperatorProbe[]=[];const failures:{poolAddress:string;reason:string}[]=[];let cursor=0;
  const worker=async()=>{for(;;){if(Date.now()>=deadlineAt)return;const index=cursor++;if(index>=ordered.length)return;const poolAddress=ordered[index]!,remaining=deadlineAt-Date.now();if(remaining<30_000){failures.push({poolAddress,reason:'GLOBAL_CYCLE_DEADLINE_REACHED'});return;}try{probes.push(await runAutonomousDecisionProbe({cwd:input.cwd,env:{...input.env,LPFORGE_P7_PLAN_DISPATCH_ENABLED:'false',LPFORGE_PRODUCTION_GLOBAL_SELECTION_CYCLE_ID:globalCycleId},poolAddress,timeoutMs:remaining}));}catch(error){failures.push({poolAddress,reason:redactProbeFailureDetail(error instanceof Error?error.message:String(error))});}}};
  await Promise.all(Array.from({length:Math.min(concurrency,ordered.length)},worker));
  const decisionCutoff=new Date().toISOString();
  const [facts,settlements]=await Promise.all([input.store.loadProductionGlobalCandidateFacts(globalCycleId,ordered),input.store.loadProductionPoolSettlementHistory(ordered,decisionCutoff)]);
  const outcomes:SettledPoolOutcome[]=settlements.map(row=>{const capital=finite(row.initial_capital_lamports),net=BigInt(String(row.realized_sol_pnl_lamports));return{lifecycleId:String(row.lifecycle_id),poolAddress:String(row.pool_address),settledAt:new Date(String(row.settled_at)).toISOString(),realizedNetLamports:net,...(capital&&capital>0?{realizedReturnFraction:Number(net)/capital}:{}),...(row.close_reason?{closeReason:String(row.close_reason)}:{}),...(row.oor_direction?{oorDirection:String(row.oor_direction)}:{}),...(row.inventory_classification?{inventoryClassification:String(row.inventory_classification)}:{}),grossFeesLamports:BigInt(String(row.gross_fees??0)),inventoryPnlLamports:BigInt(String(row.inventory_pnl??0))};});
  const byPool=new Map(facts.map(row=>[String(row.pool_address),row]));
  const candidates:PoolCandidate[]=ordered.map(poolAddress=>{
    const row=byPool.get(poolAddress),history=deriveProductionPoolHistory({poolAddress,asOf:decisionCutoff,outcomes}),operationalState=String(row?.operational_state??'REJECTED');
    const raw:Omit<PoolCandidate,'state'|'reasonCodes'>={poolAddress,operationalState:operationalState==='ENTRY_READY'||operationalState==='NO_TRADE'||operationalState==='WARMING'||operationalState==='REJECTED'?operationalState:'REJECTED',operationalReasonCodes:strings(row?.reason_codes),...(row?.recommendation_id?{recommendationId:String(row.recommendation_id)}:{}),...(row?.thesis_id?{thesisId:String(row.thesis_id)}:{}),...(row?.candidate_id?{candidateId:String(row.candidate_id)}:{}),...(row?.strategy?{strategy:String(row.strategy)}:{}),...(row?.orientation?{orientation:String(row.orientation)}:{}),...(finite(row?.lower_bin_id)===undefined?{}:{lowerBinId:finite(row?.lower_bin_id)!}),...(finite(row?.upper_bin_id)===undefined?{}:{upperBinId:finite(row?.upper_bin_id)!}),...(finite(row?.active_bin_id)===undefined?{}:{activeBinId:finite(row?.active_bin_id)!}),...(row?.observed_at?{decisionAt:new Date(String(row.observed_at)).toISOString()}:{}),phase3State:operationalState,...(row?.phase4_state?{phase4State:String(row.phase4_state)}:{}),...(finite(row?.capital_value)===undefined?{}:{capitalValue:finite(row?.capital_value)!}),...(finite(row?.horizon_minutes)===undefined?{}:{horizonMinutes:finite(row?.horizon_minutes)!}),...(finite(row?.risk_adjusted_expected_net_ev)===undefined?{}:{riskAdjustedExpectedNetEv:finite(row?.risk_adjusted_expected_net_ev)!}),...(finite(row?.predicted_gross_fees)===undefined?{}:{predictedFees:finite(row?.predicted_gross_fees)!}),...(finite(row?.predicted_inventory_pnl)===undefined?{}:{predictedInventoryPnl:finite(row?.predicted_inventory_pnl)!}),...(finite(row?.uncertainty)===undefined?{}:{uncertainty:finite(row?.uncertainty)!}),...(finite(row?.confidence)===undefined?{}:{confidence:finite(row?.confidence)!}),...(finite(row?.oor_risk)===undefined?{}:{oorRisk:finite(row?.oor_risk)!}),history};
    return classifyProductionPoolCandidate({candidate:raw,cycleStartedAt:startedAt,decisionCutoff});
  });
  let selection=selectProductionGlobalWinner({decisionCutoff,candidates});
  if(failures.length||facts.length!==ordered.length)selection={...selection,outcome:'GLOBAL_NO_TRADE',reasonCodes:[...new Set([...selection.reasonCodes,'GLOBAL_COVERAGE_INCOMPLETE'])].sort()};
  const winner=selection.outcome==='GLOBAL_WINNER'?selection.winner:undefined,runnerUp=winner?selection.ranked.find(x=>x.poolAddress!==winner.poolAddress&&x.state==='INCLUDED'):undefined,selectionAdmissionByPool=new Map((input.selectionAdmissionSnapshots??[]).map(snapshot=>[snapshot.poolAddress,snapshot]));
  await input.store.insertProductionGlobalSelection({globalCycleId,policyVersion:GLOBAL_POOL_SELECTION_POLICY_V1,reentryContextPolicyVersion:POOL_REENTRY_CONTEXT_POLICY_V1,decisionCutoff,startedAt,completedAt:new Date().toISOString(),eligiblePoolCount:ordered.length,evaluatedPoolCount:probes.length,candidatePoolCount:candidates.filter(x=>x.state==='INCLUDED').length,coverageState:failures.length||facts.length!==ordered.length?'INCOMPLETE':'COMPLETE',outcome:selection.outcome,...(winner?{winnerPoolAddress:winner.poolAddress,winnerCandidateId:winner.candidateId}:{}),...(runnerUp?{runnerUpPoolAddress:runnerUp.poolAddress}:{}),rankingMetric:'RISK_ADJUSTED_EXPECTED_NET_EV_SOL_0_03_CAPITAL_60M',crossPoolMetricsComparable:selection.crossPoolMetricsComparable,reasonCodes:selection.reasonCodes,...(input.sourceCommit?{sourceCommit:input.sourceCommit}:{}),...(input.buildId?{buildId:input.buildId}:{}),payload:{evaluationOrder:ordered,concurrency,deadlineMs:P7_GLOBAL_SELECTION_CYCLE_DEADLINE_MS,failures,globalNoTradeRequiresFailClosed:true,historyAdjustment:'CONTEXT_AND_EXACT_TIE_BREAK_ONLY',postSettlementFreshEvidenceRequired:true},candidates:selection.ranked.map((c,index)=>{const admission=selectionAdmissionByPool.get(c.poolAddress);return{poolAddress:c.poolAddress,evaluationOrder:ordered.indexOf(c.poolAddress)+1,...(c.state==='INCLUDED'?{candidateRank:index+1}:{}),candidateState:c.state,...(admission?{selectionTier:admission.tier,selectionState:admission.state,selectionDynamicEligible:admission.dynamicEligible}:{}),...(c.recommendationId?{recommendationId:c.recommendationId}:{}),...(c.thesisId?{thesisId:c.thesisId}:{}),...(c.candidateId?{candidateId:c.candidateId}:{}),...(c.strategy?{strategy:c.strategy}:{}),...(c.orientation?{orientation:c.orientation}:{}),...(c.lowerBinId===undefined?{}:{lowerBinId:c.lowerBinId}),...(c.upperBinId===undefined?{}:{upperBinId:c.upperBinId}),...(c.activeBinId===undefined?{}:{activeBinId:c.activeBinId}),...(c.riskAdjustedExpectedNetEv===undefined?{}:{riskAdjustedExpectedNetEv:c.riskAdjustedExpectedNetEv}),...(c.predictedFees===undefined?{}:{predictedFees:c.predictedFees}),...(c.predictedInventoryPnl===undefined?{}:{predictedInventoryPnl:c.predictedInventoryPnl}),...(c.capitalValue===undefined?{}:{capitalValue:c.capitalValue}),...(c.horizonMinutes===undefined?{}:{horizonMinutes:c.horizonMinutes}),...(c.decisionAt?{decisionAt:c.decisionAt}:{}),...(c.expiresAt?{expiresAt:c.expiresAt}:{}),phase3State:c.phase3State,...(c.phase4State?{phase4State:c.phase4State}:{}),reasonCodes:c.reasonCodes,historyContext:c.history as unknown as Record<string,unknown>,payload:{}}})});
  return{globalCycleId,selection,ordered,probes,failures,concurrency};
}
/**
 * Observation has no economic authority.  Keep it on a separate child entry
 * point so it continues while recovery, safety, or a failed decision probe
 * blocks every CLAIM/CLOSE/OPEN action.
 */
export async function runAutonomousPositionObservationProbe(input:{cwd:string;env:NodeJS.ProcessEnv}):Promise<Phase7OperatorProbe>{
  const childEnv:{[key:string]:string|undefined}={...input.env,LIVE_SIGNING:'false',LPFORGE_LIVE_EXECUTION:'false',LPFORGE_MAINNET_CANARY:'false',LPFORGE_DATA_MODE:'LIVE_READ_ONLY',LPFORGE_OPERATOR_MACHINE_SUMMARY:'true'};
  delete childEnv.LPFORGE_PREPARE_POSITION_ADDRESS;
  const timeoutMs=Math.max(30_000,Math.min(300_000,Number(input.env.LPFORGE_P7_POSITION_OBSERVATION_TIMEOUT_MS??60_000)));
  return new Promise((resolve,reject)=>{const child=spawn('node',['--enable-source-maps','.build/apps/operator/src/main.js','observe-owned-positions'],{cwd:input.cwd,env:childEnv,stdio:['ignore','pipe','pipe']});let out='',err='',settled=false;const timeout=setTimeout(()=>{if(settled)return;settled=true;(child as unknown as {kill:(signal:string)=>boolean}).kill('SIGTERM');reject(new Error(`LPFORGE_P7_POSITION_OBSERVATION_TIMEOUT:${timeoutMs}:${redactProbeFailureDetail(err||out)}`));},timeoutMs);const done=(fn:()=>void)=>{if(settled)return;settled=true;clearTimeout(timeout);fn();};child.stdout?.on('data',x=>{out+=String(x);});child.stderr?.on('data',x=>{err+=String(x);});child.on('error',error=>done(()=>reject(error)));child.on('close',code=>done(()=>{const combined=out+'\n'+err;const exitCode=code??1;if(exitCode!==0)return reject(new Error(`LPFORGE_P7_POSITION_OBSERVATION_FAILED:${exitCode}:${redactProbeFailureDetail(err||out)}`));resolve(parsePhase7OperatorProbeOutput(combined,exitCode));}));});
}
export async function runPhase7ProductionOnce(input:{cfg:Phase1Config;store:Phase1Store;runtimeId:string;instanceId:string;cycleKey:string;driftBaseline:Phase7EvaluationMetrics;sourceCommit?:string;policyHash?:string;cwd:string;env:NodeJS.ProcessEnv;leaseTtlMs?:number;restarted:boolean}):Promise<Phase7ProductionOnceResult>{
  const startedAt=new Date().toISOString();if(!input.cfg.smokePoolAddress)throw new Error('LPFORGE_CONFIG_REQUIRED:LPFORGE_SMOKE_POOL_ADDRESS');const ttl=input.leaseTtlMs??60_000;const lease=await input.store.claimPhase7RuntimeLease({runtimeId:input.runtimeId,holderId:input.instanceId,now:startedAt,expiresAt:new Date(Date.parse(startedAt)+ttl).toISOString()});if(!lease){const runtime={runtimeId:input.runtimeId,instanceId:input.instanceId,cycleKey:input.cycleKey,leaseAcquired:false,recoveryScanCompleted:false,recoveryFacts:{previousCompletedCycleKeys:[],completedEconomicActionKeys:[],recoveryQueueCount:0,unknownSubmissionCount:0,unresolvedReconciliationDebt:0,supersededReconciliationHistoryCount:0},plan:'HOLD' as const,reasonCodes:['P7_RUNTIME_LEASE_HELD_BY_OTHER'],newEconomicActionAllowed:false,cycleInserted:false,requiresExistingExecutionWorkflow:true as const,directSigner:false as const,directTransactionSend:false as const};return{runtimeId:input.runtimeId,instanceId:input.instanceId,cycleKey:input.cycleKey,observedAt:startedAt,runtime,directSigner:false,directTransactionSend:false,mainnetTransactionSent:false};}
  // This is intentionally best-effort: inability to observe does not grant an
  // action or suppress existing recovery.  The child is read-only and writes
  // only durable management facts, including when P7 is RECOVER_ONLY.
  try{await runAutonomousPositionObservationProbe({cwd:input.cwd,env:input.env});}catch{/* health/action semantics remain fail-closed elsewhere */}
  const recovery=await input.store.loadPhase7RecoveryFacts(input.runtimeId);if(recovery.recoveryQueueCount>0||recovery.unknownSubmissionCount>0||recovery.unresolvedReconciliationDebt>0||recovery.partialEntryRecoveryCount>0){const runtime=await runPhase7RecoveryRuntimeTick({store:input.store,runtimeId:input.runtimeId,instanceId:input.instanceId,cycleKey:input.cycleKey,now:new Date().toISOString(),leaseTtlMs:ttl,restarted:input.restarted,control:{authorityMode:'OBSERVE_ONLY',healthStatus:'CRITICAL',newEconomicActionAllowed:false}});return{runtimeId:input.runtimeId,instanceId:input.instanceId,cycleKey:input.cycleKey,observedAt:new Date().toISOString(),runtime,directSigner:false,directTransactionSend:false,mainnetTransactionSent:false};}
  const priorControlRow=await input.store.loadLatestPhase7ControlDecision(input.runtimeId),priorControlPayload=(priorControlRow?.payload??{}) as Record<string,unknown>,scheduledDecisionHealthPools=phase7DecisionHealthProbePoolAddresses({smokePoolAddress:input.cfg.smokePoolAddress,priorControlPayload}),latestDecisionFacts=await Promise.all(scheduledDecisionHealthPools.map(async poolAddress=>({poolAddress,facts:await input.store.loadPhase7HealthFacts(poolAddress).catch(()=>undefined)}))),latestDecisionAtByPool:Record<string,string>={};
  for(const row of latestDecisionFacts)if(row.facts?.latestDecisionAt)latestDecisionAtByPool[row.poolAddress]=row.facts.latestDecisionAt;
  const decisionHealthSource=phase7VerifiedDecisionHealthPoolAddress({smokePoolAddress:input.cfg.smokePoolAddress,priorControlPayload,...(priorControlRow?{priorControlObservedAt:new Date(String(priorControlRow.observed_at)).toISOString()}:{}),...(Object.keys(latestDecisionAtByPool).length?{latestDecisionAtByPool}:{})}),decisionHealthPoolAddress=decisionHealthSource.poolAddress;
  const productionRpcInterval=Math.max(0,Number(input.env.LPFORGE_PRODUCTION_RPC_MIN_INTERVAL_MS??input.cfg.rpcMinIntervalMs));const rpc=createSolanaRpcClient({url:input.cfg.solanaRpcHttpUrl,timeoutMs:input.cfg.rpcTimeoutMs,minIntervalMs:productionRpcInterval,maxRetries:input.cfg.rpcMaxRetries,retryBaseDelayMs:input.cfg.rpcRetryBaseDelayMs,retryMaxDelayMs:input.cfg.rpcRetryMaxDelayMs,priority:'P2_POSITION_MANAGEMENT'});const dataApi=createMeteoraDataApi({baseUrl:input.cfg.meteoraDataApiUrl,maxRps:input.cfg.dataApiMaxRps,timeoutMs:input.cfg.httpTimeoutMs});
  // Health, drift and the control decision persist BEFORE the operator probes
  // so the operator's own control read sees this cycle's decision — never the
  // previous cycle's. Probe outputs (decoder telemetry, probed pools) lag one
  // cycle through the stored evidence snapshot; health and drift inputs never
  // depend on the probe at all.
  const probeAt=new Date().toISOString();const observations=await collectPhase7LiveHealthObservations({assessmentAt:probeAt,poolAddress:decisionHealthPoolAddress,rpc,dataApi,store:input.store});const healthAt=new Date().toISOString();const health=assessPhase7Health(observations,defaultPhase7HealthPolicy,healthAt);await input.store.insertPhase7HealthAssessment({assessmentId:`${input.runtimeId}:${input.cycleKey}:health`,runtimeId:input.runtimeId,cycleKey:input.cycleKey,observedAt:healthAt,status:health.status,newEntriesAllowed:health.newEntriesAllowed,managementWritesAllowed:health.managementWritesAllowed,reasonCodes:health.reasonCodes,domainStatus:health.domainStatus,payload:{poolAddress:decisionHealthPoolAddress,observations,staleDomains:health.staleDomains,missingDomains:health.missingDomains}});
  const driftAt=new Date().toISOString(),since=new Date(Date.parse(driftAt)-24*3600_000).toISOString();
  const priorEvidenceRow=await input.store.loadLatestPhase7EvidenceSnapshot(input.runtimeId),priorEvidencePayload=(priorEvidenceRow?.payload??{}) as Record<string,unknown>,priorDriftRow=await input.store.loadLatestPhase7DriftAssessment(),priorDriftPayload=(priorDriftRow?.payload??{}) as Record<string,unknown>;
  const telemetryWarnings=Number(priorEvidencePayload.operatorEventDecodeWarnings??priorDriftPayload.operatorEventDecodeWarnings??NaN),telemetrySwaps=Number(priorEvidencePayload.operatorDecodedSwapEvents??priorDriftPayload.operatorDecodedSwapEvents??NaN),telemetryBytes=Number(priorEvidencePayload.operatorOutputBytes??priorDriftPayload.operatorOutputBytes??NaN);
  const decoderSkipRate=Number.isFinite(telemetryWarnings)&&Number.isFinite(telemetrySwaps)?telemetryWarnings/Math.max(1,telemetryWarnings+telemetrySwaps):undefined;
  // Drift is assessed per pool over the exact set the operator probes this
  // cycle. The smoke pool stays the full-weight RPC-liveness anchor; other
  // probed pools count at full weight only when they carry deployed capital
  // or open positions, otherwise at most WATCH — an idle candidate pool can
  // never BLOCK the system.
  const ownerAddress=input.env.LPFORGE_OPERATOR_OWNER_ADDRESS?.trim(),capitalPools=new Set<string>(),openPools=new Set<string>();
  if(ownerAddress){try{const [portfolioFacts,ownedRows]=await Promise.all([input.store.loadPhase7PortfolioFacts(ownerAddress),input.store.loadOwnedPositions(ownerAddress)]);for(const [poolAddress,lamports] of Object.entries(portfolioFacts.poolExposureLamports))if(lamports>0n)capitalPools.add(poolAddress);for(const row of ownedRows)if(String(row.lifecycle_state)!=='CLOSED'&&row.pool_address)openPools.add(String(row.pool_address));}catch{/* portfolio facts are advisory here; unreadable pools default to idle (WATCH-capped) */}}
  // Snapshot the dynamic Tier-A new-entry universe once. Discovery may mutate
  // it while this cycle runs; the global selector must nevertheless describe
  // one immutable, dynamically admitted set. Management/health pools remain
  // observable for drift but never acquire new-entry eligibility by policy
  // membership or ownership alone.
  const newEntryAdmissionSnapshots=await getProductionNewEntryAdmissionSnapshots(input.store,input.env,input.cycleKey),newEntryPoolAddresses=newEntryAdmissionSnapshots.map(snapshot=>snapshot.poolAddress),managementPoolAddresses=productionManagementPoolAddresses(input.env,[...openPools]),driftPoolAddresses=[...new Set([input.cfg.smokePoolAddress,...managementPoolAddresses,...newEntryPoolAddresses])];
  const poolDrift:{poolAddress:string;status:Phase7DriftAssessment['status'];significant:boolean;deltas:Record<string,number>;sampleCount:number;reasonCodes:string[]}[]=[];
  let smokeLive:Awaited<ReturnType<typeof assessPhase7LiveDrift>>|undefined;
  for(const poolAddress of driftPoolAddresses){
    const liveDrift=await assessPhase7LiveDrift({store:input.store,poolAddress,since,observedAt:driftAt,baseline:input.driftBaseline,policy:defaultPhase7LiveDriftPolicy,...(decoderSkipRate!==undefined?{decoderSkipRate}:{})});
    poolDrift.push({poolAddress,status:liveDrift.assessment.status,significant:poolAddress===input.cfg.smokePoolAddress||capitalPools.has(poolAddress)||openPools.has(poolAddress),deltas:liveDrift.assessment.deltas,sampleCount:liveDrift.assessment.sampleCount,reasonCodes:liveDrift.assessment.reasonCodes});
    if(poolAddress===input.cfg.smokePoolAddress)smokeLive=liveDrift;
  }
  if(!smokeLive)throw new Error('LPFORGE_P7_DRIFT_SMOKE_POOL_MISSING');
  const rank=(status:Phase7DriftAssessment['status'])=>status==='BLOCK'?2:status==='WATCH'?1:0;
  const cappedDrift=poolDrift.map(p=>({...p,rawStatus:p.status,status:p.significant?p.status:(rank(p.status)>rank('WATCH')?'WATCH':p.status)}));
  const overallStatus=cappedDrift.reduce((worst,p)=>rank(p.status)>rank(worst)?p.status:worst,smokeLive.assessment.status);
  const drift:Phase7DriftAssessment={...smokeLive.assessment,status:overallStatus,reasonCodes:[...new Set([...smokeLive.assessment.reasonCodes,...cappedDrift.filter(p=>p.status!=='STABLE').map(p=>`P7_LIVE_DRIFT_POOL_${p.status}`)])].sort(),newEntriesAllowed:overallStatus!=='BLOCK'};
  await input.store.insertPhase7DriftAssessment({assessmentId:`${input.runtimeId}:${input.cycleKey}:drift`,policyHash:smokeLive.baselineHash,observedAt:driftAt,status:drift.status,sampleCount:drift.sampleCount,reasonCodes:drift.reasonCodes,deltas:drift.deltas,payload:{runtimeId:input.runtimeId,cycleKey:input.cycleKey,poolAddress:input.cfg.smokePoolAddress,current:smokeLive.current,coverage:{...smokeLive.coverage,decoderSkipTelemetry:decoderSkipRate!==undefined},probedPoolAddresses:driftPoolAddresses,poolDrift:cappedDrift.map(p=>({poolAddress:p.poolAddress,status:p.status,rawStatus:p.rawStatus,significant:p.significant,deltas:p.deltas,sampleCount:p.sampleCount,reasonCodes:p.reasonCodes})),operatorEventDecodeWarnings:Number.isFinite(telemetryWarnings)?telemetryWarnings:null,operatorDecodedSwapEvents:Number.isFinite(telemetrySwaps)?telemetrySwaps:null,operatorOutputBytes:Number.isFinite(telemetryBytes)?telemetryBytes:null,policyMutationAllowed:false,automaticPolicyPromotion:false}});
  const controlAt=new Date().toISOString(),approval=loadPhase7ManualApproval(input.env),existing=(await input.store.loadActivePhase7Incidents()).map(incidentFromRow),current=derivePhase7AutomaticIncidents({poolAddress:input.cfg.smokePoolAddress,observedAt:controlAt,health,drift}),updates=reconcilePhase7AutomaticIncidents({existing,current,observedAt:controlAt});
  for(const i of updates)await input.store.upsertPhase7IncidentState({incidentId:i.incidentId,incidentType:i.type,severity:i.severity,status:i.status,openedAt:i.openedAt,observedAt:controlAt,...(i.resolvedAt?{resolvedAt:i.resolvedAt}:{}),...(i.pool?{poolAddress:i.pool}:{}),...(i.token?{tokenMint:i.token}:{}),reasonCodes:i.reasonCodes,payload:{acknowledgedBy:i.acknowledgedBy??null,automatic:i.incidentId.startsWith('auto:')}});
  const decisionObservedAt=observations.find(observation=>observation.domain==='DECISION')?.observedAt;
  const active=updates.filter(i=>i.status!=='RESOLVED'),releaseIdentity=assessPhase7ReleaseIdentity({cwd:input.cwd,env:input.env,...(input.sourceCommit?{sourceCommit:input.sourceCommit}:{}),...(input.policyHash?{policyHash:input.policyHash}:{})}),portfolio=await assessLivePortfolioAuthority({store:input.store,cfg:input.cfg,env:input.env,now:controlAt}),freshAuthorization=await input.store.loadFreshPhase4EntryAuthorization(controlAt),watch=resolveControlledCanaryWatch({env:input.env,now:controlAt,...(freshAuthorization?{authorization:freshAuthorization}:{}),portfolio:{openPositions:portfolio.facts?.openPositions??Number.MAX_SAFE_INTEGER,pendingExecutionCount:portfolio.facts?.pendingExecutionCount??Number.MAX_SAFE_INTEGER,pendingReservedLamports:portfolio.facts?.pendingReservedLamports??1n,unresolvedReconciliationDebt:portfolio.facts?.unresolvedReconciliationDebt??Number.MAX_SAFE_INTEGER},...(decisionObservedAt?{decisionObservedAt}:{})}),probePools=watch.activate&&watch.authorization?[watch.authorization.poolAddress]:phase7BoundedDecisionHealthProbePoolAddresses({fallbackPoolAddress:decisionHealthPoolAddress,priorControlPayload,evaluationPoolAddresses:newEntryPoolAddresses}),nextDecisionHealthPoolAddress=phase7NextDecisionHealthPoolAddress({fallbackPoolAddress:decisionHealthPoolAddress,probePoolAddresses:probePools}),controlEnv:NodeJS.ProcessEnv=watch.activate&&watch.approval?{...input.env,LPFORGE_P7_MODE:'PRODUCTION',LPFORGE_P7_PRODUCTION_AUTHORITY:'true',LPFORGE_P7_SCALING_MODE:'DISABLED',LPFORGE_P7_PLAN_DISPATCH_ENABLED:'true',LPFORGE_P7_APPROVAL_ID:watch.approval.approvalId,LPFORGE_P7_APPROVAL_ACTION:watch.approval.action,LPFORGE_P7_APPROVED_BY:watch.approval.operatorId,LPFORGE_P7_APPROVAL_ISSUED_AT:watch.approval.issuedAt,LPFORGE_P7_APPROVAL_EXPIRES_AT:watch.approval.expiresAt,LPFORGE_P7_APPROVAL_REASON:watch.approval.reason}:input.env,authority=resolvePhase7Authority({config:loadPhase7ControlConfig(controlEnv),now:controlAt,...(watch.approval?{approval:watch.approval}:approval?{approval}:{})}),control=buildPhase7LiveControlDecision({authority,health,drift,incidents:active,releaseIdentity:{valid:releaseIdentity.valid&&portfolio.valid,reasonCodes:[...releaseIdentity.reasonCodes,...portfolio.reasonCodes]}});
  await input.store.insertPhase7ControlDecision({decisionId:`${input.runtimeId}:${input.cycleKey}:control`,runtimeId:input.runtimeId,cycleKey:input.cycleKey,observedAt:controlAt,authorityMode:control.authorityMode,healthStatus:control.healthStatus,driftStatus:control.driftStatus,safetyMode:control.safety.mode,daemonPlan:control.daemonPlan,newEconomicActionAllowed:control.newEconomicActionAllowed,reasonCodes:control.reasonCodes,payload:{poolAddress:input.cfg.smokePoolAddress,decisionHealthPoolAddress:nextDecisionHealthPoolAddress,decisionHealthProbePoolAddresses:probePools,healthSourcePoolAddress:decisionHealthPoolAddress,decisionHealthTargetPoolAddress:decisionHealthSource.targetPoolAddress,decisionHealthTargetVerified:decisionHealthSource.targetVerified,activeIncidentIds:active.map(i=>i.incidentId),operator:priorControlPayload.operator??null,releaseIdentity,portfolio,controlledCanaryRevokedApprovalIds:controlledCanaryRevokedApprovalIds(input.env),controlledCanaryWatch:{enabled:watch.enabled,activate:watch.activate,reasonCodes:watch.reasonCodes,...(watch.authorization?{entryEvaluationId:watch.authorization.entryEvaluationId,poolAddress:watch.authorization.poolAddress,expiresAt:watch.authorization.expiresAt}:{}),...(watch.approval?{approvalId:watch.approval.approvalId,approvalAction:watch.approval.action,approvalIssuedAt:watch.approval.issuedAt,approvalExpiresAt:watch.approval.expiresAt,approvalOperatorId:watch.approval.operatorId}:{})},poolDrift:cappedDrift.map(p=>({poolAddress:p.poolAddress,status:p.status,rawStatus:p.rawStatus,significant:p.significant}))}});
  let operator:Phase7OperatorProbe;let globalSelection:Awaited<ReturnType<typeof runProductionGlobalSelectionCycle>>;
  try{
    globalSelection=await runProductionGlobalSelectionCycle({store:input.store,cwd:input.cwd,env:{...controlEnv,LPFORGE_P7_PLAN_DISPATCH_ENABLED:'false'},cycleKey:input.cycleKey,eligiblePoolAddresses:newEntryPoolAddresses,selectionAdmissionSnapshots:newEntryAdmissionSnapshots,...(input.sourceCommit?{sourceCommit:input.sourceCommit}:{}),...(input.env.LPFORGE_BUILD_ID?{buildId:input.env.LPFORGE_BUILD_ID}:{})});
    const probes=[...globalSelection.probes];
    if(probes.length!==newEntryPoolAddresses.length||probes.some(probe=>!probe.operationalCycleComplete))throw new Error('LPFORGE_P7_GLOBAL_OPERATOR_CYCLE_INCOMPLETE');
    const winner=globalSelection.selection.winner;
    const entryDispatchDisabled=enabled(input.env.LPFORGE_GLOBAL_POOL_SELECTION_ENTRY_DISABLED);
    // The collection pass cannot create a plan. Only the durable canonical
    // global winner receives a second, candidate-identity-locked construction
    // pass; any changed winner fails closed in the operator.
    if(!entryDispatchDisabled&&winner?.candidateId&&control.newEconomicActionAllowed){
      const prepared=await runAutonomousDecisionProbe({cwd:input.cwd,env:{...controlEnv,LPFORGE_P7_PLAN_DISPATCH_ENABLED:'true',LPFORGE_GLOBAL_SELECTION_CYCLE_ID:globalSelection.globalCycleId,LPFORGE_GLOBAL_SELECTED_CANDIDATE_ID:winner.candidateId},poolAddress:winner.poolAddress});
      if(!prepared.operationalCycleComplete)throw new Error('LPFORGE_P7_GLOBAL_WINNER_PREPARE_INCOMPLETE');
      probes.push(prepared);
    }
    operator={exitCode:0,eventDecodeWarnings:probes.reduce((sum,probe)=>sum+probe.eventDecodeWarnings,0),transactionsScanned:probes.reduce((sum,probe)=>sum+probe.transactionsScanned,0),decodedSwapEvents:probes.reduce((sum,probe)=>sum+probe.decodedSwapEvents,0),operationalCycleComplete:true,outputBytes:probes.reduce((sum,probe)=>sum+probe.outputBytes,0),poolAddresses:probes.flatMap(probe=>probe.poolAddresses)};
  }
  catch(error){
    const operatorFailureReason=redactProbeFailureDetail(error instanceof Error?error.message:String(error));
    const failureAt=new Date().toISOString();const observations=await collectPhase7LiveHealthObservations({assessmentAt:failureAt,poolAddress:decisionHealthPoolAddress,rpc,dataApi,store:input.store});observations.push({domain:'DECISION',observedAt:failureAt,status:'CRITICAL',reasonCodes:['P7_LIVE_OPERATOR_CYCLE_FAILED']});const health=assessPhase7Health(observations,defaultPhase7HealthPolicy,failureAt);await input.store.insertPhase7HealthAssessment({assessmentId:`${input.runtimeId}:${input.cycleKey}:health:failure`,runtimeId:input.runtimeId,cycleKey:input.cycleKey,observedAt:failureAt,status:health.status,newEntriesAllowed:false,managementWritesAllowed:false,reasonCodes:health.reasonCodes,domainStatus:health.domainStatus,payload:{poolAddress:decisionHealthPoolAddress,observations,staleDomains:health.staleDomains,missingDomains:health.missingDomains,operatorFailure:true,operatorFailureReason}});
    const drift:Phase7DriftAssessment={status:'BLOCK',reasonCodes:['P7_DRIFT_OPERATOR_CYCLE_UNAVAILABLE'],observedAt:failureAt,sampleCount:0,newEntriesAllowed:false,managementAllowed:true,policyMutationAllowed:false,automaticPolicyPromotion:false,deltas:{}};await input.store.insertPhase7DriftAssessment({assessmentId:`${input.runtimeId}:${input.cycleKey}:drift:failure`,observedAt:failureAt,status:'BLOCK',sampleCount:0,reasonCodes:drift.reasonCodes,deltas:{},payload:{runtimeId:input.runtimeId,cycleKey:input.cycleKey,poolAddress:input.cfg.smokePoolAddress,operatorFailure:true,operatorFailureReason,policyMutationAllowed:false,automaticPolicyPromotion:false}});
    const approval=loadPhase7ManualApproval(input.env);const authority=resolvePhase7Authority({config:loadPhase7ControlConfig(input.env),now:failureAt,...(approval?{approval}:{})});const existing=(await input.store.loadActivePhase7Incidents()).map(incidentFromRow);const current=derivePhase7AutomaticIncidents({poolAddress:input.cfg.smokePoolAddress,observedAt:failureAt,health,drift});const updates=reconcilePhase7AutomaticIncidents({existing,current,observedAt:failureAt});for(const i of updates)await input.store.upsertPhase7IncidentState({incidentId:i.incidentId,incidentType:i.type,severity:i.severity,status:i.status,openedAt:i.openedAt,observedAt:failureAt,...(i.resolvedAt?{resolvedAt:i.resolvedAt}:{}),...(i.pool?{poolAddress:i.pool}:{}),...(i.token?{tokenMint:i.token}:{}),reasonCodes:i.reasonCodes,payload:{acknowledgedBy:i.acknowledgedBy??null,automatic:i.incidentId.startsWith('auto:')}});const active=updates.filter(i=>i.status!=='RESOLVED');const control=buildPhase7LiveControlDecision({authority,health,drift,incidents:active});await input.store.insertPhase7ControlDecision({decisionId:`${input.runtimeId}:${input.cycleKey}:control:failure`,runtimeId:input.runtimeId,cycleKey:input.cycleKey,observedAt:failureAt,authorityMode:control.authorityMode,healthStatus:control.healthStatus,driftStatus:control.driftStatus,safetyMode:control.safety.mode,daemonPlan:control.daemonPlan,newEconomicActionAllowed:false,reasonCodes:control.reasonCodes,payload:{poolAddress:input.cfg.smokePoolAddress,activeIncidentIds:active.map(i=>i.incidentId),operatorFailure:true,operatorFailureReason}});
    const runtime=await runPhase7RecoveryRuntimeTick({store:input.store,runtimeId:input.runtimeId,instanceId:input.instanceId,cycleKey:input.cycleKey,now:failureAt,leaseTtlMs:ttl,restarted:input.restarted,control:{authorityMode:control.authorityMode,healthStatus:'CRITICAL',newEconomicActionAllowed:false}});const evidence=await buildPhase7RuntimeEvidence({store:input.store,runtimeId:input.runtimeId,observedAt:failureAt,...(input.sourceCommit?{sourceCommit:input.sourceCommit}:{}),...(input.policyHash?{policyHash:input.policyHash}:{}),packId:`${input.runtimeId}:${input.cycleKey}:pack`});const implementationStatus=evidence.statuses.IMPLEMENTATION==='PASS'?'PASS':evidence.statuses.IMPLEMENTATION==='BLOCK'?'FAIL':'UNKNOWN';const operationalStatus=evidence.statuses.PRODUCTION==='PASS'?'PASS':evidence.statuses.PRODUCTION==='BLOCK'?'BLOCK':'HOLD';await input.store.insertPhase7EvidenceSnapshot({snapshotId:`${input.runtimeId}:${input.cycleKey}:snapshot`,runtimeId:input.runtimeId,cycleKey:input.cycleKey,observedAt:failureAt,implementationStatus,operationalStatus,payload:{statuses:evidence.statuses,facts:evidence.facts,reasonCodes:evidence.reasonCodes,operatorFailure:true,operatorFailureReason,operatorEventDecodeWarnings:Number.isFinite(telemetryWarnings)?telemetryWarnings:null,operatorDecodedSwapEvents:Number.isFinite(telemetrySwaps)?telemetrySwaps:null,operatorOutputBytes:Number.isFinite(telemetryBytes)?telemetryBytes:null}});if(evidence.pack)await input.store.insertPhase7EvidencePack({packHash:evidence.pack.packHash,packId:evidence.pack.packId,sourceCommit:evidence.pack.sourceCommit,policyHash:evidence.pack.policyHash,complete:evidence.pack.complete,operationalPass:evidence.pack.operationalPass,createdAt:evidence.pack.createdAt,payload:evidence.pack as unknown as Record<string,unknown>});return{runtimeId:input.runtimeId,instanceId:input.instanceId,cycleKey:input.cycleKey,observedAt:failureAt,operatorFailure:true,health,drift,control,runtime,evidence,directSigner:false,directTransactionSend:false,mainnetTransactionSent:false};
  }
  const runtime=await runPhase7RecoveryRuntimeTick({store:input.store,runtimeId:input.runtimeId,instanceId:input.instanceId,cycleKey:input.cycleKey,now:new Date().toISOString(),leaseTtlMs:ttl,restarted:input.restarted,control:{authorityMode:control.authorityMode,healthStatus:control.healthStatus,newEconomicActionAllowed:control.newEconomicActionAllowed}});
  const evidenceAt=new Date().toISOString();const evidence=await buildPhase7RuntimeEvidence({store:input.store,runtimeId:input.runtimeId,observedAt:evidenceAt,...(input.sourceCommit?{sourceCommit:input.sourceCommit}:{}),...(input.policyHash?{policyHash:input.policyHash}:{}),packId:`${input.runtimeId}:${input.cycleKey}:pack`});const implementationStatus=evidence.statuses.IMPLEMENTATION==='PASS'?'PASS':evidence.statuses.IMPLEMENTATION==='BLOCK'?'FAIL':'UNKNOWN';const operationalStatus=evidence.statuses.PRODUCTION==='PASS'?'PASS':evidence.statuses.PRODUCTION==='BLOCK'?'BLOCK':'HOLD';await input.store.insertPhase7EvidenceSnapshot({snapshotId:`${input.runtimeId}:${input.cycleKey}:snapshot`,runtimeId:input.runtimeId,cycleKey:input.cycleKey,observedAt:evidenceAt,implementationStatus,operationalStatus,payload:{statuses:evidence.statuses,facts:evidence.facts,reasonCodes:evidence.reasonCodes,packHash:evidence.pack?.packHash??null,operatorEventDecodeWarnings:operator.eventDecodeWarnings,operatorDecodedSwapEvents:operator.decodedSwapEvents,operatorOutputBytes:operator.outputBytes,probedPoolAddresses:operator.poolAddresses,productionGlobalSelection:globalSelection?{globalCycleId:globalSelection.globalCycleId,outcome:globalSelection.selection.outcome,winnerPoolAddress:globalSelection.selection.winner?.poolAddress??null,eligiblePoolCount:globalSelection.ordered.length,evaluatedPoolCount:globalSelection.probes.length,concurrency:globalSelection.concurrency}:null}});if(evidence.pack)await input.store.insertPhase7EvidencePack({packHash:evidence.pack.packHash,packId:evidence.pack.packId,sourceCommit:evidence.pack.sourceCommit,policyHash:evidence.pack.policyHash,complete:evidence.pack.complete,operationalPass:evidence.pack.operationalPass,createdAt:evidence.pack.createdAt,payload:evidence.pack as unknown as Record<string,unknown>});return{runtimeId:input.runtimeId,instanceId:input.instanceId,cycleKey:input.cycleKey,observedAt:evidenceAt,operator,health,drift,control,runtime,evidence,...(globalSelection?{globalSelection:{globalCycleId:globalSelection.globalCycleId,outcome:globalSelection.selection.outcome,...(globalSelection.selection.winner?{winnerPoolAddress:globalSelection.selection.winner.poolAddress}:{}),eligiblePoolCount:globalSelection.ordered.length,evaluatedPoolCount:globalSelection.probes.length,concurrency:globalSelection.concurrency}}:{}),directSigner:false,directTransactionSend:false,mainnetTransactionSent:false};
}
export async function loadPhase7ProductionStatus(input:{store:Pick<Phase1Store,'loadLatestPhase7HealthAssessment'|'loadLatestPhase7DriftAssessment'|'loadLatestPhase7ControlDecision'|'loadRecentPhase7RuntimeCycles'|'loadLatestPhase7EvidenceSnapshot'>;runtimeId:string}){const [health,drift,control,runtime,evidence]=await Promise.all([input.store.loadLatestPhase7HealthAssessment(input.runtimeId),input.store.loadLatestPhase7DriftAssessment(),input.store.loadLatestPhase7ControlDecision(input.runtimeId),input.store.loadRecentPhase7RuntimeCycles(input.runtimeId,1),input.store.loadLatestPhase7EvidenceSnapshot(input.runtimeId)]);return{runtimeId:input.runtimeId,health,drift,control,runtime:runtime[0],evidence,directSigner:false,directTransactionSend:false};}
