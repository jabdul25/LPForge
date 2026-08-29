import assert from 'node:assert/strict';
import {Client} from 'pg';

const url=process.env.DATABASE_URL;
const planId=process.env.LPFORGE_POSTGRES_PERSISTENCE_PLAN_ID;
if(!url||!planId)throw new Error('DATABASE_URL and LPFORGE_POSTGRES_PERSISTENCE_PLAN_ID required');
const client=new Client({connectionString:url});
await client.connect();
try{
  await client.query('BEGIN');
  const result=await client.query(
    `UPDATE execution.execution_journal
        SET state=$2,updated_at=$3::timestamptz,
            payload=payload||jsonb_build_object('terminalPlanState',$4::text,'terminalizedAt',$3::text)
      WHERE plan_id=$1
        AND state IN ('PLAN_CREATED','BUILT','SIMULATED','APPROVED','SIGNING','SIGNED','SUBMITTED','UNKNOWN_SUBMISSION','CONFIRMED','RECONCILIATION_REQUIRED')
      RETURNING payload->>'terminalPlanState' AS terminal_plan_state`,
    [planId,'RECONCILED','2026-08-29T12:28:39.000Z','RECONCILED'],
  );
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].terminal_plan_state,'RECONCILED');
  await client.query('ROLLBACK');
  console.log('COMPLETE_AUTONOMOUS_PLAN_POSTGRES_REGRESSION_PASS');
}catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{await client.end();}
