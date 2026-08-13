// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
import {assertManualApproval,assertPhase7Authority,type Phase7Authority,type Phase7ManualApproval,type Phase7OperationalMode,type Phase7ScalingMode} from '../../phase7-contracts/src/index.js';

export interface Phase7ControlConfig {
  mode:Phase7OperationalMode;
  productionAuthorityRequested:boolean;
  scalingMode:Phase7ScalingMode;
  automaticPolicyPromotion:false;
  authorityTtlMs:number;
}

function bool(env:NodeJS.ProcessEnv,name:string,fallback=false):boolean{
  const raw=(env[name]??String(fallback)).trim().toLowerCase();
  if(raw==='true')return true;if(raw==='false')return false;throw new Error(`LPFORGE_P7_CONFIG_BOOLEAN:${name}`);
}
function int(env:NodeJS.ProcessEnv,name:string,fallback:number,min:number,max:number):number{
  const raw=env[name];const value=raw==null||raw===''?fallback:Number(raw);
  if(!Number.isInteger(value)||value<min||value>max)throw new Error(`LPFORGE_P7_CONFIG_INTEGER:${name}`);
  return value;
}

export function loadPhase7ControlConfig(env:NodeJS.ProcessEnv=process.env):Phase7ControlConfig{
  const mode=(env.LPFORGE_P7_MODE??'OBSERVE_ONLY').trim() as Phase7OperationalMode;
  if(!['OBSERVE_ONLY','LIMITED_LIVE','PRODUCTION'].includes(mode))throw new Error('LPFORGE_P7_CONFIG_MODE');
  const scalingMode=(env.LPFORGE_P7_SCALING_MODE??'DISABLED').trim() as Phase7ScalingMode;
  if(!['DISABLED','OPERATOR_STEP','POLICY_BOUNDED'].includes(scalingMode))throw new Error('LPFORGE_P7_CONFIG_SCALING_MODE');
  const automaticPolicyPromotion=bool(env,'LPFORGE_P7_AUTOMATIC_POLICY_PROMOTION',false);
  if(automaticPolicyPromotion)throw new Error('LPFORGE_P7_AUTOMATIC_POLICY_PROMOTION_FORBIDDEN');
  const productionAuthorityRequested=bool(env,'LPFORGE_P7_PRODUCTION_AUTHORITY',false);
  const authorityTtlMs=int(env,'LPFORGE_P7_AUTHORITY_TTL_MS',60_000,1_000,300_000);
  if(mode==='OBSERVE_ONLY'&&(productionAuthorityRequested||scalingMode!=='DISABLED'))throw new Error('LPFORGE_P7_OBSERVE_ONLY_DEFAULT_DENY');
  if(mode==='LIMITED_LIVE'&&productionAuthorityRequested)throw new Error('LPFORGE_P7_LIMITED_LIVE_PRODUCTION_AUTHORITY_FORBIDDEN');
  if(mode==='LIMITED_LIVE'&&scalingMode==='POLICY_BOUNDED')throw new Error('LPFORGE_P7_LIMITED_LIVE_POLICY_SCALING_FORBIDDEN');
  if(mode==='PRODUCTION'&&!productionAuthorityRequested)throw new Error('LPFORGE_P7_PRODUCTION_AUTHORITY_FLAG_REQUIRED');
  return{mode,productionAuthorityRequested,scalingMode,automaticPolicyPromotion:false,authorityTtlMs};
}

export function resolvePhase7Authority(input:{config:Phase7ControlConfig;now:string;approval?:Phase7ManualApproval;reasonCodes?:string[]}):Phase7Authority{
  const {config,now}=input;
  if(config.mode!=='OBSERVE_ONLY'){
    if(!input.approval)throw new Error('LPFORGE_P7_EXPLICIT_APPROVAL_REQUIRED');
    assertManualApproval(input.approval,now);
    const expected=config.mode==='LIMITED_LIVE'?'PROMOTE_LIMITED_LIVE':'PROMOTE_PRODUCTION';
    if(input.approval.action!==expected)throw new Error(`LPFORGE_P7_APPROVAL_ACTION_MISMATCH:${input.approval.action}`);
  }
  const expiresAt=new Date(Date.parse(now)+config.authorityTtlMs).toISOString();
  const approvalExpiry=input.approval?.expiresAt;
  const boundedExpiry=approvalExpiry&&Date.parse(approvalExpiry)<Date.parse(expiresAt)?approvalExpiry:expiresAt;
  const authority:Phase7Authority={
    phase:'P7',cluster:'mainnet-beta',mode:config.mode,issuedAt:now,expiresAt:boundedExpiry,
    approvalId:input.approval?.approvalId??null,
    productionAuthorityIssued:config.mode==='PRODUCTION'&&config.productionAuthorityRequested,
    scalingMode:config.scalingMode,
    automaticPolicyPromotion:false,
    reasonCodes:input.reasonCodes??[`P7_${config.mode}`]
  };
  assertPhase7Authority(authority,now);
  return authority;
}

export function phase7CapabilityModel(authority:Phase7Authority){
  return{
    phase:'P7' as const,
    mode:authority.mode,
    directSigner:false as const,
    directTransactionSend:false as const,
    automaticPolicyPromotion:false as const,
    scalingMode:authority.scalingMode,
    productionAuthorityIssued:authority.productionAuthorityIssued,
    allowed:authority.mode==='OBSERVE_ONLY'
      ?['health_read','evidence_read','policy_read','portfolio_read','drift_read']
      :['health_read','evidence_read','policy_read','portfolio_read','drift_read','audited_operator_control','existing_execution_workflow_request'],
    prohibited:['direct_signer','direct_transaction_send','secret_material','automatic_policy_promotion','unbounded_scaling','reconciliation_bypass']
  };
}
