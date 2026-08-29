import { canonicalJson, sha256Hex } from '../../domain/src/index.js';
import {
  deriveCapitalConstrainedForwardPosition,
  forwardV2ValueLamports,
  type FrozenPhase3ForwardDecision,
} from '../../phase3-forward-validation/src/index.js';
import { simulateSyntheticPosition, type BinFrame } from '../../simulator/src/index.js';

/**
 * A deliberately non-authoritative successor to the historical inventory
 * replay.  This identity is part of every immutable prediction and must never
 * be reused for a changed formula.
 */
export const INVENTORY_FORECAST_V2_ACTIVATION_ID='inventory-forecast-v2-shadow-v1';
export const INVENTORY_FORECAST_V2_MODEL_VERSION='inventory-forecast-v2-shadow-v1';
export const INVENTORY_FORECAST_V2_SCHEMA_VERSION='inventory-forecast-v2-prospective-schema-v1';
export const INVENTORY_FORECAST_V2_FORMULA_VERSION='capital-constrained-analogue-scenarios-v1';
export const INVENTORY_FORECAST_V2_COLLECTOR_VERSION='inventory-forecast-v2-shadow-recorder-v1';
export const INVENTORY_FORECAST_V2_OUTCOME_MODEL_VERSION='phase3-forward-outcome-v2';
export const INVENTORY_FORECAST_V2_HORIZONS=[30,60,120] as const;
export const INVENTORY_FORECAST_V2_HISTORY_LOOKBACK_MINUTES=240;
export const INVENTORY_FORECAST_V1_MODEL_VERSION='inventory-forecast-v1';

const WSOL_MINT='So11111111111111111111111111111111111111112';

export type InventoryForecastV2Status=
  | 'OBSERVED'
  | 'FORECAST_UNAVAILABLE'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_STALE'
  | 'SOURCE_TIMESTAMP_UNVERIFIED'
  | 'DUPLICATE_REJECTED'
  | 'INTEGRITY_CONFLICT'
  | 'PRE_ACTIVATION_NOT_APPLICABLE';

export type InventoryForecastV2Orientation='WSOL_AS_Y'|'WSOL_AS_X'|'UNRESOLVED';
export type InventoryForecastV2Horizon=(typeof INVENTORY_FORECAST_V2_HORIZONS)[number];
export type ForecastSign=-1|0|1;

export interface InventoryForecastV2PoolIdentity {
  tokenXMint?:string;
  tokenYMint?:string;
  firstSeenAt?:string;
}

export interface InventoryForecastV2Scenario {
  scenarioId:'NEUTRAL_PERSISTENCE'|'UPWARD_DISPLACEMENT'|'DOWNWARD_DISPLACEMENT';
  horizonMinutes:InventoryForecastV2Horizon;
  /** Equal descriptive scenario mass, not a calibrated probability. */
  scenarioWeight:number;
  scenarioWeightSource:'UNWEIGHTED_DIRECTIONAL_ENVELOPE';
  terminalActiveBinId:number;
  binDisplacement:number;
  pathDefinition:'ENTRY_TO_TERMINAL_BIN_ONE_STEP';
  analogueObservedAt:string;
  analogueActiveBinId:number;
  inventoryPnlSol:number;
  inventorySign:ForecastSign;
  startingValueLamports:string;
  terminalValueLamports:string;
}

export interface InventoryForecastV2Plan {
  telemetryEpisodeId:string;
  recommendationId:string;
  candidateId:string;
  poolAddress:string;
  decisionAt:string;
  captureStatus:InventoryForecastV2Status;
  reasonCodes:string[];
  rawFrozenInputs:Record<string,unknown>;
  derivedForecast:Record<string,unknown>;
  provenance:Record<string,unknown>;
}

type ObjectRecord=Record<string,unknown>;
const object=(value:unknown):ObjectRecord=>value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectRecord:{};
const copy=<T>(value:T):T=>JSON.parse(canonicalJson(value)) as T;
const at=(value:unknown):number|undefined=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):undefined;
const sign=(value:number):ForecastSign=>value>0?1:value<0?-1:0;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

function unavailable(input:{telemetryEpisodeId:string;decision:FrozenPhase3ForwardDecision;candidateId?:string;status:InventoryForecastV2Status;reasonCodes:string[];provenance?:Record<string,unknown>}):InventoryForecastV2Plan {
  return {
    telemetryEpisodeId:input.telemetryEpisodeId,recommendationId:input.decision.recommendationId,candidateId:input.candidateId??input.decision.selectedCandidate?.id??'NO_SELECTED_CANONICAL_CANDIDATE',poolAddress:input.decision.poolAddress,decisionAt:input.decision.decisionTimestamp,
    captureStatus:input.status,reasonCodes:[...new Set(input.reasonCodes)].sort(),rawFrozenInputs:{},derivedForecast:{},
    provenance:{inventoryForecastModelVersion:INVENTORY_FORECAST_V2_MODEL_VERSION,formulaVersion:INVENTORY_FORECAST_V2_FORMULA_VERSION,decisionContextCutoff:input.decision.decisionTimestamp,...(input.provenance??{})},
  };
}

function orientation(identity:InventoryForecastV2PoolIdentity):InventoryForecastV2Orientation {
  if(identity.tokenYMint===WSOL_MINT)return'WSOL_AS_Y';
  if(identity.tokenXMint===WSOL_MINT)return'WSOL_AS_X';
  return'UNRESOLVED';
}

function usableFrame(candidate:NonNullable<FrozenPhase3ForwardDecision['selectedCandidate']>,frame:BinFrame):boolean {
  const bins=new Map(frame.bins.map(bin=>[bin.binId,bin] as const));
  return candidate.perBinWeights.filter(weight=>weight.weight>0).every(weight=>{
    const bin=bins.get(weight.binId);
    return Boolean(bin&&bin.liquiditySupply&&BigInt(bin.liquiditySupply)>0n);
  });
}

function horizonContext(decision:FrozenPhase3ForwardDecision,horizon:InventoryForecastV2Horizon):{binVelocityPerMinute:number;sourceHorizon:string}|undefined {
  const context=decision.marketContext?.derived.marketContext;
  const key=horizon===30?'30m':horizon===60?'1h':'4h';
  const value=object(context).horizons;
  const source=object(value)[key];
  const velocity=object(source).binVelocityPerMinute;
  return finite(velocity)&&velocity>=0?{binVelocityPerMinute:velocity,sourceHorizon:key}:undefined;
}

function analogueFrame(input:{frames:BinFrame[];candidate:NonNullable<FrozenPhase3ForwardDecision['selectedCandidate']>;targetActiveBinId:number}):BinFrame|undefined {
  return [...input.frames]
    .filter(frame=>usableFrame(input.candidate,frame))
    .sort((left,right)=>{
      const delta=Math.abs(left.activeBinId-input.targetActiveBinId)-Math.abs(right.activeBinId-input.targetActiveBinId);
      return delta||Date.parse(right.observedAt)-Date.parse(left.observedAt);
    })[0];
}

function scenarioTerminalFrame(source:BinFrame,terminalAt:string,terminalActiveBinId:number):BinFrame {
  return {observedAt:terminalAt,activeBinId:terminalActiveBinId,bins:copy(source.bins)};
}

function scenarioOutcome(input:{decision:FrozenPhase3ForwardDecision;baseline:BinFrame;terminal:BinFrame;scenarioId:InventoryForecastV2Scenario['scenarioId'];horizonMinutes:InventoryForecastV2Horizon;terminalActiveBinId:number;binDisplacement:number;position:NonNullable<ReturnType<typeof deriveCapitalConstrainedForwardPosition>['position']>}):InventoryForecastV2Scenario|undefined {
  const rawUnitValueX=Number(input.decision.prediction.rawUnitValueX??0),rawUnitValueY=Number(input.decision.prediction.rawUnitValueY??0);
  const replay=simulateSyntheticPosition({position:input.position.position,frames:[input.baseline,input.terminal],events:[],horizonEnd:input.terminal.observedAt});
  const start=replay.inventory[0],end=replay.inventory.at(-1);
  const startValue=start?forwardV2ValueLamports(start.tokenXRaw,start.tokenYRaw,rawUnitValueX,rawUnitValueY):undefined;
  const terminalValue=end?forwardV2ValueLamports(end.tokenXRaw,end.tokenYRaw,rawUnitValueX,rawUnitValueY):undefined;
  if(startValue===undefined||terminalValue===undefined)return undefined;
  const inventoryPnlSol=Number(terminalValue-startValue)/1_000_000_000;
  return {scenarioId:input.scenarioId,horizonMinutes:input.horizonMinutes,scenarioWeight:1/3,scenarioWeightSource:'UNWEIGHTED_DIRECTIONAL_ENVELOPE',terminalActiveBinId:input.terminalActiveBinId,binDisplacement:input.binDisplacement,pathDefinition:'ENTRY_TO_TERMINAL_BIN_ONE_STEP',analogueObservedAt:input.terminal.observedAt,analogueActiveBinId:input.terminal.activeBinId,inventoryPnlSol,inventorySign:sign(inventoryPnlSol),startingValueLamports:startValue.toString(),terminalValueLamports:terminalValue.toString()};
}

/**
 * Uses only frozen decision evidence plus protocol frames observed no later
 * than the decision.  Scenario frames are historical analogues, not future
 * observations; their source timestamp remains explicit in raw provenance.
 */
export function planProspectiveInventoryForecastV2(input:{telemetryEpisodeId:string;decision:FrozenPhase3ForwardDecision;poolIdentity:InventoryForecastV2PoolIdentity;historicalFrames:BinFrame[]}):InventoryForecastV2Plan {
  const candidate=input.decision.selectedCandidate;
  const decisionAt=at(input.decision.decisionTimestamp);
  if(!candidate)return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,status:'FORECAST_UNAVAILABLE',reasonCodes:['INVENTORY_FORECAST_V2_SELECTED_CANONICAL_CANDIDATE_UNAVAILABLE']});
  if(decisionAt===undefined)return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'SOURCE_TIMESTAMP_UNVERIFIED',reasonCodes:['INVENTORY_FORECAST_V2_DECISION_TIMESTAMP_INVALID']});
  const context=input.decision.marketContext;
  if(!context)return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'SOURCE_UNAVAILABLE',reasonCodes:['INVENTORY_FORECAST_V2_DECISION_CONTEXT_UNAVAILABLE']});
  if(at(context.decisionContextCutoff)!==decisionAt)return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'SOURCE_TIMESTAMP_UNVERIFIED',reasonCodes:['INVENTORY_FORECAST_V2_CONTEXT_CUTOFF_INVALID']});
  const observations=[...context.raw.marketObservations];
  if(observations.some(row=>{const observed=at(row.observedAt);return observed===undefined||observed>decisionAt;}))return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'SOURCE_TIMESTAMP_UNVERIFIED',reasonCodes:['INVENTORY_FORECAST_V2_LOOKAHEAD_MARKET_SOURCE_REJECTED']});
  const latestObservation=[...observations].sort((left,right)=>(at(left.observedAt)??0)-(at(right.observedAt)??0)).at(-1);
  const latestAt=at(latestObservation?.observedAt);
  if(latestAt===undefined)return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'SOURCE_UNAVAILABLE',reasonCodes:['INVENTORY_FORECAST_V2_MARKET_SOURCE_UNAVAILABLE']});
  const freshness=Math.max(0,Math.floor(context.sourceFreshnessBoundaryMs));
  if(decisionAt-latestAt>freshness)return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'SOURCE_STALE',reasonCodes:['INVENTORY_FORECAST_V2_MARKET_SOURCE_STALE'],provenance:{sourceAgeMs:decisionAt-latestAt,sourceFreshnessBoundaryMs:freshness}});
  const positionOrientation=orientation(input.poolIdentity);
  if(positionOrientation==='UNRESOLVED')return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'FORECAST_UNAVAILABLE',reasonCodes:['INVENTORY_FORECAST_V2_TOKEN_ORIENTATION_UNRESOLVED']});
  // Canonical V2/M0049 currently values SOL through rawUnitValueY. Never
  // silently reinterpret a WSOL-as-X pool under that contract.
  if(positionOrientation==='WSOL_AS_X')return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'FORECAST_UNAVAILABLE',reasonCodes:['INVENTORY_FORECAST_V2_CANONICAL_WSOL_AS_X_UNSUPPORTED']});
  if(input.poolIdentity.firstSeenAt&&((at(input.poolIdentity.firstSeenAt)??Infinity)>decisionAt))return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'SOURCE_TIMESTAMP_UNVERIFIED',reasonCodes:['INVENTORY_FORECAST_V2_POOL_IDENTITY_AFTER_DECISION']});
  if(input.historicalFrames.some(frame=>{const observed=at(frame.observedAt);return observed===undefined||observed>decisionAt;}))return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'SOURCE_TIMESTAMP_UNVERIFIED',reasonCodes:['INVENTORY_FORECAST_V2_LOOKAHEAD_BIN_FRAME_REJECTED']});
  const historical=[...input.historicalFrames].filter(frame=>at(frame.observedAt)!==undefined).sort((left,right)=>Date.parse(left.observedAt)-Date.parse(right.observedAt));
  const baseline=historical.at(-1);
  if(!baseline||!usableFrame(candidate,baseline))return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'SOURCE_UNAVAILABLE',reasonCodes:['INVENTORY_FORECAST_V2_BASELINE_FRAME_UNAVAILABLE']});
  const baselineAt=at(baseline.observedAt)!;
  if(decisionAt-baselineAt>freshness)return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'SOURCE_STALE',reasonCodes:['INVENTORY_FORECAST_V2_BASELINE_FRAME_STALE'],provenance:{baselineSourceAgeMs:decisionAt-baselineAt,sourceFreshnessBoundaryMs:freshness}});
  const constrained=deriveCapitalConstrainedForwardPosition({decision:input.decision,candidate,baseline});
  if(!constrained.position)return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'FORECAST_UNAVAILABLE',reasonCodes:constrained.reasonCodes??['INVENTORY_FORECAST_V2_CAPITAL_CONSTRAINED_POSITION_UNAVAILABLE']});
  const scenarioRows:InventoryForecastV2Scenario[]=[];
  const forecasts:Record<string,unknown>={};
  for(const horizon of INVENTORY_FORECAST_V2_HORIZONS){
    const contextMetric=horizonContext(input.decision,horizon);
    if(!contextMetric)return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'FORECAST_UNAVAILABLE',reasonCodes:[`INVENTORY_FORECAST_V2_${horizon}M_BIN_VELOCITY_UNAVAILABLE`]});
    const displacement=Math.max(1,Math.round(contextMetric.binVelocityPerMinute*horizon));
    const terminalAt=new Date(decisionAt+horizon*60_000).toISOString();
    const definitions:[InventoryForecastV2Scenario['scenarioId'],number,BinFrame|undefined][]=[
      ['NEUTRAL_PERSISTENCE',0,baseline],
      ['UPWARD_DISPLACEMENT',displacement,analogueFrame({frames:historical,candidate,targetActiveBinId:baseline.activeBinId+displacement})],
      ['DOWNWARD_DISPLACEMENT',-displacement,analogueFrame({frames:historical,candidate,targetActiveBinId:baseline.activeBinId-displacement})],
    ];
    const scenarios=definitions.map(([scenarioId,shift,analogue])=>{
      if(!analogue)return undefined;
      const terminal=scenarioTerminalFrame(analogue,terminalAt,baseline.activeBinId+shift);
      const result=scenarioOutcome({decision:input.decision,baseline,terminal,scenarioId,horizonMinutes:horizon,terminalActiveBinId:terminal.activeBinId,binDisplacement:shift,position:constrained.position!});
      return result?{...result,analogueObservedAt:analogue.observedAt,analogueActiveBinId:analogue.activeBinId}:undefined;
    });
    if(scenarios.some(value=>!value))return unavailable({telemetryEpisodeId:input.telemetryEpisodeId,decision:input.decision,candidateId:candidate.id,status:'FORECAST_UNAVAILABLE',reasonCodes:[`INVENTORY_FORECAST_V2_${horizon}M_ANALOGUE_FRAME_UNAVAILABLE`]});
    const complete=scenarios as InventoryForecastV2Scenario[];
    scenarioRows.push(...complete);
    const values=complete.map(row=>row.inventoryPnlSol),expected=values.reduce((sum,value)=>sum+value,0)/values.length;
    const variance=values.reduce((sum,value)=>sum+(value-expected)**2,0)/values.length;
    forecasts[`${horizon}m`]={predictedInventoryPnlSol:expected,predictedInventorySign:sign(expected),downsideScenarioInventoryPnlSol:Math.min(...values),upsideScenarioInventoryPnlSol:Math.max(...values),scenarioDispersionSol:Math.sqrt(variance),binDisplacement:displacement,binVelocityPerMinute:contextMetric.binVelocityPerMinute,binVelocitySourceHorizon:contextMetric.sourceHorizon};
  }
  const searchIndex=historical.map(frame=>({observedAt:frame.observedAt,activeBinId:frame.activeBinId}));
  return {
    telemetryEpisodeId:input.telemetryEpisodeId,recommendationId:input.decision.recommendationId,candidateId:candidate.id,poolAddress:input.decision.poolAddress,decisionAt:input.decision.decisionTimestamp,captureStatus:'OBSERVED',reasonCodes:[],
    rawFrozenInputs:{
      selectedCandidate:copy(candidate),capitalLamports:input.decision.capitalLamports,rawUnitValueX:input.decision.prediction.rawUnitValueX,rawUnitValueY:input.decision.prediction.rawUnitValueY,
      tokenOrientation:positionOrientation,poolIdentity:copy(input.poolIdentity),baselineFrame:copy(baseline),analogueSearchIndex:searchIndex,
      decisionMarketContext:{decisionContextCutoff:context.decisionContextCutoff,sourceFreshnessBoundaryMs:context.sourceFreshnessBoundaryMs,rawMarketObservations:copy(observations),derivedMarketContext:copy(context.derived.marketContext),derivedRegime:copy(context.derived.regime),derivedStructure:copy(context.derived.structure)},
    },
    derivedForecast:{target:'canonical-v2-realized-inventory-pnl',unit:'SOL',participationModel:'CAPITAL_CONSTRAINED_V2',startingPosition:{frozenCapitalLamports:constrained.position.frozenCapitalLamports.toString(),allocatedCapitalLamports:constrained.position.allocatedCapitalLamports.toString(),derivedPositionValueLamports:constrained.position.derivedPositionValueLamports.toString(),maxEffectiveOwnershipBps:constrained.position.maxEffectiveOwnershipBps,perBinParticipation:constrained.position.bins},forecasts,scenarios:scenarioRows},
    provenance:{inventoryForecastModelVersion:INVENTORY_FORECAST_V2_MODEL_VERSION,formulaVersion:INVENTORY_FORECAST_V2_FORMULA_VERSION,inventoryForecastSchemaVersion:INVENTORY_FORECAST_V2_SCHEMA_VERSION,decisionContextCutoff:input.decision.decisionTimestamp,baselineSourceObservedAt:baseline.observedAt,marketSourceObservedAtMax:latestObservation!.observedAt,sourceFreshnessBoundaryMs:freshness,scenarioAssumptions:{path:'historical-analogue-terminal-bin-frame',weight:'equal-descriptive-scenario-mass-not-probability',magnitude:'abs(canonical_bin_velocity_per_minute)*horizon_minutes rounded with a one-bin floor',terminalValuation:'canonical-v2-frozen-raw-unit-values'},coefficientInventory:[{name:'scenarioWeight',value:1/3,classification:'NEW_ASSUMPTION',rationale:'unweighted directional envelope; not calibrated probability'},{name:'binDisplacement',classification:'MATHEMATICALLY_DERIVED',rationale:'round(abs(canonical bin velocity per minute) times horizon) with one-bin floor'},{name:'rawUnitValueX/rawUnitValueY',classification:'CANONICAL_EXISTING',rationale:'frozen canonical V2 valuation contract'},{name:'capital-constrained-position',classification:'CANONICAL_EXISTING',rationale:'direct reuse of canonical V2/M0049 primitive'}]},
  };
}

export async function inventoryForecastV2ContentHash(plan:InventoryForecastV2Plan):Promise<string> {
  return sha256Hex(canonicalJson({telemetryEpisodeId:plan.telemetryEpisodeId,recommendationId:plan.recommendationId,candidateId:plan.candidateId,poolAddress:plan.poolAddress,decisionAt:plan.decisionAt,captureStatus:plan.captureStatus,reasonCodes:[...plan.reasonCodes].sort(),rawFrozenInputs:plan.rawFrozenInputs,derivedForecast:plan.derivedForecast,provenance:plan.provenance}));
}

export async function buildInventoryForecastV2ManifestEntry(input:{telemetryEpisodeId:string;predictionId:string;capturedAt:string;sourceVersion:string;collectorVersion:string;contentHash:string;previousHash:string;captureStatus:InventoryForecastV2Status}):Promise<{currentHash:string}&typeof input> {
  return {...input,currentHash:await sha256Hex(canonicalJson(input))};
}

export async function verifyInventoryForecastV2ManifestChain(input:{episodeHeaderHash:string;entry:{telemetryEpisodeId:string;predictionId:string;capturedAt:string;sourceVersion:string;collectorVersion:string;contentHash:string;previousHash:string;currentHash:string;captureStatus:InventoryForecastV2Status}}):Promise<boolean> {
  if(input.entry.previousHash!==input.episodeHeaderHash)return false;
  const {currentHash,...basis}=input.entry;
  return (await buildInventoryForecastV2ManifestEntry(basis)).currentHash===currentHash;
}

export interface InventoryForecastV2ValidationRow {poolAddress:string;decisionAt:string;horizonMinutes:InventoryForecastV2Horizon;predictedInventoryPnlSol:number;v1PredictedInventoryPnlSol?:number;realizedInventoryPnlSol:number;strategy?:string;orientation?:string;widthBucket?:string;regime?:string;volatilityState?:string;transitionRisk?:number;transitionRiskState?:string;}
type ForecastMetrics={count:number;pearson:number|null;spearman:number|null;signAccuracy:number|null;balancedSignAccuracy:number|null;realizedPositiveSignBaseRate:number|null;realizedNegativeSignBaseRate:number|null;majoritySignBaselineAccuracy:number|null;mae:number|null;meanBias:number|null;medianBias:number|null;medianAbsoluteError:number|null;};
const mean=(values:number[])=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;
const median=(values:number[])=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]!:(sorted[mid-1]!+sorted[mid]!)/2;};
function rank(values:number[]):number[]{const indexed=values.map((value,index)=>({value,index})).sort((a,b)=>a.value-b.value);const ranked=Array<number>(values.length);let start=0;while(start<indexed.length){let end=start+1;while(end<indexed.length&&indexed[end]!.value===indexed[start]!.value)end++;const value=(start+1+end)/2;for(let i=start;i<end;i++){const item=indexed[i]!;ranked[item.index]=value;}start=end;}return ranked;}
function correlation(left:number[],right:number[]):number|null{if(left.length!==right.length||!left.length)return null;const a=mean(left),b=mean(right);let numerator=0,dx=0,dy=0;for(let i=0;i<left.length;i++){const x=left[i]!-a,y=right[i]!-b;numerator+=x*y;dx+=x*x;dy+=y*y;}return dx>0&&dy>0?numerator/Math.sqrt(dx*dy):null;}
function metrics(rows:InventoryForecastV2ValidationRow[],prediction:(row:InventoryForecastV2ValidationRow)=>number|undefined):ForecastMetrics {
  const usable=rows.flatMap(row=>{const value=prediction(row);return finite(value)?[{predicted:value,realized:row.realizedInventoryPnlSol}]:[];});
  if(!usable.length)return{count:0,pearson:null,spearman:null,signAccuracy:null,balancedSignAccuracy:null,realizedPositiveSignBaseRate:null,realizedNegativeSignBaseRate:null,majoritySignBaselineAccuracy:null,mae:null,meanBias:null,medianBias:null,medianAbsoluteError:null};
  const signRows=usable.filter(row=>row.realized!==0);
  const positive=signRows.filter(row=>row.realized>0),negative=signRows.filter(row=>row.realized<0);
  const rate=(rows:{predicted:number;realized:number}[])=>rows.length?rows.filter(row=>sign(row.predicted)===sign(row.realized)).length/rows.length:null;
  const errors=usable.map(row=>row.realized-row.predicted);
  return{count:usable.length,pearson:correlation(usable.map(row=>row.predicted),usable.map(row=>row.realized)),spearman:correlation(rank(usable.map(row=>row.predicted)),rank(usable.map(row=>row.realized))),signAccuracy:rate(signRows),balancedSignAccuracy:positive.length&&negative.length?((rate(positive)??0)+(rate(negative)??0))/2:null,realizedPositiveSignBaseRate:signRows.length?positive.length/signRows.length:null,realizedNegativeSignBaseRate:signRows.length?negative.length/signRows.length:null,majoritySignBaselineAccuracy:signRows.length?Math.max(positive.length,negative.length)/signRows.length:null,mae:mean(errors.map(Math.abs)),meanBias:mean(errors),medianBias:median(errors),medianAbsoluteError:median(errors.map(Math.abs))};
}

function widthBucket(value:unknown):string|undefined{const width=Number(value);if(!Number.isFinite(width))return undefined;return width<=20?'1-20':width<=49?'21-49':width<=79?'50-79':'80+';}
function stringField(value:Record<string,unknown>,keys:string[]):string|undefined{for(const key of keys){const candidate=value[key];if(typeof candidate==='string'&&candidate)return candidate;}return undefined;}
function scalarAverage(rows:ForecastMetrics[]):Record<string,number|null>{const keys:Exclude<keyof ForecastMetrics,'count'>[]=['pearson','spearman','signAccuracy','balancedSignAccuracy','realizedPositiveSignBaseRate','realizedNegativeSignBaseRate','majoritySignBaselineAccuracy','mae','meanBias','medianBias','medianAbsoluteError'];return Object.fromEntries(keys.map(key=>{const values=rows.map(row=>row[key]).filter((value):value is number=>value!==null);return[key,values.length?mean(values):null];}));}
function grouped(rows:InventoryForecastV2ValidationRow[],key:(row:InventoryForecastV2ValidationRow)=>string|undefined):Record<string,unknown>{const groups=new Map<string,InventoryForecastV2ValidationRow[]>();for(const row of rows){const value=key(row);if(!value)continue;groups.set(value,[...(groups.get(value)??[]),row]);}return Object.fromEntries([...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([value,group])=>[value,{samples:group.length,independentPools:new Set(group.map(row=>row.poolAddress)).size,independentHours:new Set(group.map(row=>row.decisionAt.slice(0,13))).size,v2:metrics(group,row=>row.predictedInventoryPnlSol),v1:metrics(group,row=>row.v1PredictedInventoryPnlSol),zero:metrics(group,()=>0)}]));}

/** Converts a read-only joined row into the explicit future-validation shape. No fallback synthesizes missing production context. */
export function inventoryForecastV2ValidationRowFromStored(row:Record<string,unknown>):InventoryForecastV2ValidationRow|undefined {
 const forecast=object(object(row.derived_forecast).forecasts)[`${Number(row.horizon_minutes)}m`],prediction=object(forecast).predictedInventoryPnlSol,realized=Number(row.realized_inventory_pnl);if(!finite(prediction)||!Number.isFinite(realized))return undefined;
 const raw=object(row.raw_frozen_inputs),candidate=object(raw.selectedCandidate),context=object(raw.decisionMarketContext),regime=object(context.derivedRegime),market=object(context.derivedMarketContext),volatility=object(market.volatility),transitionRisk=regime.transitionRisk;
 const strategy=stringField(candidate,['strategy']),orientationValue=stringField(candidate,['orientation']),width=widthBucket(candidate.widthBins??candidate.width_bins),regimeLabel=stringField(regime,['primaryRegime','regime','label']),volatilityLabel=stringField(volatility,['state','class','label']),transitionRiskState=stringField(regime,['transitionRiskState','transitionState']);
 return{poolAddress:String(row.pool_address),decisionAt:String(row.decision_at),horizonMinutes:Number(row.horizon_minutes) as InventoryForecastV2Horizon,predictedInventoryPnlSol:prediction,...(finite(Number(row.v1_predicted_inventory_pnl))?{v1PredictedInventoryPnlSol:Number(row.v1_predicted_inventory_pnl)}:{}),realizedInventoryPnlSol:realized,...(strategy?{strategy}:{}),...(orientationValue?{orientation:orientationValue}:{}),...(width?{widthBucket:width}:{}),...(regimeLabel?{regime:regimeLabel}:{}),...(volatilityLabel?{volatilityState:volatilityLabel}:{}),...(finite(transitionRisk)?{transitionRisk}:{}),...(transitionRiskState?{transitionRiskState}:{}),};
}

/** Read-only future-validation helper. It does not create predictions, alter
 * outcomes, or use any pre-activation row. */
export function buildInventoryForecastV2ValidationReport(rows:InventoryForecastV2ValidationRow[]):Record<string,unknown> {
  const byHorizon=Object.fromEntries(INVENTORY_FORECAST_V2_HORIZONS.map(horizon=>{
    const group=rows.filter(row=>row.horizonMinutes===horizon);
    const pools=[...new Set(group.map(row=>row.poolAddress))];
    const pooled={v2:metrics(group,row=>row.predictedInventoryPnlSol),v1:metrics(group,row=>row.v1PredictedInventoryPnlSol),zero:metrics(group,()=>0)};
    const poolGroups=pools.map(pool=>group.filter(row=>row.poolAddress===pool)),days=[...new Set(group.map(row=>row.decisionAt.slice(0,10)))],dayGroups=days.map(day=>group.filter(row=>row.decisionAt.startsWith(day)));
    const balanced=(groups:InventoryForecastV2ValidationRow[][])=>({groups:groups.length,v2:scalarAverage(groups.map(rows=>metrics(rows,row=>row.predictedInventoryPnlSol))),v1:scalarAverage(groups.map(rows=>metrics(rows,row=>row.v1PredictedInventoryPnlSol))),zero:scalarAverage(groups.map(rows=>metrics(rows,()=>0)))});
    return[`${horizon}m`,{samples:group.length,independentPools:pools.length,independentHours:new Set(group.map(row=>row.decisionAt.slice(0,13))).size,independentDays:days.length,rawEpisodeWeighted:pooled,poolBalanced:balanced(poolGroups),timeBalanced:balanced(dayGroups),strata:{strategy:grouped(group,row=>row.strategy),orientation:grouped(group,row=>row.orientation),width:grouped(group,row=>row.widthBucket),regime:grouped(group,row=>row.regime),volatility:grouped(group,row=>row.volatilityState),transitionRiskState:grouped(group,row=>row.transitionRiskState)}}];
  }));
  return{modelVersion:INVENTORY_FORECAST_V2_MODEL_VERSION,validationStatus:'PROSPECTIVE_VALIDATION_REQUIRED',comparators:['inventory-forecast-v2-shadow-v1','inventory-forecast-v1','BASELINE_ZERO'],byHorizon};
}
