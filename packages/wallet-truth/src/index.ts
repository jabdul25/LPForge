// LPFORGE_PHASE5_EXECUTION_MODULE
import type { ExecutionCluster } from '../../execution-contracts/src/index.js';

export interface TokenBalanceFact {mint:string;rawAmount:bigint;decimals:number;uiAmount:number;tokenAccount:string;slot:bigint;}
export interface WalletPositionFact {positionAddress:string;poolAddress:string;lowerBinId:number;upperBinId:number;tokenXAmount:string;tokenYAmount:string;slot:bigint;}
export interface CapitalReservation {reservationId:string;reason:string;lamports:bigint;expiresAt:string;}
export interface WalletTruthSnapshot {
  ownerAddress:string;cluster:ExecutionCluster;observedAt:string;slot:bigint;
  nativeLamports:bigint;tokenBalances:TokenBalanceFact[];positions:WalletPositionFact[];
  activeReservations:CapitalReservation[];reservedLamports:bigint;availableLamports:bigint;
  consistency:'CONSISTENT'|'SLOT_SKEW'|'NEGATIVE_AVAILABLE';reasonCodes:string[];
}
export interface WalletTruthReader {
  getNativeBalance(ownerAddress:string):Promise<{lamports:bigint;slot:bigint}>;
  getTokenBalances(ownerAddress:string):Promise<TokenBalanceFact[]>;
  getDlmmPositions(ownerAddress:string):Promise<WalletPositionFact[]>;
}
export interface WalletTruthPolicy {maxSlotSkew:bigint;}
export const WALLET_TRUTH_POLICY_V1:WalletTruthPolicy={maxSlotSkew:8n};

export async function observeWalletTruth(input:{ownerAddress:string;cluster:ExecutionCluster;observedAt:string;reader:WalletTruthReader;reservations?:CapitalReservation[];policy?:WalletTruthPolicy}):Promise<WalletTruthSnapshot>{
  const policy=input.policy??WALLET_TRUTH_POLICY_V1;
  const [native,tokens,positions]=await Promise.all([input.reader.getNativeBalance(input.ownerAddress),input.reader.getTokenBalances(input.ownerAddress),input.reader.getDlmmPositions(input.ownerAddress)]);
  const slots=[native.slot,...tokens.map(v=>v.slot),...positions.map(v=>v.slot)];
  const maxSlot=slots.reduce((a,b)=>a>b?a:b,native.slot); const minSlot=slots.reduce((a,b)=>a<b?a:b,native.slot);
  const active=(input.reservations??[]).filter(r=>Date.parse(r.expiresAt)>Date.parse(input.observedAt));
  const reserved=active.reduce((sum,r)=>sum+r.lamports,0n); const available=native.lamports-reserved;
  const reasons:string[]=[]; if(maxSlot-minSlot>policy.maxSlotSkew)reasons.push('WALLET_TRUTH_SLOT_SKEW'); if(available<0n)reasons.push('WALLET_TRUTH_RESERVATIONS_EXCEED_BALANCE');
  const consistency=available<0n?'NEGATIVE_AVAILABLE':reasons.includes('WALLET_TRUTH_SLOT_SKEW')?'SLOT_SKEW':'CONSISTENT';
  return{ownerAddress:input.ownerAddress,cluster:input.cluster,observedAt:input.observedAt,slot:maxSlot,nativeLamports:native.lamports,tokenBalances:tokens,positions,activeReservations:active,reservedLamports:reserved,availableLamports:available,consistency,reasonCodes:reasons};
}

export function requireConsistentWalletTruth(snapshot:WalletTruthSnapshot):void{if(snapshot.consistency!=='CONSISTENT')throw new Error(`LPFORGE_WALLET_TRUTH_NOT_CONSISTENT:${snapshot.consistency}`);}
