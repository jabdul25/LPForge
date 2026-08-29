// LPFORGE_PHASE5_EXECUTION_MODULE
import { Transaction, VersionedTransaction, type Connection } from '@solana/web3.js';
import { assertAuthority, type ExecutionAuthority, type SimulationResultContract } from '../../execution-contracts/src/index.js';
import { recommendComputeUnitLimit } from '../../execution-cost/src/index.js';
export interface SimulationTransportResult {err:unknown;logs?:string[]|null;unitsConsumed?:number;accounts?:Record<string,unknown>;}
export interface SimulationTransport {simulate(transaction:object,options:{sigVerify:false;replaceRecentBlockhash:true}):Promise<SimulationTransportResult>;}
export interface SimulationGatewayResult extends SimulationResultContract {recommendedComputeUnitLimit?:number;simulationFreshUntil:string;}
export async function simulateExecutionTransaction(input:{authority:ExecutionAuthority;transactionId:string;transaction:object;transport:SimulationTransport;simulatedAt:string;freshnessMs:number}):Promise<SimulationGatewayResult>{
  assertAuthority(input.authority,['SIMULATE_ONLY','DEVNET_SIGN','DEVNET_SUBMIT','MAINNET_BUILD_SIMULATE','MAINNET_CANARY'],input.simulatedAt);
  if(!Number.isInteger(input.freshnessMs)||input.freshnessMs<1000||input.freshnessMs>120000)throw new Error('LPFORGE_SIMULATION_FRESHNESS_INVALID');
  const raw=await input.transport.simulate(input.transaction,{sigVerify:false,replaceRecentBlockhash:true});const ok=raw.err==null;const result:SimulationGatewayResult={transactionId:input.transactionId,simulatedAt:input.simulatedAt,ok,logs:raw.logs??[],simulationFreshUntil:new Date(Date.parse(input.simulatedAt)+input.freshnessMs).toISOString(),...(raw.unitsConsumed!==undefined?{unitsConsumed:raw.unitsConsumed,recommendedComputeUnitLimit:recommendComputeUnitLimit(raw.unitsConsumed)}:{}),...(raw.err!=null?{error:typeof raw.err==='string'?raw.err:JSON.stringify(raw.err)}:{}),...(raw.accounts?{accountDiff:raw.accounts}:{})};return result;
}

/**
 * web3.js 1.98.x exposes different simulateTransaction overloads:
 * - VersionedTransaction accepts SimulateTransactionConfig.
 * - legacy Transaction accepts signers/includeAccounts, not the config object.
 *
 * For a legacy Transaction, calling simulateTransaction(tx) already refreshes the
 * recent blockhash internally and does not enable signature verification when no
 * signers are supplied. That is equivalent to LPForge's unsigned pre-sign
 * simulation policy without hitting web3.js's Invalid arguments guard.
 */
export function createWeb3SimulationTransport(connection:Pick<Connection,'simulateTransaction'>):SimulationTransport{return{async simulate(transaction,options){let r;if(transaction instanceof VersionedTransaction){r=await connection.simulateTransaction(transaction,options);}else if(transaction instanceof Transaction){r=await connection.simulateTransaction(transaction);}else{throw new Error('LPFORGE_SIMULATION_UNSUPPORTED_TRANSACTION_TYPE');}return{err:r.value.err,...(r.value.logs!==undefined?{logs:r.value.logs}:{}),...(r.value.unitsConsumed!==undefined?{unitsConsumed:r.value.unitsConsumed}:{}),...(r.value.accounts!==undefined?{accounts:{raw:r.value.accounts}}:{})};}};}
