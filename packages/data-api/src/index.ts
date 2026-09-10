import {createHash} from 'node:crypto';

export const METEORA_DATA_API_DEFAULT = 'https://dlmm.datapi.meteora.ag';
export const METEORA_DISCOVERY_API_DEFAULT = 'https://pool-discovery-api.datapi.meteora.ag';
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
export type MeteoraDiscoveryTimeframe = '30m'|'1h'|'24h';
/** Canonical Meteora discovery fields. Ratio values are percentage points. */
export interface MeteoraDiscoveryPool { pool_address?:string; address?:string; tvl?:number; active_tvl?:number; fee_tvl_ratio?:number; fee_active_tvl_ratio?:number; fee?:number; fees?:number; volume?:number; swap_count?:number; dlmm_bin_step?:number; updated_at?:string|number; timestamp?:string|number; [key:string]:unknown; }
export interface MeteoraDiscoveryPoolsPage { current_page?:number; page_size?:number; total?:number; pages?:number; total_pages?:number; data:MeteoraDiscoveryPool[]; }
export interface MeteoraPositionPnlAmount { usd?:number|string; sol?:number|string; amount?:number|string; amountSol?:number|string; }
export interface MeteoraPositionPnl {
  positionAddress:string;
  pnlUsd?:number|string;
  pnlPctChange?:number|string;
  pnlSol?:number|string;
  pnlSolPctChange?:number|string;
  allTimeDeposits?:{total?:MeteoraPositionPnlAmount};
  allTimeWithdrawals?:{total?:MeteoraPositionPnlAmount};
  allTimeFees?:{total?:MeteoraPositionPnlAmount};
  unrealizedPnl?:{balances?:number|string;balancesSol?:number|string;unclaimedFeeTokenX?:MeteoraPositionPnlAmount;unclaimedFeeTokenY?:MeteoraPositionPnlAmount};
}
export interface MeteoraDataApi {
  listPools(page?: number, pageSize?: number, query?: string, options?: {sortBy?:string;filterBy?:string}): Promise<PoolsPage>;
  getPool(address: string): Promise<DataApiPool>;
  getOhlcv(address: string, params?: {timeframe?:MeteoraOhlcvTimeframe;startTime?:number;endTime?:number}): Promise<OhlcvResponse>;
  getHistoricalVolume(address:string,params?:{timeframe?:MeteoraOhlcvTimeframe;startTime?:number;endTime?:number}):Promise<HistoricalVolumeResponse>;
  getOpenPositionPnl(poolAddress:string,ownerAddress:string):Promise<MeteoraPositionPnl[]>;
  listDiscoveryPools(page?:number,pageSize?:number,options?:{timeframe?:MeteoraDiscoveryTimeframe;sortBy?:string;filterBy?:string;category?:string}):Promise<MeteoraDiscoveryPoolsPage>;
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
type SleepLike=(ms:number)=>Promise<void>;
export type DataApiPriority='P0_POSITION_PROTECTION'|'P1_PRODUCTION_DECISION'|'P2_DISCOVERY_CURRENT'|'P3_RESEARCH_BACKFILL';
export interface DataApiCoordinator { acquire(priority:DataApiPriority,operation:string,deadlineAt?:number):Promise<void>; note429(priority:DataApiPriority,operation:string,backoffMs:number):Promise<void>; noteRetry(priority:DataApiPriority,operation:string):Promise<void>; }
export function dataApiProviderKey(url:string){return createHash('sha256').update(url).digest('hex');}
export class DataApiBudgetShedError extends Error { readonly code='LPFORGE_DATA_API_BUDGET_SHED';constructor(readonly priority:DataApiPriority,readonly operation:string){super(`LPFORGE_DATA_API_BUDGET_SHED:${priority}:${operation}`);}}
export class DataApiDeadlineError extends Error {readonly code='LPFORGE_DATA_API_DEADLINE_EXCEEDED';constructor(){super('LPFORGE_DATA_API_DEADLINE_EXCEEDED');}}
type PgClient={connect:()=>Promise<void>;query:(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>}>;end:()=>Promise<void>;on:(event:'error',listener:(error:Error)=>void)=>unknown};
type DataApiBudgetConfig={total:number;p0:number;p1:number;p2:number;p3:number};
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function envInt(name:string,fallback:number,min:number){const value=Number(process.env[name]??fallback);return Number.isSafeInteger(value)&&value>=min?value:fallback;}
const priorityWaitMs:Record<DataApiPriority,number>={P0_POSITION_PROTECTION:60_000,P1_PRODUCTION_DECISION:30_000,P2_DISCOVERY_CURRENT:15_000,P3_RESEARCH_BACKFILL:10_000};
function dataApiBudgetConfig():DataApiBudgetConfig{const total=envInt('LPFORGE_DATA_API_GLOBAL_MAX_RPS',envInt('LPFORGE_DATA_API_MAX_RPS',25,1),1);const p0=envInt('LPFORGE_DATA_API_P0_RESERVED_RPS',total>=4?1:0,0),p1=envInt('LPFORGE_DATA_API_P1_RESERVED_RPS',total>=4?1:0,0);if(p0+p1>=total)throw new Error('LPFORGE_DATA_API_BUDGET_INVALID');const available=Math.max(1,total-p0-p1);return{total,p0,p1,p2:envInt('LPFORGE_DATA_API_P2_MAX_RPS',available,1),p3:envInt('LPFORGE_DATA_API_P3_MAX_RPS',Math.max(1,Math.floor(available/2)),1)};}
class PostgresDataApiCoordinator implements DataApiCoordinator {
  private client:PgClient|undefined;private readonly providerKey:string;private readonly config=dataApiBudgetConfig();
  constructor(url:string){this.providerKey=dataApiProviderKey(url);}
  private async db():Promise<PgClient>{if(this.client)return this.client;const pg=await import('pg') as unknown as {Client:new(input:{connectionString:string})=>PgClient};const url=process.env.DATABASE_URL?.trim();if(!url)throw new Error('LPFORGE_DATA_API_COORDINATOR_DATABASE_URL_REQUIRED');const client=new pg.Client({connectionString:url});client.on('error',()=>{if(this.client===client)this.client=undefined;});await client.connect();this.client=client;return client;}
  async acquire(priority:DataApiPriority,operation:string,deadlineAt?:number):Promise<void>{const started=Date.now();for(;;){if(deadlineAt!==undefined&&Date.now()>=deadlineAt)throw new DataApiDeadlineError();const db=await this.db();const r=await db.query('SELECT * FROM execution.acquire_data_api_permit($1,$2,$3,$4,$5,$6,$7,$8)',[this.providerKey,priority,operation,this.config.total,this.config.p0,this.config.p1,this.config.p2,this.config.p3]);const row=r.rows[0]??{};if(row.granted===true||row.granted==='t')return;const maxWait=Math.min(priorityWaitMs[priority],deadlineAt===undefined?Infinity:Math.max(0,deadlineAt-started));if(Date.now()-started>=maxWait)throw new DataApiBudgetShedError(priority,operation);await sleep(Math.max(1,Math.min(Number(row.wait_ms??100),1000,deadlineAt===undefined?1000:Math.max(1,deadlineAt-Date.now()))));}}
  async note429(priority:DataApiPriority,operation:string,backoffMs:number):Promise<void>{const db=await this.db();await db.query('SELECT execution.report_data_api_pressure($1,$2,$3,$4)',[this.providerKey,priority,operation,Math.max(1,backoffMs)]);}
  async noteRetry(priority:DataApiPriority,operation:string):Promise<void>{const db=await this.db();await db.query("SELECT execution.data_api_metric_event($1,$2,$3,'RETRY',0)",[this.providerKey,priority,operation]);}
}
const sharedCoordinators=new Map<string,DataApiCoordinator>();
/** Process handles share a PostgreSQL permit authority; the URL itself is never persisted. */
export function defaultDataApiCoordinator(providerUrl:string):DataApiCoordinator|undefined{if(!process.env.DATABASE_URL?.trim())return undefined;return sharedCoordinators.get(providerUrl)??(()=>{const c=new PostgresDataApiCoordinator(providerUrl);sharedCoordinators.set(providerUrl,c);return c;})();}
function retryAfterMs(response:Response,now:number):number|undefined{const raw=response.headers.get('retry-after')?.trim();if(!raw)return undefined;const seconds=Number(raw);if(Number.isFinite(seconds)&&seconds>=0)return Math.ceil(seconds*1000);const at=Date.parse(raw);return Number.isFinite(at)?Math.max(0,at-now):undefined;}
function errorCode(error:unknown){return error&&typeof error==='object'?String((error as {code?:unknown}).code??''):'';}
export function classifyDataApiFailure(error:unknown):{failureClass:'TRANSIENT_DATA_API'|'DATA_API_RATE_PRESSURE'|'SCHEMA_OR_PROTOCOL_FAILURE'|'UNKNOWN';retryable:boolean}{const message=error instanceof Error?error.message:String(error),name=error instanceof Error?error.name:'',code=errorCode(error);if(error instanceof DataApiBudgetShedError||/DATA_API_HTTP:429/.test(message))return{failureClass:'DATA_API_RATE_PRESSURE',retryable:true};if(name==='AbortError'||['ECONNRESET','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(code)||/DATA_API_HTTP:(500|502|503|504)/.test(message))return{failureClass:'TRANSIENT_DATA_API',retryable:true};if(/DATA_API_(SCHEMA|.*IDENTITY|.*TIMEFRAME|.*PAGE)/.test(message))return{failureClass:'SCHEMA_OR_PROTOCOL_FAILURE',retryable:false};return{failureClass:'UNKNOWN',retryable:false};}
function assertObject(value: unknown, code: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code); return value as Record<string,unknown>; }

export function createMeteoraDataApi(opts: {baseUrl?:string;discoveryBaseUrl?:string;maxRps?:number;timeoutMs?:number;fetchImpl?:FetchLike;maxRetries?:number;sleepImpl?:SleepLike;priority?:DataApiPriority;coordinator?:DataApiCoordinator;deadlineAt?:number;nowImpl?:()=>number} = {}): MeteoraDataApi {
  const base=(opts.baseUrl ?? METEORA_DATA_API_DEFAULT).replace(/\/$/,'');
  const discoveryBase=(opts.discoveryBaseUrl ?? METEORA_DISCOVERY_API_DEFAULT).replace(/\/$/,'');
  const limiter=new TokenBucketLimiter(opts.maxRps ?? 25); const timeout=opts.timeoutMs ?? 10000; const fetchImpl=opts.fetchImpl ?? fetch; const maxRetries=Math.max(0,opts.maxRetries??2); const sleepImpl=opts.sleepImpl??sleep;const nowImpl=opts.nowImpl??(()=>Date.now());const priority=opts.priority??'P2_DISCOVERY_CURRENT';const coordinator=opts.coordinator??defaultDataApiCoordinator(base);
  async function getAt(apiBase:string,path:string, query:Record<string,string|number|undefined>={}): Promise<unknown> {
    const url=new URL(apiBase+path); for (const [k,v] of Object.entries(query)) if (v!==undefined) url.searchParams.set(k,String(v));
    const operation=`GET ${path}`;
    for(let attempt=0;;attempt++){const remaining=opts.deadlineAt===undefined?Infinity:opts.deadlineAt-nowImpl();if(remaining<=0)throw new DataApiDeadlineError();await coordinator?.acquire(priority,operation,opts.deadlineAt);await limiter.take();const requestTimeout=Math.max(1,Math.min(timeout,remaining));const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),requestTimeout);try {const response=await fetchImpl(url,{method:'GET',headers:{accept:'application/json'},signal:controller.signal});if(!response.ok){const retryable=[429,500,502,503,504].includes(response.status);const retryDelay=Math.max(100,retryAfterMs(response,nowImpl())??100*(2**attempt));if(retryable&&attempt<maxRetries&&retryDelay<(opts.deadlineAt===undefined?Infinity:Math.max(0,opts.deadlineAt-nowImpl()))){if(response.status===429)await coordinator?.note429(priority,operation,retryDelay);else await coordinator?.noteRetry(priority,operation);await sleepImpl(retryDelay);continue;}throw new Error(`LPFORGE_DATA_API_HTTP:${response.status}`);}return await response.json();}catch(error){const name=error instanceof Error?error.name:'';const code=errorCode(error);const transient=name==='AbortError'||['ECONNRESET','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(code);const retryDelay=100*(2**attempt);if(transient&&attempt<maxRetries&&retryDelay<(opts.deadlineAt===undefined?Infinity:Math.max(0,opts.deadlineAt-nowImpl()))){await coordinator?.noteRetry(priority,operation);await sleepImpl(retryDelay);continue;}throw error;}finally{clearTimeout(timer);}}
  }
  const get=(path:string,query:Record<string,string|number|undefined>={})=>getAt(base,path,query);
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
    },
    async getOpenPositionPnl(poolAddress,ownerAddress) {
      if(!poolAddress.trim()||!ownerAddress.trim())throw new Error('LPFORGE_DATA_API_POSITION_PNL_IDENTITY');
      const obj=assertObject(await get(`/positions/${encodeURIComponent(poolAddress)}/pnl`,{user:ownerAddress,status:'open',pageSize:100,page:1}),'LPFORGE_DATA_API_SCHEMA:POSITION_PNL');
      if(!Array.isArray(obj.positions))throw new Error('LPFORGE_DATA_API_SCHEMA:POSITION_PNL_DATA');
      return obj.positions.filter((value):value is MeteoraPositionPnl=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&typeof (value as Record<string,unknown>).positionAddress==='string') as MeteoraPositionPnl[];
    },
    async listDiscoveryPools(page=1,pageSize=100,options={}) {
      if(!Number.isInteger(page)||page<1)throw new Error('LPFORGE_DISCOVERY_API_PAGE');
      if(!Number.isInteger(pageSize)||pageSize<1||pageSize>250)throw new Error('LPFORGE_DISCOVERY_API_PAGE_SIZE');
      const allowed=new Set<MeteoraDiscoveryTimeframe>(['30m','1h','24h']);
      if(options.timeframe!==undefined&&!allowed.has(options.timeframe))throw new Error('LPFORGE_DISCOVERY_API_TIMEFRAME');
      const value=assertObject(await getAt(discoveryBase,'/pools',{page,page_size:pageSize,timeframe:options.timeframe,sort_by:options.sortBy,filter_by:options.filterBy,category:options.category}),'LPFORGE_DISCOVERY_API_SCHEMA:POOLS');
      if(!Array.isArray(value.data))throw new Error('LPFORGE_DISCOVERY_API_SCHEMA:POOLS_DATA');
      return value as unknown as MeteoraDiscoveryPoolsPage;
    }
  };
}
