import { createPostgresStore } from '../../../packages/db/src/index.js';
import { persistPaperManagementCycleEvidence, runPaperManagementCycle, type PaperManagementCycleInput } from '../../../packages/paper-management/src/index.js';
const now='2026-08-12T10:15:00Z';
const position={id:'paper-fixture-1',pool:'fixture-pool',token:'fixture-token',thesisId:'fixture-thesis',candidateId:'fixture-candidate',state:'IN_RANGE' as const,capital:1,lowerBinId:90,upperBinId:110,openedAt:'2026-08-12T10:00:00Z',currentActiveBinId:100,tokenXValue:.75,tokenYValue:.22,feesValue:.04,rewardsValue:0,costsValue:.005,paperOnly:true as const,version:4};
const input:PaperManagementCycleInput={position,observedAt:now,activeBinId:103,thesisStatus:'VALID',riskFacts:{now,protocolCompatible:true,criticalDataObservedAt:'2026-08-12T10:14:30Z',dailyDrawdownFraction:.01,rollingDrawdownFraction:.02,tokenExposureFraction:.08,poolExposureFraction:.06,referenceDivergenceBps:30,liquidityChangeFraction:0},currentForwardEv:.008,actionForecasts:[{action:'HOLD',grossForwardValue:.008,implementationCost:0,tailRiskCharge:.001,uncertainty:.2,feasibility:1},{action:'RESHAPE',grossForwardValue:.012,implementationCost:.003,tailRiskCharge:.001,uncertainty:.25,feasibility:.9},{action:'CLOSE_TO_NUMERAIRE',grossForwardValue:0,implementationCost:.001,tailRiskCharge:0,uncertainty:0,feasibility:1}],expectedReturnProbability:.9,expectedReturnMinutes:0,binVelocityPerMinute:.5,regimeDanger:.1,volatileTokenValue:.22,numeraireValue:.75,maxAdverseTokenValue:.35,feeVelocityBeforeOor:.01,rebalanceCost:.002,closeCost:.001,drawdownFraction:.01};
const result=runPaperManagementCycle(input);
const cmd=process.argv[2]??'fixture-once';
if(cmd==='fixture-once')console.log(JSON.stringify(result,null,2));
else if(cmd==='fixture-once-persist'){
 const url=process.env.DATABASE_URL;if(!url)throw new Error('DATABASE_URL required for fixture-once-persist');
 const store=await createPostgresStore(url);
 try{
  await store.upsertPool({address:position.pool,tokenXMint:'fixture-token-x',tokenYMint:'fixture-token-y',binStep:10,functionType:'LIQUIDITY_MINING',collectFeeMode:'INPUT_ONLY',activeBinId:input.activeBinId,stamp:{source:'FIXTURE',observedAt:now}});
  await persistPaperManagementCycleEvidence(store,input,result);
 }finally{await store.close();}
 console.log(JSON.stringify({...result,persisted:true},null,2));
}else{console.error('usage: paper fixture-once|fixture-once-persist');process.exitCode=2;}
