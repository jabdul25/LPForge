import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresStore } from '../.build/packages/db/src/index.js';

// This intentionally requires an explicitly named local/integration URL.
// It must never run merely because a Production DATABASE_URL is present.
const databaseUrl=process.env.LPFORGE_TEST_DATABASE_URL;
const enabled=Boolean(databaseUrl);
const at='2026-09-10T12:00:00.000Z';
const suffix=`ts5-${process.pid}-${Date.now()}`;
const pool=`POOL-${suffix}`,owner=`OWNER-${suffix}`,position=`POSITION-${suffix}`,lpPosition=`LP-${suffix}`;
const transition={lpforgePositionId:lpPosition,observedAt:at,watch:{schemaVersion:1,policyVersion:'profit-retention-ts5-oor-p4-v1',state:'PROTECTION_CONFIRMED',confirmedAt:at}};
const intent=(id,action='CLOSE')=>({intentId:`intent-${suffix}-${id}`,idempotencyKey:`key-${suffix}-${id}`,action,poolAddress:pool,ownerAddress:owner,positionAddress:position,thesisId:`thesis-${suffix}`,observedAt:at,expiresAt:'2026-09-10T12:30:00.000Z',payload:{protective:true}});
const plan=(id)=>({planId:`plan-${suffix}-${id}`,intentId:`intent-${suffix}-${id}`,cluster:'mainnet-beta',state:'PLANNED',createdAt:at,expiresAt:'2026-09-10T12:30:00.000Z',payload:{reasonCodes:['PROFIT_RETENTION_TS5_CONFIRMED']},steps:[{transactionId:`step-${suffix}-${id}`,sequence:1,kind:'METEORA_CLOSE',state:'PLANNED',requiredSignerAddresses:[owner],metadata:{}}]});

test('serialized protective close intent admits exactly one concurrent plan per position', {skip:!enabled}, async()=>{
  const pg=await import('pg');
  const seed=new pg.Client({connectionString:databaseUrl});
  await seed.connect();
  try {
    await seed.query('INSERT INTO protocol.tokens(mint,decimals,token_program) VALUES($1,9,$2),($3,9,$2)',[`X-${suffix}`,'TOKEN',`Y-${suffix}`]);
    await seed.query('INSERT INTO protocol.pools(address,token_x_mint,token_y_mint,bin_step) VALUES($1,$2,$3,1)',[pool,`X-${suffix}`,`Y-${suffix}`]);
    await seed.query(`INSERT INTO execution.owned_positions(lpforge_position_id,pool_address,position_address,owner_address,strategy,orientation,lower_bin_id,upper_bin_id,active_bin_at_entry,initial_capital_lamports,entered_at,lifecycle_state,reconciliation_status)
      VALUES($1,$2,$3,$4,'CURVE','BALANCED',0,30,15,30000000,$5,'OPEN','MATCH')`,[lpPosition,pool,position,owner,at]);
    await seed.query(`INSERT INTO execution.position_exit_state(lpforge_position_id,observed_at,evidence_state,peak_net_return_fraction,peak_observed_at,last_action,updated_at)
      VALUES($1,$2,'AVAILABLE',0,$2,'HOLD',$2)`,[lpPosition,at]);
  } finally { await seed.end(); }

  const a=await createPostgresStore(databaseUrl),b=await createPostgresStore(databaseUrl);
  try {
    const result=await Promise.all([
      a.persistProtectedClosePlan({positionAddress:position,intent:intent('a'),plan:plan('a'),profitRetentionTransition:transition}),
      b.persistProtectedClosePlan({positionAddress:position,intent:intent('b'),plan:plan('b'),profitRetentionTransition:transition}),
    ]);
    assert.deepEqual(result.sort(),[false,true]);
    assert.equal(await a.hasActiveAutonomousPlan(position),true);
    assert.equal(await a.persistProtectedClosePlan({positionAddress:position,intent:intent('c','EMERGENCY_CLOSE'),plan:plan('c')}),false);
  } finally { await a.close(); await b.close(); }

  const verify=new pg.Client({connectionString:databaseUrl});
  await verify.connect();
  try {
    const plans=await verify.query(`SELECT p.plan_id FROM execution.transaction_plans p JOIN execution.intents i ON i.intent_id=p.intent_id WHERE i.position_address=$1`,[position]);
    const intents=await verify.query('SELECT intent_id FROM execution.intents WHERE position_address=$1',[position]);
    const state=await verify.query('SELECT payload FROM execution.position_exit_state WHERE lpforge_position_id=$1',[lpPosition]);
    assert.equal(plans.rowCount,1);
    assert.equal(intents.rowCount,1);
    assert.equal(state.rows[0].payload.profitRetentionWatch.state,'PROTECTION_CONFIRMED');
  } finally { await verify.end(); }
});
