import {createHash} from 'node:crypto';
import {Connection} from '@solana/web3.js';
import { asNumber, asString, nowIso, type Base58Address, type BinLiquidityFact, type CollectFeeMode, type FunctionType, type PoolStateFact, type PositionV2Fact, type ProtocolCompatibilityCheck, type SwapEventFact } from '../../domain/src/index.js';

export const EXPECTED_DLMM_PROGRAM_ID = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
export const BASELINE_METEORA_SDK_VERSION = '1.9.10';
export const EVENT_DECODER_VERSION = 'lpforge-swap2evt-v2-cpi';

export interface MeteoraReadAdapter {
  verifyCompatibility(smokePool?: Base58Address): Promise<ProtocolCompatibilityCheck>;
  getPool(address: Base58Address): Promise<PoolStateFact>;
  getActiveBin(address: Base58Address): Promise<BinLiquidityFact>;
  getBinsAroundActive(address: Base58Address, left: number, right?: number): Promise<BinLiquidityFact[]>;
  getPositionV2(poolAddress: Base58Address, positionAddress: Base58Address): Promise<PositionV2Fact>;
  decodeEvents(poolAddress: Base58Address, signature: string, slot: bigint | undefined, blockTime: string | undefined, logs: string[], cpiInstructionData?: string[]): Promise<SwapEventFact[]>;
}

export interface MeteoraEventDecodeWarning {
  code: 'LPFORGE_METEORA_EVENT_DECODE_QUARANTINED';
  poolAddress: Base58Address;
  signature: string;
  slot?: string;
  payloadChars: number;
  source?: 'PROGRAM_DATA'|'EVENT_CPI';
  errorName: string;
  errorMessage: string;
}

type AnchorDecodedEvent = {name:string;data:Record<string,unknown>};
type AnchorEventCoder = {decode?:(data:string)=>AnchorDecodedEvent|null};

export function tryDecodeAnchorEvent(coder:AnchorEventCoder, encoded:string):{decoded:AnchorDecodedEvent|null;error?:Error}{
  if(!coder.decode)return{decoded:null};
  try{return{decoded:coder.decode(encoded)}}catch(error){return{decoded:null,error:error instanceof Error?error:new Error(String(error))};}
}

export interface SolanaRpcClient {
  call<T>(method:string, params:unknown[]): Promise<T>;
  getSlot(): Promise<bigint>;
  getSignaturesForAddress(address:string, limit:number, before?:string): Promise<Array<{signature:string;slot:number;blockTime?:number|null;err?:unknown}>>;
  getTransaction(signature:string): Promise<Record<string,unknown>|null>;
}

type FetchLike=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
type SleepLike=(ms:number)=>Promise<void>;
export type RpcPriority='P0_EXECUTION_CRITICAL'|'P1_RECOVERY_CRITICAL'|'P2_POSITION_MANAGEMENT'|'P3_DISCOVERY'|'P4_BACKFILL';
export interface RpcCoordinator { acquire(priority:RpcPriority,method:string):Promise<void>; note429(priority:RpcPriority,method:string,retryAfterMs:number):Promise<void>; noteRetry(priority:RpcPriority,method:string):Promise<void>; }
export class RpcBudgetShedError extends Error { readonly code='LPFORGE_RPC_BUDGET_SHED'; constructor(readonly priority:RpcPriority,readonly method:string){super(`LPFORGE_RPC_BUDGET_SHED:${priority}:${method}`);} }
type PgClient={connect:()=>Promise<void>;query:(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>}>;end:()=>Promise<void>};
type RpcBudgetConfig={total:number;p0:number;p1:number;p2:number;p3:number;p4:number;};
const priorityWaitMs:Record<RpcPriority,number>={P0_EXECUTION_CRITICAL:60_000,P1_RECOVERY_CRITICAL:60_000,P2_POSITION_MANAGEMENT:10_000,P3_DISCOVERY:1_500,P4_BACKFILL:250};
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function envInt(name:string,fallback:number,min:number){const value=Number(process.env[name]??fallback);return Number.isSafeInteger(value)&&value>=min?value:fallback;}
function rpcBudgetConfig():RpcBudgetConfig{const total=envInt('LPFORGE_RPC_GLOBAL_MAX_RPS',12,3);const p0=envInt('LPFORGE_RPC_P0_RESERVED_RPS',3,0);const p1=envInt('LPFORGE_RPC_P1_RESERVED_RPS',3,0);if(p0+p1>=total)throw new Error('LPFORGE_RPC_BUDGET_INVALID');return{total,p0,p1,p2:envInt('LPFORGE_RPC_P2_MAX_RPS',Math.max(1,total-p0-p1),1),p3:envInt('LPFORGE_RPC_P3_MAX_RPS',Math.max(1,Math.floor((total-p0-p1)/2)),1),p4:envInt('LPFORGE_RPC_P4_MAX_RPS',1,1)};}
class PostgresRpcCoordinator implements RpcCoordinator {
  private client?:PgClient; private readonly providerKey:string; private readonly config=rpcBudgetConfig();
  constructor(url:string){this.providerKey=createHash('sha256').update(url).digest('hex');}
  private async db():Promise<PgClient>{if(this.client)return this.client;const pg=await import('pg') as unknown as {Client:new(input:{connectionString:string})=>PgClient};const url=process.env.DATABASE_URL?.trim();if(!url)throw new Error('LPFORGE_RPC_COORDINATOR_DATABASE_URL_REQUIRED');const client=new pg.Client({connectionString:url});await client.connect();this.client=client;return client;}
  async acquire(priority:RpcPriority,method:string):Promise<void>{const started=Date.now();for(;;){const db=await this.db();const r=await db.query('SELECT * FROM execution.acquire_rpc_permit($1,$2,$3,$4,$5,$6,$7,$8,$9)',[this.providerKey,priority,method,this.config.total,this.config.p0,this.config.p1,this.config.p2,this.config.p3,this.config.p4]);const row=r.rows[0]??{};if(row.granted===true||row.granted==='t')return;const waited=Date.now()-started;if(waited>=priorityWaitMs[priority]&&priority!=='P0_EXECUTION_CRITICAL'&&priority!=='P1_RECOVERY_CRITICAL')throw new RpcBudgetShedError(priority,method);await sleep(Math.max(1,Math.min(Number(row.wait_ms??100),1000)));}}
  async note429(priority:RpcPriority,method:string,backoffMs:number):Promise<void>{const db=await this.db();await db.query('SELECT execution.report_rpc_pressure($1,$2,$3,$4)',[this.providerKey,priority,method,Math.max(1,backoffMs)]);}
  async noteRetry(priority:RpcPriority,method:string):Promise<void>{const db=await this.db();await db.query("SELECT execution.rpc_metric_event($1,$2,$3,'RETRY',0)",[this.providerKey,priority,method]);}
}
const sharedCoordinators=new Map<string,RpcCoordinator>();
/** Returns the process handle for the database-backed system-wide coordinator. */
export function defaultRpcCoordinator(providerUrl:string):RpcCoordinator|undefined {if(!process.env.DATABASE_URL?.trim())return undefined;return sharedCoordinators.get(providerUrl)??(()=>{const coordinator=new PostgresRpcCoordinator(providerUrl);sharedCoordinators.set(providerUrl,coordinator);return coordinator;})();}
function methodFromBody(body:unknown):string{try{const parsed=typeof body==='string'?JSON.parse(body):body;return typeof parsed==='object'&&parsed&&typeof (parsed as {method?:unknown}).method==='string'?(parsed as {method:string}).method:'sdk';}catch{return'sdk';}}
/** SDK Connection fetch hook. Every web3/Meteora RPC request receives the same shared permit as direct JSON-RPC. */
export function createGovernedRpcFetch(input:{rpcUrl?:string;fetchImpl?:FetchLike;coordinator?:RpcCoordinator;priority:RpcPriority}):FetchLike {const fetchImpl=input.fetchImpl??fetch;const coordinator=input.coordinator??(input.rpcUrl?defaultRpcCoordinator(input.rpcUrl):undefined);return async(url,init)=>{const method=methodFromBody(init?.body);await coordinator?.acquire(input.priority,method);const response=await fetchImpl(url,init);if(response.status===429)await coordinator?.note429(input.priority,method,retryAfterMs(response,Date.now())??1000);return response;};}
/** Create a web3 Connection whose SDK fan-out is admitted by the shared coordinator. */
export function createGovernedConnection(input:{rpcUrl:string;priority:RpcPriority;coordinator?:RpcCoordinator;commitment?:'confirmed'|'finalized'|'processed'}):Connection{return new Connection(input.rpcUrl,{commitment:input.commitment??'confirmed',fetch:createGovernedRpcFetch({rpcUrl:input.rpcUrl,priority:input.priority,...(input.coordinator?{coordinator:input.coordinator}:{})})});}
export interface SolanaRpcClientOptions {
  url:string;
  timeoutMs?:number;
  fetchImpl?:FetchLike;
  minIntervalMs?:number;
  maxRetries?:number;
  retryBaseDelayMs?:number;
  retryMaxDelayMs?:number;
  sleepImpl?:SleepLike;
  nowImpl?:()=>number;
  priority?:RpcPriority;
  coordinator?:RpcCoordinator;
}
function retryAfterMs(response:Response,now:number):number|undefined {
  const raw=response.headers.get('retry-after')?.trim(); if(!raw)return undefined;
  const seconds=Number(raw); if(Number.isFinite(seconds)&&seconds>=0)return Math.ceil(seconds*1000);
  const at=Date.parse(raw); return Number.isFinite(at)?Math.max(0,at-now):undefined;
}
export function createSolanaRpcClient(opts:SolanaRpcClientOptions):SolanaRpcClient {
  let id=0; let lastRequestStartedAt=-Infinity;
  const fetchImpl=opts.fetchImpl??fetch; const timeout=opts.timeoutMs??12000;
  const minIntervalMs=Math.max(0,opts.minIntervalMs??125); const maxRetries=Math.max(0,opts.maxRetries??5);
  const retryBaseDelayMs=Math.max(1,opts.retryBaseDelayMs??250); const retryMaxDelayMs=Math.max(retryBaseDelayMs,opts.retryMaxDelayMs??4000);
  const sleepImpl=opts.sleepImpl??(ms=>new Promise(resolve=>setTimeout(resolve,ms))); const nowImpl=opts.nowImpl??(()=>Date.now());
  const priority=opts.priority??'P2_POSITION_MANAGEMENT'; const coordinator=opts.coordinator??defaultRpcCoordinator(opts.url);
  async function pace(){const wait=Math.max(0,minIntervalMs-(nowImpl()-lastRequestStartedAt));if(wait>0)await sleepImpl(wait);lastRequestStartedAt=nowImpl();}
  async function call<T>(method:string,params:unknown[]):Promise<T>{
    for(let attempt=0;;attempt++){
      await coordinator?.acquire(priority,method);
      await pace();
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeout);
      try {
        const r=await fetchImpl(opts.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:controller.signal});
        if(!r.ok){
          const transient=r.status===429||r.status===500||r.status===502||r.status===503||r.status===504;
          if(transient&&attempt<maxRetries){
            const exponential=Math.min(retryMaxDelayMs,retryBaseDelayMs*(2**attempt));
            const wait=Math.max(exponential,retryAfterMs(r,nowImpl())??0);
            if(r.status===429)await coordinator?.note429(priority,method,wait); else await coordinator?.noteRetry(priority,method);
            await sleepImpl(wait); continue;
          }
          throw new Error(`LPFORGE_RPC_HTTP:${r.status}`);
        }
        const body=await r.json() as {result?:T;error?:{code:number;message:string}};
        if(body.error){
          // A provider can intermittently fail one historical transaction
          // lookup. Retry transient JSON-RPC errors inside the configured RPC
          // budget before scanner-level quarantine is considered.
          const transient=body.error.code===-32603||body.error.code===-32005||body.error.code===-32004;
          if(transient&&attempt<maxRetries){
            await coordinator?.noteRetry(priority,method);
            await sleepImpl(Math.min(retryMaxDelayMs,retryBaseDelayMs*(2**attempt)));
            continue;
          }
          throw new Error(`LPFORGE_RPC:${method}:${body.error.code}:${body.error.message}`);
        }
        return body.result as T;
      } finally {clearTimeout(timer);}
    }
  }
  return { call, async getSlot(){return BigInt(await call<number>('getSlot',[{commitment:'confirmed'}]));}, async getSignaturesForAddress(address,limit,before){return call('getSignaturesForAddress',[address,{limit,...(before?{before}:{}),commitment:'confirmed'}]);}, async getTransaction(signature){return call('getTransaction',[signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]);} };
}

function field(obj: unknown, ...paths: string[][]): unknown {
  for (const path of paths) { let cur: unknown=obj; let ok=true; for (const key of path) { if (!cur || typeof cur!=='object' || !(key in (cur as Record<string,unknown>))) {ok=false;break;} cur=(cur as Record<string,unknown>)[key]; } if(ok && cur!==undefined && cur!==null)return cur; }
  return undefined;
}
function functionType(value: unknown): FunctionType { const n=asNumber(value); if(n===0)return'UNDETERMINED'; if(n===1)return'LIQUIDITY_MINING'; if(n===2)return'LIMIT_ORDER'; const s=asString(value).toLowerCase(); if(s.includes('liquidity'))return'LIQUIDITY_MINING'; if(s.includes('limit'))return'LIMIT_ORDER'; return'UNKNOWN'; }
function collectFeeMode(value: unknown): CollectFeeMode { const n=asNumber(value); if(n===0)return'INPUT_ONLY'; if(n===1)return'ONLY_Y'; const s=asString(value).toLowerCase(); if(s.includes('input'))return'INPUT_ONLY'; if(s.includes('onlyy')||s.includes('only_y'))return'ONLY_Y'; return'UNKNOWN'; }
function publicKeyString(value: unknown): string { return asString(value); }

export function normalizePoolFromSdk(address:string, client:Record<string,unknown>, slot:bigint, dynamicFee?:unknown):PoolStateFact {
  const lb=field(client,['lbPair']) as Record<string,unknown>|undefined; if(!lb)throw new Error('LPFORGE_METEORA_SDK_SHAPE:LBPAIR');
  const tokenX=field(client,['tokenX','publicKey'],['tokenX','mint'],['lbPair','tokenXMint']);
  const tokenY=field(client,['tokenY','publicKey'],['tokenY','mint'],['lbPair','tokenYMint']);
  const binStep=asNumber(field(lb,['binStep'],['parameters','binStep'],['parameters','bin_step']));
  const active=asNumber(field(lb,['activeId'],['active_id']));
  if(!tokenX||!tokenY||binStep===undefined||active===undefined)throw new Error('LPFORGE_METEORA_SDK_SHAPE:POOL_FIELDS');
  return {address,tokenXMint:publicKeyString(tokenX),tokenYMint:publicKeyString(tokenY),binStep,functionType:functionType(field(lb,['parameters','functionType'],['parameters','function_type'])),collectFeeMode:collectFeeMode(field(lb,['parameters','collectFeeMode'],['parameters','collect_fee_mode'])),activeBinId:active,...(dynamicFee!==undefined?{dynamicFeePct:asString(dynamicFee)}:{}),stamp:{source:'METEORA_SDK',chainSlot:slot,observedAt:nowIso()},raw:{activeId:active}};
}

export function normalizeBin(pool:string, raw:Record<string,unknown>, stamp:{slot:bigint;observedAt:string}):BinLiquidityFact {
  const id=asNumber(field(raw,['binId'],['bin_id'])); if(id===undefined)throw new Error('LPFORGE_METEORA_SDK_SHAPE:BIN_ID');
  return {pool,binId:id,price:asString(field(raw,['price'],['pricePerToken']))||'0',amountX:asString(field(raw,['xAmount'],['amountX'],['amount_x']))||'0',amountY:asString(field(raw,['yAmount'],['amountY'],['amount_y']))||'0',...(field(raw,['liquiditySupply'],['liquidity_supply'])!==undefined?{liquiditySupply:asString(field(raw,['liquiditySupply'],['liquidity_supply']))}:{}),stamp:{source:'METEORA_SDK',chainSlot:stamp.slot,observedAt:stamp.observedAt}};
}

export function normalizePosition(poolAddress:string, positionAddress:string, raw:Record<string,unknown>, slot:bigint):PositionV2Fact {
  const pd=(field(raw,['positionData']) ?? raw) as Record<string,unknown>;
  const lower=asNumber(field(pd,['lowerBinId'],['lower_bin_id'],['positionBinData','0','binId']));
  const upper=asNumber(field(pd,['upperBinId'],['upper_bin_id']));
  const owner=publicKeyString(field(pd,['owner'],['positionData','owner']));
  if(lower===undefined||upper===undefined||!owner)throw new Error('LPFORGE_METEORA_SDK_SHAPE:POSITION_FIELDS');
  return {address:positionAddress,pool:poolAddress,owner,...(field(pd,['feeOwner'])?{feeOwner:publicKeyString(field(pd,['feeOwner']))}:{}),lowerBinId:lower,upperBinId:upper,totalXAmount:asString(field(pd,['totalXAmount'],['totalX']))||'0',totalYAmount:asString(field(pd,['totalYAmount'],['totalY']))||'0',feeX:asString(field(pd,['feeX'],['feeXAmount']))||'0',feeY:asString(field(pd,['feeY'],['feeYAmount']))||'0',stamp:{source:'METEORA_SDK',chainSlot:slot,observedAt:nowIso()},raw:{sdkPosition:true}};
}

async function loadSdk() {
  const moduleName='node:module';
  const mod=await import(moduleName) as unknown as {createRequire:(url:string)=>((id:string)=>unknown)&{resolve:(id:string)=>string}};
  const rootRequire=mod.createRequire(import.meta.url);
  const web3=rootRequire('@solana/web3.js') as {Connection:new(url:string,config:unknown)=>unknown;PublicKey:new(value:string)=>unknown};
  const DLMM=rootRequire('@meteora-ag/dlmm') as {create:(connection:unknown,key:unknown,opt:unknown)=>Promise<Record<string,unknown>>};
  if(!DLMM||typeof DLMM.create!=='function')throw new Error('LPFORGE_METEORA_SDK_INCOMPATIBLE'); return {web3,DLMM};
}

export function createMeteoraReadAdapter(opts:{rpcUrl:string;cluster:'mainnet-beta'|'devnet';programId:string;expectedSdkVersion?:string;rpcTimeoutMs?:number;rpcMinIntervalMs?:number;rpcMaxRetries?:number;retryBaseDelayMs?:number;retryMaxDelayMs?:number;priority?:RpcPriority;coordinator?:RpcCoordinator;onEventDecodeWarning?:(warning:MeteoraEventDecodeWarning)=>void}):MeteoraReadAdapter {
  const priority=opts.priority??'P2_POSITION_MANAGEMENT'; const coordinator=opts.coordinator??defaultRpcCoordinator(opts.rpcUrl);
  const rpc=createSolanaRpcClient({url:opts.rpcUrl,...(opts.rpcTimeoutMs!==undefined?{timeoutMs:opts.rpcTimeoutMs}:{}),...(opts.rpcMinIntervalMs!==undefined?{minIntervalMs:opts.rpcMinIntervalMs}:{}),...(opts.rpcMaxRetries!==undefined?{maxRetries:opts.rpcMaxRetries}:{}),...(opts.retryBaseDelayMs!==undefined?{retryBaseDelayMs:opts.retryBaseDelayMs}:{}),...(opts.retryMaxDelayMs!==undefined?{retryMaxDelayMs:opts.retryMaxDelayMs}:{}),priority,...(coordinator?{coordinator}:{})});
  const clientCache=new Map<string,Promise<Record<string,unknown>>>();
  async function client(address:string):Promise<Record<string,unknown>> { let pending=clientCache.get(address); if(!pending){ pending=(async()=>{const {web3,DLMM}=await loadSdk(); const connection=new web3.Connection(opts.rpcUrl,{commitment:'confirmed',fetch:createGovernedRpcFetch({rpcUrl:opts.rpcUrl,priority,...(coordinator?{coordinator}:{})})}); const key=new web3.PublicKey(address); const programId=new web3.PublicKey(opts.programId); return DLMM.create(connection,key,{cluster:opts.cluster,programId});})(); clientCache.set(address,pending); } return pending; }
  return {
    async verifyCompatibility(smokePool){ const checkedAt=nowIso(); try { if(opts.programId!==EXPECTED_DLMM_PROGRAM_ID)throw new Error('PROGRAM_ID_MISMATCH'); await loadSdk(); const details:Record<string,unknown>={sdkImport:true,programIdMatch:true}; if(smokePool){const p=await client(smokePool); details.smokePoolLoaded=Boolean(p.lbPair); details.slot=(await rpc.getSlot()).toString();} return {state:'VERIFIED',programId:opts.programId,expectedSdkVersion:opts.expectedSdkVersion??BASELINE_METEORA_SDK_VERSION,decoderVersion:EVENT_DECODER_VERSION,checkedAt,details}; } catch(error){return {state:'HOLD',programId:opts.programId,expectedSdkVersion:opts.expectedSdkVersion??BASELINE_METEORA_SDK_VERSION,decoderVersion:EVENT_DECODER_VERSION,checkedAt,details:{error:error instanceof Error?error.message:String(error)}};} },
    async getPool(address){ const c=await client(address); const slot=await rpc.getSlot(); const dyn=typeof c.getDynamicFee==='function'?await (c.getDynamicFee as ()=>Promise<unknown>|unknown)():undefined; return normalizePoolFromSdk(address,c,slot,dyn); },
    async getActiveBin(address){ const c=await client(address); if(typeof c.getActiveBin!=='function')throw new Error('LPFORGE_METEORA_SDK_METHOD:getActiveBin'); const [raw,slot]=await Promise.all([(c.getActiveBin as ()=>Promise<Record<string,unknown>>)(),rpc.getSlot()]); return normalizeBin(address,raw,{slot,observedAt:nowIso()}); },
    async getBinsAroundActive(address,left,right=left){ const c=await client(address); if(typeof c.getBinsAroundActiveBin!=='function')throw new Error('LPFORGE_METEORA_SDK_METHOD:getBinsAroundActiveBin'); const [result,slot]=await Promise.all([(c.getBinsAroundActiveBin as (l:number,r:number)=>Promise<Record<string,unknown>>)(left,right),rpc.getSlot()]); const bins=field(result,['bins']); if(!Array.isArray(bins))throw new Error('LPFORGE_METEORA_SDK_SHAPE:BINS'); const observedAt=nowIso(); return bins.map(b=>normalizeBin(address,b as Record<string,unknown>,{slot,observedAt})); },
    async getPositionV2(poolAddress,positionAddress){ const c=await client(poolAddress); if(typeof c.getPosition!=='function')throw new Error('LPFORGE_METEORA_SDK_METHOD:getPosition'); const {web3}=await loadSdk(); const raw=await (c.getPosition as (key:unknown)=>Promise<Record<string,unknown>>)(new web3.PublicKey(positionAddress)); return normalizePosition(poolAddress,positionAddress,raw,await rpc.getSlot()); },
    async decodeEvents(poolAddress,signature,slot,blockTime,logs,cpiInstructionData=[]){
      const c=await client(poolAddress);
      const coder=field(c,['program','coder','events']) as AnchorEventCoder|undefined;
      if(!coder?.decode)return[];
      const out:SwapEventFact[]=[];
      let idx=0;
      const sources=[
        ...extractProgramDataLogsForProgram(logs,opts.programId).map(encoded=>({encoded,source:'PROGRAM_DATA' as const})),
        ...cpiInstructionData.flatMap(data=>{const encoded=anchorEventBase64FromCpiInstruction(data);return encoded?[{encoded,source:'EVENT_CPI' as const}]:[];})
      ];
      for(const {encoded,source} of sources){
        const attempt=tryDecodeAnchorEvent(coder,encoded);
        if(attempt.error){
          opts.onEventDecodeWarning?.({
            code:'LPFORGE_METEORA_EVENT_DECODE_QUARANTINED',
            poolAddress,
            signature,
            ...(slot!==undefined?{slot:slot.toString()}:{}),
            payloadChars:encoded.length,
            source,
            errorName:attempt.error.name,
            errorMessage:attempt.error.message
          });
          continue;
        }
        const decoded=attempt.decoded;
        if(!decoded)continue;
        const eventName=decoded.name.toLowerCase();
        if(eventName!=='swap2evt')continue;
        const d=decoded.data;
        const sender=publicKeyString(field(d,['sender'],['user'],['from']));
        const startBinId=asNumber(field(d,['startBinId'],['start_bin_id']));
        const endBinId=asNumber(field(d,['endBinId'],['end_bin_id']));
        const swapForYValue=field(d,['swapForY'],['swap_for_y']);
        const amountIn=asString(field(d,['amountIn'],['amount_in']));
        const amountOut=asString(field(d,['amountOut'],['amount_out']));
        const mmFee=asString(field(d,['mmFee'],['mm_fee']));
        const protocolFee=asString(field(d,['protocolFee'],['protocol_fee']));
        const limitOrderFee=asString(field(d,['limitOrderFee'],['limit_order_fee']));
        const hostFee=asString(field(d,['hostFee'],['host_fee']));
        const amountLeft=asString(field(d,['amountLeft'],['amount_left']));
        const feeBps=asString(field(d,['feeBps'],['fee_bps']));
        const feesOnInputValue=field(d,['feesOnInput'],['fees_on_input']);
        const feesOnTokenXValue=field(d,['feesOnTokenX'],['fees_on_token_x']);
        out.push({signature,eventIndex:idx++,pool:publicKeyString(field(d,['lbPair'],['lb_pair']))||poolAddress,...(sender?{sender}:{}),...(startBinId!==undefined?{startBinId}:{}),...(endBinId!==undefined?{endBinId}:{}),...(typeof swapForYValue==='boolean'?{swapForY:swapForYValue}:{}),...(amountIn?{amountIn}:{}),...(amountLeft?{amountLeft}:{}),...(amountOut?{amountOut}:{}),...(feeBps?{feeBps}:{}),...(mmFee?{mmFee}:{}),...(protocolFee?{protocolFee}:{}),...(limitOrderFee?{limitOrderFee}:{}),...(hostFee?{hostFee}:{}),...(typeof feesOnInputValue==='boolean'?{feesOnInput:feesOnInputValue}:{}),...(typeof feesOnTokenXValue==='boolean'?{feesOnTokenX:feesOnTokenXValue}:{}),stamp:{source:'SOLANA_RPC',...(slot!==undefined?{chainSlot:slot}:{}),...(blockTime?{blockTime}:{}),observedAt:nowIso()},raw:{...d,eventTransport:source}});
      }
      return out;
    }
  };
}

export function extractProgramDataLogs(logs:string[]):string[]{ const prefix='Program data: '; return logs.filter(l=>l.startsWith(prefix)).map(l=>l.slice(prefix.length).trim()).filter(Boolean); }

export function extractProgramDataLogsForProgram(logs:string[],programId:string):string[]{
  const invoke=/^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[\d+\]$/;
  const complete=/^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:.*)$/;
  const prefix='Program data: ';
  const stack:string[]=[];
  const out:string[]=[];
  for(const line of logs){
    const invoked=invoke.exec(line);
    if(invoked){stack.push(invoked[1]!);continue;}
    const completed=complete.exec(line);
    if(completed){
      const id=completed[1]!;
      for(let i=stack.length-1;i>=0;i--){if(stack[i]===id){stack.length=i;break;}}
      continue;
    }
    if(line.startsWith(prefix)&&stack.at(-1)===programId){const encoded=line.slice(prefix.length).trim();if(encoded)out.push(encoded);}
  }
  return out;
}

const BASE58_ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function decodeBase58(value:string):Uint8Array{
  if(!value)return new Uint8Array();
  let n=0n;for(const ch of value){const i=BASE58_ALPHABET.indexOf(ch);if(i<0)throw new Error('LPFORGE_BASE58_INVALID');n=n*58n+BigInt(i);}
  const bytes:number[]=[];while(n>0n){bytes.push(Number(n&255n));n>>=8n;}bytes.reverse();
  let leading=0;while(leading<value.length&&value[leading]==='1')leading++;
  return Uint8Array.from([...Array(leading).fill(0),...bytes]);
}
export function anchorEventBase64FromCpiInstruction(data:string):string|undefined{
  try{const raw=decodeBase58(data);if(raw.length<=8)return undefined;return btoa(String.fromCharCode(...raw.subarray(8)));}catch{return undefined;}
}
function accountKeyStrings(tx:Record<string,unknown>):string[]{
  const transaction=(tx.transaction??{}) as Record<string,unknown>;const message=(transaction.message??{}) as Record<string,unknown>;
  const base=(Array.isArray(message.accountKeys)?message.accountKeys.flatMap(v=>typeof v==='string'?[v]:v&&typeof v==='object'&&typeof (v as Record<string,unknown>).pubkey==='string'?[String((v as Record<string,unknown>).pubkey)]:[]):[]) as string[];
  const meta=(tx.meta??{}) as Record<string,unknown>;const loaded=(meta.loadedAddresses??{}) as Record<string,unknown>;
  const writable=Array.isArray(loaded.writable)?loaded.writable.filter((x):x is string=>typeof x==='string'):[];const readonly=Array.isArray(loaded.readonly)?loaded.readonly.filter((x):x is string=>typeof x==='string'):[];
  return [...base,...writable,...readonly];
}
export function extractInnerInstructionDataForProgram(tx:Record<string,unknown>,programId:string):string[]{
  const keys=accountKeyStrings(tx);const meta=(tx.meta??{}) as Record<string,unknown>;const groups=Array.isArray(meta.innerInstructions)?meta.innerInstructions:[];const out:string[]=[];
  for(const group of groups){if(!group||typeof group!=='object')continue;const ixs=(group as Record<string,unknown>).instructions;if(!Array.isArray(ixs))continue;for(const ix of ixs){if(!ix||typeof ix!=='object')continue;const r=ix as Record<string,unknown>;const index=Number(r.programIdIndex);if(!Number.isInteger(index)||keys[index]!==programId||typeof r.data!=='string')continue;out.push(r.data);}}
  return out;
}
export interface ScannedAddressTransaction {signature:string;slot:bigint;blockTime?:string;logs:string[];cpiInstructionData:string[];}
export interface ScanTransactionFailure {signature:string;message:string;}
export async function scanAddressTransactions(opts:{rpc:SolanaRpcClient;address:string;limit:number;before?:string;programId?:string;maxTransactionFailures?:number;onTransactionFailure?:(failure:ScanTransactionFailure)=>void}):Promise<ScannedAddressTransaction[]> {
  const sigs=await opts.rpc.getSignaturesForAddress(opts.address,opts.limit,opts.before); const out:ScannedAddressTransaction[]=[];
  const maxFailures=Math.max(0,Math.floor(opts.maxTransactionFailures??3));let failures=0;
  for(const s of [...sigs].reverse()){
    if(s.err)continue;
    let tx:Record<string,unknown>|null;
    try{tx=await opts.rpc.getTransaction(s.signature);}catch(error){
      failures++;
      const message=error instanceof Error?error.message:String(error);
      opts.onTransactionFailure?.({signature:s.signature,message});
      if(failures>maxFailures)throw new Error(`LPFORGE_RPC_SCAN_TRANSACTION_FAILURE_THRESHOLD:${failures}/${maxFailures}:${message}`);
      continue;
    }
    if(!tx)continue;
    const meta=(tx.meta??{}) as Record<string,unknown>; const logs=Array.isArray(meta.logMessages)?meta.logMessages.filter((x):x is string=>typeof x==='string'):[]; out.push({signature:s.signature,slot:BigInt(s.slot),...(typeof s.blockTime==='number'?{blockTime:new Date(s.blockTime*1000).toISOString()}:{}),logs,cpiInstructionData:extractInnerInstructionDataForProgram(tx,opts.programId??EXPECTED_DLMM_PROGRAM_ID)});
  }
  return out;
}

export const scanProgramTransactions = scanAddressTransactions;
