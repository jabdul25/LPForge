// LPFORGE_PHASE7_RUNTIME_INTEGRATION_MODULE
import {createHash} from 'node:crypto';
import type {Phase1Store} from '../../db/src/index.js';

export const PHASE7_RUNTIME_RELEASE_EVIDENCE_SCHEMA='lpforge-phase7-runtime-release-evidence-v1' as const;
export interface Phase7RuntimeReleaseEvidenceBody {
  schemaVersion:typeof PHASE7_RUNTIME_RELEASE_EVIDENCE_SCHEMA;
  sourceCommit:string;
  generatedAt:string;
  fullRegression:{passed:boolean;testCount:number};
  phaseBoundaries:{P1:boolean;P2:boolean;P3:boolean;P4:boolean;P5:boolean;P6:boolean;P7:boolean};
  migrations:{passed:boolean;count:number;latest:string;freshPostgres:boolean;upgradePostgres:boolean};
  localMeteoraLifecycle:{passed:boolean;open:boolean;positionV2:boolean;swap:boolean;close:boolean;mainnetTransactionSent:false};
  runtimeIntegration:{R01:boolean;R02:boolean;R03:boolean;R04:boolean;R05:boolean;R06:boolean;R07:boolean;R08:boolean;R09:boolean;soakCycles:number;uniqueForwardCycles:boolean;uniqueRuntimeCycles:boolean;futureTimestampCount:number;transactionPlanCount:number;submissionAttemptCount:number;confirmationCount:number;canarySessionCount:number;restartRecoveryPass:boolean;leaseExclusivityPass:boolean};
  secretScanPass:boolean;
}
export interface Phase7RuntimeReleaseEvidence extends Phase7RuntimeReleaseEvidenceBody {evidenceHash:string;}
export interface Phase7ReleaseMigrationIdentity {count:number;latest:string;}
export function migrationIdentityFromNames(names:readonly string[]):Phase7ReleaseMigrationIdentity{const sorted=[...names].filter(name=>/^M\d{4}_.+\.sql$/.test(name)).sort();if(sorted.length!==names.length||!sorted.length)throw new Error('LPFORGE_P7_RELEASE_MIGRATION_SET_INVALID');return{count:sorted.length,latest:sorted.at(-1)!};}
function stable(v:unknown):string{if(Array.isArray(v))return`[${v.map(stable).join(',')}]`;if(v&&typeof v==='object')return`{${Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;return JSON.stringify(v);}
export function hashPhase7RuntimeReleaseEvidence(body:Phase7RuntimeReleaseEvidenceBody):string{return createHash('sha256').update(stable(body)).digest('hex');}
export function verifyPhase7RuntimeReleaseEvidence(value:Phase7RuntimeReleaseEvidence,expectedSourceCommit?:string,expectedMigrations?:Phase7ReleaseMigrationIdentity):{valid:true;reasonCodes:string[]} {
  const reasons:string[]=[];
  if(value.schemaVersion!==PHASE7_RUNTIME_RELEASE_EVIDENCE_SCHEMA)reasons.push('P7_RELEASE_EVIDENCE_SCHEMA');
  if(!/^[0-9a-f]{40}$/.test(value.sourceCommit))reasons.push('P7_RELEASE_EVIDENCE_SOURCE_COMMIT');
  if(expectedSourceCommit&&value.sourceCommit!==expectedSourceCommit)reasons.push('P7_RELEASE_EVIDENCE_SOURCE_MISMATCH');
  if(!Number.isFinite(Date.parse(value.generatedAt)))reasons.push('P7_RELEASE_EVIDENCE_TIMESTAMP');
  if(!value.fullRegression?.passed||!Number.isInteger(value.fullRegression.testCount)||value.fullRegression.testCount<=0)reasons.push('P7_RELEASE_EVIDENCE_REGRESSION');
  if(!value.phaseBoundaries||Object.values(value.phaseBoundaries).some(x=>x!==true))reasons.push('P7_RELEASE_EVIDENCE_BOUNDARIES');
  if(!value.migrations?.passed||!Number.isInteger(value.migrations.count)||value.migrations.count<1||!/^M\d{4}_.+\.sql$/.test(String(value.migrations.latest))||!value.migrations.freshPostgres||!value.migrations.upgradePostgres)reasons.push('P7_RELEASE_EVIDENCE_MIGRATIONS');
  if(expectedMigrations&&(value.migrations.count!==expectedMigrations.count||value.migrations.latest!==expectedMigrations.latest))reasons.push('P7_RELEASE_EVIDENCE_MIGRATION_IDENTITY_MISMATCH');
  const life=value.localMeteoraLifecycle;if(!life?.passed||!life.open||!life.positionV2||!life.swap||!life.close||life.mainnetTransactionSent!==false)reasons.push('P7_RELEASE_EVIDENCE_LOCAL_METEORA');
  const r=value.runtimeIntegration;if(!r||[r.R01,r.R02,r.R03,r.R04,r.R05,r.R06,r.R07,r.R08,r.R09].some(x=>x!==true)||r.soakCycles<5||!r.uniqueForwardCycles||!r.uniqueRuntimeCycles||r.futureTimestampCount!==0||r.transactionPlanCount!==0||r.submissionAttemptCount!==0||r.confirmationCount!==0||r.canarySessionCount!==0||!r.restartRecoveryPass||!r.leaseExclusivityPass)reasons.push('P7_RELEASE_EVIDENCE_RUNTIME_INTEGRATION');
  if(value.secretScanPass!==true)reasons.push('P7_RELEASE_EVIDENCE_SECRET_SCAN');
  const {evidenceHash,...body}=value;const expected=hashPhase7RuntimeReleaseEvidence(body);if(evidenceHash!==expected)reasons.push('P7_RELEASE_EVIDENCE_HASH');
  if(reasons.length)throw new Error(`LPFORGE_P7_RELEASE_EVIDENCE_INVALID:${[...new Set(reasons)].sort().join(',')}`);
  return{valid:true,reasonCodes:[]};
}
export async function registerPhase7RuntimeReleaseEvidence(input:{store:Pick<Phase1Store,'insertPhase7StageEvidence'>;evidence:Phase7RuntimeReleaseEvidence;expectedSourceCommit?:string;expectedMigrations?:Phase7ReleaseMigrationIdentity}){
  verifyPhase7RuntimeReleaseEvidence(input.evidence,input.expectedSourceCommit,input.expectedMigrations);const evidenceId=`P7-R10:${input.evidence.sourceCommit}`;await input.store.insertPhase7StageEvidence({evidenceId,stage:'P7-R10',status:'PASS',observedAt:input.evidence.generatedAt,evidenceHash:input.evidence.evidenceHash,payload:input.evidence as unknown as Record<string,unknown>});return{evidenceId,stage:'P7-R10' as const,status:'PASS' as const,sourceCommit:input.evidence.sourceCommit,evidenceHash:input.evidence.evidenceHash,productionAuthorityIssued:false as const,automaticPolicyPromotion:false as const};
}
