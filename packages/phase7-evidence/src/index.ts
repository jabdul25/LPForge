// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
import {createHash} from 'node:crypto';
export const requiredPhase7Runbooks=['RPC_OUTAGE','METEORA_API_OUTAGE','PROTOCOL_UPGRADE','FAILED_OPEN','FAILED_REBALANCE','STUCK_POSITION','RECONCILIATION_MISMATCH','COMPROMISED_WALLET','LIQUIDITY_RUG','DATABASE_RESTORE','POLICY_ROLLBACK'] as const;
export type Phase7RunbookId=typeof requiredPhase7Runbooks[number];
export interface Phase7EvidenceItem {kind:string;id:string;status:'PASS'|'HOLD'|'BLOCK';observedAt:string;hash:string;}
export interface Phase7EvidencePack {packId:string;createdAt:string;sourceCommit:string;policyHash:string;runbookIds:Phase7RunbookId[];items:Phase7EvidenceItem[];packHash:string;complete:boolean;operationalPass:boolean;reasonCodes:string[];productionAuthorityIssued:false;}
const requiredEvidenceKinds=['FULL_REGRESSION','PHASE_BOUNDARIES','MIGRATIONS','POSTGRES_RUNTIME','LOCAL_METEORA_LIFECYCLE','MAINNET_READ_ONLY','CANARY_PROGRAM','DISASTER_RECOVERY','PROMOTION_DECISION'];
function stable(v:unknown):string{if(Array.isArray(v))return`[${v.map(stable).join(',')}]`;if(v&&typeof v==='object')return`{${Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;return JSON.stringify(v);}
const sha=(v:unknown)=>createHash('sha256').update(stable(v)).digest('hex');
export function buildPhase7EvidencePack(input:{packId:string;createdAt:string;sourceCommit:string;policyHash:string;runbookIds:Phase7RunbookId[];items:Phase7EvidenceItem[]}):Phase7EvidencePack{
  const reasons:string[]=[];if(!input.packId.trim()||!input.sourceCommit.trim()||!input.policyHash.trim()||!Number.isFinite(Date.parse(input.createdAt)))throw new Error('LPFORGE_P7_EVIDENCE_FIELDS');
  const runbooks=[...new Set(input.runbookIds)].sort() as Phase7RunbookId[];for(const id of requiredPhase7Runbooks)if(!runbooks.includes(id))reasons.push(`P7_EVIDENCE_RUNBOOK_MISSING:${id}`);
  for(const kind of requiredEvidenceKinds)if(!input.items.some(x=>x.kind===kind))reasons.push(`P7_EVIDENCE_KIND_MISSING:${kind}`);
  if(input.items.some(x=>!x.hash.trim()||!Number.isFinite(Date.parse(x.observedAt))))reasons.push('P7_EVIDENCE_ITEM_INVALID');
  const canonical={packId:input.packId,createdAt:input.createdAt,sourceCommit:input.sourceCommit,policyHash:input.policyHash,runbooks,items:[...input.items].sort((a,b)=>`${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))};
  const complete=reasons.length===0;const operationalPass=complete&&input.items.every(x=>x.status==='PASS');
  return{...input,runbookIds:runbooks,packHash:sha(canonical),complete,operationalPass,reasonCodes:[...new Set(reasons)].sort(),productionAuthorityIssued:false};
}
