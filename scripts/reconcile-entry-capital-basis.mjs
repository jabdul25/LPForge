/**
 * Deterministic, receipt-backed repair for a historical live entry basis.
 * It appends a versioned basis and (only when needed) an append-only delta
 * cashflow. It never updates an historical receipt/cashflow row, signs, or
 * submits a transaction.
 */
import {Connection} from '@solana/web3.js';
import {createPostgresStore} from '../.build/packages/db/src/index.js';
import {loadParsedConfirmedExecutionReceipt} from '../.build/packages/transaction-receipt/src/index.js';
import {deriveReceiptBackedEntryBasis,deriveReceiptBoundSolContribution,receiptBoundOwnerTokenDebits} from '../.build/packages/entry-capital-basis/src/index.js';

const positionAddress=process.argv[2];
if(!positionAddress)throw new Error('POSITION_ADDRESS_REQUIRED');
const dryRun=process.argv.includes('--dry-run');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL_REQUIRED');
const rpcUrl=process.env.LPFORGE_PRODUCTION_RPC_URL;
if(!rpcUrl)throw new Error('LPFORGE_PRODUCTION_RPC_URL_REQUIRED');
const {Client}=await import('pg');
const db=new Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try{
  const positionResult=await db.query(`SELECT position_address,entry_plan_id,owner_address,initial_capital_lamports FROM execution.owned_positions WHERE position_address=$1`,[positionAddress]);
  const position=positionResult.rows[0];
  if(!position?.entry_plan_id)throw new Error('ENTRY_PLAN_NOT_FOUND');
  const planId=String(position.entry_plan_id),ownerAddress=String(position.owner_address),requested=BigInt(String(position.initial_capital_lamports));
  const refs=(await db.query(`SELECT s.transaction_id,s.kind,a.signature FROM execution.transaction_steps s JOIN LATERAL (SELECT a.signature FROM execution.submission_attempts a JOIN execution.confirmations c ON c.attempt_id=a.attempt_id WHERE a.transaction_id=s.transaction_id AND a.signature IS NOT NULL AND c.status IN ('CONFIRMED','FINALIZED') ORDER BY a.attempt DESC,c.observed_at DESC LIMIT 1) a ON true WHERE s.plan_id=$1 ORDER BY s.sequence`,[planId])).rows.map(row=>({transactionId:String(row.transaction_id),kind:String(row.kind),signature:String(row.signature)}));
  const planFlows=(await db.query(`SELECT flow_type,lamports,token_mint,token_amount_raw,transaction_signature FROM execution.plan_cashflows WHERE plan_id=$1`,[planId])).rows;
  const funded=planFlows.find(row=>row.flow_type==='ENTRY_FUNDING_X_IN');
  const fundingRef=refs.find(row=>row.kind==='JUPITER_SWAP');
  const fundingRaw=funded?.token_amount_raw===undefined||funded?.token_amount_raw===null?0n:BigInt(String(funded.token_amount_raw));
  const fundingMint=funded?.token_mint?String(funded.token_mint):undefined;
  const connection=new Connection(rpcUrl,'confirmed');
  const rows=[];
  for(const ref of refs){rows.push({...ref,receipt:await loadParsedConfirmedExecutionReceipt(connection,ref.signature)});}
  let executionCost=0n,rentDebits=0n,rentRefunds=0n,fundingPrincipal=0n,openPrincipal=0n,depositedPaired=0n;
  const reasons=[];
  for(const row of rows){
    const contribution=deriveReceiptBoundSolContribution({receipt:row.receipt,ownerAddress,positionAddress,...(row.receipt.staticAccountKeys[0]?{feePayerAddress:row.receipt.staticAccountKeys[0]}:{})});
    if(!contribution){reasons.push(`ENTRY_BASIS_RECEIPT_UNAVAILABLE:${row.transactionId}`);continue;}
    executionCost+=contribution.transactionFeeLamports;
    if(row.kind==='JUPITER_SWAP'){fundingPrincipal+=contribution.principalLamports;rentDebits+=contribution.recoverableRentDebitsLamports;rentRefunds+=contribution.recoverableRentRefundsLamports;}
    if(row.kind==='METEORA_OPEN'||row.kind==='METEORA_OPEN_CHUNK'){
      openPrincipal+=contribution.principalLamports;
      rentDebits+=contribution.recoverableRentDebitsLamports;rentRefunds+=contribution.recoverableRentRefundsLamports;
      if(fundingMint)depositedPaired+=receiptBoundOwnerTokenDebits({receipt:row.receipt,ownerAddress,mint:fundingMint}).reduce((total,effect)=>total+effect.rawAmount,0n);
    }else if(row.kind==='METEORA_POSITION_EXTEND'){
      rentDebits+=contribution.recoverableRentDebitsLamports;rentRefunds+=contribution.recoverableRentRefundsLamports;
    }
  }
  const basis=deriveReceiptBackedEntryBasis({requestedLiquidityCapitalLamports:requested,fundingPrincipalLamports:fundingPrincipal,fundedPairedTokenRaw:fundingRaw,openSolPrincipalLamports:openPrincipal,depositedPairedTokenRaw:depositedPaired,executionCostLamports:executionCost,recoverableRentDebitsLamports:rentDebits,recoverableRentRefundsLamports:rentRefunds});
  reasons.push(...basis.reasonCodes);
  const proven=reasons.length===0;
  const summary={positionAddress,planId,basisState:proven?'PROVEN':'INCOMPLETE',requestedLiquidityCapitalLamports:requested.toString(),lpPositionPrincipalLamports:basis.lpPositionPrincipalLamports.toString(),managedEconomicContributionLamports:basis.managedEconomicContributionLamports.toString(),executionCostLamports:executionCost.toString(),recoverableRentDebitsLamports:rentDebits.toString(),recoverableRentRefundsLamports:rentRefunds.toString(),openContributionCorrectionLamports:'0',dryRun};
  if(dryRun){
    console.log(JSON.stringify(summary,null,2));
  }else{
    const store=await createPostgresStore(process.env.DATABASE_URL);
    await store.insertPositionEntryBasis({basisId:`${planId}:entry-basis:v1`,positionAddress,entryPlanId:planId,classificationVersion:1,basisState:proven?'PROVEN':'INCOMPLETE',requestedLiquidityCapitalLamports:requested,...(proven?{lpPositionPrincipalLamports:basis.lpPositionPrincipalLamports,managedEconomicContributionLamports:basis.managedEconomicContributionLamports}:{}),executionCostLamports:executionCost,recoverableRentDebitsLamports:rentDebits,recoverableRentRefundsLamports:rentRefunds,unclassifiedLamports:basis.unclassifiedLamports,receiptProvenance:{source:'HISTORICAL_CONFIRMED_ENTRY_RECEIPTS_V1',fundingPrincipalLamports:fundingPrincipal.toString(),openSolPrincipalLamports:openPrincipal.toString(),fundedPairedTokenRaw:fundingRaw.toString(),depositedPairedTokenRaw:depositedPaired.toString(),residualPairedTokenPrincipalLamports:basis.residualPairedTokenPrincipalLamports.toString(),receipts:rows.map(row=>({transactionId:row.transactionId,kind:row.kind,signature:row.signature,state:row.receipt.state})),reasonCodes:[...new Set(reasons)].sort()},observedAt:new Date().toISOString()});
    if(!proven)throw new Error(`ENTRY_BASIS_UNPROVEN:${[...new Set(reasons)].sort().join(',')}`);
    const openFlows=await db.query(`SELECT COALESCE(sum(lamports),0)::text AS lamports FROM execution.position_cashflows WHERE position_address=$1 AND plan_id=$2 AND flow_type='OPEN_CONTRIBUTION'`,[positionAddress,planId]);
    const priorContribution=BigInt(String(openFlows.rows[0].lamports));
    const correction=basis.managedEconomicContributionLamports-priorContribution;
    if(correction!==0n)await store.insertPositionCashflow({cashflowId:`${planId}:entry-basis-correction:v1`,positionAddress,planId,flowType:'ENTRY_BASIS_CORRECTION',observedAt:new Date().toISOString(),lamports:correction,payload:{source:'HISTORICAL_RECEIPT_BACKED_ENTRY_BASIS_V1',basisId:`${planId}:entry-basis:v1`,priorOpenContributionLamports:priorContribution.toString(),correctedManagedEconomicContributionLamports:basis.managedEconomicContributionLamports.toString(),reason:'NON_PRINCIPAL_RENT_REMOVED_FROM_LEGACY_OPEN_CONTRIBUTION'}});
    const fundingCost=planFlows.find(row=>row.flow_type==='FUNDING_TX_COST');
    if(fundingCost?.lamports!==undefined&&fundingCost?.lamports!==null)await store.insertPositionCashflow({cashflowId:`${planId}:tx-cost:funding`,positionAddress,planId,flowType:'TX_COST',observedAt:new Date().toISOString(),lamports:BigInt(String(fundingCost.lamports)),payload:{source:'ENTRY_FUNDING_RECEIPT',...(fundingCost.transaction_signature?{signature:String(fundingCost.transaction_signature)}:{})}});
    console.log(JSON.stringify({...summary,openContributionCorrectionLamports:correction.toString(),dryRun:false},null,2));
  }
}finally{await db.end();}
