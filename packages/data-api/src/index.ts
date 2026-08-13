export const METEORA_DATA_API_DEFAULT = 'https://dlmm.datapi.meteora.ag';
export const METEORA_DATA_API_MAX_RPS = 30;
export type MeteoraOhlcvTimeframe = '5m'|'30m'|'1h'|'2h'|'4h'|'12h'|'24h';
export interface WindowMetrics { '5m'?: number; '30m'?: number; '1h'?: number; '2h'?: number; '4h'?: number; '12h'?: number; '24h'?: number; }
export interface DataApiToken { address: string; decimals?: number; symbol?: string; name?: string; price?: number; holders?: number; is_verified?: boolean; freeze_authority_disabled?: boolean; market_cap?: number; total_supply?: number; }
export interface DataApiPool {
  address: string; name?: string; created_at?: number; current_price?: number; dynamic_fee_pct?: number; tvl?: number;
  fees?: WindowMetrics; volume?: WindowMetrics; fee_tvl_ratio?: WindowMetrics; protocol_fees?: WindowMetrics;
  token_x?: DataApiToken; token_y?: DataApiToken; token_x_amount?: number; token_y_amount?: number;
  pool_config?: {base_fee_pct?:number;bin_step?:number;collect_fee_mode?:number;max_fee_pct?:number;protocol_fee_pct?:number};
  is_blacklisted?: boolean; tags?: string[]; launchpad?: string;
  [key:string]: unknown;
}
export interface PoolsPage { current_page: number; page_size: number; total?: number; pages?: number; total_pages?: number; data: DataApiPool[]; }
export interface OhlcvCandle { timestamp: number; timestamp_str?: string; open: number; high: number; low: number; close: number; volume: number; }
export interface OhlcvResponse { data: OhlcvCandle[]; start_time: number; end_time: number; timeframe: string | null; }
export interface HistoricalVolumePoint { timestamp:number; timestamp_str?:string; fees:number; protocol_fees:number; volume:number; }
export interface HistoricalVolumeResponse { data:HistoricalVolumePoint[]; start_time:number; end_time:number; timeframe:string|null; }
export interface MeteoraDataApi {
  listPools(page?: number, pageSize?: number, query?: string, options?: {sortBy?:string;filterBy?:string}): Promise<PoolsPage>;
  getPool(address: string): Promise<DataApiPool>;
  getOhlcv(address: string, params?: {timeframe?:MeteoraOhlcvTimeframe;startTime?:number;endTime?:number}): Promise<OhlcvResponse>;
  getHistoricalVolume(address:string,params?:{timeframe?:MeteoraOhlcvTimeframe;startTime?:number;endTime?:number}):Promise<HistoricalVolumeResponse>;
}

export class TokenBucketLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  constructor(private readonly ratePerSecond: number) {
    if (!(ratePerSecond > 0 && ratePerSecond <= METEORA_DATA_API_MAX_RPS)) throw new Error('LPFORGE_DATA_API_RATE_INVALID');
    this.tokens = ratePerSecond;
  }
  private refill(): void {
    const now=Date.now(); const elapsed=(now-this.lastRefill)/1000;
    this.tokens=Math.min(this.ratePerSecond, this.tokens + elapsed*this.ratePerSecond); this.lastRefill=now;
  }
  async take(): Promise<void> {
    while (true) { this.refill(); if (this.tokens>=1) { this.tokens-=1; return; } await new Promise(r=>setTimeout(r, Math.max(5, Math.ceil(1000/this.ratePerSecond)))); }
  }
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
function assertObject(value: unknown, code: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code); return value as Record<string,unknown>; }

export function createMeteoraDataApi(opts: {baseUrl?:string;maxRps?:number;timeoutMs?:number;fetchImpl?:FetchLike} = {}): MeteoraDataApi {
  const base=(opts.baseUrl ?? METEORA_DATA_API_DEFAULT).replace(/\/$/,'');
  const limiter=new TokenBucketLimiter(opts.maxRps ?? 25); const timeout=opts.timeoutMs ?? 10000; const fetchImpl=opts.fetchImpl ?? fetch;
  async function get(path:string, query:Record<string,string|number|undefined>={}): Promise<unknown> {
    await limiter.take(); const url=new URL(base+path); for (const [k,v] of Object.entries(query)) if (v!==undefined) url.searchParams.set(k,String(v));
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeout);
    try { const response=await fetchImpl(url,{method:'GET',headers:{accept:'application/json'},signal:controller.signal}); if (!response.ok) throw new Error(`LPFORGE_DATA_API_HTTP:${response.status}`); return await response.json(); }
    finally { clearTimeout(timer); }
  }
  return {
    async listPools(page=1,pageSize=100,query,options={}) {
      if (!Number.isInteger(page)||page<1) throw new Error('LPFORGE_DATA_API_PAGE'); if (!Number.isInteger(pageSize)||pageSize<1||pageSize>1000) throw new Error('LPFORGE_DATA_API_PAGE_SIZE');
      const obj=assertObject(await get('/pools',{page,page_size:pageSize,query,sort_by:options.sortBy,filter_by:options.filterBy}),'LPFORGE_DATA_API_SCHEMA:POOLS'); if (!Array.isArray(obj.data)) throw new Error('LPFORGE_DATA_API_SCHEMA:POOLS_DATA');
      return obj as unknown as PoolsPage;
    },
    async getPool(address) { const obj=assertObject(await get(`/pools/${encodeURIComponent(address)}`),'LPFORGE_DATA_API_SCHEMA:POOL'); if (typeof obj.address!=='string') throw new Error('LPFORGE_DATA_API_SCHEMA:POOL_ADDRESS'); return obj as unknown as DataApiPool; },
    async getOhlcv(address,params={}) {
      const allowed=new Set<MeteoraOhlcvTimeframe>(['5m','30m','1h','2h','4h','12h','24h']); if (params.timeframe && !allowed.has(params.timeframe)) throw new Error('LPFORGE_DATA_API_OHLCV_TIMEFRAME');
      const obj=assertObject(await get(`/pools/${encodeURIComponent(address)}/ohlcv`,{timeframe:params.timeframe,start_time:params.startTime,end_time:params.endTime}),'LPFORGE_DATA_API_SCHEMA:OHLCV'); if (!Array.isArray(obj.data)) throw new Error('LPFORGE_DATA_API_SCHEMA:OHLCV_DATA');
      return obj as unknown as OhlcvResponse;
    },
    async getHistoricalVolume(address,params={}) {
      const allowed=new Set<MeteoraOhlcvTimeframe>(['5m','30m','1h','2h','4h','12h','24h']); if(params.timeframe&&!allowed.has(params.timeframe))throw new Error('LPFORGE_DATA_API_VOLUME_TIMEFRAME');
      const obj=assertObject(await get(`/pools/${encodeURIComponent(address)}/volume/history`,{timeframe:params.timeframe,start_time:params.startTime,end_time:params.endTime}),'LPFORGE_DATA_API_SCHEMA:HISTORICAL_VOLUME'); if(!Array.isArray(obj.data))throw new Error('LPFORGE_DATA_API_SCHEMA:HISTORICAL_VOLUME_DATA'); return obj as unknown as HistoricalVolumeResponse;
    }
  };
}
