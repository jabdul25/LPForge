import { canonicalJson, sha256Hex } from '../../domain/src/index.js';
import { assertNoLookahead } from '../../research/src/index.js';

export type MarketHorizon = '5m'|'15m'|'30m'|'1h'|'4h';
export const MARKET_HORIZON_MINUTES:Record<MarketHorizon,number>={ '5m':5,'15m':15,'30m':30,'1h':60,'4h':240 };

export interface MarketObservation {
  observedAt:string;
  price:number;
  /**
   * Price/volume candles from a historical provider do not always carry a
   * direct active-bin observation.  They are still valid market-time evidence
   * for price context and completeness; bin-motion metrics only use the rows
   * that carry real or event-reconstructed bin evidence.
   */
  activeBinId?:number;
  /** Duration represented by this genuine source observation.  A 5m OHLCV
   * candle covers five real market minutes; it is never expanded into five
   * synthetic minute samples. */
  resolutionMs?:number;
  volume?:number;
  feeValue?:number;
  twoWayRatio?:number;
  localLiquidity?:number;
}
export interface HorizonContext {
  horizon:MarketHorizon;
  samples:number;
  startAt?:string;
  endAt:string;
  returnPct:number;
  maxDrawdownPct:number;
  realizedVolatility:number;
  priceRangePct:number;
  netBins:number;
  absoluteBins:number;
  /** Largest distance of an observed bin from the first bin in this horizon.
   * Unlike absoluteBins this is an excursion envelope, so reversals do not
   * turn repeated travel through the same range into additional range width. */
  maxAnchorDisplacementBins:number;
  binVelocityPerMinute:number;
  directionalEfficiency:number;
  volumeTotal:number;
  feeTotal:number;
  twoWayRatioMean:number|null;
  localLiquidityChangePct:number|null;
  completeness:number;
}
export interface MarketContextSnapshot {
  pool:string;
  decisionAt:string;
  schemaVersion:'phase3-market-context-v1';
  horizons:Record<MarketHorizon,HorizonContext>;
  sourceObservationCount:number;
  hash:string;
}
const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const mean=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:0;
function finite(v:number|undefined):v is number{return typeof v==='number'&&Number.isFinite(v);}
function contextFor(horizon:MarketHorizon,decisionAt:string,rows:MarketObservation[]):HorizonContext{
  const decision=Date.parse(decisionAt),mins=MARKET_HORIZON_MINUTES[horizon],start=decision-mins*60000;
  const s=rows.filter((r)=>{const t=Date.parse(r.observedAt);return t>=start&&t<=decision;}).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  const endAt=decisionAt;
  if(!s.length)return{horizon,samples:0,endAt,returnPct:0,maxDrawdownPct:0,realizedVolatility:0,priceRangePct:0,netBins:0,absoluteBins:0,maxAnchorDisplacementBins:0,binVelocityPerMinute:0,directionalEfficiency:0,volumeTotal:0,feeTotal:0,twoWayRatioMean:null,localLiquidityChangePct:null,completeness:0};
  const prices=s.map((x)=>x.price).filter((x)=>Number.isFinite(x)&&x>0); const first=prices[0]??0,last=prices.at(-1)??first;
  let peak=first,maxDd=0; for(const p of prices){peak=Math.max(peak,p);if(peak>0)maxDd=Math.min(maxDd,(p-peak)/peak*100);}
  const logReturns:number[]=[];for(let i=1;i<prices.length;i++){const a=prices[i-1]!,b=prices[i]!;if(a>0&&b>0)logReturns.push(Math.log(b/a));}
  const lrMean=mean(logReturns);const variance=mean(logReturns.map((r)=>(r-lrMean)**2));
  const binRows=s.filter((row):row is MarketObservation & {activeBinId:number}=>Number.isFinite(row.activeBinId));
  let absBins=0;for(let i=1;i<binRows.length;i++)absBins+=Math.abs(binRows[i]!.activeBinId-binRows[i-1]!.activeBinId);
  const netBins=binRows.length>=2?binRows.at(-1)!.activeBinId-binRows[0]!.activeBinId:0;
  const anchorBin=binRows[0]?.activeBinId;
  const maxAnchorDisplacementBins=anchorBin===undefined?0:Math.max(...binRows.map((row)=>Math.abs(row.activeBinId-anchorBin)));
  const duration=Math.max((Date.parse(s.at(-1)!.observedAt)-Date.parse(s[0]!.observedAt))/60000,1/60);
  const tw=s.map((x)=>x.twoWayRatio).filter(finite); const liq=s.map((x)=>x.localLiquidity).filter(finite);
  // Completeness is market-time coverage, not ingestion-count.  This retains
  // the existing .60 threshold while allowing a genuine 5m candle to cover its
  // five-minute interval without manufacturing five minute observations.
  const intervals=s.map(row=>{const bucketStart=Math.max(Date.parse(row.observedAt),start);const resolution=Math.max(1_000,Math.min(15*60_000,Number(row.resolutionMs??60_000)));return[bucketStart,Math.min(decision,bucketStart+resolution)] as const;}).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  let covered=0,coveredEnd=-Infinity;for(const [a,b] of intervals){const from=Math.max(a,coveredEnd);if(b>from){covered+=b-from;coveredEnd=Math.max(coveredEnd,b);}}
  return{horizon,samples:s.length,startAt:s[0]!.observedAt,endAt,returnPct:first>0?(last-first)/first*100:0,maxDrawdownPct:maxDd,realizedVolatility:Math.sqrt(Math.max(0,variance))*100,priceRangePct:prices.length&&Math.min(...prices)>0?(Math.max(...prices)-Math.min(...prices))/Math.min(...prices)*100:0,netBins,absoluteBins:absBins,maxAnchorDisplacementBins,binVelocityPerMinute:absBins/duration,directionalEfficiency:absBins?Math.abs(netBins)/absBins:0,volumeTotal:s.reduce((a,b)=>a+(finite(b.volume)?b.volume:0),0),feeTotal:s.reduce((a,b)=>a+(finite(b.feeValue)?b.feeValue:0),0),twoWayRatioMean:tw.length?mean(tw):null,localLiquidityChangePct:liq.length>=2&&liq[0]!>0?(liq.at(-1)!-liq[0]!)/liq[0]!*100:null,completeness:clamp(covered/(mins*60_000))};
}
export async function buildMarketContext(pool:string,decisionAt:string,observations:MarketObservation[]):Promise<MarketContextSnapshot>{
  assertNoLookahead(decisionAt,observations);
  const sorted=[...observations].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
  const horizons={} as Record<MarketHorizon,HorizonContext>;
  for(const h of Object.keys(MARKET_HORIZON_MINUTES) as MarketHorizon[])horizons[h]=contextFor(h,decisionAt,sorted);
  const core={pool,decisionAt,schemaVersion:'phase3-market-context-v1' as const,horizons,sourceObservationCount:sorted.length};
  return{...core,hash:await sha256Hex(canonicalJson(core))};
}
