// LPFORGE_PHASE5_EXECUTION_MODULE
export type OpaqueTransaction = object;
export interface OpenBuildRequest {userAddress:string;positionAddress:string;totalXAmount:string|bigint;totalYAmount:string|bigint;lowerBinId:number;upperBinId:number;strategy:'SPOT'|'CURVE'|'BID_ASK';}
export interface AddBuildRequest extends OpenBuildRequest {}
export interface MeteoraOpenAddPoolLike {
  initializePositionAndAddLiquidityByStrategy(args:Record<string,unknown>):Promise<OpaqueTransaction>;
  addLiquidityByStrategy(args:Record<string,unknown>):Promise<OpaqueTransaction>;
}
export function createFixtureMeteoraOpenAddPool():MeteoraOpenAddPoolLike{
  return{
    async initializePositionAndAddLiquidityByStrategy(){return{fixtureUnsigned:true};},
    async addLiquidityByStrategy(){return{fixtureUnsignedAdd:true};}
  };
}
export interface BuiltMeteoraTransaction {transaction:OpaqueTransaction;requiredSignerAddresses:string[];builder:'initializePositionAndAddLiquidityByStrategy'|'addLiquidityByStrategy'|'removeLiquidity'|'claimAllRewardsByPosition';metadata:Record<string,unknown>;}
interface RuntimeSdk {PublicKey:new(value:string)=>{toBase58():string};BN:new(value:string|number|bigint)=>{toString(base?:number):string};StrategyType:{Spot:number;Curve:number;BidAsk:number};dlmmVersion:string;}
let cached:RuntimeSdk|undefined;
export async function loadMeteoraExecutionRuntime():Promise<RuntimeSdk>{
  if(cached)return cached;
  const moduleName='node:module';
  const mod=await import(moduleName) as unknown as {createRequire:(url:string)=>((id:string)=>unknown)&{resolve:(id:string)=>string}};
  const rootRequire=mod.createRequire(import.meta.url); const dlmmEntry=rootRequire.resolve('@meteora-ag/dlmm'); const dlmmRequire=mod.createRequire(dlmmEntry);
  const dlmm=dlmmRequire('@meteora-ag/dlmm') as {StrategyType:{Spot:number;Curve:number;BidAsk:number}};
  const web3=rootRequire('@solana/web3.js') as {PublicKey:RuntimeSdk['PublicKey']};
  const BN=dlmmRequire('bn.js') as RuntimeSdk['BN'];
  // package.json is not exported; derive the installed production lock version explicitly from our compatibility baseline.
  cached={PublicKey:web3.PublicKey,BN,StrategyType:dlmm.StrategyType,dlmmVersion:'1.9.8'}; return cached;
}
function strategyType(s:'SPOT'|'CURVE'|'BID_ASK',r:RuntimeSdk){return s==='SPOT'?r.StrategyType.Spot:s==='CURVE'?r.StrategyType.Curve:r.StrategyType.BidAsk;}
function validateRange(lower:number,upper:number){if(!Number.isInteger(lower)||!Number.isInteger(upper)||lower>upper)throw new Error('LPFORGE_METEORA_BUILD_INVALID_RANGE');}
export async function buildOpenPositionTransaction(pool:MeteoraOpenAddPoolLike,r:OpenBuildRequest):Promise<BuiltMeteoraTransaction>{
  validateRange(r.lowerBinId,r.upperBinId);const sdk=await loadMeteoraExecutionRuntime();
  const args={positionPubKey:new sdk.PublicKey(r.positionAddress),user:new sdk.PublicKey(r.userAddress),totalXAmount:new sdk.BN(r.totalXAmount),totalYAmount:new sdk.BN(r.totalYAmount),strategy:{minBinId:r.lowerBinId,maxBinId:r.upperBinId,strategyType:strategyType(r.strategy,sdk)}};
  const transaction=await pool.initializePositionAndAddLiquidityByStrategy(args);
  return{transaction,requiredSignerAddresses:[r.userAddress,r.positionAddress],builder:'initializePositionAndAddLiquidityByStrategy',metadata:{strategy:r.strategy,lowerBinId:r.lowerBinId,upperBinId:r.upperBinId,totalXAmount:String(r.totalXAmount),totalYAmount:String(r.totalYAmount)}};
}
export async function buildAddLiquidityTransaction(pool:MeteoraOpenAddPoolLike,r:AddBuildRequest):Promise<BuiltMeteoraTransaction>{
  validateRange(r.lowerBinId,r.upperBinId);const sdk=await loadMeteoraExecutionRuntime();
  const args={positionPubKey:new sdk.PublicKey(r.positionAddress),user:new sdk.PublicKey(r.userAddress),totalXAmount:new sdk.BN(r.totalXAmount),totalYAmount:new sdk.BN(r.totalYAmount),strategy:{minBinId:r.lowerBinId,maxBinId:r.upperBinId,strategyType:strategyType(r.strategy,sdk)}};
  const transaction=await pool.addLiquidityByStrategy(args);
  return{transaction,requiredSignerAddresses:[r.userAddress],builder:'addLiquidityByStrategy',metadata:{strategy:r.strategy,lowerBinId:r.lowerBinId,upperBinId:r.upperBinId,totalXAmount:String(r.totalXAmount),totalYAmount:String(r.totalYAmount)}};
}

export interface MeteoraRemoveClaimPoolLike {
  removeLiquidity(args:Record<string,unknown>):Promise<OpaqueTransaction|OpaqueTransaction[]>;
  claimAllRewardsByPosition(args:Record<string,unknown>):Promise<OpaqueTransaction|OpaqueTransaction[]>;
}
export interface RemoveBuildRequest {userAddress:string;positionAddress:string;fromBinId:number;toBinId:number;bps:number;claimAndClose:boolean;}
function many(value:OpaqueTransaction|OpaqueTransaction[]):OpaqueTransaction[]{return Array.isArray(value)?value:[value];}
export async function buildRemoveLiquidityTransactions(pool:MeteoraRemoveClaimPoolLike,r:RemoveBuildRequest):Promise<BuiltMeteoraTransaction[]>{
  if(!Number.isInteger(r.bps)||r.bps<1||r.bps>10_000)throw new Error('LPFORGE_METEORA_REMOVE_BPS'); if(r.fromBinId>r.toBinId)throw new Error('LPFORGE_METEORA_REMOVE_RANGE'); if(r.claimAndClose&&r.bps!==10_000)throw new Error('LPFORGE_METEORA_CLOSE_REQUIRES_FULL_REMOVE');
  const sdk=await loadMeteoraExecutionRuntime(); const result=await pool.removeLiquidity({position:new sdk.PublicKey(r.positionAddress),user:new sdk.PublicKey(r.userAddress),fromBinId:r.fromBinId,toBinId:r.toBinId,bps:new sdk.BN(r.bps),shouldClaimAndClose:r.claimAndClose});
  return many(result).map((transaction,index)=>({transaction,requiredSignerAddresses:[r.userAddress],builder:'removeLiquidity' as const,metadata:{operation:r.claimAndClose?'CLOSE':'REMOVE',chunkIndex:index,chunkCount:many(result).length,bps:r.bps,fromBinId:r.fromBinId,toBinId:r.toBinId}}));
}
export async function buildClaimTransactions(pool:MeteoraRemoveClaimPoolLike,r:{userAddress:string;positionAddress:string}):Promise<BuiltMeteoraTransaction[]>{
  const sdk=await loadMeteoraExecutionRuntime(); const result=await pool.claimAllRewardsByPosition({owner:new sdk.PublicKey(r.userAddress),position:new sdk.PublicKey(r.positionAddress)}); const list=many(result);
  return list.map((transaction,index)=>({transaction,requiredSignerAddresses:[r.userAddress],builder:'claimAllRewardsByPosition' as const,metadata:{operation:'CLAIM',chunkIndex:index,chunkCount:list.length}}));
}
