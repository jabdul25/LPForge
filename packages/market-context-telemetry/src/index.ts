import { canonicalJson, sha256Hex } from '../../domain/src/index.js';
import type { FrozenPhase3ForwardDecision } from '../../phase3-forward-validation/src/index.js';

export const MARKET_CONTEXT_TELEMETRY_SCHEMA_VERSION='m0050-prospective-market-context-v1';
export const MARKET_CONTEXT_TELEMETRY_MODEL_VERSION='phase3-decision-market-context-capture-v1';
export const MARKET_CONTEXT_TELEMETRY_COLLECTOR_VERSION='market-context-telemetry-recorder-v1';
export const MARKET_CONTEXT_TELEMETRY_ACTIVATION_ID='m0050-prospective-market-context-telemetry-v1';

export type MarketContextCaptureStatus=
  |'OBSERVED'
  |'PARTIAL'
  |'SOURCE_UNAVAILABLE'
  |'SOURCE_STALE'
  |'SOURCE_TIMESTAMP_UNVERIFIED'
  |'DUPLICATE_REJECTED'
  |'INTEGRITY_CONFLICT'
  |'PRE_ACTIVATION_NOT_APPLICABLE';

export type MarketContextFactLayer='RAW_FACT'|'DERIVED_INTERPRETATION';

export interface NormalizedMarketContextFact {
  key:string;
  layer:MarketContextFactLayer;
  value:unknown;
  unit:string;
  sourceIdentity:string;
  sourceVersion:string;
  availabilityStatus:MarketContextCaptureStatus;
  sourceObservedAt?:string;
  sourceAgeMs?:number;
  sourceWindow?:string;
}

export interface MarketContextSnapshotPlan {
  telemetryEpisodeId:string;
  recommendationId:string;
  poolAddress:string;
  decisionAt:string;
  captureStatus:MarketContextCaptureStatus;
  reasonCodes:string[];
  availability:Record<string,MarketContextCaptureStatus>;
  rawPayload:Record<string,unknown>;
  derivedInterpretation:Record<string,unknown>;
  provenance:Record<string,unknown>;
  facts:NormalizedMarketContextFact[];
}

type ObjectRecord=Record<string,unknown>;
const object=(value:unknown):ObjectRecord=>value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectRecord:{};
const timestamp=(value:unknown):number|undefined=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):undefined;
const copy=<T>(value:T):T=>JSON.parse(canonicalJson(value)) as T;
const statusAvailability=(value:unknown):MarketContextCaptureStatus=>Object.keys(object(value)).length?'OBSERVED':'SOURCE_UNAVAILABLE';

function unitFor(key:string):string {
  if(/returnPct|drawdownPct|priceRangePct|localLiquidityChangePct/i.test(key))return'percent';
  if(/realizedVolatility|confidence|stability|risk|score|probability|ratio|efficiency|completeness|skew|fraction|quality|toxicity/i.test(key))return'ratio';
  if(/bin|swaps|samples|count|observations|reversals/i.test(key))return'count';
  if(/volume|fee|liquidity|tvl|price|amount/i.test(key))return'native';
  if(/velocity/i.test(key))return'per_minute';
  return'unitless';
}

function primitiveFacts(input:{
  prefix:string;
  value:unknown;
  layer:MarketContextFactLayer;
  sourceIdentity:string;
  sourceVersion:string;
  availabilityStatus:MarketContextCaptureStatus;
  sourceObservedAt?:string;
  sourceAgeMs?:number;
  sourceWindow?:string;
}, depth=0):NormalizedMarketContextFact[] {
  if(depth>5)return[];
  if(input.value===null||typeof input.value==='string'||typeof input.value==='number'||typeof input.value==='boolean'){
    return[{key:input.prefix,layer:input.layer,value:input.value,unit:unitFor(input.prefix),sourceIdentity:input.sourceIdentity,sourceVersion:input.sourceVersion,availabilityStatus:input.availabilityStatus,...(input.sourceObservedAt?{sourceObservedAt:input.sourceObservedAt}:{}),...(input.sourceAgeMs!==undefined?{sourceAgeMs:input.sourceAgeMs}:{}),...(input.sourceWindow?{sourceWindow:input.sourceWindow}:{})}];
  }
  if(Array.isArray(input.value)){
    return input.value.flatMap((entry,index)=>primitiveFacts({...input,prefix:input.prefix+'.'+index,value:entry},depth+1));
  }
  return Object.entries(object(input.value)).flatMap(([key,value])=>primitiveFacts({...input,prefix:input.prefix+'.'+key,value},depth+1));
}

function unavailablePlan(input:{telemetryEpisodeId:string;decision:FrozenPhase3ForwardDecision;reason:string}):MarketContextSnapshotPlan {
  const availability={market:'SOURCE_UNAVAILABLE',regime:'SOURCE_UNAVAILABLE',volatility:'SOURCE_UNAVAILABLE',flow:'SOURCE_UNAVAILABLE',liquidity:'SOURCE_UNAVAILABLE',toxicity:'SOURCE_UNAVAILABLE',marketStructure:'SOURCE_UNAVAILABLE'} as Record<string,MarketContextCaptureStatus>;
  return{
    telemetryEpisodeId:input.telemetryEpisodeId,recommendationId:input.decision.recommendationId,poolAddress:input.decision.poolAddress,decisionAt:input.decision.decisionTimestamp,
    captureStatus:'SOURCE_UNAVAILABLE',reasonCodes:[input.reason],availability,
    rawPayload:{marketObservations:[],captureStatus:'SOURCE_UNAVAILABLE'},
    derivedInterpretation:{},
    provenance:{marketContextSchemaVersion:MARKET_CONTEXT_TELEMETRY_SCHEMA_VERSION,marketContextModelVersion:MARKET_CONTEXT_TELEMETRY_MODEL_VERSION,decisionSourceSha:input.decision.sourceSha,decisionBuildId:input.decision.buildId,decisionMigrationHead:input.decision.migrationHead},
    facts:[],
  };
}

/**
 * Builds a research-only M0050 snapshot strictly from the frozen forward
 * decision. It never reads mutable market tables and excludes any source
 * observation newer than the decision cutoff.
 */
export function planProspectiveMarketContextSnapshot(input:{telemetryEpisodeId:string;decision:FrozenPhase3ForwardDecision}):MarketContextSnapshotPlan {
  const decision=input.decision,context=decision.marketContext;
  if(!context)return unavailablePlan({telemetryEpisodeId:input.telemetryEpisodeId,decision,reason:'MARKET_CONTEXT_NOT_FROZEN_AT_DECISION'});
  const cutoff=timestamp(decision.decisionTimestamp),contextCutoff=timestamp(context.decisionContextCutoff);
  if(cutoff===undefined||contextCutoff===undefined||cutoff!==contextCutoff)return unavailablePlan({telemetryEpisodeId:input.telemetryEpisodeId,decision,reason:'MARKET_CONTEXT_CUTOFF_INVALID'});
  const observations=[...context.raw.marketObservations];
  const invalid=observations.filter(row=>{const observed=timestamp(row.observedAt);return observed===undefined||observed>cutoff;});
  if(invalid.length){
    const availability={market:'SOURCE_TIMESTAMP_UNVERIFIED',regime:'SOURCE_TIMESTAMP_UNVERIFIED',volatility:'SOURCE_TIMESTAMP_UNVERIFIED',flow:'SOURCE_TIMESTAMP_UNVERIFIED',liquidity:'SOURCE_TIMESTAMP_UNVERIFIED',toxicity:'SOURCE_TIMESTAMP_UNVERIFIED',marketStructure:'SOURCE_TIMESTAMP_UNVERIFIED'} as Record<string,MarketContextCaptureStatus>;
    return{
      telemetryEpisodeId:input.telemetryEpisodeId,recommendationId:decision.recommendationId,poolAddress:decision.poolAddress,decisionAt:decision.decisionTimestamp,
      captureStatus:'SOURCE_TIMESTAMP_UNVERIFIED',reasonCodes:['M0050_LOOKAHEAD_SOURCE_REJECTED'],availability,
      rawPayload:{marketObservations:[],rejectedObservationCount:invalid.length,captureStatus:'SOURCE_TIMESTAMP_UNVERIFIED'},
      derivedInterpretation:{},
      provenance:{marketContextSchemaVersion:MARKET_CONTEXT_TELEMETRY_SCHEMA_VERSION,marketContextModelVersion:MARKET_CONTEXT_TELEMETRY_MODEL_VERSION,decisionSourceSha:decision.sourceSha,decisionBuildId:decision.buildId,decisionMigrationHead:decision.migrationHead,decisionContextCutoff:decision.decisionTimestamp},
      facts:[],
    };
  }
  const sorted=observations.sort((a,b)=>(timestamp(a.observedAt)??0)-(timestamp(b.observedAt)??0));
  const latest=sorted.at(-1),latestAt=latest?.observedAt,sourceAgeMs=latestAt===undefined?undefined:Math.max(0,cutoff-(timestamp(latestAt)??cutoff));
  const freshness=Math.max(0,Math.floor(context.sourceFreshnessBoundaryMs));
  const marketStatus:MarketContextCaptureStatus=latestAt===undefined?'SOURCE_UNAVAILABLE':sourceAgeMs!==undefined&&sourceAgeMs>freshness?'SOURCE_STALE':'OBSERVED';
  const raw={
    marketObservations:copy(sorted),
    ...(context.raw.binFeatures?{binFeatures:copy(context.raw.binFeatures)}:{}),
    ...(context.raw.flowFeatures?{flowFeatures:copy(context.raw.flowFeatures)}:{}),
    poolAssessmentEvidence:copy(context.raw.poolAssessmentEvidence),
  };
  const derived={
    marketContext:copy(context.derived.marketContext),
    structure:copy(context.derived.structure),
    regime:copy(context.derived.regime),
    regimeHistory:copy(context.derived.regimeHistory),
    poolQualityShadow:copy(context.derived.poolQualityShadow),
    phase4:copy(decision.phase4),
  };
  const availability:Record<string,MarketContextCaptureStatus>={
    market:marketStatus,
    regime:statusAvailability(context.derived.regime),
    volatility:statusAvailability(context.derived.marketContext?.horizons),
    flow:context.raw.flowFeatures?'OBSERVED':'PARTIAL',
    liquidity:Object.keys(context.raw.poolAssessmentEvidence).length?'OBSERVED':'PARTIAL',
    toxicity:context.derived.poolQualityShadow?'OBSERVED':'PARTIAL',
    marketStructure:statusAvailability(context.derived.structure),
  };
  const categoryStatuses=Object.values(availability);
  const captureStatus:MarketContextCaptureStatus=marketStatus==='SOURCE_UNAVAILABLE'||marketStatus==='SOURCE_STALE'?marketStatus:categoryStatuses.some(status=>status!=='OBSERVED')?'PARTIAL':'OBSERVED';
  const sourceIdentity='phase3-frozen-decision-market-context';
  const sourceVersion=context.schemaVersion;
  const volatilityStatus=availability.volatility??'PARTIAL',structureStatus=availability.marketStructure??'PARTIAL',flowStatus=availability.flow??'PARTIAL',liquidityStatus=availability.liquidity??'PARTIAL',regimeStatus=availability.regime??'PARTIAL',toxicityStatus=availability.toxicity??'PARTIAL';
  const facts:NormalizedMarketContextFact[]=[];
  if(latest){
    facts.push(...primitiveFacts({prefix:'raw.decisionObservation.price',value:latest.price,layer:'RAW_FACT',sourceIdentity,sourceVersion,availabilityStatus:marketStatus,...(latestAt?{sourceObservedAt:latestAt}:{}),...(sourceAgeMs!==undefined?{sourceAgeMs}:{}),sourceWindow:'decision'}));
    if(latest.activeBinId!==undefined)facts.push(...primitiveFacts({prefix:'raw.decisionObservation.activeBinId',value:latest.activeBinId,layer:'RAW_FACT',sourceIdentity,sourceVersion,availabilityStatus:marketStatus,...(latestAt?{sourceObservedAt:latestAt}:{}),...(sourceAgeMs!==undefined?{sourceAgeMs}:{}),sourceWindow:'decision'}));
  }
  facts.push(...primitiveFacts({prefix:'raw.marketContext.horizons',value:context.derived.marketContext.horizons,layer:'RAW_FACT',sourceIdentity,sourceVersion,availabilityStatus:volatilityStatus,...(latestAt?{sourceObservedAt:latestAt}:{}),...(sourceAgeMs!==undefined?{sourceAgeMs}:{})}));
  facts.push(...primitiveFacts({prefix:'raw.binFeatures',value:context.raw.binFeatures,layer:'RAW_FACT',sourceIdentity,sourceVersion,availabilityStatus:structureStatus,...(latestAt?{sourceObservedAt:latestAt}:{}),...(sourceAgeMs!==undefined?{sourceAgeMs}:{}),sourceWindow:'decision'}));
  facts.push(...primitiveFacts({prefix:'raw.flowFeatures',value:context.raw.flowFeatures,layer:'RAW_FACT',sourceIdentity,sourceVersion,availabilityStatus:flowStatus,...(latestAt?{sourceObservedAt:latestAt}:{}),...(sourceAgeMs!==undefined?{sourceAgeMs}:{}),sourceWindow:'decision'}));
  facts.push(...primitiveFacts({prefix:'raw.poolAssessmentEvidence',value:context.raw.poolAssessmentEvidence,layer:'RAW_FACT',sourceIdentity,sourceVersion,availabilityStatus:liquidityStatus,...(latestAt?{sourceObservedAt:latestAt}:{}),...(sourceAgeMs!==undefined?{sourceAgeMs}:{}),sourceWindow:'decision'}));
  facts.push(...primitiveFacts({prefix:'derived.regime',value:context.derived.regime,layer:'DERIVED_INTERPRETATION',sourceIdentity:'phase3-regime-classifier',sourceVersion:context.provenance.regimeModelVersion,availabilityStatus:regimeStatus,sourceObservedAt:decision.decisionTimestamp,sourceWindow:'decision'}));
  facts.push(...primitiveFacts({prefix:'derived.structure',value:context.derived.structure,layer:'DERIVED_INTERPRETATION',sourceIdentity:'phase3-structure-features',sourceVersion:context.provenance.structureModelVersion,availabilityStatus:structureStatus,sourceObservedAt:decision.decisionTimestamp,sourceWindow:'decision'}));
  facts.push(...primitiveFacts({prefix:'derived.poolQualityShadow',value:context.derived.poolQualityShadow,layer:'DERIVED_INTERPRETATION',sourceIdentity:'pool-quality-prospective-shadow',sourceVersion:String(context.derived.poolQualityShadow.version??'unknown'),availabilityStatus:toxicityStatus,sourceObservedAt:decision.decisionTimestamp,sourceWindow:'decision'}));
  facts.push(...primitiveFacts({prefix:'derived.phase4',value:decision.phase4,layer:'DERIVED_INTERPRETATION',sourceIdentity:'phase4-frozen-context',sourceVersion:'phase4-forward-snapshot-v1',availabilityStatus:'OBSERVED',sourceObservedAt:decision.decisionTimestamp,sourceWindow:'decision'}));
  return{
    telemetryEpisodeId:input.telemetryEpisodeId,recommendationId:decision.recommendationId,poolAddress:decision.poolAddress,decisionAt:decision.decisionTimestamp,captureStatus,
    reasonCodes:[...(captureStatus==='PARTIAL'?['M0050_CONTEXT_PARTIAL']:[]),...(marketStatus==='SOURCE_STALE'?['M0050_MARKET_SOURCE_STALE']:[])],
    availability,rawPayload:raw,derivedInterpretation:derived,
    provenance:{
      marketContextSchemaVersion:MARKET_CONTEXT_TELEMETRY_SCHEMA_VERSION,
      marketContextModelVersion:MARKET_CONTEXT_TELEMETRY_MODEL_VERSION,
      sourceMarketContextSchemaVersion:context.schemaVersion,
      regimeModelVersion:context.provenance.regimeModelVersion,
      structureModelVersion:context.provenance.structureModelVersion,
      decisionSourceSha:decision.sourceSha,decisionBuildId:decision.buildId,decisionMigrationHead:decision.migrationHead,
      decisionContextCutoff:decision.decisionTimestamp,sourceFreshnessBoundaryMs:freshness,
      ...(latestAt?{sourceObservedAtMax:latestAt}:{}),...(sourceAgeMs!==undefined?{sourceAgeMs}:{}),
    },
    facts,
  };
}

export async function marketContextContentHash(plan:MarketContextSnapshotPlan):Promise<string> {
  return sha256Hex(canonicalJson({
    telemetryEpisodeId:plan.telemetryEpisodeId,recommendationId:plan.recommendationId,poolAddress:plan.poolAddress,decisionAt:plan.decisionAt,
    captureStatus:plan.captureStatus,reasonCodes:[...plan.reasonCodes].sort(),availability:plan.availability,
    rawPayload:plan.rawPayload,derivedInterpretation:plan.derivedInterpretation,provenance:plan.provenance,facts:plan.facts,
  }));
}

export async function buildMarketContextManifestEntry(input:{telemetryEpisodeId:string;marketContextModelVersion:string;snapshotId:string;sequenceNumber:number;capturedAt:string;contentHash:string;previousHash:string;captureStatus:MarketContextCaptureStatus;collectorVersion:string;sourceVersion:string}):Promise<{currentHash:string}&typeof input> {
  const currentHash=await sha256Hex(canonicalJson(input));
  return{...input,currentHash};
}

export async function verifyMarketContextManifestChain(input:{episodeHeaderHash:string;entry:{telemetryEpisodeId:string;sequenceNumber:number;contentHash:string;previousHash:string;currentHash:string;capturedAt:string;captureStatus:MarketContextCaptureStatus;collectorVersion:string;sourceVersion:string;marketContextModelVersion:string;snapshotId:string}}):Promise<boolean> {
  if(input.entry.sequenceNumber!==1||input.entry.previousHash!==input.episodeHeaderHash)return false;
  const {currentHash,...basis}=input.entry;
  const expected=await buildMarketContextManifestEntry(basis);
  return expected.currentHash===currentHash;
}
