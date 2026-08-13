// LPFORGE_PHASE5_EXECUTION_MODULE
import type { ExecutionAction, ExecutionCluster, ExecutionIntent, PlannedTransaction, TransactionIntentKind, TransactionPlan } from '../../execution-contracts/src/index.js';

export interface PlanRequest {
  action:ExecutionAction;cluster:ExecutionCluster;ownerAddress:string;poolAddress:string;positionAddress?:string;replacementPositionAddress?:string;
  thesisId:string;candidateId?:string;observedAt:string;expiresAt:string;capitalLamports?:bigint;lowerBinId?:number;upperBinId?:number;strategy?:'SPOT'|'CURVE'|'BID_ASK';
  reductionBps?:number;claimOnClose?:boolean;metadata?:Record<string,unknown>;
}
function hash(value:string){let a=0x811c9dc5n,b=0x9e3779b97f4a7c15n;for(const ch of value){const c=BigInt(ch.codePointAt(0)??0);a=((a^c)*0x100000001b3n)&0xffffffffffffffffn;b=((b+c+0x9e3779b9n)^(b<<6n)^(b>>2n))&0xffffffffffffffffn;}return a.toString(16).padStart(16,'0')+b.toString(16).padStart(16,'0');}
function stableKey(r:PlanRequest){return hash(JSON.stringify({...r,capitalLamports:r.capitalLamports?.toString(),metadata:r.metadata??{}},Object.keys({...r,metadata:r.metadata??{}}).sort()));}
function tx(kind:TransactionIntentKind,sequence:number,owner:string,position?:string,metadata:Record<string,unknown>={}):PlannedTransaction{return{transactionId:`tx-${sequence}-${hash(`${kind}:${owner}:${position??''}:${JSON.stringify(metadata)}`)}`,sequence,kind,requiredSignerAddresses:[owner,...(kind==='METEORA_OPEN'&&position?[position]:[])],writableAccounts:[...(position?[position]:[])],state:'PLANNED',metadata};}

export function buildTransactionPlan(r:PlanRequest):TransactionPlan{
  if(Date.parse(r.expiresAt)<=Date.parse(r.observedAt))throw new Error('LPFORGE_PLAN_ALREADY_EXPIRED');
  if((r.action==='REDUCE'||r.action==='CLOSE'||r.action==='EMERGENCY_CLOSE'||r.action==='CLAIM'||r.action==='RESHAPE'||r.action==='REBALANCE')&&!r.positionAddress)throw new Error(`LPFORGE_PLAN_POSITION_REQUIRED:${r.action}`);
  if((r.action==='OPEN'||r.action==='RESHAPE'||r.action==='REBALANCE')&&(r.lowerBinId===undefined||r.upperBinId===undefined||!r.strategy))throw new Error(`LPFORGE_PLAN_RANGE_REQUIRED:${r.action}`);
  if(r.lowerBinId!==undefined&&r.upperBinId!==undefined&&r.lowerBinId>r.upperBinId)throw new Error('LPFORGE_PLAN_INVALID_RANGE');
  const key=stableKey(r); const intent:ExecutionIntent={intentId:`intent-${key}`,idempotencyKey:key,action:r.action,poolAddress:r.poolAddress,ownerAddress:r.ownerAddress,...(r.positionAddress?{positionAddress:r.positionAddress}:{}),...(r.candidateId?{candidateId:r.candidateId}:{}),thesisId:r.thesisId,observedAt:r.observedAt,expiresAt:r.expiresAt,...(r.capitalLamports!==undefined?{capitalLamports:r.capitalLamports}:{}),...(r.lowerBinId!==undefined?{lowerBinId:r.lowerBinId}:{}),...(r.upperBinId!==undefined?{upperBinId:r.upperBinId}:{}),...(r.strategy?{strategy:r.strategy}:{}),payload:{reductionBps:r.reductionBps??null,claimOnClose:r.claimOnClose??false,...(r.metadata??{})}};
  const transactions:PlannedTransaction[]=[];
  if(r.action==='OPEN')transactions.push(tx('METEORA_OPEN',1,r.ownerAddress,r.replacementPositionAddress??r.positionAddress,{lowerBinId:r.lowerBinId,upperBinId:r.upperBinId,strategy:r.strategy}));
  else if(r.action==='ADD')transactions.push(tx('METEORA_ADD',1,r.ownerAddress,r.positionAddress,{capitalLamports:r.capitalLamports?.toString()}));
  else if(r.action==='CLAIM')transactions.push(tx('METEORA_CLAIM',1,r.ownerAddress,r.positionAddress));
  else if(r.action==='REDUCE')transactions.push(tx('METEORA_REMOVE',1,r.ownerAddress,r.positionAddress,{bps:r.reductionBps??0,claimAndClose:false}));
  else if(r.action==='CLOSE'||r.action==='EMERGENCY_CLOSE')transactions.push(tx('METEORA_CLOSE',1,r.ownerAddress,r.positionAddress,{bps:10_000,claimAndClose:true,emergency:r.action==='EMERGENCY_CLOSE'}));
  else if(r.action==='RESHAPE'||r.action==='REBALANCE'){
    if(!r.replacementPositionAddress)throw new Error(`LPFORGE_PLAN_REPLACEMENT_POSITION_REQUIRED:${r.action}`);
    transactions.push(tx('METEORA_CLOSE',1,r.ownerAddress,r.positionAddress,{bps:10_000,claimAndClose:true,managementAction:r.action}));
    transactions.push(tx('METEORA_OPEN',2,r.ownerAddress,r.replacementPositionAddress,{lowerBinId:r.lowerBinId,upperBinId:r.upperBinId,strategy:r.strategy,managementAction:r.action}));
  }
  return{planId:`plan-${key}`,intent,cluster:r.cluster,createdAt:r.observedAt,expiresAt:r.expiresAt,state:'PLANNED',transactions,reasonCodes:transactions.length>1?['EXECUTION_MULTI_TRANSACTION_PLAN']:[]};
}
