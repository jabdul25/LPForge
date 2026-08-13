import { canonicalJson, sha256Hex } from '../../domain/src/index.js';
import type { PoolAssessment } from '../../pool-intelligence/src/index.js';
import type { RegimeAssessment } from '../../regime/src/index.js';
import type { OpportunityEconomics } from '../../opportunity/src/index.js';
import type { RangeStrategyCandidate } from '../../rangeforge/src/index.js';
import type { SurvivalForecast } from '../../range-survival/src/index.js';
import type { CandidateRankingResult } from '../../candidate-ranking/src/index.js';

export interface MachineReadableLpThesis {
  thesisId:string;
  schemaVersion:'lp-thesis-v1';
  recommendationOnly:true;
  observedAt:string;
  expiresAt:string;
  pool:string;
  opportunityClass:string;
  numeraire:string;
  horizonMinutes:number;
  expectedRegimes:Array<{label:string;probability:number}>;
  forbiddenRegimes:string[];
  selectedCandidate:{id:string;strategy:string;orientation:string;lowerBinId:number;upperBinId:number;centerBinId:number;widthBins:number;capitalFraction:number};
  expectedEconomics:{feeValue:number;inventoryPnl:number;hodlRelativePnl:number;executionCost:number;repositionCost:number;tailRiskCharge:number;netLpValue:number;uncertainty:number};
  rangeSurvival:Record<string,{probability:number;activeTimeRatio:number;confidence:number}>;
  invalidation:string[];
  confidence:number;
  reasonCodes:string[];
  provenance:Record<string,string>;
}
function classFromRegime(r:RegimeAssessment):string{const map:Record<string,string>={SIDEWAYS:'SIDEWAYS_FEE_HARVEST',CONSOLIDATION:'CONSOLIDATION_LP',CONTROLLED_PULLBACK:'CONTROLLED_PULLBACK_LP',BREAKOUT_CONTROLLED_PULLBACK:'BREAKOUT_PULLBACK_LP',RECOVERY:'CONTROLLED_PULLBACK_LP'};return map[r.primary]??'DEFENSIVE_WIDE_LP';}
export async function generateLpThesis(input:{pool:PoolAssessment;regime:RegimeAssessment;economics:OpportunityEconomics;candidate:RangeStrategyCandidate;ranking:CandidateRankingResult;survival:SurvivalForecast[];observedAt:string;expiresAt:string;numeraire?:string;provenance?:Record<string,string>}):Promise<MachineReadableLpThesis>{
 if(input.ranking.winner==='NO_TRADE'||input.ranking.winner!==input.candidate.id)throw new Error('LPFORGE_THESIS_REQUIRES_SELECTED_WINNER');if(!input.economics.economicallyPositive)throw new Error('LPFORGE_THESIS_REQUIRES_POSITIVE_ECONOMICS');
 const expectedRegimes=input.regime.probabilities.slice(0,3).map((x)=>({label:x.label,probability:x.probability}));const invalidation=['FORWARD_EV_NON_POSITIVE','REGIME_FREEFALL_PROBABILITY_EXCEEDS_POLICY','POOL_ELIGIBILITY_BLOCK','FLOW_TOXICITY_EXCEEDS_POLICY','REFERENCE_DIVERGENCE_EXCEEDS_POLICY','RANGE_SURVIVAL_BELOW_POLICY','CRITICAL_DATA_STALE'];if(input.regime.primary==='CONTROLLED_PULLBACK'||input.regime.primary==='BREAKOUT_CONTROLLED_PULLBACK')invalidation.push('PULLBACK_SUPPORT_INVALIDATED');
 const survival:MachineReadableLpThesis['rangeSurvival']={};for(const f of input.survival.filter((x)=>x.rangeId===input.candidate.id||x.rangeId===input.candidate.family.toLowerCase()||x.rangeId===input.candidate.family))survival[`${f.horizonMinutes}m`]={probability:f.survivalProbability,activeTimeRatio:f.expectedActiveTimeRatio,confidence:f.confidence};
 const core={schemaVersion:'lp-thesis-v1' as const,recommendationOnly:true as const,observedAt:input.observedAt,expiresAt:input.expiresAt,pool:input.pool.pool,opportunityClass:classFromRegime(input.regime),numeraire:input.numeraire??'SOL',horizonMinutes:input.economics.horizonMinutes,expectedRegimes,forbiddenRegimes:['FREEFALL'],selectedCandidate:{id:input.candidate.id,strategy:input.candidate.strategy,orientation:input.candidate.orientation,lowerBinId:input.candidate.lowerBinId,upperBinId:input.candidate.upperBinId,centerBinId:input.candidate.centerBinId,widthBins:input.candidate.widthBins,capitalFraction:input.candidate.capitalFraction},expectedEconomics:{feeValue:input.economics.expectedFeeValue,inventoryPnl:input.economics.expectedInventoryPnl,hodlRelativePnl:input.economics.expectedHodlRelativePnl,executionCost:input.economics.expectedExecutionCost,repositionCost:input.economics.expectedRepositionCost,tailRiskCharge:input.economics.expectedTailRiskCharge,netLpValue:input.economics.expectedNetLpValue,uncertainty:input.economics.uncertainty},rangeSurvival:survival,invalidation,confidence:Math.max(0,Math.min(1,input.regime.confidence*(1-input.economics.uncertainty))),reasonCodes:[...new Set([...input.ranking.reasonCodes,'MACHINE_READABLE_THESIS'])].sort(),provenance:input.provenance??{}};
 return{thesisId:await sha256Hex(canonicalJson(core)),...core};
}
