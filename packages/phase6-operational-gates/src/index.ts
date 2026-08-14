// LPFORGE_PHASE6_MAINNET_MODULE
import {loadDeploymentPolicyFile} from '../../deployment-policy/src/index.js';
export type Phase6LivePathStage='READ_ONLY'|'BUILD'|'SIMULATE'|'PRESIGN'|'SIGN'|'SUBMIT'|'RECONCILE_OPEN'|'MONITOR'|'CLOSE'|'RECONCILE_CLOSE'|'RECOVERY';
/**
 * Persistent authorization for the autonomous Phase 6 service.
 *
 * The enabled live-execution policy and the three explicit live switches are
 * the durable operator intent.  A per-run approval is deliberately not part
 * of this contract: it would turn a continuously managed strategy into a
 * one-shot canary workflow.
 */
export interface Phase6LiveAuthorizationConfig {liveSigning:boolean;liveExecution:boolean;mainnetCanary:boolean;signerBackendConfigured:boolean;signerModeConfigured:boolean;privateWriteRpcConfigured:boolean;executionPolicyLoaded:boolean;executionPolicyEnabled:boolean;}
export interface Phase6LivePathStatus {wired:true;capitalDeploymentAuthorized:false|boolean;maximumReachableStage:Phase6LivePathStage;blockedAt?:Phase6LivePathStage;reasonCodes:string[];paths:{readOnly:true;build:true;simulate:true;presign:true;sign:true;submit:true;reconcileOpen:true;monitor:true;close:true;reconcileClose:true;recovery:true};}
const yes=(v:string|undefined)=>String(v??'').toLowerCase()==='true';
export function loadPhase6LiveAuthorizationConfig(env:NodeJS.ProcessEnv=process.env):Phase6LiveAuthorizationConfig{let executionPolicyLoaded=false,executionPolicyEnabled=false;try{const policy=loadDeploymentPolicyFile(env.LPFORGE_EXECUTION_POLICY_PATH?.trim()||'policies/live-execution-policy.json');executionPolicyLoaded=true;executionPolicyEnabled=policy.status==='ENABLED';}catch{}const signerBackendConfigured=Boolean(env.LPFORGE_P6_SIGNER_BACKEND_ID?.trim()),mode=(env.LPFORGE_P6_SIGNER_MODE??'').trim(),publicKey=Boolean(env.LPFORGE_P6_SIGNER_PUBLIC_KEY?.trim());const signerModeConfigured=mode==='REMOTE_KMS'?publicKey&&Boolean(env.LPFORGE_P6_REMOTE_SIGNER_URL?.trim())&&Boolean(env.LPFORGE_P6_REMOTE_SIGNER_AUTH_TOKEN?.trim()):mode==='LOCAL_KEYPAIR_FILE'?publicKey&&Boolean(env.LPFORGE_P6_KEYPAIR_PATH?.trim()):mode==='LOCAL_PRIVATE_KEY'?publicKey&&Boolean(env.LPFORGE_P6_PRIVATE_KEY?.trim()):false;return{liveSigning:yes(env.LIVE_SIGNING),liveExecution:yes(env.LPFORGE_LIVE_EXECUTION),mainnetCanary:yes(env.LPFORGE_MAINNET_CANARY),signerBackendConfigured,signerModeConfigured,privateWriteRpcConfigured:Boolean(env.LPFORGE_P6_PRIVATE_WRITE_RPC_URL?.trim()),executionPolicyLoaded,executionPolicyEnabled};}
export function evaluatePhase6LivePathAuthorization(c:Phase6LiveAuthorizationConfig):Phase6LivePathStatus{const r:string[]=[];let blocked:Phase6LivePathStage|undefined;const block=(stage:Phase6LivePathStage,code:string)=>{if(!blocked)blocked=stage;r.push(code)};
 if(!c.privateWriteRpcConfigured)block('PRESIGN','P6_LIVE_PRIVATE_WRITE_RPC_NOT_CONFIGURED');
 if(!c.executionPolicyLoaded)block('PRESIGN','P6_LIVE_EXECUTION_POLICY_NOT_LOADED');
 if(!c.executionPolicyEnabled)block('PRESIGN','P6_LIVE_EXECUTION_POLICY_DISABLED');
 if(!c.signerBackendConfigured)block('SIGN','P6_LIVE_SIGNER_BACKEND_NOT_CONFIGURED');
 if(!c.signerModeConfigured)block('SIGN','P6_LIVE_SIGNER_MODE_NOT_CONFIGURED');
 if(!c.liveSigning)block('SIGN','P6_LIVE_SIGNING_DISABLED');
 if(!c.liveExecution)block('SUBMIT','P6_LIVE_EXECUTION_DISABLED');
 if(!c.mainnetCanary)block('SUBMIT','P6_MAINNET_CANARY_DISABLED');
 const order:Phase6LivePathStage[]=['READ_ONLY','BUILD','SIMULATE','PRESIGN','SIGN','SUBMIT','RECONCILE_OPEN','MONITOR','CLOSE','RECONCILE_CLOSE','RECOVERY'];
 const idx=blocked?Math.max(0,order.indexOf(blocked)-1):order.length-1;const authorized=!blocked;
 return{wired:true,capitalDeploymentAuthorized:authorized,maximumReachableStage:order[idx]!,...(blocked?{blockedAt:blocked}:{}),reasonCodes:[...new Set(r)].sort(),paths:{readOnly:true,build:true,simulate:true,presign:true,sign:true,submit:true,reconcileOpen:true,monitor:true,close:true,reconcileClose:true,recovery:true}};}
export function assertCapitalDeploymentAuthorized(s:Phase6LivePathStatus):void{if(!s.capitalDeploymentAuthorized)throw new Error(`LPFORGE_P6_CAPITAL_DEPLOYMENT_NOT_AUTHORIZED:${s.reasonCodes.join(',')}`);}
