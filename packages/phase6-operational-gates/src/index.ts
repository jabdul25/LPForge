// LPFORGE_PHASE6_MAINNET_MODULE
export type Phase6LivePathStage='READ_ONLY'|'BUILD'|'SIMULATE'|'PRESIGN'|'SIGN'|'SUBMIT'|'RECONCILE_OPEN'|'MONITOR'|'CLOSE'|'RECONCILE_CLOSE'|'RECOVERY';
export interface Phase6LiveAuthorizationConfig {liveSigning:boolean;liveExecution:boolean;mainnetCanary:boolean;operatorApprovalId?:string;operatorApprovedBy?:string;operatorApprovalExpiresAt?:string;signerBackendConfigured:boolean;privateWriteRpcConfigured:boolean;canaryPoolAllowlisted:boolean;canaryCapitalLamports:bigint;}
export interface Phase6LivePathStatus {wired:true;capitalDeploymentAuthorized:false|boolean;maximumReachableStage:Phase6LivePathStage;blockedAt?:Phase6LivePathStage;reasonCodes:string[];paths:{readOnly:true;build:true;simulate:true;presign:true;sign:true;submit:true;reconcileOpen:true;monitor:true;close:true;reconcileClose:true;recovery:true};}
const yes=(v:string|undefined)=>String(v??'').toLowerCase()==='true';
export function loadPhase6LiveAuthorizationConfig(env:NodeJS.ProcessEnv=process.env):Phase6LiveAuthorizationConfig{const cap=BigInt(env.LPFORGE_P6_CANARY_CAPITAL_LAMPORTS?.trim()||'0');return{liveSigning:yes(env.LIVE_SIGNING),liveExecution:yes(env.LPFORGE_LIVE_EXECUTION),mainnetCanary:yes(env.LPFORGE_MAINNET_CANARY),...(env.LPFORGE_P6_OPERATOR_APPROVAL_ID?.trim()?{operatorApprovalId:env.LPFORGE_P6_OPERATOR_APPROVAL_ID.trim()}:{}),...(env.LPFORGE_P6_OPERATOR_APPROVED_BY?.trim()?{operatorApprovedBy:env.LPFORGE_P6_OPERATOR_APPROVED_BY.trim()}:{}),...(env.LPFORGE_P6_OPERATOR_APPROVAL_EXPIRES_AT?.trim()?{operatorApprovalExpiresAt:env.LPFORGE_P6_OPERATOR_APPROVAL_EXPIRES_AT.trim()}:{}),signerBackendConfigured:Boolean(env.LPFORGE_P6_SIGNER_BACKEND_ID?.trim()),privateWriteRpcConfigured:Boolean(env.LPFORGE_P6_PRIVATE_WRITE_RPC_URL?.trim()),canaryPoolAllowlisted:Boolean(env.LPFORGE_P6_CANARY_POOL_ALLOWLIST?.trim()),canaryCapitalLamports:cap};}
export function evaluatePhase6LivePathAuthorization(c:Phase6LiveAuthorizationConfig,now=new Date().toISOString()):Phase6LivePathStatus{const r:string[]=[];let blocked:Phase6LivePathStage|undefined;const block=(stage:Phase6LivePathStage,code:string)=>{if(!blocked)blocked=stage;r.push(code)};
 if(!c.privateWriteRpcConfigured)block('PRESIGN','P6_LIVE_PRIVATE_WRITE_RPC_NOT_CONFIGURED');
 if(!c.canaryPoolAllowlisted)block('PRESIGN','P6_LIVE_CANARY_POOL_ALLOWLIST_EMPTY');
 if(c.canaryCapitalLamports<=0n)block('PRESIGN','P6_LIVE_CANARY_CAPITAL_NOT_CONFIGURED');
 if(!c.signerBackendConfigured)block('SIGN','P6_LIVE_SIGNER_BACKEND_NOT_CONFIGURED');
 if(!c.liveSigning)block('SIGN','P6_LIVE_SIGNING_DISABLED');
 if(!c.liveExecution)block('SUBMIT','P6_LIVE_EXECUTION_DISABLED');
 if(!c.mainnetCanary)block('SUBMIT','P6_MAINNET_CANARY_DISABLED');
 if(!c.operatorApprovalId||!c.operatorApprovedBy||!c.operatorApprovalExpiresAt)block('SUBMIT','P6_OPERATOR_APPROVAL_MISSING');
 else if(!Number.isFinite(Date.parse(c.operatorApprovalExpiresAt))||Date.parse(c.operatorApprovalExpiresAt)<=Date.parse(now))block('SUBMIT','P6_OPERATOR_APPROVAL_EXPIRED');
 const order:Phase6LivePathStage[]=['READ_ONLY','BUILD','SIMULATE','PRESIGN','SIGN','SUBMIT','RECONCILE_OPEN','MONITOR','CLOSE','RECONCILE_CLOSE','RECOVERY'];
 const idx=blocked?Math.max(0,order.indexOf(blocked)-1):order.length-1;const authorized=!blocked;
 return{wired:true,capitalDeploymentAuthorized:authorized,maximumReachableStage:order[idx]!,...(blocked?{blockedAt:blocked}:{}),reasonCodes:[...new Set(r)].sort(),paths:{readOnly:true,build:true,simulate:true,presign:true,sign:true,submit:true,reconcileOpen:true,monitor:true,close:true,reconcileClose:true,recovery:true}};}
export function assertCapitalDeploymentAuthorized(s:Phase6LivePathStatus):void{if(!s.capitalDeploymentAuthorized)throw new Error(`LPFORGE_P6_CAPITAL_DEPLOYMENT_NOT_AUTHORIZED:${s.reasonCodes.join(',')}`);}
