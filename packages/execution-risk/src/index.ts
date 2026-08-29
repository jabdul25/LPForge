// LPFORGE_PHASE5_EXECUTION_MODULE
import type { ExecutionAction } from '../../execution-contracts/src/index.js';
export interface ExecutionRiskPolicy {maxReferenceDivergenceBps:number;maxActiveBinDriftBins:number;approvalTtlMs:number;allowEmergencyCostOverride:boolean;}
export interface ExecutionRiskFacts {action:ExecutionAction;planId:string;now:string;thesisExpiresAt:string;planExpiresAt:string;simulationOk:boolean;simulationFreshUntil:string;walletTruthConsistent:boolean;protocolCompatible:boolean;rpcHealthy:boolean;referenceDivergenceBps:number;activeBinId:number;intendedCenterBinId:number;costApproved:boolean;reconciliationRequired:boolean;globalKillSwitch:boolean;liquidityCollapse:boolean;}
export interface ExecutionRiskDecision {decision:'APPROVE'|'BLOCK'|'EMERGENCY';permitId?:string;issuedAt:string;expiresAt?:string;reasonCodes:string[];hardBlocks:string[];emergencyReasons:string[];}
const increasing=new Set<ExecutionAction>(['OPEN','ADD','RESHAPE','REBALANCE']); const exits=new Set<ExecutionAction>(['REDUCE','CLOSE','EMERGENCY_CLOSE']);
function id(input:ExecutionRiskFacts){let n=2166136261>>>0;for(const c of `${input.planId}:${input.action}:${input.now}`){n^=c.charCodeAt(0);n=Math.imul(n,16777619)>>>0;}return `exec-permit-${n.toString(16).padStart(8,'0')}`;}
export function governExecutionRisk(f:ExecutionRiskFacts,p:ExecutionRiskPolicy):ExecutionRiskDecision{
  if(p.maxReferenceDivergenceBps<0||p.maxActiveBinDriftBins<0||p.approvalTtlMs<1000||p.approvalTtlMs>120000)throw new Error('LPFORGE_EXECUTION_RISK_POLICY_INVALID');
  const blocks:string[]=[];const emergency:string[]=[];const reasons:string[]=[];const now=Date.parse(f.now);
  if(!f.simulationOk)blocks.push('EXEC_SIMULATION_FAILED');if(Date.parse(f.simulationFreshUntil)<=now)blocks.push('EXEC_SIMULATION_STALE');if(!f.walletTruthConsistent)blocks.push('EXEC_WALLET_TRUTH_INCONSISTENT');if(!f.protocolCompatible)blocks.push('EXEC_PROTOCOL_INCOMPATIBLE');if(!f.rpcHealthy)blocks.push('EXEC_RPC_UNHEALTHY');if(f.reconciliationRequired)blocks.push('EXEC_RECONCILIATION_REQUIRED');if(Date.parse(f.planExpiresAt)<=now)blocks.push('EXEC_PLAN_EXPIRED');
  if(increasing.has(f.action)&&Date.parse(f.thesisExpiresAt)<=now)blocks.push('EXEC_THESIS_EXPIRED');if(increasing.has(f.action)&&Math.abs(f.activeBinId-f.intendedCenterBinId)>p.maxActiveBinDriftBins)blocks.push('EXEC_ACTIVE_BIN_DRIFT');if(f.referenceDivergenceBps>p.maxReferenceDivergenceBps)blocks.push('EXEC_REFERENCE_DIVERGENCE');
  if(!f.costApproved&&!(f.action==='EMERGENCY_CLOSE'&&p.allowEmergencyCostOverride))blocks.push('EXEC_COST_NOT_APPROVED');
  if(f.globalKillSwitch&&increasing.has(f.action))blocks.push('EXEC_GLOBAL_KILL_SWITCH');if(f.globalKillSwitch&&exits.has(f.action))reasons.push('EXEC_KILL_SWITCH_EXIT_ONLY');
  if(f.liquidityCollapse){if(increasing.has(f.action))emergency.push('EXEC_LIQUIDITY_COLLAPSE');else reasons.push('EXEC_LIQUIDITY_COLLAPSE_EXIT_PATH');}
  if(emergency.length&&f.action!=='EMERGENCY_CLOSE')return{decision:'EMERGENCY',issuedAt:f.now,reasonCodes:[...new Set([...reasons,...emergency])],hardBlocks:blocks,emergencyReasons:emergency};
  if(blocks.length)return{decision:'BLOCK',issuedAt:f.now,reasonCodes:[...new Set([...reasons,...blocks])],hardBlocks:blocks,emergencyReasons:emergency};
  const expiresAt=new Date(now+p.approvalTtlMs).toISOString();return{decision:'APPROVE',permitId:id(f),issuedAt:f.now,expiresAt,reasonCodes:reasons,hardBlocks:[],emergencyReasons:emergency};
}
