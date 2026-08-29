import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2,
  buildCapitalContract, buildCapitalEvaluationIdentity, buildCanonicalEvidenceManifest, buildCanonicalForwardReplayContract, buildPositionContract,
  deriveMaximumFeasibleCapital, evaluateCapitalFeasibility, freezePhase3ForwardDecision, lamportsToDisplaySol,
  matureFrozenPhase3ForwardOutcome, phase3ForwardOutcomeResultHash, replayCanonicalForwardContract, solToLamports,
} from '../.build/packages/phase3-forward-validation/src/index.js';

const start='2026-08-27T00:00:00.000Z';
const at=(m)=>new Date(Date.parse(start)+m*60_000).toISOString();
const artifact={sourceSha:'a'.repeat(40),buildId:'b'.repeat(64),policyHash:'c'.repeat(64),migrationHead:'M0053_variable_capital_foundation.sql'};
const candidate=(id='candidate-a',fraction=1)=>({id,family:'BASE',lowerBinId:100,upperBinId:101,centerBinId:100,widthBins:2,lowerOffsetBins:-1,upperOffsetBins:1,lowerDistancePct:0,upperDistancePct:0,strategy:'CURVE',orientation:'BALANCED',capitalFraction:fraction,perBinWeights:[{binId:100,weight:.5},{binId:101,weight:.5}],reasonCodes:[]});
function decision(id='vc'){
 const selectedCandidate=candidate();
 const rec={recommendationId:id,phase:'P3',recommendationOnly:true,decisionAt:start,expiresAt:at(5),pool:'pool-vc',state:'WATCHING',noTrade:true,marketContextHash:'ctx',regime:{transitionRisk:.2},economics:{expectedFeeValue:0,expectedInventoryPnl:0,expectedExecutionCost:0,expectedRepositionCost:0,expectedTailRiskCharge:0,expectedNetLpValue:0,expectedActiveTimeRatio:1,forecastUncertainty:.1,evidenceFidelity:'EVENT_PATH_ESTIMATE'},candidateCount:1,simulations:[],ranking:{winner:'NO_TRADE',rankings:[],reasonCodes:[]},forwardValidation:{version:'phase3-forward-decision-v1',horizonMinutes:30,capitalValue:.03,capitalLamports:'30000000',activeBinIdAtDecision:100,rawUnitValueX:.000001,rawUnitValueY:.000001,costs:{compositionFeeValue:'0',transactionFeeValue:'0',slippageValue:'0',rebalanceCostValue:'0',otherCostValue:'0'},selectedCandidateKind:'TOP_RANKED_COUNTERFACTUAL',selectedCandidate,evidence:{replayAnchorAt:start,replayEvidenceWatermark:start,historicalFrameHash:'frame',historicalEventHash:'event'},wouldAugEraThesisSemanticsHaveCreatedThesis:true},reasonCodes:[]};
 return freezePhase3ForwardDecision({recommendation:rec,artifact});
}
const frame=(m)=>({observedAt:at(m),activeBinId:100,bins:[{binId:100,price:'1',amountX:'1000000000',amountY:'0',liquiditySupply:'1000000000000000000'},{binId:101,price:'1',amountX:'1000000000',amountY:'0',liquiditySupply:'1000000000000000000'}]});

test('capital conversion and contract identity are exact',async()=>{
 assert.equal(solToLamports('0.03'),30000000n); assert.equal(lamportsToDisplaySol(1000000001n),'1.000000001'); assert.throws(()=>solToLamports('0.0000000001'));
 const a=await buildCapitalContract({proposedCapitalLamports:30000000n,candidateCapitalFraction:1}), b=await buildCapitalContract({proposedCapitalLamports:500000000n,candidateCapitalFraction:1}), h=await buildCapitalContract({proposedCapitalLamports:30000000n,candidateCapitalFraction:.5});
 assert.notEqual(a.capitalContractHash,b.capitalContractHash); assert.equal(h.allocatedCapitalLamports,'15000000');
 const d=decision('identity'), p=await buildPositionContract({decision:d,candidate:d.selectedCandidate,baseline:frame(0),capitalContract:a}), changed=await buildPositionContract({decision:{...d,prediction:{...d.prediction,rawUnitValueX:.000002}},candidate:d.selectedCandidate,baseline:frame(0),capitalContract:a});
 assert.notEqual(p.positionContractHash,changed.positionContractHash);
 const observed=await buildCapitalEvaluationIdentity({decision:d,candidate:d.selectedCandidate,capitalContract:a,positionContract:p,modelVersion:'phase3-forward-outcome-v2',formulaVersion:'capital-constrained-forward-v2',namespace:'OBSERVED_CANONICAL'}), counterfactual=await buildCapitalEvaluationIdentity({decision:d,candidate:d.selectedCandidate,capitalContract:a,positionContract:p,modelVersion:'phase3-forward-outcome-v2',formulaVersion:'capital-constrained-forward-v2',namespace:'COUNTERFACTUAL_CANONICAL'}), larger=await buildCapitalEvaluationIdentity({decision:d,candidate:d.selectedCandidate,capitalContract:b,positionContract:p,modelVersion:'phase3-forward-outcome-v2',formulaVersion:'capital-constrained-forward-v2',namespace:'OBSERVED_CANONICAL'}); assert.notEqual(observed.capitalEvaluationId,counterfactual.capitalEvaluationId); assert.notEqual(observed.capitalEvaluationId,larger.capitalEvaluationId);
});

test('manifest ordering and V2 replay are deterministic',async()=>{
 const d=decision('manifest'), events=[{signature:'b',eventIndex:0,pool:'pool-vc',startBinId:100,endBinId:100,mmFee:'0',feesOnTokenX:true,stamp:{source:'FIXTURE',observedAt:at(2)},raw:{}},{signature:'a',eventIndex:0,pool:'pool-vc',startBinId:100,endBinId:100,mmFee:'0',feesOnTokenX:true,stamp:{source:'FIXTURE',observedAt:at(1)},raw:{}}];
 const x=await buildCanonicalEvidenceManifest({decision:d,horizonMinutes:30,baseline:frame(0),futureFrames:[frame(2),frame(1)],futureEvents:events}), y=await buildCanonicalEvidenceManifest({decision:d,horizonMinutes:30,baseline:frame(0),futureFrames:[frame(1),frame(2)],futureEvents:[...events].reverse()});
 assert.equal(x.evidenceManifestHash,y.evidenceManifestHash);
 const frames=Array.from({length:31},(_,i)=>frame(i));
 const first=await matureFrozenPhase3ForwardOutcome({decision:d,horizonMinutes:30,outcomeModelVersion:PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2,frames,events:[],now:at(31)}), second=await matureFrozenPhase3ForwardOutcome({decision:d,horizonMinutes:30,outcomeModelVersion:PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2,frames:[...frames].reverse(),events:[],now:at(31)});
 assert.equal(first.state,'FINAL'); assert.equal(first.evidenceHash,second.evidenceHash); assert.equal(first.replayContract.canonicalInputSnapshotHash,second.replayContract.canonicalInputSnapshotHash); assert.equal(await phase3ForwardOutcomeResultHash(first),await phase3ForwardOutcomeResultHash(second));
 const replayed=await replayCanonicalForwardContract(first.replayContract); assert.equal(await phase3ForwardOutcomeResultHash(replayed),await phase3ForwardOutcomeResultHash(first)); assert.equal(replayed.realized.realizedInventoryPnl,first.realized.realizedInventoryPnl);
 const c=await buildCanonicalForwardReplayContract({decision:d,horizonMinutes:30,outcomeModelVersion:PHASE3_FORWARD_OUTCOME_MODEL_VERSION_V2,baseline:frame(0),futureFrames:[frame(1)],futureEvents:[]}); assert.equal(c.namespace,'OBSERVED_CANONICAL');
});

test('feasibility recomputes ownership and fails closed',async()=>{
 const d=decision('capacity'), selected=d.selectedCandidate, base=frame(0);
 for(const c of [10000000n,30000000n,100000000n]){const r=await evaluateCapitalFeasibility({decision:d,candidate:selected,baseline:base,proposedCapitalLamports:c}); assert.equal(r.status,'FEASIBLE_PRICE_TAKING'); assert.ok(r.maxOwnershipBps<=500);}
 const half=await evaluateCapitalFeasibility({decision:d,candidate:{...selected,capitalFraction:.5},baseline:base,proposedCapitalLamports:30000000n}); assert.equal(half.allocatedCapitalLamports,'15000000');
 const large=await evaluateCapitalFeasibility({decision:d,candidate:selected,baseline:base,proposedCapitalLamports:500000000n}); assert.equal(large.status,'OWNERSHIP_LIMIT');
 const x=await evaluateCapitalFeasibility({decision:d,candidate:selected,baseline:base,proposedCapitalLamports:30000000n,tokenOrientation:'WSOL_AS_X'}); assert.equal(x.status,'UNSUPPORTED_ORIENTATION');
 const maximum=await deriveMaximumFeasibleCapital({decision:d,candidate:selected,baseline:base}); assert.ok(maximum.maximumFeasibleCapitalLamports); const atMax=await evaluateCapitalFeasibility({decision:d,candidate:selected,baseline:base,proposedCapitalLamports:BigInt(maximum.maximumFeasibleCapitalLamports)}); assert.equal(atMax.status,'FEASIBLE_PRICE_TAKING');
});
