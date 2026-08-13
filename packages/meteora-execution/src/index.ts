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
interface RuntimeSdk {
  PublicKey:new(value:string)=>{toBase58():string};
  Connection:new(url:string,commitment:'confirmed')=>unknown;
  DLMM:{create(connection:unknown,pool:unknown,options:Record<string,unknown>):Promise<MeteoraOpenAddPoolLike>};
  BN:new(value:string|number|bigint)=>{toString(base?:number):string};
  StrategyType:{Spot:number;Curve:number;BidAsk:number};
  calculateSpotDistribution(activeBinId:number,binIds:number[]):Array<{binId:number;xAmountBpsOfTotal:{toString(base?:number):string};yAmountBpsOfTotal:{toString(base?:number):string}}>;
  calculateNormalDistribution(activeBinId:number,binIds:number[]):Array<{binId:number;xAmountBpsOfTotal:{toString(base?:number):string};yAmountBpsOfTotal:{toString(base?:number):string}}>;
  calculateBidAskDistribution(activeBinId:number,binIds:number[]):Array<{binId:number;xAmountBpsOfTotal:{toString(base?:number):string};yAmountBpsOfTotal:{toString(base?:number):string}}>;
  autoFillXByStrategy(activeBinId:number,binStep:number,amountY:{toString(base?:number):string},amountXInActiveBin:{toString(base?:number):string},amountYInActiveBin:{toString(base?:number):string},lowerBinId:number,upperBinId:number,strategyType:number):{toString(base?:number):string};
  getPriceOfBinByBinId(binId:number,binStep:number):{toFixed(decimalPlaces?:number):string};
  dlmmVersion:string;
}
let cached:RuntimeSdk|undefined;
export async function loadMeteoraExecutionRuntime():Promise<RuntimeSdk>{
  if(cached)return cached;
  const moduleName='node:module';
  const mod=await import(moduleName) as unknown as {createRequire:(url:string)=>((id:string)=>unknown)&{resolve:(id:string)=>string}};
  const rootRequire=mod.createRequire(import.meta.url); const dlmmEntry=rootRequire.resolve('@meteora-ag/dlmm'); const dlmmRequire=mod.createRequire(dlmmEntry);
  const dlmm=dlmmRequire('@meteora-ag/dlmm') as Omit<RuntimeSdk,'PublicKey'|'Connection'|'BN'|'dlmmVersion'>;
  const web3=rootRequire('@solana/web3.js') as {PublicKey:RuntimeSdk['PublicKey'];Connection:RuntimeSdk['Connection']};
  const BN=dlmmRequire('bn.js') as RuntimeSdk['BN'];
  // package.json is not exported; derive the installed production lock version explicitly from our compatibility baseline.
  cached={PublicKey:web3.PublicKey,Connection:web3.Connection,DLMM:dlmm as unknown as RuntimeSdk['DLMM'],BN,StrategyType:dlmm.StrategyType,calculateSpotDistribution:dlmm.calculateSpotDistribution,calculateNormalDistribution:dlmm.calculateNormalDistribution,calculateBidAskDistribution:dlmm.calculateBidAskDistribution,autoFillXByStrategy:dlmm.autoFillXByStrategy,getPriceOfBinByBinId:dlmm.getPriceOfBinByBinId,dlmmVersion:'1.9.10'}; return cached;
}
function strategyType(s:'SPOT'|'CURVE'|'BID_ASK',r:RuntimeSdk){return s==='SPOT'?r.StrategyType.Spot:s==='CURVE'?r.StrategyType.Curve:r.StrategyType.BidAsk;}
function validateRange(lower:number,upper:number){if(!Number.isInteger(lower)||!Number.isInteger(upper)||lower>upper)throw new Error('LPFORGE_METEORA_BUILD_INVALID_RANGE');}
/** Creates a live SDK pool adapter. Construction is read-only; it cannot sign or submit. */
export async function createLiveMeteoraOpenPool(input:{rpcUrl:string;poolAddress:string;programId:string}):Promise<MeteoraOpenAddPoolLike>{
  if(!input.rpcUrl.trim()||!input.poolAddress.trim()||!input.programId.trim())throw new Error('LPFORGE_METEORA_LIVE_POOL_CONFIG_REQUIRED');
  const sdk=await loadMeteoraExecutionRuntime();
  return sdk.DLMM.create(new sdk.Connection(input.rpcUrl.trim(),'confirmed'),new sdk.PublicKey(input.poolAddress.trim()),{cluster:'mainnet-beta',programId:new sdk.PublicKey(input.programId.trim())});
}
export interface MeteoraStrategyDistribution {strategy:'SPOT'|'CURVE'|'BID_ASK';activeBinId:number;lowerBinId:number;upperBinId:number;bins:Array<{binId:number;xAmountBps:number;yAmountBps:number}>;sdkVersion:string;}
export async function calculateMeteoraStrategyDistribution(input:{strategy:'SPOT'|'CURVE'|'BID_ASK';activeBinId:number;lowerBinId:number;upperBinId:number}):Promise<MeteoraStrategyDistribution>{
  validateRange(input.lowerBinId,input.upperBinId);if(!Number.isInteger(input.activeBinId)||input.activeBinId<input.lowerBinId||input.activeBinId>input.upperBinId)throw new Error('LPFORGE_METEORA_DISTRIBUTION_ACTIVE_BIN_OUTSIDE_RANGE');const sdk=await loadMeteoraExecutionRuntime();const binIds=Array.from({length:input.upperBinId-input.lowerBinId+1},(_,index)=>input.lowerBinId+index);const calculate=input.strategy==='SPOT'?sdk.calculateSpotDistribution:input.strategy==='CURVE'?sdk.calculateNormalDistribution:sdk.calculateBidAskDistribution;return{strategy:input.strategy,activeBinId:input.activeBinId,lowerBinId:input.lowerBinId,upperBinId:input.upperBinId,bins:calculate(input.activeBinId,binIds).map(row=>({binId:row.binId,xAmountBps:Number(row.xAmountBpsOfTotal.toString()),yAmountBps:Number(row.yAmountBpsOfTotal.toString())})),sdkVersion:sdk.dlmmVersion};
}
export async function quoteMeteoraPairedTokenForYDeposit(input:{strategy:'SPOT'|'CURVE'|'BID_ASK';activeBinId:number;binStep:number;lowerBinId:number;upperBinId:number;targetYAmount:string|bigint;activeBinXAmount:string|bigint;activeBinYAmount:string|bigint}):Promise<{totalXAmount:string;totalYAmount:string;sdkVersion:string}>{
  validateRange(input.lowerBinId,input.upperBinId);if(!Number.isInteger(input.activeBinId)||input.activeBinId<input.lowerBinId||input.activeBinId>input.upperBinId||!Number.isInteger(input.binStep)||input.binStep<=0)throw new Error('LPFORGE_METEORA_FUNDING_INPUT_INVALID');const sdk=await loadMeteoraExecutionRuntime();const y=new sdk.BN(input.targetYAmount),x=sdk.autoFillXByStrategy(input.activeBinId,input.binStep,y,new sdk.BN(input.activeBinXAmount),new sdk.BN(input.activeBinYAmount),input.lowerBinId,input.upperBinId,strategyType(input.strategy,sdk));return{totalXAmount:x.toString(),totalYAmount:y.toString(),sdkVersion:sdk.dlmmVersion};
}
function scaledDecimal(value:string,scaleDigits=18):bigint{const [whole='',fraction='']=value.split('.');if(!/^\d+$/.test(whole)||!/^\d*$/.test(fraction))throw new Error('LPFORGE_METEORA_PRICE_INVALID');return BigInt(whole+fraction.padEnd(scaleDigits,'0').slice(0,scaleDigits));}
export interface MeteoraSolCapitalFundingQuote {strategy:'SPOT'|'CURVE'|'BID_ASK';orientation:'BALANCED'|'SKEWED_Y'|'ONE_SIDED_Y';totalXAmount:string;totalYAmount:string;pairedTokenCostInYRaw:string;capitalUsedYRaw:string;activeBinPriceYPerXRaw:string;sdkVersion:string;}
/** Finds the largest SDK-valid X/Y deposit whose raw Y-value fits the configured SOL capital. */
export async function quoteMeteoraFundingFromSolCapital(input:{strategy:'SPOT'|'CURVE'|'BID_ASK';orientation:'BALANCED'|'SKEWED_Y'|'ONE_SIDED_Y';capitalYAmount:string|bigint;activeBinId:number;binStep:number;lowerBinId:number;upperBinId:number;activeBinXAmount:string|bigint;activeBinYAmount:string|bigint}):Promise<MeteoraSolCapitalFundingQuote>{
  validateRange(input.lowerBinId,input.upperBinId);if(!Number.isInteger(input.activeBinId)||input.activeBinId<input.lowerBinId||input.activeBinId>input.upperBinId||!Number.isInteger(input.binStep)||input.binStep<=0)throw new Error('LPFORGE_METEORA_FUNDING_INPUT_INVALID');const capital=BigInt(input.capitalYAmount);if(capital<1n)throw new Error('LPFORGE_METEORA_FUNDING_CAPITAL_INVALID');const sdk=await loadMeteoraExecutionRuntime();const priceScaled=scaledDecimal(sdk.getPriceOfBinByBinId(input.activeBinId,input.binStep).toFixed(18));const scale=10n**18n;
  if(input.orientation==='ONE_SIDED_Y')return{strategy:input.strategy,orientation:input.orientation,totalXAmount:'0',totalYAmount:capital.toString(),pairedTokenCostInYRaw:'0',capitalUsedYRaw:capital.toString(),activeBinPriceYPerXRaw:(priceScaled.toString()),sdkVersion:sdk.dlmmVersion};
  let low=0n,high=capital,bestX=0n,bestY=0n;for(let iteration=0;iteration<80&&low<=high;iteration++){const y=(low+high)/2n;const x=BigInt(sdk.autoFillXByStrategy(input.activeBinId,input.binStep,new sdk.BN(y),new sdk.BN(input.activeBinXAmount),new sdk.BN(input.activeBinYAmount),input.lowerBinId,input.upperBinId,strategyType(input.strategy,sdk)).toString());const xValue=(x*priceScaled)/scale;const used=y+xValue;if(used<=capital){bestX=x;bestY=y;low=y+1n;}else high=y-1n;}
  const xValue=(bestX*priceScaled)/scale;return{strategy:input.strategy,orientation:input.orientation,totalXAmount:bestX.toString(),totalYAmount:bestY.toString(),pairedTokenCostInYRaw:xValue.toString(),capitalUsedYRaw:(bestY+xValue).toString(),activeBinPriceYPerXRaw:priceScaled.toString(),sdkVersion:sdk.dlmmVersion};
}
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
