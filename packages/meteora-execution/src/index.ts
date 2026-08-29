// LPFORGE_PHASE5_EXECUTION_MODULE
import {createGovernedConnection} from '../../meteora/src/index.js';
export type OpaqueTransaction = object;
export interface OpenBuildRequest {userAddress:string;positionAddress:string;totalXAmount:string|bigint;totalYAmount:string|bigint;lowerBinId:number;upperBinId:number;strategy:'SPOT'|'CURVE'|'BID_ASK';maxPositionWidthBins?:number;/** Explicit policy cap passed to the Meteora SDK as a percent. */liquiditySlippageBps:number;}
export interface AddBuildRequest extends Omit<OpenBuildRequest,'liquiditySlippageBps'> {}
export interface MeteoraOpenAddPoolLike {
  initializePositionAndAddLiquidityByStrategy(args:Record<string,unknown>):Promise<OpaqueTransaction>;
  createExtendedEmptyPosition?(lowerBinId:number,upperBinId:number,position:unknown,owner:unknown):Promise<OpaqueTransaction>;
  addLiquidityByStrategyChunkable?(args:Record<string,unknown>):Promise<OpaqueTransaction[]>;
  addLiquidityByStrategy(args:Record<string,unknown>):Promise<OpaqueTransaction>;
  getPosition?(position:unknown):Promise<unknown>;
}
export function createFixtureMeteoraOpenAddPool():MeteoraOpenAddPoolLike{
  return{
    async initializePositionAndAddLiquidityByStrategy(){return{fixtureUnsigned:true};},
    async addLiquidityByStrategy(){return{fixtureUnsignedAdd:true};}
  };
}
export interface BuiltMeteoraTransaction {transaction:OpaqueTransaction;requiredSignerAddresses:string[];builder:'initializePositionAndAddLiquidityByStrategy'|'createExtendedEmptyPosition'|'addLiquidityByStrategyChunkable'|'addLiquidityByStrategy'|'removeLiquidity'|'claimAllRewardsByPosition'|'closePositionIfEmpty';metadata:Record<string,unknown>;}
interface RuntimeSdk {
  PublicKey:new(value:string)=>{toBase58():string};
  Connection:new(url:string,commitment:'confirmed')=>unknown;
  DLMM:{create(connection:unknown,pool:unknown,options:Record<string,unknown>):Promise<MeteoraOpenAddPoolLike>;getAllLbPairPositionsByUser?(connection:unknown,user:unknown,options:Record<string,unknown>,getPositionsOptions?:Record<string,unknown>):Promise<Map<string,{lbPairPositionsData:Array<{publicKey:{toBase58():string}}> }>>};
  BN:new(value:string|number|bigint)=>{toString(base?:number):string};
  StrategyType:{Spot:number;Curve:number;BidAsk:number};
  calculateSpotDistribution(activeBinId:number,binIds:number[]):Array<{binId:number;xAmountBpsOfTotal:{toString(base?:number):string};yAmountBpsOfTotal:{toString(base?:number):string}}>;
  calculateNormalDistribution(activeBinId:number,binIds:number[]):Array<{binId:number;xAmountBpsOfTotal:{toString(base?:number):string};yAmountBpsOfTotal:{toString(base?:number):string}}>;
  calculateBidAskDistribution(activeBinId:number,binIds:number[]):Array<{binId:number;xAmountBpsOfTotal:{toString(base?:number):string};yAmountBpsOfTotal:{toString(base?:number):string}}>;
  autoFillXByStrategy(activeBinId:number,binStep:number,amountY:{toString(base?:number):string},amountXInActiveBin:{toString(base?:number):string},amountYInActiveBin:{toString(base?:number):string},lowerBinId:number,upperBinId:number,strategyType:number):{toString(base?:number):string};
  getPriceOfBinByBinId(binId:number,binStep:number):{toFixed(decimalPlaces?:number):string};
  getBinArrayKeysCoverage(lowerBinId:{toString(base?:number):string},upperBinId:{toString(base?:number):string},lbPair:unknown,programId:unknown):Array<{toBase58():string}>;
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
  cached={PublicKey:web3.PublicKey,Connection:web3.Connection,DLMM:dlmm as unknown as RuntimeSdk['DLMM'],BN,StrategyType:dlmm.StrategyType,calculateSpotDistribution:dlmm.calculateSpotDistribution,calculateNormalDistribution:dlmm.calculateNormalDistribution,calculateBidAskDistribution:dlmm.calculateBidAskDistribution,autoFillXByStrategy:dlmm.autoFillXByStrategy,getPriceOfBinByBinId:dlmm.getPriceOfBinByBinId,getBinArrayKeysCoverage:dlmm.getBinArrayKeysCoverage,dlmmVersion:'1.9.10'}; return cached;
}
function strategyType(s:'SPOT'|'CURVE'|'BID_ASK',r:RuntimeSdk){return s==='SPOT'?r.StrategyType.Spot:s==='CURVE'?r.StrategyType.Curve:r.StrategyType.BidAsk;}
/** The SDK one-shot initializer is 70 bins; extended PositionV2 is 1,400. */
export const METEORA_ONE_SHOT_POSITION_WIDTH_BINS=70;
export const METEORA_PROTOCOL_MAX_POSITION_WIDTH_BINS=1400;
function validateRange(lower:number,upper:number,maxWidthBins=100){if(!Number.isInteger(lower)||!Number.isInteger(upper)||lower>upper)throw new Error('LPFORGE_METEORA_BUILD_INVALID_RANGE');if(!Number.isInteger(maxWidthBins)||maxWidthBins<3||maxWidthBins>METEORA_PROTOCOL_MAX_POSITION_WIDTH_BINS)throw new Error('LPFORGE_METEORA_BUILD_POSITION_WIDTH_POLICY');if(upper-lower+1>maxWidthBins)throw new Error('LPFORGE_METEORA_BUILD_POSITION_WIDTH_POLICY_EXCEEDED');}
function sdkSlippagePercent(bps:number){if(!Number.isInteger(bps)||bps<1||bps>10_000)throw new Error('LPFORGE_METEORA_BUILD_LIQUIDITY_SLIPPAGE_POLICY');return bps/100;}
/** Creates a live SDK pool adapter. Construction is read-only; it cannot sign or submit. */
export async function createLiveMeteoraOpenPool(input:{rpcUrl:string;poolAddress:string;programId:string}):Promise<MeteoraOpenAddPoolLike>{
  if(!input.rpcUrl.trim()||!input.poolAddress.trim()||!input.programId.trim())throw new Error('LPFORGE_METEORA_LIVE_POOL_CONFIG_REQUIRED');
  const sdk=await loadMeteoraExecutionRuntime();
  return sdk.DLMM.create(createGovernedConnection({rpcUrl:input.rpcUrl.trim(),priority:'P0_EXECUTION_CRITICAL'}),new sdk.PublicKey(input.poolAddress.trim()),{cluster:'mainnet-beta',programId:new sdk.PublicKey(input.programId.trim())});
}
/** Refuses an open before the SDK can create any missing bin-array account.
 * PositionV2 rent remains a refundable wallet requirement and is handled by
 * the execution preflight, never by opportunity economics. */
export async function assertPreinitializedMeteoraBinArrays(input:{rpcUrl:string;poolAddress:string;programId:string;lowerBinId:number;upperBinId:number}):Promise<{binArrayAddresses:string[]}>{
  validateRange(input.lowerBinId,input.upperBinId,METEORA_PROTOCOL_MAX_POSITION_WIDTH_BINS);const sdk=await loadMeteoraExecutionRuntime(),connection=createGovernedConnection({rpcUrl:input.rpcUrl.trim(),priority:'P0_EXECUTION_CRITICAL'}) as unknown as {getMultipleAccountsInfo(keys:unknown[],commitment:'confirmed'):Promise<Array<unknown|null>>},keys=sdk.getBinArrayKeysCoverage(new sdk.BN(input.lowerBinId),new sdk.BN(input.upperBinId),new sdk.PublicKey(input.poolAddress),new sdk.PublicKey(input.programId)),accounts=await connection.getMultipleAccountsInfo(keys,'confirmed'),missing=keys.filter((_,index)=>!accounts[index]);if(missing.length)throw new Error(`LPFORGE_METEORA_BIN_ARRAY_INITIALIZATION_RENT_REQUIRED:${missing.map(key=>key.toBase58()).join(',')}`);return{binArrayAddresses:keys.map(key=>key.toBase58())};
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
  validateRange(r.lowerBinId,r.upperBinId,r.maxPositionWidthBins);if(r.upperBinId-r.lowerBinId+1>METEORA_ONE_SHOT_POSITION_WIDTH_BINS)throw new Error('LPFORGE_METEORA_BUILD_EXTENDED_POSITION_REQUIRED');const sdk=await loadMeteoraExecutionRuntime();
  const args={positionPubKey:new sdk.PublicKey(r.positionAddress),user:new sdk.PublicKey(r.userAddress),totalXAmount:new sdk.BN(r.totalXAmount),totalYAmount:new sdk.BN(r.totalYAmount),strategy:{minBinId:r.lowerBinId,maxBinId:r.upperBinId,strategyType:strategyType(r.strategy,sdk)},slippage:sdkSlippagePercent(r.liquiditySlippageBps)};
  const transaction=await pool.initializePositionAndAddLiquidityByStrategy(args);
  return{transaction,requiredSignerAddresses:[r.userAddress,r.positionAddress],builder:'initializePositionAndAddLiquidityByStrategy',metadata:{strategy:r.strategy,lowerBinId:r.lowerBinId,upperBinId:r.upperBinId,totalXAmount:String(r.totalXAmount),totalYAmount:String(r.totalYAmount)}};
}
/**
 * Creates the refundable extended PositionV2 account first, then lets the
 * SDK split liquidity over its safe 70-bin instruction chunks. This builder
 * is transaction construction only: callers must simulate, submit, confirm
 * and persist every returned step in order.
 */
export async function buildExtendedChunkableOpenTransactions(pool:MeteoraOpenAddPoolLike,r:OpenBuildRequest):Promise<BuiltMeteoraTransaction[]>{
  validateRange(r.lowerBinId,r.upperBinId,r.maxPositionWidthBins);const width=r.upperBinId-r.lowerBinId+1;if(width<=METEORA_ONE_SHOT_POSITION_WIDTH_BINS)return[await buildOpenPositionTransaction(pool,r)];if(!pool.createExtendedEmptyPosition||!pool.addLiquidityByStrategyChunkable)throw new Error('LPFORGE_METEORA_EXTENDED_CHUNKABLE_SDK_REQUIRED');const sdk=await loadMeteoraExecutionRuntime(),position=new sdk.PublicKey(r.positionAddress),owner=new sdk.PublicKey(r.userAddress),strategy={minBinId:r.lowerBinId,maxBinId:r.upperBinId,strategyType:strategyType(r.strategy,sdk)},extension=await pool.createExtendedEmptyPosition(r.lowerBinId,r.upperBinId,position,owner),chunks=await pool.addLiquidityByStrategyChunkable({positionPubKey:position,user:owner,totalXAmount:new sdk.BN(r.totalXAmount),totalYAmount:new sdk.BN(r.totalYAmount),strategy,slippage:sdkSlippagePercent(r.liquiditySlippageBps)});if(!chunks.length)throw new Error('LPFORGE_METEORA_CHUNKABLE_EMPTY');const shared={strategy:r.strategy,lowerBinId:r.lowerBinId,upperBinId:r.upperBinId,totalXAmount:String(r.totalXAmount),totalYAmount:String(r.totalYAmount),positionWidthBins:width,liquiditySlippageBps:r.liquiditySlippageBps};return[{transaction:extension,requiredSignerAddresses:[r.userAddress,r.positionAddress],builder:'createExtendedEmptyPosition',metadata:{...shared,operation:'POSITION_EXTEND'}},...chunks.map((transaction,chunkIndex)=>({transaction,requiredSignerAddresses:[r.userAddress],builder:'addLiquidityByStrategyChunkable' as const,metadata:{...shared,operation:'OPEN_CHUNK',chunkIndex,chunkCount:chunks.length}}))];
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
  closePositionIfEmpty?(args:Record<string,unknown>):Promise<OpaqueTransaction>;
  getPosition?(position:unknown):Promise<unknown>;
}
export interface RemoveBuildRequest {userAddress:string;positionAddress:string;fromBinId:number;toBinId:number;bps:number;claimAndClose:boolean;}
function many(value:OpaqueTransaction|OpaqueTransaction[]):OpaqueTransaction[]{return Array.isArray(value)?value:[value];}
export async function buildRemoveLiquidityTransactions(pool:MeteoraRemoveClaimPoolLike,r:RemoveBuildRequest):Promise<BuiltMeteoraTransaction[]>{
  if(!Number.isInteger(r.bps)||r.bps<1||r.bps>10_000)throw new Error('LPFORGE_METEORA_REMOVE_BPS'); if(r.fromBinId>r.toBinId)throw new Error('LPFORGE_METEORA_REMOVE_RANGE'); if(r.claimAndClose&&r.bps!==10_000)throw new Error('LPFORGE_METEORA_CLOSE_REQUIRES_FULL_REMOVE');
  const sdk=await loadMeteoraExecutionRuntime(); const result=await pool.removeLiquidity({position:new sdk.PublicKey(r.positionAddress),user:new sdk.PublicKey(r.userAddress),fromBinId:r.fromBinId,toBinId:r.toBinId,bps:new sdk.BN(r.bps),shouldClaimAndClose:r.claimAndClose});
  return many(result).map((transaction,index)=>({transaction,requiredSignerAddresses:[r.userAddress],builder:'removeLiquidity' as const,metadata:{operation:r.claimAndClose?'CLOSE':'REMOVE',chunkIndex:index,chunkCount:many(result).length,bps:r.bps,fromBinId:r.fromBinId,toBinId:r.toBinId}}));
}
export async function buildClaimTransactions(pool:MeteoraRemoveClaimPoolLike,r:{userAddress:string;positionAddress:string}):Promise<BuiltMeteoraTransaction[]>{
  const sdk=await loadMeteoraExecutionRuntime(),positionKey=new sdk.PublicKey(r.positionAddress),position=await pool.getPosition?.(positionKey);if(!position)throw new Error('LPFORGE_METEORA_CLAIM_POSITION_UNAVAILABLE');let result:OpaqueTransaction|OpaqueTransaction[];try{result=await pool.claimAllRewardsByPosition({owner:new sdk.PublicKey(r.userAddress),position});}catch(error){if(error instanceof Error&&error.message==='No fee/reward to claim')throw new Error('LPFORGE_METEORA_CLAIM_NOTHING_TO_CLAIM');throw error;} const list=many(result);
  return list.map((transaction,index)=>({transaction,requiredSignerAddresses:[r.userAddress],builder:'claimAllRewardsByPosition' as const,metadata:{operation:'CLAIM',chunkIndex:index,chunkCount:list.length}}));
}
/** Closes a fully drained PositionV2. The instruction is a no-op unless the
 * position is empty, so a range with residual liquidity stays open and is
 * caught by the post-close chain verification instead of being lost. */
export async function buildClosePositionTransaction(pool:MeteoraRemoveClaimPoolLike,r:{userAddress:string;positionAddress:string}):Promise<BuiltMeteoraTransaction>{
  const sdk=await loadMeteoraExecutionRuntime(),positionKey=new sdk.PublicKey(r.positionAddress),position=await pool.getPosition?.(positionKey);if(!position)throw new Error('LPFORGE_METEORA_CLOSE_POSITION_UNAVAILABLE');if(typeof pool.closePositionIfEmpty!=='function')throw new Error('LPFORGE_METEORA_CLOSE_UNSUPPORTED');
  const transaction=await pool.closePositionIfEmpty({owner:new sdk.PublicKey(r.userAddress),position});
  return{transaction,requiredSignerAddresses:[r.userAddress],builder:'closePositionIfEmpty' as const,metadata:{operation:'CLOSE_EMPTY'}};
}
