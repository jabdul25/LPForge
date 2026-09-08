// LPFORGE_TELEGRAM_OPERATOR_CONSOLE
// Inbound Telegram is deliberately a durable operator-intent surface.  It
// cannot open trades, access signer material, or send chain transactions.
import {createHash} from 'node:crypto';
import {loadPhase1Config,resolveLiveExecutionPolicyPath} from '../../../packages/config/src/index.js';
import {createPostgresStore} from '../../../packages/db/src/index.js';
import {loadDeploymentPolicyFile} from '../../../packages/deployment-policy/src/index.js';
import {loadPhase7TelegramConfig} from '../../../packages/phase7-alerting/src/index.js';
import {formatTelegramPositionSummaries,resolveTelegramPositionAddress} from '../../../packages/telegram-operator-format/src/index.js';

const enabled=(v:string|undefined)=>['1','true','yes','on'].includes(String(v??'').toLowerCase());
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const now=()=>new Date().toISOString();
const id=(prefix:string,input:string)=>`${prefix}:${createHash('sha256').update(input).digest('hex').slice(0,32)}`;
const pool=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type TelegramMessage={message_id?:number;chat?:{id?:number|string};from?:{id?:number|string};text?:string};
type TelegramUpdate={update_id?:number;message?:TelegramMessage};
type CommandConfig={enabled:boolean;chatId?:string;token?:string;operators:Set<string>;pollMs:number};
function config(env:NodeJS.ProcessEnv=process.env):CommandConfig{
  const telegram=loadPhase7TelegramConfig(env),operators=new Set((env.LPFORGE_TELEGRAM_OPERATOR_USER_IDS??'').split(',').map(x=>x.trim()).filter(x=>/^\d+$/.test(x)));
  return{enabled:enabled(env.LPFORGE_TELEGRAM_COMMANDS_ENABLED),...(telegram.chatId?{chatId:telegram.chatId}:{}),...(telegram.botToken?{token:telegram.botToken}:{}),operators,pollMs:Math.max(1000,Math.min(15000,Number(env.LPFORGE_TELEGRAM_COMMAND_POLL_MS??2000)||2000))};
}
function assertConfig(c:CommandConfig){if(!c.enabled)return;if(!c.token)throw new Error('LPFORGE_TELEGRAM_COMMAND_BOT_TOKEN_REQUIRED');if(!c.chatId)throw new Error('LPFORGE_TELEGRAM_COMMAND_CHAT_ID_REQUIRED');if(!c.operators.size)throw new Error('LPFORGE_TELEGRAM_OPERATOR_USER_IDS_REQUIRED');}
async function telegram(c:CommandConfig,method:string,body:Record<string,unknown>){
  const r=await fetch(`https://api.telegram.org/bot${c.token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw new Error(`LPFORGE_TELEGRAM_COMMAND_HTTP_${r.status}`);
  return await r.json() as {ok?:boolean;result?:unknown};
}
async function reply(c:CommandConfig,text:string){try{await telegram(c,'sendMessage',{chat_id:c.chatId,text:text.slice(0,4000),disable_web_page_preview:true});}catch(error){console.error(JSON.stringify({event:'telegram_operator_reply_failed',error:error instanceof Error?error.message:String(error)}));}}
function command(text:string|undefined){const [raw='',...rest]=(text??'').trim().split(/\s+/);return{name:raw.replace(/@[^ ]+$/,'').toLowerCase(),args:rest};}
function reason(args:string[]){return args.join(' ').trim().slice(0,280)||'Telegram operator request';}
function maxOpenPositions():number|undefined{try{return loadDeploymentPolicyFile(resolveLiveExecutionPolicyPath()).maxOpenPositions;}catch{return undefined;}}

async function processUpdate(c:CommandConfig,u:TelegramUpdate){
  const updateId=Number(u.update_id),message=u.message,chat=String(message?.chat?.id??''),operator=String(message?.from?.id??''),parsed=command(message?.text),receivedAt=now();
  if(!Number.isSafeInteger(updateId)||!message?.text)return;
  const cfg=loadPhase1Config(),store=await createPostgresStore(cfg.databaseUrl);
  const accepted=chat===c.chatId&&c.operators.has(operator);
  const persist=async(status:'ACCEPTED'|'REJECTED'|'COMPLETED'|'FAILED',response:string,payload:Record<string,unknown>={})=>store.recordTelegramOperatorCommand({telegramUpdateId:BigInt(updateId),chatId:chat,...(operator?{operatorId:operator}:{}),command:parsed.name||'UNKNOWN',arguments:{args:parsed.args},receivedAt,status,response,payload});
  try{
    if(!accepted){await persist('REJECTED','Unauthorized Telegram operator command.',{authorization:'REJECTED'});return;}
    const actionId=`telegram:${updateId}`;
    const audit=async(action:string,why:string,targetType?:string,targetId?:string)=>store.insertPhase7OperatorAction({actionId,operatorId:operator,action,requestedAt:receivedAt,approvalId:'telegram-allowlist-v1',reason:why,...(targetType?{targetType}:{}),...(targetId?{targetId}:{}),beforeHash:'telegram-command',afterHash:'telegram-command',result:'APPLIED',payload:{telegramOperator:true,telegramUpdateId:updateId,chatId:chat}});
    let response='';
    if(['/help','/start'].includes(parsed.name))response='LPForge commands:\n/status — P7 and portfolio summary\n/positions — live positions\n/pause [reason] — stop new entries only\n/resume — restore normal entry eligibility subject to P7/P6\n/stop [reason] — freeze entries and discretionary writes; protective close/recovery/settlement continue\n/blacklist <pool> [reason]\n/unblacklist <pool>\n/close <position number|all> [reason]\nTelegram cannot open positions.';
    else if(parsed.name==='/status'){
      const [control,positions,blocks]=await Promise.all([store.loadLatestPhase7ControlDecision((process.env.LPFORGE_P7_RUNTIME_ID??'lpforge-production').trim()),store.loadTelegramOperatorOpenPositions(),store.loadActiveTelegramOperatorPoolBlocks()]);
      response=`LPForge status\nP7: ${control?`${String(control.authority_mode)} / ${String(control.health_status)} / ${String(control.drift_status)} / ${String(control.safety_mode)}`:'unavailable'}\nNew economic action: ${control?.new_economic_action_allowed===true?'YES':'NO'}\nOpen positions: ${positions.length}\nPool blacklist: ${blocks.length?blocks.join(', '):'none'}`;
    } else if(parsed.name==='/positions'){const max=maxOpenPositions();response=formatTelegramPositionSummaries({positions:await store.loadTelegramOperatorPositionSummaries(),...(max===undefined?{}:{maxOpenPositions:max})});}
    else if(parsed.name==='/pause'||parsed.name==='/stop'){
      const stop=parsed.name==='/stop',incidentId=stop?'telegram:stop':'telegram:pause',why=reason(parsed.args);
      await store.upsertPhase7IncidentState({incidentId,incidentType:'MANUAL_EMERGENCY',severity:stop?'CRITICAL':'WARNING',status:'OPEN',openedAt:receivedAt,observedAt:receivedAt,reasonCodes:[stop?'P7_TELEGRAM_OPERATOR_STOP':'P7_TELEGRAM_OPERATOR_PAUSE'],payload:{telegramOperator:true,operatorId:operator,reason:why,semantics:stop?'ENTRIES_AND_DISCRETIONARY_WRITES_PAUSED_PROTECTIVE_CLOSE_RECOVERY_SETTLEMENT_ALLOWED':'NEW_ENTRIES_PAUSED_PROTECTIVE_MANAGEMENT_RECOVERY_SETTLEMENT_ALLOWED'}});
      await audit(stop?'PAUSE_ALL_WRITES':'PAUSE_ENTRIES',why);response=stop?'Emergency execution freeze requested. New entries and discretionary writes will stop; protective close, recovery, and settlement continue.':'New entries paused. Existing monitoring, protective closes, recovery, and settlement continue.';
    } else if(parsed.name==='/resume'){
      const resolved=await store.resolveTelegramOperatorControlIncidents({operatorId:operator,at:receivedAt});await audit('RESUME_ENTRIES','Telegram resume');response=`Telegram pause/stop controls resolved: ${resolved}. Normal entry eligibility remains subject to P7, P6, capacity, and all safety gates.`;
    } else if(parsed.name==='/blacklist'||parsed.name==='/unblacklist'){
      const target=parsed.args[0]??'';if(!pool.test(target))throw new Error('LPFORGE_TELEGRAM_POOL_ADDRESS_REQUIRED');const remove=parsed.name==='/unblacklist';await store.upsertTelegramOperatorPoolBlock({poolAddress:target,status:remove?'REMOVED':'ACTIVE',operatorId:operator,at:receivedAt,reason:reason(parsed.args.slice(1)),sourceUpdateId:BigInt(updateId),payload:{telegramOperator:true}});await audit('BLOCK_POOL',reason(parsed.args.slice(1)),'POOL',target);response=remove?`Pool blacklist removed: ${target}`:`Pool blacklisted for new risk-increasing entries: ${target}. Protective close/recovery remain allowed.`;
    } else if(parsed.name==='/close'){
      const target=parsed.args[0]??'';const positions=await store.loadTelegramOperatorOpenPositions();const targets=target==='all'?positions.map(p=>String(p.position_address)):[resolveTelegramPositionAddress({target,positions})];let queued=0;for(const positionAddress of targets){if(await store.createTelegramOperatorCloseRequest({requestId:id('telegram-close',`${updateId}:${positionAddress}`),positionAddress,operatorId:operator,requestedAt:receivedAt,reason:reason(parsed.args.slice(1)),sourceUpdateId:BigInt(updateId),payload:{telegramOperator:true,requestType:'CLOSE'}}))queued++;}await audit('REQUEST_CLOSE',reason(parsed.args.slice(1)),'POSITION',target);response=`Canonical close request${targets.length===1?'':'s'} accepted: ${queued}/${targets.length}. The position manager will revalidate ownership, live truth, protective authority, and idempotency before it creates a close plan. No direct Telegram transaction was sent.`;
    } else {response='Unsupported command. Send /help.';}
    await persist('COMPLETED',response,{authorization:'ALLOWLISTED'});await reply(c,response);
  }catch(error){const response=parsed.name==='/positions'?'Unable to load position snapshot right now.':`Command not applied: ${error instanceof Error?error.message:'LPFORGE_TELEGRAM_COMMAND_FAILED'}`;try{await persist('FAILED',response);}catch{}await reply(c,response);
  }finally{await store.close();}
}
async function cycle(c:CommandConfig){const cfg=loadPhase1Config(),store=await createPostgresStore(cfg.databaseUrl);let offset:bigint|undefined;try{const latest=await store.loadLatestTelegramOperatorUpdateId();offset=latest===undefined?undefined:latest+1n;}finally{await store.close();}const body:Record<string,unknown>={timeout:25,allowed_updates:['message']};if(offset!==undefined)body.offset=offset.toString();const result=await telegram(c,'getUpdates',body),updates=Array.isArray(result.result)?result.result as TelegramUpdate[]:[];for(const update of updates)await processUpdate(c,update);}
async function start(){const c=config();assertConfig(c);if(!c.enabled){console.log(JSON.stringify({service:'lpforge-telegram-operator',status:'DISABLED'}));for(;;)await sleep(60000);}console.log(JSON.stringify({service:'lpforge-telegram-operator',status:'READY',operators:c.operators.size}));for(;;){try{await cycle(c);}catch(error){console.error(JSON.stringify({service:'lpforge-telegram-operator',status:'POLL_ERROR',error:error instanceof Error?error.message:String(error)}));await sleep(c.pollMs);}}}
if(process.argv[2]==='once')await start(); else await start();
