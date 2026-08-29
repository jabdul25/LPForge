// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
import {createHash} from 'node:crypto';
export type Phase7PolicyStatus='CANDIDATE'|'FROZEN_LIMITED_LIVE'|'PRODUCTION'|'RETIRED';
export type Phase7PromotionTarget='LIMITED_LIVE'|'PRODUCTION';
export interface Phase7PolicySpec {policyId:string;version:string;parentPolicyHash?:string;codeCommit:string;featureSchemaHash:string;config:Record<string,unknown>;createdAt:string;status:Phase7PolicyStatus;}
export interface Phase7RegisteredPolicy extends Phase7PolicySpec {configHash:string;policyHash:string;}
export interface Phase7PromotionEvidence {policyHash:string;codeCommit:string;featureSchemaHash:string;datasetHashes:string[];experimentReportHash:string;walkForwardHash:string;stressHash:string;shadowHash:string;paperHash:string;canaryHash:string;limitedLiveHash?:string;knownLimitations:string[];rollbackPolicyHash:string;}
export interface Phase7PromotionBundle {target:Phase7PromotionTarget;policyHash:string;bundleHash:string;complete:boolean;reasonCodes:string[];evidence:Phase7PromotionEvidence;automaticPromotion:false;}
function stable(v:unknown):string{if(Array.isArray(v))return`[${v.map(stable).join(',')}]`;if(v&&typeof v==='object')return`{${Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;return JSON.stringify(v);}
function sha(v:unknown):string{return createHash('sha256').update(typeof v==='string'?v:stable(v)).digest('hex');}
function requiredText(v:string|undefined,code:string,reasons:string[]){if(!v?.trim())reasons.push(code);}
export function registerPhase7Policy(spec:Phase7PolicySpec):Phase7RegisteredPolicy{
  if(!spec.policyId.trim()||!spec.version.trim()||!spec.codeCommit.trim()||!spec.featureSchemaHash.trim()||!Number.isFinite(Date.parse(spec.createdAt)))throw new Error('LPFORGE_P7_POLICY_FIELDS');
  const configHash=sha(spec.config);const canonical={policyId:spec.policyId,version:spec.version,parentPolicyHash:spec.parentPolicyHash??null,codeCommit:spec.codeCommit,featureSchemaHash:spec.featureSchemaHash,configHash,createdAt:spec.createdAt,status:spec.status};
  return{...spec,configHash,policyHash:sha(canonical)};
}
export function buildPhase7PromotionBundle(policy:Phase7RegisteredPolicy,target:Phase7PromotionTarget,evidence:Phase7PromotionEvidence):Phase7PromotionBundle{
  const reasons:string[]=[];
  if(evidence.policyHash!==policy.policyHash)reasons.push('P7_PROMOTION_POLICY_HASH_MISMATCH');
  if(evidence.codeCommit!==policy.codeCommit)reasons.push('P7_PROMOTION_CODE_COMMIT_MISMATCH');
  if(evidence.featureSchemaHash!==policy.featureSchemaHash)reasons.push('P7_PROMOTION_FEATURE_SCHEMA_MISMATCH');
  if(!evidence.datasetHashes.length||evidence.datasetHashes.some(x=>!x.trim()))reasons.push('P7_PROMOTION_DATASET_HASHES_REQUIRED');
  requiredText(evidence.experimentReportHash,'P7_PROMOTION_EXPERIMENT_REQUIRED',reasons);requiredText(evidence.walkForwardHash,'P7_PROMOTION_WALK_FORWARD_REQUIRED',reasons);requiredText(evidence.stressHash,'P7_PROMOTION_STRESS_REQUIRED',reasons);requiredText(evidence.shadowHash,'P7_PROMOTION_SHADOW_REQUIRED',reasons);requiredText(evidence.paperHash,'P7_PROMOTION_PAPER_REQUIRED',reasons);requiredText(evidence.canaryHash,'P7_PROMOTION_CANARY_REQUIRED',reasons);requiredText(evidence.rollbackPolicyHash,'P7_PROMOTION_ROLLBACK_REQUIRED',reasons);
  if(target==='PRODUCTION')requiredText(evidence.limitedLiveHash,'P7_PROMOTION_LIMITED_LIVE_REQUIRED',reasons);
  if(evidence.rollbackPolicyHash===policy.policyHash)reasons.push('P7_PROMOTION_ROLLBACK_MUST_DIFFER');
  if(!evidence.knownLimitations.length)reasons.push('P7_PROMOTION_KNOWN_LIMITATIONS_REQUIRED');
  const canonical={target,policyHash:policy.policyHash,evidence:{...evidence,datasetHashes:[...evidence.datasetHashes].sort(),knownLimitations:[...evidence.knownLimitations].sort()}};
  return{target,policyHash:policy.policyHash,bundleHash:sha(canonical),complete:reasons.length===0,reasonCodes:[...new Set(reasons)].sort(),evidence,automaticPromotion:false};
}
