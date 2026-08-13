// LPFORGE_PHASE7_OPERATIONAL_ALERTING_MODULE
export type Phase7AlertSeverity='INFO'|'WARNING'|'CRITICAL';
export interface Phase7TelegramConfig {enabled:boolean;botToken?:string;chatId?:string;threadId?:number;minSeverity:Phase7AlertSeverity;timeoutMs:number;cooldownMs:number;notifyStartup:boolean;}
export interface Phase7Alert {severity:Phase7AlertSeverity;code:string;title:string;message:string;runtimeId?:string;instanceId?:string;cycleKey?:string;observedAt:string;reasonCodes?:string[];}
const rank:Record<Phase7AlertSeverity,number>={INFO:0,WARNING:1,CRITICAL:2};
const bool=(value:string|undefined,fallback=false)=>value==null?fallback:['1','true','yes','on'].includes(value.trim().toLowerCase());
const boundedInt=(value:string|undefined,fallback:number,min:number,max:number)=>{const n=Number(value??fallback);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback;};
export function loadPhase7TelegramConfig(env:NodeJS.ProcessEnv=process.env):Phase7TelegramConfig{
  const minRaw=(env.LPFORGE_TELEGRAM_MIN_SEVERITY??'WARNING').trim().toUpperCase();
  const minSeverity:Phase7AlertSeverity=minRaw==='INFO'||minRaw==='CRITICAL'?minRaw:'WARNING';
  const token=env.LPFORGE_TELEGRAM_BOT_TOKEN?.trim(),chatId=env.LPFORGE_TELEGRAM_CHAT_ID?.trim();
  const threadRaw=env.LPFORGE_TELEGRAM_THREAD_ID?.trim();const thread=threadRaw?Number(threadRaw):undefined;
  return{enabled:bool(env.LPFORGE_TELEGRAM_ALERTS_ENABLED,false),...(token?{botToken:token}:{}),...(chatId?{chatId}:{}),...(thread!==undefined&&Number.isInteger(thread)&&thread>0?{threadId:thread}:{}),minSeverity,timeoutMs:boundedInt(env.LPFORGE_TELEGRAM_TIMEOUT_MS,5000,1000,30000),cooldownMs:boundedInt(env.LPFORGE_TELEGRAM_COOLDOWN_MS,300000,0,86400000),notifyStartup:bool(env.LPFORGE_TELEGRAM_NOTIFY_STARTUP,true)};
}
export function validatePhase7TelegramConfig(cfg:Phase7TelegramConfig){if(!cfg.enabled)return;if(!cfg.botToken)throw new Error('LPFORGE_TELEGRAM_BOT_TOKEN_REQUIRED');if(!cfg.chatId)throw new Error('LPFORGE_TELEGRAM_CHAT_ID_REQUIRED');}
const clean=(value:string)=>value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
export function renderPhase7TelegramAlert(alert:Phase7Alert){
  const reasons=(alert.reasonCodes??[]).slice(0,12).map(clean).filter(Boolean);
  const lines=[`LPForge ${alert.severity}: ${clean(alert.title)}`,`Code: ${clean(alert.code)}`,`Time: ${clean(alert.observedAt)}`];
  if(alert.runtimeId)lines.push(`Runtime: ${clean(alert.runtimeId)}`);if(alert.instanceId)lines.push(`Instance: ${clean(alert.instanceId)}`);if(alert.cycleKey)lines.push(`Cycle: ${clean(alert.cycleKey)}`);
  lines.push(clean(alert.message));if(reasons.length)lines.push(`Reasons: ${reasons.join(', ')}`);return lines.join('\n').slice(0,3900);
}
export function phase7AlertFingerprint(alert:Phase7Alert){return [alert.severity,alert.code,...(alert.reasonCodes??[]).slice().sort()].join('|');}
export class Phase7TelegramAlerter{
  private readonly lastSent=new Map<string,number>();constructor(readonly config=loadPhase7TelegramConfig()){}
  shouldSend(alert:Phase7Alert,nowMs=Date.now()){if(!this.config.enabled||rank[alert.severity]<rank[this.config.minSeverity])return false;const key=phase7AlertFingerprint(alert),prior=this.lastSent.get(key);return prior==null||nowMs-prior>=this.config.cooldownMs;}
  async send(alert:Phase7Alert):Promise<{sent:boolean;reason?:string}>{
    if(!this.shouldSend(alert))return{sent:false,reason:'disabled_below_threshold_or_cooldown'};validatePhase7TelegramConfig(this.config);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);
    try{const body:Record<string,unknown>={chat_id:this.config.chatId,text:renderPhase7TelegramAlert(alert),disable_web_page_preview:true};if(this.config.threadId)body.message_thread_id=this.config.threadId;const response=await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});if(!response.ok)throw new Error(`LPFORGE_TELEGRAM_HTTP_${response.status}`);this.lastSent.set(phase7AlertFingerprint(alert),Date.now());return{sent:true};}finally{clearTimeout(timer);}
  }
}
export function alertsForPhase7ProductionResult(result:{runtimeId:string;instanceId:string;cycleKey:string;observedAt:string;operatorFailure?:true;health?:{status:string;reasonCodes:string[]};drift?:{status:string;reasonCodes:string[]};control?:{daemonPlan?:string;reasonCodes?:string[];safety?:{mode?:string}};runtime:{leaseAcquired?:boolean;plan?:string;reasonCodes?:string[]};evidence?:{statuses?:Record<string,string>;reasonCodes?:string[]}}):Phase7Alert[]{
  const common={runtimeId:result.runtimeId,instanceId:result.instanceId,cycleKey:result.cycleKey,observedAt:result.observedAt};const out:Phase7Alert[]=[];
  if(result.operatorFailure)out.push({...common,severity:'CRITICAL',code:'P7_OPERATOR_FAILURE',title:'Production operator cycle failed',message:'The read-only operator probe failed. LPForge remains fail-closed.',reasonCodes:result.health?.reasonCodes??[]});
  if(result.health?.status==='CRITICAL')out.push({...common,severity:'CRITICAL',code:'P7_HEALTH_CRITICAL',title:'Phase 7 health is CRITICAL',message:'New economic actions are blocked until health recovers.',reasonCodes:result.health.reasonCodes});
  else if(result.health?.status==='DEGRADED')out.push({...common,severity:'WARNING',code:'P7_HEALTH_DEGRADED',title:'Phase 7 health is DEGRADED',message:'Operational health has degraded; frozen safety gates remain active.',reasonCodes:result.health.reasonCodes});
  if(result.drift?.status==='BLOCK')out.push({...common,severity:'CRITICAL',code:'P7_DRIFT_BLOCK',title:'Phase 7 drift gate BLOCK',message:'Drift evidence blocks new entries. No automatic policy retuning is permitted.',reasonCodes:result.drift.reasonCodes});
  else if(result.drift?.status==='WARN')out.push({...common,severity:'WARNING',code:'P7_DRIFT_WARN',title:'Phase 7 drift warning',message:'Observed drift requires operator attention.',reasonCodes:result.drift.reasonCodes});
  if(result.runtime.leaseAcquired===false)out.push({...common,severity:'WARNING',code:'P7_RUNTIME_LEASE_HELD',title:'Runtime lease not acquired',message:'Another LPForge production holder owns the runtime lease. This instance performed no economic action.',reasonCodes:result.runtime.reasonCodes??[]});
  if(result.control?.safety?.mode==='EMERGENCY_ONLY')out.push({...common,severity:'CRITICAL',code:'P7_EMERGENCY_CLOSE_PLAN',title:'Emergency-close plan active',message:'The control plane has requested the existing emergency-close workflow.',reasonCodes:[...(result.runtime.reasonCodes??[]),...(result.control?.reasonCodes??[])]});
  const productionStatus=result.evidence?.statuses?.PRODUCTION;if(productionStatus==='BLOCK')out.push({...common,severity:'CRITICAL',code:'P7_PRODUCTION_EVIDENCE_BLOCK',title:'Production evidence gate BLOCK',message:'The Phase 7 production evidence evaluator reports BLOCK.',reasonCodes:result.evidence?.reasonCodes??[]});
  return out;
}
/** Execution alerts are event-driven; the normal empty queue must never page Telegram. */
export function alertsForExecutionResult(result:{status:string;observedAt:string;planId?:string|undefined;reasonCodes?:string[]|undefined;transactionSubmitted?:boolean|undefined;runtimeId?:string|undefined}):Phase7Alert[]{
  const common={runtimeId:result.runtimeId??'lpforge-execution',observedAt:result.observedAt,reasonCodes:result.reasonCodes??[]};const plan=result.planId?` Plan: ${result.planId}.`:'';
  if(result.status==='BLOCKED')return[{...common,severity:'CRITICAL',code:'P6_EXECUTION_PLAN_BLOCKED',title:'Execution plan blocked',message:`The execution claim guard or worker blocked a plan.${plan} No transaction was sent.`}];
  if(result.status==='UNKNOWN')return[{...common,severity:'CRITICAL',code:'P6_EXECUTION_SUBMISSION_UNKNOWN',title:'Execution submission requires reconciliation',message:`A submitted execution has unknown chain outcome.${plan} LPForge will not resend blindly.`}];
  if(result.status==='SUBMITTED')return[{...common,severity:'INFO',code:'P6_EXECUTION_SUBMITTED',title:'Execution transaction submitted',message:`LPForge submitted an execution transaction for chain confirmation.${plan}`}];
  if(result.status==='RECONCILED')return[{...common,severity:'INFO',code:'P6_EXECUTION_RECONCILED',title:'Execution lifecycle reconciled',message:`LPForge reconciled the execution lifecycle against chain truth.${plan}`}];
  return[];
}
