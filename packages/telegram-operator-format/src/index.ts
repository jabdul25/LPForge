/**
 * Presentation-only formatting for the Telegram operator console.  This
 * module intentionally accepts persisted facts and does not import RPC,
 * pricing, Meteora, execution, or accounting code.
 */
export type TelegramPositionSummary = Record<string, unknown>;

const LAMPORTS_PER_SOL=1_000_000_000;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const number=(value:unknown):number|undefined=>{
  if(finite(value))return value;
  if(typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value)))return Number(value);
  return undefined;
};
const timestamp=(value:unknown):number|undefined=>{
  if(value instanceof Date)return value.getTime();
  if(typeof value==='string'||typeof value==='number'){const parsed=Date.parse(String(value));return Number.isFinite(parsed)?parsed:undefined;}
  return undefined;
};
const text=(value:unknown,fallback='unavailable')=>typeof value==='string'&&value.trim()?value.trim():typeof value==='number'&&Number.isFinite(value)?String(value):fallback;

export function shortenTelegramPositionAddress(value:unknown):string{
  const address=text(value,'unavailable');
  return address.length>12?`${address.slice(0,6)}…${address.slice(-4)}`:address;
}

/**
 * Resolves only an exact canonical address or the exact display alias emitted
 * by /positions.  A Telegram close request remains an operator intent: the
 * position manager still revalidates ownership, chain truth, authority, and
 * idempotency before it can construct a plan.
 */
export function resolveTelegramPositionAddress(input:{target:string;positions:readonly TelegramPositionSummary[]}):string{
  const target=input.target.trim();
  // /positions numbers the same entered-at ordered live-position list.  An
  // ordinal is resolved immediately to its canonical address and is never
  // persisted as an execution identifier.
  if(/^[1-9]\d*$/.test(target)){
    const ordinal=Number(target);
    if(Number.isSafeInteger(ordinal)&&ordinal<=input.positions.length)return String(input.positions[ordinal-1]!.position_address);
    throw new Error('LPFORGE_TELEGRAM_LIVE_POSITION_NOT_FOUND');
  }
  const exact=input.positions.filter(position=>String(position.position_address??'')===target);
  if(exact.length===1)return String(exact[0]!.position_address);
  if(exact.length>1)throw new Error('LPFORGE_TELEGRAM_LIVE_POSITION_AMBIGUOUS');
  const alias=input.positions.filter(position=>shortenTelegramPositionAddress(position.position_address)===target);
  if(alias.length===1)return String(alias[0]!.position_address);
  if(alias.length>1)throw new Error('LPFORGE_TELEGRAM_LIVE_POSITION_AMBIGUOUS');
  throw new Error('LPFORGE_TELEGRAM_LIVE_POSITION_NOT_FOUND');
}

function sol(value:unknown):string|undefined{
  const n=number(value);if(n===undefined)return undefined;
  return `${(n/LAMPORTS_PER_SOL).toFixed(6)} SOL`;
}
function usd(value:unknown,signed=false):string|undefined{
  const n=number(value);if(n===undefined)return undefined;
  return `${signed?(n<0?'-':'+'):(n<0?'-':'')}$${Math.abs(n).toFixed(4)}`;
}
function signedPercent(value:unknown):string|undefined{
  const n=number(value);if(n===undefined)return undefined;
  return `${n>=0?'+':''}${(n*100).toFixed(2)}%`;
}
function age(value:unknown,nowMs:number):string|undefined{
  const at=timestamp(value);if(at===undefined||at>nowMs)return undefined;
  const seconds=Math.floor((nowMs-at)/1000);
  if(seconds<60)return `${seconds}s ago`;
  const minutes=Math.floor(seconds/60);if(minutes<60)return `${minutes}m ago`;
  const hours=Math.floor(minutes/60);if(hours<24)return `${hours}h ${minutes%60}m`;
  return `${Math.floor(hours/24)}d ${hours%24}h`;
}
function chainFresh(summary:TelegramPositionSummary):boolean{return summary.observation_stale_data!==true&&summary.chain_truth_fresh!==false;}
function range(summary:TelegramPositionSummary):string{
  if(!chainFresh(summary))return '⚠️ CHAIN DATA STALE';
  const state=text(summary.oor_range_state,text(summary.observation_range_state,'UNKNOWN'));
  if(state==='IN_RANGE')return '🟢 IN RANGE';
  if(state==='OUT_OF_RANGE')return '🔴 OUT OF RANGE';
  return `⚠️ ${state}`;
}
function valuationAvailable(summary:TelegramPositionSummary):boolean{
  return chainFresh(summary)&&text(summary.valuation_state,'UNAVAILABLE')==='AVAILABLE'&&number(summary.net_return_fraction)!==undefined;
}
function lpValuationAvailable(summary:TelegramPositionSummary):boolean{
  return chainFresh(summary)&&text(summary.lp_mtm_state,'UNAVAILABLE')==='AVAILABLE'&&number(summary.lp_net_return_fraction)!==undefined;
}
function canonicalFee(summary:TelegramPositionSummary):string|undefined{
  if(!chainFresh(summary))return undefined;
  const fee=sol(summary.fee_value_lamports);
  return fee===undefined?undefined:`+${fee}`;
}
function positionState(summary:TelegramPositionSummary):string{
  const lifecycle=text(summary.lifecycle_state,'UNKNOWN').replaceAll('_',' ').toLowerCase();
  const reconciliation=text(summary.reconciliation_status,'UNKNOWN').replaceAll('_',' ').toLowerCase();
  const title=(value:string)=>value.replace(/\b\w/g,char=>char.toUpperCase());
  return reconciliation==='match'?title(lifecycle):`${title(lifecycle)} / ${title(reconciliation)}`;
}
function compactOne(summary:TelegramPositionSummary,index:number,nowMs:number):string{
  const active=summary.last_active_bin_id??summary.observation_active_bin_id;
  const opened=age(summary.entered_at,nowMs);
  const updated=age(summary.lp_mtm_observed_at??summary.valuation_observed_at??summary.chain_observed_at??summary.latest_observed_at??summary.observation_observed_at,nowMs);
  const lines=[
    `${index}. ${shortenTelegramPositionAddress(summary.position_address)}`,
    `Pool: ${shortenTelegramPositionAddress(summary.pool_address)}`,
    `${range(summary).replace('IN RANGE','In range').replace('OUT OF RANGE','Out of range')} · ${positionState(summary)}`,
    '',
  ];
  const lpReturn=lpValuationAvailable(summary)?signedPercent(summary.lp_net_return_fraction):undefined;
  lines.push(`Current LP return: ${lpReturn??'unavailable'}`);
  lines.push(`Fees earned: ${canonicalFee(summary)??'unavailable'}`);
  lines.push(`Range: ${text(summary.lower_bin_id)} → ${text(summary.upper_bin_id)}`);
  lines.push(`Current bin: ${active===null||active===undefined?'unavailable':String(active)}`);
  if(opened)lines.push(`Opened: ${opened}`);
  if(updated)lines.push(`Updated: ${updated}`);
  return lines.join('\n');
}
function detailOne(summary:TelegramPositionSummary,index:number|undefined,nowMs:number):string{
  const active=summary.last_active_bin_id??summary.observation_active_bin_id;
  const opened=age(summary.entered_at,nowMs);
  const updated=age(summary.lp_mtm_observed_at??summary.valuation_observed_at??summary.chain_observed_at??summary.latest_observed_at??summary.observation_observed_at,nowMs);
  const lines=[
    `${index===undefined?'Position':`${index}.`} ${shortenTelegramPositionAddress(summary.position_address)}`,
    `Pool: ${shortenTelegramPositionAddress(summary.pool_address)}`,
    `${text(summary.strategy)} · ${text(summary.orientation)}`,
    `${range(summary)} · ${text(summary.lifecycle_state)} / ${text(summary.reconciliation_status)}`,
    '',
    `Capital: ${sol(summary.initial_capital_lamports)??'unavailable'}`,
  ];
  if(lpValuationAvailable(summary)){
    const value=usd(summary.lp_current_position_value_usd),pnl=usd(summary.lp_net_pnl_usd,true),pct=signedPercent(summary.lp_net_return_fraction);
    lines.push(`LP Value: ${value??'unavailable'}`);
    lines.push(`LP MTM: ${pnl??'unavailable'}${pct?` (${pct})`:''}`);
  }else lines.push('LP MTM: unavailable · entry basis pending');
  const managedBasis=sol(summary.managed_economic_contribution_lamports);
  if(managedBasis)lines.push(`Economic basis: ${managedBasis}`);
  if(valuationAvailable(summary)){
    const value=usd(summary.current_economic_value_usd),pnl=usd(summary.net_pnl_usd,true),pct=signedPercent(summary.net_return_fraction);
    lines.push(`Economic value: ${value??'unavailable'}`);
    lines.push(`Economic MTM: ${pnl??'unavailable'}${pct?` (${pct})`:''}`);
  }else{
    const state=text(summary.valuation_state,'UNAVAILABLE');
    lines.push('Economic value: unavailable');
    lines.push(`Economic MTM: unavailable${state==='STALE'||!chainFresh(summary)?' · valuation stale':''}`);
  }
  lines.push(`Fees: ${canonicalFee(summary)??'unavailable'}`);
  lines.push('',`Range: ${text(summary.lower_bin_id)} → ${text(summary.upper_bin_id)}`);
  lines.push(`Active: ${active===null||active===undefined?'unavailable':String(active)}`);
  if(opened)lines.push(`Opened: ${opened}`);
  if(updated)lines.push(`Updated: ${updated}`);
  return lines.join('\n');
}

/** Formats the detailed accounting view for one persisted live position. */
export function formatTelegramPositionDetail(input:{position:TelegramPositionSummary;index?:number;nowMs?:number}):string{
  return detailOne(input.position,input.index,input.nowMs??Date.now());
}

/** Formats only canonical persisted facts.  `nowMs` is supplied for tests. */
export function formatTelegramPositionSummaries(input:{positions:readonly TelegramPositionSummary[];maxOpenPositions?:number;nowMs?:number;maxLength?:number}):string{
  if(!input.positions.length)return 'No live LPForge positions.';
  const maxLength=Math.max(256,Math.min(4000,Math.floor(input.maxLength??3900)));
  const header=Number.isInteger(input.maxOpenPositions)&&input.maxOpenPositions!>0
    ?`📊 LPForge Positions — ${input.positions.length} open / ${input.maxOpenPositions} max`
    :`📊 LPForge Positions — ${input.positions.length} open`;
  const sections=[header];const nowMs=input.nowMs??Date.now();
  for(let i=0;i<input.positions.length;i++){
    const next=compactOne(input.positions[i]!,i+1,nowMs),candidate=[...sections,next].join('\n\n');
    const omitted=`… ${input.positions.length-i} additional position${input.positions.length-i===1?'':'s'} omitted; use /position <number> for details.`;
    // Reserve space for an explicit, non-truncating omission marker. Telegram
    // must never receive a slice through an otherwise complete position block.
    if(candidate.length>maxLength||i<input.positions.length-1&&candidate.length+2+omitted.length>maxLength){
      const withOmission=[...sections,omitted].join('\n\n');
      if(withOmission.length<=maxLength)sections.push(omitted);
      break;
    }
    sections.push(next);
  }
  return sections.join('\n\n');
}
