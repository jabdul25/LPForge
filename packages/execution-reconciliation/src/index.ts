// LPFORGE_PHASE5_EXECUTION_MODULE
import type { ExecutionAction, ReconciliationResultContract } from '../../execution-contracts/src/index.js';
export interface PositionTruth {positionAddress:string;exists:boolean;ownerAddress?:string;poolAddress?:string;lowerBinId?:number;upperBinId?:number;tokenXAmount?:string;tokenYAmount?:string;}
export interface ReconciliationExpected {action:ExecutionAction;ownerAddress:string;poolAddress:string;oldPositionAddress?:string;newPositionAddress?:string;expectedLowerBinId?:number;expectedUpperBinId?:number;maxNativeDebitLamports?:bigint;minNativeCreditLamports?:bigint;}
export interface ReconciliationActual {positions:PositionTruth[];nativeLamportsBefore?:bigint;nativeLamportsAfter?:bigint;confirmed:boolean;dataFresh:boolean;}
function pos(actual:ReconciliationActual,address:string|undefined){return address?actual.positions.find(p=>p.positionAddress===address):undefined;}
export function reconcileExecutionPlan(input:{planId:string;observedAt:string;expected:ReconciliationExpected;actual:ReconciliationActual}):ReconciliationResultContract{
  const d:string[]=[];const e=input.expected,a=input.actual;if(!a.confirmed)d.push('RECON_TX_NOT_CONFIRMED');if(!a.dataFresh)d.push('RECON_DATA_STALE');
  const old=pos(a,e.oldPositionAddress),fresh=pos(a,e.newPositionAddress);
  if(e.action==='OPEN'||e.action==='RESHAPE'||e.action==='REBALANCE'){
    if(!e.newPositionAddress)d.push('RECON_NEW_POSITION_EXPECTATION_MISSING');else if(!fresh?.exists)d.push('RECON_NEW_POSITION_MISSING');else{if(fresh.ownerAddress!==e.ownerAddress)d.push('RECON_OWNER_MISMATCH');if(fresh.poolAddress!==e.poolAddress)d.push('RECON_POOL_MISMATCH');if(e.expectedLowerBinId!==undefined&&fresh.lowerBinId!==e.expectedLowerBinId)d.push('RECON_LOWER_BIN_MISMATCH');if(e.expectedUpperBinId!==undefined&&fresh.upperBinId!==e.expectedUpperBinId)d.push('RECON_UPPER_BIN_MISMATCH');}
  }
  if(e.action==='CLOSE'||e.action==='EMERGENCY_CLOSE'||e.action==='RESHAPE'||e.action==='REBALANCE'){if(!e.oldPositionAddress)d.push('RECON_OLD_POSITION_EXPECTATION_MISSING');else if(old?.exists)d.push('RECON_OLD_POSITION_STILL_EXISTS');}
  if(e.action==='REDUCE'||e.action==='ADD'||e.action==='CLAIM'){if(!e.oldPositionAddress)d.push('RECON_POSITION_EXPECTATION_MISSING');else if(!old?.exists)d.push('RECON_EXISTING_POSITION_MISSING');}
  if(a.nativeLamportsBefore!==undefined&&a.nativeLamportsAfter!==undefined){const delta=a.nativeLamportsAfter-a.nativeLamportsBefore;if(e.maxNativeDebitLamports!==undefined&&delta< -e.maxNativeDebitLamports)d.push('RECON_NATIVE_DEBIT_EXCEEDED');if(e.minNativeCreditLamports!==undefined&&delta<e.minNativeCreditLamports)d.push('RECON_NATIVE_CREDIT_BELOW_EXPECTATION');}
  const hard=d.filter(x=>!['RECON_TX_NOT_CONFIRMED','RECON_DATA_STALE'].includes(x));const status:ReconciliationResultContract['status']=hard.length?'MISMATCH':d.length?'UNKNOWN':'MATCH';return{planId:input.planId,observedAt:input.observedAt,status,expected:{...e,maxNativeDebitLamports:e.maxNativeDebitLamports?.toString(),minNativeCreditLamports:e.minNativeCreditLamports?.toString()},actual:{...a,nativeLamportsBefore:a.nativeLamportsBefore?.toString(),nativeLamportsAfter:a.nativeLamportsAfter?.toString()},discrepancies:d};
}
export function reconciliationAllowsNextEconomicAction(result:ReconciliationResultContract):boolean{return result.status==='MATCH';}
