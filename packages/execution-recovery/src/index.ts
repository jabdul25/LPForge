// LPFORGE_PHASE5_EXECUTION_MODULE
/**
 * The durable journal contract is deliberately narrower than the transaction
 * plan state machine.  These are the states that can be persisted in
 * execution.execution_journal and therefore must remain in lock-step with
 * M0059_execution_journal_state_contract.sql.
 */
export const executionJournalStates = [
  'PLAN_CREATED',
  'BUILT',
  'SIMULATED',
  'APPROVED',
  'SIGNING',
  'SIGNED',
  'SUBMITTED',
  'UNKNOWN_SUBMISSION',
  'CONFIRMED',
  'RECONCILIATION_REQUIRED',
  'RECONCILED',
  'EXPIRED',
  'FAILED',
  'HOLD',
] as const;
export type ExecutionJournalState=(typeof executionJournalStates)[number];

const journalTransitions: Readonly<Record<ExecutionJournalState, readonly ExecutionJournalState[]>> = {
  PLAN_CREATED: ['PLAN_CREATED','BUILT','SIMULATED','APPROVED','SIGNING','RECONCILED','EXPIRED','FAILED','HOLD'],
  BUILT: ['BUILT','SIMULATED','APPROVED','SIGNING','RECONCILED','EXPIRED','FAILED','HOLD'],
  SIMULATED: ['SIMULATED','APPROVED','SIGNING','RECONCILED','EXPIRED','FAILED','HOLD'],
  APPROVED: ['APPROVED','SIGNING','RECONCILED','EXPIRED','FAILED','HOLD'],
  SIGNING: ['SIGNING','SIGNED','EXPIRED','FAILED','HOLD'],
  SIGNED: ['SIGNED','SUBMITTED','UNKNOWN_SUBMISSION','EXPIRED','FAILED','HOLD'],
  // A chunked OPEN may sign the next independently durable child only after
  // the preceding child has been submitted.  It never permits a second OPEN
  // plan: the plan/campaign boundary remains separate and authoritative.
  SUBMITTED: ['SUBMITTED','SIGNING','CONFIRMED','UNKNOWN_SUBMISSION','RECONCILIATION_REQUIRED','RECONCILED','FAILED','HOLD'],
  UNKNOWN_SUBMISSION: ['UNKNOWN_SUBMISSION','SUBMITTED','CONFIRMED','RECONCILIATION_REQUIRED','RECONCILED','FAILED','HOLD'],
  // A multi-transaction CLOSE/RESHAPE confirms its completed child before
  // signing the next one.  This preserves the no-resend boundary for the
  // confirmed child while allowing the independently journaled follow-up.
  CONFIRMED: ['CONFIRMED','SIGNING','RECONCILIATION_REQUIRED','RECONCILED','HOLD'],
  RECONCILIATION_REQUIRED: ['RECONCILIATION_REQUIRED','RECONCILED','HOLD'],
  RECONCILED: ['RECONCILED'],
  EXPIRED: ['EXPIRED'],
  FAILED: ['FAILED'],
  HOLD: ['HOLD','RECONCILIATION_REQUIRED','RECONCILED'],
};

export function assertExecutionJournalTransition(
  previous: ExecutionJournalState,
  next: ExecutionJournalState,
): void {
  if (!journalTransitions[previous].includes(next))
    throw new Error(`LPFORGE_EXECUTION_JOURNAL_INVALID_TRANSITION:${previous}->${next}`);
}
export interface ExecutionJournal {journalId:string;idempotencyKey:string;planId:string;transactionId?:string;state:ExecutionJournalState;signature?:string;blockhash?:string;lastValidBlockHeight?:number;version:number;updatedAt:string;payload:Record<string,unknown>;}
export type RecoveryAction='RETURN_EXISTING_PLAN'|'WAIT_DO_NOT_RESUBMIT'|'RECONCILE_FIRST'|'REBUILD_WITH_NEW_BLOCKHASH'|'MARK_RECONCILED'|'HOLD_FOR_OPERATOR'|'NO_ACTION_COMPLETE';
export interface RecoveryFacts {journal:ExecutionJournal;currentBlockHeight:number;confirmationStatus:'PROCESSED'|'CONFIRMED'|'FINALIZED'|'EXPIRED'|'FAILED'|'UNKNOWN';economicEffect:'PRESENT'|'ABSENT'|'UNKNOWN';}
export function determineRecoveryAction(f:RecoveryFacts):RecoveryAction{
  const j=f.journal,action=String(j.payload?.action??'');
  if(j.state==='RECONCILED')return'NO_ACTION_COMPLETE';
  // A close-family plan may only auto-complete when the position is verifiably
  // gone. Recovery maps "position gone" to economicEffect PRESENT for
  // close-family (the close's effect is on chain), so ABSENT — position still
  // readable — is operator attention, never a silent completion or resend.
  if(action==='CLOSE'||action==='EMERGENCY_CLOSE')return f.economicEffect==='PRESENT'&&(f.confirmationStatus==='CONFIRMED'||f.confirmationStatus==='FINALIZED')?'MARK_RECONCILED':'HOLD_FOR_OPERATOR';
  if(f.economicEffect==='PRESENT')return f.confirmationStatus==='CONFIRMED'||f.confirmationStatus==='FINALIZED'?'RECONCILE_FIRST':'MARK_RECONCILED';
  // A sent submission attempt can survive a crash before the journal state is
  // advanced from SIGNED.  A durable signature is sufficient to force the
  // same no-blind-resend recovery branch.
  if(j.state==='SUBMITTED'||j.state==='UNKNOWN_SUBMISSION'||(j.state==='SIGNED'&&Boolean(j.signature))){
    if(f.confirmationStatus==='PROCESSED'||f.confirmationStatus==='CONFIRMED'||f.confirmationStatus==='FINALIZED')return'RECONCILE_FIRST';
    const expired=j.lastValidBlockHeight!==undefined&&f.currentBlockHeight>j.lastValidBlockHeight;
    if(!expired)return'WAIT_DO_NOT_RESUBMIT';
    if(f.economicEffect==='ABSENT'&&(f.confirmationStatus==='UNKNOWN'||f.confirmationStatus==='EXPIRED'||f.confirmationStatus==='FAILED'))return'REBUILD_WITH_NEW_BLOCKHASH';
    return'HOLD_FOR_OPERATOR';
  }
  if(j.state==='FAILED'||j.state==='HOLD')return'HOLD_FOR_OPERATOR';if(j.state==='CONFIRMED')return'RECONCILE_FIRST';return'RETURN_EXISTING_PLAN';
}
export class MemoryExecutionJournalStore {#byKey=new Map<string,ExecutionJournal>();create(j:ExecutionJournal):{created:boolean;journal:ExecutionJournal}{const existing=this.#byKey.get(j.idempotencyKey);if(existing)return{created:false,journal:existing};this.#byKey.set(j.idempotencyKey,j);return{created:true,journal:j};}get(key:string){return this.#byKey.get(key);}transition(key:string,expectedVersion:number,nextState:ExecutionJournalState,at:string,patch:Partial<ExecutionJournal>={}):ExecutionJournal{const cur=this.#byKey.get(key);if(!cur)throw new Error('LPFORGE_EXECUTION_JOURNAL_MISSING');if(cur.version!==expectedVersion)throw new Error('LPFORGE_EXECUTION_JOURNAL_VERSION_CONFLICT');assertExecutionJournalTransition(cur.state,nextState);const next={...cur,...patch,state:nextState,version:cur.version+1,updatedAt:at,idempotencyKey:cur.idempotencyKey,journalId:cur.journalId,planId:cur.planId};this.#byKey.set(key,next);return next;}}
