// LPFORGE_PHASE6_MAINNET_MODULE
import {readFileSync} from 'node:fs';

export interface Phase6ManualPlanSource {kind:'MANUAL_FILE';path:string;status:'READY'|'WAITING';planId?:string;reasonCodes:string[];}

function text(value:unknown,code:string){if(typeof value!=='string'||!value.trim())throw new Error(code);return value.trim();}
function record(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('LPFORGE_P6_PLAN_FORMAT');return value as Record<string,unknown>;}
/** Reads an operator-created inbox record only. It does not construct, sign, or submit a transaction. */
export function loadPhase6ManualPlanSource(path:string):Phase6ManualPlanSource{
  const source=path.trim();if(!source)throw new Error('LPFORGE_P6_PLAN_SOURCE_PATH_REQUIRED');
  try{const plan=record(JSON.parse(readFileSync(source,'utf8')));if(plan.schemaVersion!==1)throw new Error('LPFORGE_P6_PLAN_SCHEMA');const planId=text(plan.planId,'LPFORGE_P6_PLAN_ID');text(plan.action,'LPFORGE_P6_PLAN_ACTION');text(plan.poolAddress,'LPFORGE_P6_PLAN_POOL');text(plan.requestedAt,'LPFORGE_P6_PLAN_REQUESTED_AT');text(plan.expiresAt,'LPFORGE_P6_PLAN_EXPIRES_AT');return{kind:'MANUAL_FILE',path:source,status:'READY',planId,reasonCodes:['P6_MANUAL_PLAN_REQUIRES_BUILD_SIMULATION_AND_FRESH_APPROVAL']};}
  catch(error){if(typeof error==='object'&&error!==null&&'code' in error&&(error as {code?:unknown}).code==='ENOENT')return{kind:'MANUAL_FILE',path:source,status:'WAITING',reasonCodes:['P6_MANUAL_PLAN_INBOX_EMPTY']};throw error;}
}
