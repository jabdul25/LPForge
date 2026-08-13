// LPFORGE_PHASE5_EXECUTION_MODULE
export type ExecutionJournalState='PLAN_CREATED'|'BUILT'|'SIMULATED'|'APPROVED'|'SIGNED'|'SUBMITTED'|'UNKNOWN_SUBMISSION'|'CONFIRMED'|'RECONCILED'|'EXPIRED'|'FAILED'|'HOLD';
export interface ExecutionJournal {journalId:string;idempotencyKey:string;planId:string;transactionId?:string;state:ExecutionJournalState;signature?:string;blockhash?:string;lastValidBlockHeight?:number;version:number;updatedAt:string;payload:Record<string,unknown>;}
export type RecoveryAction='RETURN_EXISTING_PLAN'|'WAIT_DO_NOT_RESUBMIT'|'RECONCILE_FIRST'|'REBUILD_WITH_NEW_BLOCKHASH'|'MARK_RECONCILED'|'HOLD_FOR_OPERATOR'|'NO_ACTION_COMPLETE';
export interface RecoveryFacts {journal:ExecutionJournal;currentBlockHeight:number;confirmationStatus:'PROCESSED'|'CONFIRMED'|'FINALIZED'|'EXPIRED'|'FAILED'|'UNKNOWN';economicEffect:'PRESENT'|'ABSENT'|'UNKNOWN';}
export function determineRecoveryAction(f:RecoveryFacts):RecoveryAction{
  const j=f.journal;if(j.state==='RECONCILED')return'NO_ACTION_COMPLETE';if(f.economicEffect==='PRESENT')return f.confirmationStatus==='CONFIRMED'||f.confirmationStatus==='FINALIZED'?'RECONCILE_FIRST':'MARK_RECONCILED';
  if(j.state==='SUBMITTED'||j.state==='UNKNOWN_SUBMISSION'){
    if(f.confirmationStatus==='PROCESSED'||f.confirmationStatus==='CONFIRMED'||f.confirmationStatus==='FINALIZED')return'RECONCILE_FIRST';
    const expired=j.lastValidBlockHeight!==undefined&&f.currentBlockHeight>j.lastValidBlockHeight;
    if(!expired)return'WAIT_DO_NOT_RESUBMIT';
    if(f.economicEffect==='ABSENT'&&(f.confirmationStatus==='UNKNOWN'||f.confirmationStatus==='EXPIRED'||f.confirmationStatus==='FAILED'))return'REBUILD_WITH_NEW_BLOCKHASH';
    return'HOLD_FOR_OPERATOR';
  }
  if(j.state==='FAILED'||j.state==='HOLD')return'HOLD_FOR_OPERATOR';if(j.state==='CONFIRMED')return'RECONCILE_FIRST';return'RETURN_EXISTING_PLAN';
}
export class MemoryExecutionJournalStore {#byKey=new Map<string,ExecutionJournal>();create(j:ExecutionJournal):{created:boolean;journal:ExecutionJournal}{const existing=this.#byKey.get(j.idempotencyKey);if(existing)return{created:false,journal:existing};this.#byKey.set(j.idempotencyKey,j);return{created:true,journal:j};}get(key:string){return this.#byKey.get(key);}transition(key:string,expectedVersion:number,nextState:ExecutionJournalState,at:string,patch:Partial<ExecutionJournal>={}):ExecutionJournal{const cur=this.#byKey.get(key);if(!cur)throw new Error('LPFORGE_EXECUTION_JOURNAL_MISSING');if(cur.version!==expectedVersion)throw new Error('LPFORGE_EXECUTION_JOURNAL_VERSION_CONFLICT');const next={...cur,...patch,state:nextState,version:cur.version+1,updatedAt:at,idempotencyKey:cur.idempotencyKey,journalId:cur.journalId,planId:cur.planId};this.#byKey.set(key,next);return next;}}
