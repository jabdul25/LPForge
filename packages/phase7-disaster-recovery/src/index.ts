// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
export interface Phase7DisasterRecoveryPolicy {maxDatabaseBackupAgeMs:number;maxRestoreTestAgeMs:number;maxRpoMs:number;maxRtoMs:number;requireEncryptedBackup:boolean;requireOffsiteCopy:boolean;}
export interface Phase7DisasterRecoveryEvidence {observedAt:string;databaseBackupAt:string;databaseBackupVerified:boolean;latestDurableDataAt:string;restoreTestAt:string;restoreSucceeded:boolean;restoreDurationMs:number;backupEncrypted:boolean;offsiteCopyVerified:boolean;policyArchiveHash?:string;sourceBundleHash?:string;replayArchiveHash?:string;supportBundleSecretScanPass:boolean;}
export interface Phase7DisasterRecoveryDecision {status:'PASS'|'HOLD'|'BLOCK';reasonCodes:string[];rpoMs:number;rtoMs:number;productionReady:boolean;}
export function assessPhase7DisasterRecovery(e:Phase7DisasterRecoveryEvidence,p:Phase7DisasterRecoveryPolicy):Phase7DisasterRecoveryDecision{
  if(p.maxDatabaseBackupAgeMs<1||p.maxRestoreTestAgeMs<1||p.maxRpoMs<0||p.maxRtoMs<1)throw new Error('LPFORGE_P7_DR_POLICY');
  const now=Date.parse(e.observedAt),backup=Date.parse(e.databaseBackupAt),durable=Date.parse(e.latestDurableDataAt),restore=Date.parse(e.restoreTestAt);if([now,backup,durable,restore].some(x=>!Number.isFinite(x))||backup>now||durable>now||restore>now)throw new Error('LPFORGE_P7_DR_TIME');
  const hard:string[]=[];const hold:string[]=[];const backupAge=now-backup,restoreAge=now-restore,rpo=Math.max(0,durable-backup),rto=e.restoreDurationMs;
  if(!e.databaseBackupVerified)hard.push('P7_DR_BACKUP_NOT_VERIFIED');
  if(!e.restoreSucceeded)hard.push('P7_DR_RESTORE_FAILED');
  if(!e.supportBundleSecretScanPass)hard.push('P7_DR_SECRET_SCAN_FAILED');
  if(p.requireEncryptedBackup&&!e.backupEncrypted)hard.push('P7_DR_BACKUP_NOT_ENCRYPTED');
  if(p.requireOffsiteCopy&&!e.offsiteCopyVerified)hard.push('P7_DR_OFFSITE_COPY_MISSING');
  if(!e.policyArchiveHash?.trim())hard.push('P7_DR_POLICY_ARCHIVE_MISSING');if(!e.sourceBundleHash?.trim())hard.push('P7_DR_SOURCE_ARCHIVE_MISSING');if(!e.replayArchiveHash?.trim())hold.push('P7_DR_REPLAY_ARCHIVE_MISSING');
  if(backupAge>p.maxDatabaseBackupAgeMs)hold.push('P7_DR_BACKUP_STALE');if(restoreAge>p.maxRestoreTestAgeMs)hold.push('P7_DR_RESTORE_TEST_STALE');if(rpo>p.maxRpoMs)hold.push('P7_DR_RPO_EXCEEDED');if(rto>p.maxRtoMs)hold.push('P7_DR_RTO_EXCEEDED');
  const status=hard.length?'BLOCK':hold.length?'HOLD':'PASS';return{status,reasonCodes:[...new Set([...hard,...hold])].sort(),rpoMs:rpo,rtoMs:rto,productionReady:status==='PASS'};
}
