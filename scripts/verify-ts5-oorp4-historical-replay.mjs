/**
 * Read-only historical regression for the research-selected TS-5 Model-C +
 * OOR-P4 contract. It deliberately invokes the built production evaluator;
 * no duplicated policy implementation, signer, RPC, or database write exists
 * in this verifier.
 */
import pg from 'pg';
import { assessProfitRetentionProtection } from '../.build/packages/live-exit-governor/src/index.js';

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl)throw new Error('DATABASE_URL_REQUIRED');
const { Pool }=pg;
const db=new Pool({connectionString:databaseUrl});
const BCHK='BcHk2btyymBVz8W5Yk2pMhCpz23ZvAV8k2MzvUgqL2J1';
const TARGET_7FH='7fhXb33ogYqTvUYhfVud9iPrTt61ffWHFaaj8j2cj4Dy';
const TARGET_5KB='5KbExq56KYYvBD2dzmH4cZA2ngQpnrHKbBuQdQHmLDJ2';
const policy={enabled:true,policyVersion:'profit-retention-ts5-oor-p4-v1',ts5:{enabled:true,mfeActivationFraction:.04,givebackFraction:.02,watchSeconds:300,lowerRangeFraction:1/3,model:'EXPIRE_REARM',previousUsableMaxAgeSeconds:300},oorP4:{enabled:true,mfeActivationFraction:.02,requiresBelowMin:true,requiresTokenExposure:true}};
const get=(v,path)=>path.split('.').reduce((x,k)=>x==null?undefined:x[k],v);
const n=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const find=(v,keys)=>{if(!v||typeof v!=='object')return undefined;for(const [k,x] of Object.entries(v)){if(keys.includes(k)&&x!=null)return x;if(x&&typeof x==='object'){const found=find(x,keys);if(found!=null)return found;}}return undefined;};
const near=(actual,expected,tolerance=1e-8)=>Math.abs(actual-expected)<=tolerance;
try {
  const [outcomes,observations]=await Promise.all([
    db.query(`WITH latest AS (SELECT DISTINCT ON (lifecycle_id) lifecycle_id,position_address FROM execution.lifecycle_sol_settlements ORDER BY lifecycle_id,settlement_version DESC), current AS (SELECT o.* FROM research.live_learning_outcomes o WHERE o.lifecycle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM research.live_learning_outcome_supersessions s WHERE s.predecessor_outcome_id=o.outcome_id)) SELECT l.position_address,o.entry_at,o.exit_at,o.realized_return_fraction FROM latest l JOIN current o USING(lifecycle_id) ORDER BY o.exit_at`),
    db.query(`SELECT lpforge_position_id,observed_at,active_bin_id,range_state,position_truth,management_context,payload FROM execution.position_observations ORDER BY lpforge_position_id,observed_at`),
  ]);
  const raw=new Map();
  for(const row of observations.rows){const id=String(row.lpforge_position_id).replace(/^position-/,'');const rows=raw.get(id)??[];rows.push(row);raw.set(id,rows);}
  const usable=(outcome)=>{
    const start=Date.parse(outcome.entry_at),end=Date.parse(outcome.exit_at)+120000,byTime=new Map();
    for(const row of raw.get(outcome.position_address)??[]){
      const time=Date.parse(row.observed_at); if(time<start||time>end)continue;
      const economics=get(row.management_context,'exitDecision.economics'),currentReturn=n(economics?.netReturnFraction),activePlans=row.payload?.activePlans??row.management_context?.activePlans??[];
      if(economics?.evidenceState!=='AVAILABLE'||currentReturn==null||currentReturn< -1.25||currentReturn>2||activePlans.length||get(row.management_context,'exitDecision.matchingPoolContext')===false||(outcome.position_address===BCHK&&currentReturn>.1))continue;
      const oor=get(row.payload,'oorLifecycle')??get(row.management_context,'oor')??{};
      byTime.set(time,{time,currentReturn,rangeState:row.range_state,activeBin:n(row.active_bin_id),lowerBin:n(find(row.position_truth,['lowerBinId','lower_bin_id','lowerBin'])),upperBin:n(find(row.position_truth,['upperBinId','upper_bin_id','upperBin'])),below:oor.direction==='BELOW_MIN',inventory:oor.inventoryClassification??'INVENTORY_UNAVAILABLE'});
    }
    return [...byTime.values()].sort((a,b)=>a.time-b.time);
  };
  const replay=outcome=>{
    const series=usable(outcome),gaps=series.slice(1).map((point,index)=>point.time-series[index].time),maxGap=gaps.length?Math.max(...gaps):Infinity;
    const quality=series.length<20?'C':maxGap<=300000&&outcome.position_address!==BCHK?'A':'B';
    if(quality==='C')return{quality,actual:Number(outcome.realized_return_fraction),outcome:Number(outcome.realized_return_fraction),trigger:null};
    let watch,peak=-Infinity,peakAt,previous;
    for(const point of series){
      if(point.currentReturn>peak){peak=point.currentReturn;peakAt=point.time;}
      const previousUsable=previous&&point.time-previous.time<=300000?{observedAt:new Date(previous.time).toISOString(),managedReturnFraction:previous.currentReturn,fresh:true,poolAddress:'historical'}:undefined;
      const rangeState=point.rangeState==='IN_RANGE'?'IN_RANGE':point.below?'BELOW_MIN':'ABOVE_MAX';
      const assessment=assessProfitRetentionProtection({policy,observedAt:new Date(point.time).toISOString(),priorWatch:watch,economics:{evidenceState:'AVAILABLE',observedAt:new Date(point.time).toISOString(),netReturnFraction:point.currentReturn,reasonCodes:[]},highWater:{peakNetReturnFraction:peak,peakObservedAt:new Date(peakAt).toISOString()},currentFactsFresh:true,reconciliationClean:true,noActiveManagementPlan:true,poolAddress:'historical',rangeState,activeBinId:point.activeBin??undefined,lowerBinId:point.lowerBin??undefined,upperBinId:point.upperBin??undefined,inventoryClassification:point.inventory,previousUsable});
      watch=assessment.watch;
      if(assessment.kind==='TS5_PROTECTION_CONFIRMED'||assessment.kind==='OOR_P4_PROTECTION_CONFIRMED')return{quality,actual:Number(outcome.realized_return_fraction),outcome:point.currentReturn,trigger:{kind:assessment.kind,at:new Date(point.time).toISOString(),mark:point.currentReturn}};
      previous=point;
    }
    return{quality,actual:Number(outcome.realized_return_fraction),outcome:Number(outcome.realized_return_fraction),trigger:null};
  };
  const rows=outcomes.rows.map(outcome=>({position:outcome.position_address,...replay(outcome)})),eligible=rows.filter(row=>row.quality!=='C'),mean=eligible.reduce((total,row)=>total+row.outcome,0)/eligible.length;
  const layer1=eligible.filter(row=>row.trigger?.kind==='TS5_PROTECTION_CONFIRMED'),layer2=eligible.filter(row=>row.trigger?.kind==='OOR_P4_PROTECTION_CONFIRMED'),seven=rows.find(row=>row.position===TARGET_7FH),five=rows.find(row=>row.position===TARGET_5KB),winnerLayer1=layer1.filter(row=>row.actual>0);
  if(eligible.length!==32||layer1.length!==2||layer2.length!==3||winnerLayer1.length!==0||seven?.trigger?.at!=='2026-09-07T12:24:24.000Z'||!near(seven.trigger.mark,-.00942214952915838)||five?.trigger?.at!=='2026-09-09T23:14:30.000Z'||!near(five.trigger.mark,.004102932712575769)||!near(mean,.012558387653030691,1e-7))throw new Error(`TS5_OORP4_HISTORICAL_REPLAY_MISMATCH:${JSON.stringify({eligible:eligible.length,layer1:layer1.map(row=>row.position),layer2:layer2.map(row=>row.position),mean,seven:seven?.trigger,five:five?.trigger,winnerLayer1:winnerLayer1.map(row=>row.position)})}`);
  console.log(JSON.stringify({status:'PASS',eligible:eligible.length,mean,layer1:layer1.map(row=>({position:row.position,...row.trigger})),layer2:layer2.map(row=>({position:row.position,...row.trigger})),terminalWinnerLayer1:winnerLayer1.length},null,2));
} finally { await db.end(); }
