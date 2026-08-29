import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {attributedPositionInventoryRaw,settlePositionInventoryLotBalance} from '../.build/packages/db/src/index.js';

const lot=(positionAddress,tokenMint,remainingRawAmount)=>({positionAddress,tokenMint,remainingRawAmount});

test('position inventory remains attributable when multiple positions own the same mint',()=>{
  const lots=[lot('position-A','mint-X',100n),lot('position-B','mint-X',50n)];
  assert.equal(attributedPositionInventoryRaw(lots,'position-A','mint-X'),100n);
  assert.equal(attributedPositionInventoryRaw(lots,'position-B','mint-X'),50n);
  assert.equal(attributedPositionInventoryRaw(lots,'position-A'),100n);
});

test('pre-existing external wallet inventory is never inferred as position inventory',()=>{
  const externalWalletBalance=1_000n;
  const claimedLot=lot('position-A','mint-X',100n);
  assert.equal(externalWalletBalance+claimedLot.remainingRawAmount,1_100n);
  assert.equal(attributedPositionInventoryRaw([claimedLot],'position-A','mint-X'),100n);
});

test('a partial settlement retains the attributable balance and an eventual full settlement closes it',()=>{
  const partial=settlePositionInventoryLotBalance({remainingRawAmount:100n,settledRawAmount:60n,eventType:'SETTLED'});
  assert.deepEqual(partial,{remainingRawAmount:40n,status:'PARTIALLY_SETTLED'});
  const settled=settlePositionInventoryLotBalance({remainingRawAmount:partial.remainingRawAmount,settledRawAmount:40n,eventType:'SETTLED'});
  assert.deepEqual(settled,{remainingRawAmount:0n,status:'SETTLED'});
  assert.throws(()=>settlePositionInventoryLotBalance({remainingRawAmount:40n,settledRawAmount:41n,eventType:'SETTLED'}),/LPFORGE_INVENTORY_SETTLEMENT_EXCEEDS_LOT/);
});

test('inventory migration keeps a durable source lot and immutable event trail',async()=>{
  const sql=await readFile('packages/db/migrations/M0039_position_inventory_attribution.sql','utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS execution\.position_inventory_lots/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS execution\.position_inventory_lot_events/);
  assert.match(sql,/source_cashflow_id text REFERENCES execution\.position_cashflows/);
  assert.match(sql,/numeric\(78,0\)/);
  assert.match(sql,/event_type text NOT NULL CHECK\(event_type IN \('CREATED','SETTLED','TRANSFERRED'\)\)/);
});
