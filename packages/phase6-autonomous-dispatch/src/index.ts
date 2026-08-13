// LPFORGE_PHASE6_MAINNET_MODULE
import {Transaction} from '@solana/web3.js';
import {buildOpenPositionTransaction,type MeteoraOpenAddPoolLike} from '../../meteora-execution/src/index.js';
import {createEphemeralPositionSigner,type AuxiliaryMainnetSignerBackend} from '../../phase6-mainnet-signer/src/index.js';
import {createLegacyMainnetEnvelope} from '../../phase6-live-envelope/src/index.js';

export interface AutonomousOpenPlan {planId:string;intentId:string;idempotencyKey:string;poolAddress:string;ownerAddress:string;thesisId:string;observedAt:string;expiresAt:string;intentPayload:Record<string,unknown>;planPayload:Record<string,unknown>;transactionId:string;transactionMetadata:Record<string,unknown>;}
export interface PreparedAutonomousOpen {plan:AutonomousOpenPlan;positionSigner:AuxiliaryMainnetSignerBackend;requiredSignerAddresses:string[];transaction:Transaction;envelope:ReturnType<typeof createLegacyMainnetEnvelope>;metadata:Record<string,unknown>;}
function object(value:unknown,code:string){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(code);return value as Record<string,unknown>;}
function integer(value:unknown,code:string){const n=Number(value);if(!Number.isInteger(n))throw new Error(code);return n;}
function text(value:unknown,code:string){if(typeof value!=='string'||!value.trim())throw new Error(code);return value.trim();}
function openFields(plan:AutonomousOpenPlan){const intent=object(plan.planPayload.intent,'LPFORGE_P6_AUTONOMOUS_PLAN_INTENT_MISSING'),funding=object(plan.intentPayload.entryFunding,'LPFORGE_P6_AUTONOMOUS_PLAN_FUNDING_MISSING');const strategy=intent.strategy;if(strategy!=='SPOT'&&strategy!=='CURVE'&&strategy!=='BID_ASK')throw new Error('LPFORGE_P6_AUTONOMOUS_PLAN_STRATEGY');return{lowerBinId:integer(intent.lowerBinId,'LPFORGE_P6_AUTONOMOUS_PLAN_LOWER_BIN'),upperBinId:integer(intent.upperBinId,'LPFORGE_P6_AUTONOMOUS_PLAN_UPPER_BIN'),strategy:strategy as 'SPOT'|'CURVE'|'BID_ASK',totalXAmount:text(funding.totalPairedTokenRaw,'LPFORGE_P6_AUTONOMOUS_PLAN_TOTAL_X'),totalYAmount:text(funding.solForLpLamports,'LPFORGE_P6_AUTONOMOUS_PLAN_TOTAL_Y')};}
/**
 * Binds a fresh stored decision to one fresh PositionV2 account and a real
 * SDK-built transaction. This has no signer-owner or network-send capability.
 */
export async function prepareAutonomousMeteoraOpen(input:{plan:AutonomousOpenPlan;pool:MeteoraOpenAddPoolLike}):Promise<PreparedAutonomousOpen>{
  if(Date.parse(input.plan.expiresAt)<=Date.now())throw new Error('LPFORGE_P6_AUTONOMOUS_PLAN_EXPIRED');
  const fields=openFields(input.plan),positionSigner=createEphemeralPositionSigner();
  const built=await buildOpenPositionTransaction(input.pool,{userAddress:input.plan.ownerAddress,positionAddress:positionSigner.publicKeyAddress,totalXAmount:fields.totalXAmount,totalYAmount:fields.totalYAmount,lowerBinId:fields.lowerBinId,upperBinId:fields.upperBinId,strategy:fields.strategy});
  if(!(built.transaction instanceof Transaction))throw new Error('LPFORGE_P6_AUTONOMOUS_OPEN_TRANSACTION_UNSUPPORTED');
  const required=[...new Set([...built.requiredSignerAddresses,input.plan.ownerAddress,positionSigner.publicKeyAddress])];
  return{plan:input.plan,positionSigner,requiredSignerAddresses:required,transaction:built.transaction,envelope:createLegacyMainnetEnvelope(built.transaction),metadata:{...built.metadata,planId:input.plan.planId,thesisId:input.plan.thesisId,positionAddress:positionSigner.publicKeyAddress,autonomous:true}};
}
