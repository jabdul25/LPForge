import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildTelemetryManifestEntry,
  planPostEntryTelemetryCheckpoint,
  postEntryTelemetryEpisodeId,
  telemetryContentHash,
  telemetryHeaderHash,
  verifyTelemetryManifestChain,
} from '../.build/packages/post-entry-telemetry/src/index.js';

const start='2026-08-25T00:00:00.000Z';
const at=minute=>new Date(Date.parse(start)+minute*60_000).toISOString();
const candidate={id:'telemetry-candidate',family:'BASE',lowerBinId:100,upperBinId:100,centerBinId:100,widthBins:1,lowerOffsetBins:0,upperOffsetBins:0,lowerDistancePct:0,upperDistancePct:0,strategy:'CURVE',orientation:'BALANCED',capitalFraction:1,perBinWeights:[{binId:100,weight:1}],reasonCodes:[]};
const decision={recommendationId:'telemetry-rec',decisionId:'phase3-forward:telemetry-rec',poolAddress:'pool-telemetry',decisionTimestamp:start,sourceSha:'a'.repeat(40),buildId:'b'.repeat(64),policyHash:'c'.repeat(64),migrationHead:'M0049_post_entry_state_telemetry.sql',capitalLamports:'30000000',phase3State:'QUALIFIED',phase3Outcome:'ENTRY_READY',reasonCodes:[],prediction:{rawUnitValueX:.000001,rawUnitValueY:.000001,expectedExecutionCost:.00001,expectedRepositionCost:.00001,expectedTailRiskCost:.00001},evidenceProvenance:{},selectedCandidate:candidate,selectedCandidateKind:'RANKING_WINNER',wouldAugEraThesisSemanticsHaveCreatedThesis:true,phase4:{result:'ENTRY_READY',readinessScore:.8,timingConfidence:.15,reasonCodes:[],diagnostics:{}}};
const frame=minute=>({observedAt:at(minute),activeBinId:100,bins:[{binId:100,price:'1',amountX:'1000000000000',amountY:'0',liquiditySupply:'1000000000000000000'}]});
const header={provenance:{tokenXMint:'X',tokenYMint:'Y',tokenXDecimals:6,tokenYDecimals:9},valuationContract:{version:'frozen-v1'}};
const task=(overrides={})=>({telemetryEpisodeId:postEntryTelemetryEpisodeId(decision.recommendationId),checkpointKey:'DECISION',observationType:'ENTRY',targetAt:start,decisionAt:start,sourceVersion:decision.sourceSha,frozenHeader:header,decisionPayload:decision,...overrides});

test('telemetry episode and manifest are deterministic, ordered, and tamper evident',async()=>{
  const episode=postEntryTelemetryEpisodeId('rec-1');
  assert.equal(episode,'post-entry-v2:rec-1');
  const headerHash=await telemetryHeaderHash({episode,decisionAt:start});
  const contentHash=await telemetryContentHash({raw:'fact'});
  const one=await buildTelemetryManifestEntry({telemetryEpisodeId:episode,sequenceNumber:1,observationId:'obs-1',observationType:'ENTRY',observedAt:start,capturedAt:start,sourceVersion:'a'.repeat(40),collectorVersion:'test',contentHash,previousHash:headerHash,captureStatus:'OBSERVED'});
  const two=await buildTelemetryManifestEntry({telemetryEpisodeId:episode,sequenceNumber:2,observationId:'obs-2',observationType:'CHECKPOINT',observedAt:at(1),capturedAt:at(1),sourceVersion:'a'.repeat(40),collectorVersion:'test',contentHash,previousHash:one.currentHash,captureStatus:'OBSERVED'});
  assert.equal(await verifyTelemetryManifestChain({headerHash,entries:[one,two]}),true);
  assert.equal(await verifyTelemetryManifestChain({headerHash,entries:[{...two,previousHash:headerHash}]}),false);
});

test('missing checkpoints defer briefly then fail closed without interpolation',()=>{
  const history={marketObservations:[],binFrames:[],swapEvents:[]};
  const deferred=planPostEntryTelemetryCheckpoint({task:task({checkpointKey:'M1',observationType:'CHECKPOINT',targetAt:at(1),decisionCheckpointContent:{market:{frame:frame(0)}}}),history,capturedAt:at(2)});
  assert.equal(deferred.defer,true);
  const unavailable=planPostEntryTelemetryCheckpoint({task:task({checkpointKey:'M1',observationType:'CHECKPOINT',targetAt:at(1),decisionCheckpointContent:{market:{frame:frame(0)}}}),history,capturedAt:at(4)});
  assert.equal(unavailable.status,'SOURCE_UNAVAILABLE');
  assert.equal(unavailable.content.checkpoint.noInterpolation,true);
});

test('raw lifecycle checkpoint contains market, range, inventory, fees, frozen costs, and no research conclusion',()=>{
  const history={marketObservations:[{observedAt:at(1),price:1,activeBinId:100,resolutionMs:60_000}],binFrames:[frame(0),frame(1)],swapEvents:[{signature:'swap',eventIndex:0,pool:'pool-telemetry',startBinId:100,endBinId:100,mmFee:'100000',feesOnTokenX:true,stamp:{source:'FIXTURE',observedAt:at(1)},raw:{}}]};
  const plan=planPostEntryTelemetryCheckpoint({task:task({checkpointKey:'M1',observationType:'CHECKPOINT',targetAt:at(1),decisionCheckpointContent:{market:{frame:frame(0)}}}),history,capturedAt:at(1)});
  assert.equal(plan.defer,false);
  assert.equal(plan.status,'OBSERVED');
  assert.equal(plan.content.range.inRange,true);
  assert.equal(plan.content.inventory.tokenXRaw !== undefined,true);
  assert.equal(plan.content.fees.cumulativeAttributedFeeXRaw !== undefined,true);
  assert.ok(Math.abs(plan.content.economics.frozenCosts.total-.00003)<1e-12);
  assert.doesNotMatch(JSON.stringify(plan.content),/HEALTHY|STRESSED|RECOVERING|FAILED|GOOD|BAD/);
});

test('unavailable frozen position is explicitly recorded for every population state',()=>{
  const noCandidate={...decision,selectedCandidate:undefined,selectedCandidateKind:'NONE'};
  const plan=planPostEntryTelemetryCheckpoint({task:task({decisionPayload:noCandidate}),history:{marketObservations:[],binFrames:[frame(0)],swapEvents:[]},capturedAt:start});
  assert.equal(plan.status,'OBSERVED');
  assert.equal(plan.reasonCodes.includes('FROZEN_POSITION_UNAVAILABLE'),true);
});

test('schema is append-only and the recorder remains isolated from trading packages',async()=>{
  const migration=await readFile('packages/db/migrations/M0049_post_entry_state_telemetry.sql','utf8');
  for(const table of ['research.post_entry_telemetry_episodes','research.post_entry_telemetry_observations','research.telemetry_manifest','research.post_entry_telemetry_capture_audit'])assert.match(migration,new RegExp(table.replace('.','\\.')));
  assert.match(migration,/BEFORE UPDATE OR DELETE/);
  assert.match(migration,/REVOKE UPDATE, DELETE/);
  const db=await readFile('packages/db/src/index.ts','utf8');
  assert.match(db,/FOR UPDATE/);
  assert.match(db,/DUPLICATE_REJECTED/);
  assert.match(db,/INTEGRITY_CONFLICT/);
  for(const source of ['packages/opportunity/src/index.ts','packages/candidate-ranking/src/index.ts','packages/thesis/src/index.ts','packages/entry-intelligence/src/index.ts','apps/execution/src/main.ts','apps/production/src/main.ts','apps/discovery/src/main.ts'])assert.doesNotMatch(await readFile(source,'utf8'),/post-entry-telemetry/);
});
