import type { BinLiquidityFact, PoolStateFact, SwapEventFact } from '../../domain/src/index.js';
export const FIXTURE_POOL='11111111111111111111111111111111';
export const fixturePool:PoolStateFact={address:FIXTURE_POOL,tokenXMint:'So11111111111111111111111111111111111111112',tokenYMint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',binStep:10,functionType:'LIQUIDITY_MINING',collectFeeMode:'INPUT_ONLY',activeBinId:100,baseFeePct:'0.1',dynamicFeePct:'0.02',stamp:{source:'FIXTURE',chainSlot:1000n,observedAt:'2026-08-12T10:00:00.000Z'}};
export const fixtureBins:BinLiquidityFact[]=Array.from({length:7},(_,i)=>{const id=97+i;return{pool:FIXTURE_POOL,binId:id,price:String(1+(id-100)*0.001),amountX:id===98?'0':String((i+1)*100),amountY:id===98?'0':String((7-i)*80),stamp:{source:'FIXTURE',chainSlot:1000n,observedAt:'2026-08-12T10:00:00.000Z'}}});
export const fixtureSwaps:SwapEventFact[]=[
{signature:'sig1',eventIndex:0,pool:FIXTURE_POOL,startBinId:99,endBinId:101,mmFee:'10',stamp:{source:'FIXTURE',chainSlot:998n,observedAt:'2026-08-12T09:58:00.000Z'},raw:{}},
{signature:'sig2',eventIndex:0,pool:FIXTURE_POOL,startBinId:101,endBinId:100,mmFee:'12',stamp:{source:'FIXTURE',chainSlot:999n,observedAt:'2026-08-12T09:59:00.000Z'},raw:{}},
{signature:'sig3',eventIndex:0,pool:FIXTURE_POOL,startBinId:100,endBinId:102,mmFee:'11',stamp:{source:'FIXTURE',chainSlot:1000n,observedAt:'2026-08-12T10:00:00.000Z'},raw:{}}
];
export const fixtureDataApiPool={address:FIXTURE_POOL,tvl:100000,dynamic_fee_pct:0.02,fees:{'1h':100,'24h':1200},volume:{'1h':20000,'24h':250000},fee_tvl_ratio:{'1h':0.001,'24h':0.012},pool_config:{bin_step:10,collect_fee_mode:0}};
