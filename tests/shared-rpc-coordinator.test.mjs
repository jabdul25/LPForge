import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const m=await import('../.build/packages/meteora/src/index.js');

test('critical RPC calls acquire a shared permit and report provider 429 pressure',async()=>{
  const events=[];let calls=0;
  const coordinator={
    acquire:async(priority,method)=>events.push(['acquire',priority,method]),
    note429:async(priority,method,wait)=>events.push(['429',priority,method,wait]),
    noteRetry:async(priority,method)=>events.push(['retry',priority,method]),
  };
  const rpc=m.createSolanaRpcClient({url:'https://rpc.invalid',priority:'P0_EXECUTION_CRITICAL',coordinator,minIntervalMs:0,maxRetries:1,retryBaseDelayMs:1,retryMaxDelayMs:1,sleepImpl:async()=>{},fetchImpl:async()=>{calls++;return calls===1?new Response('busy',{status:429,headers:{'retry-after':'0'}}):new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:44}),{headers:{'content-type':'application/json'}});}});
  assert.equal(await rpc.getSlot(),44n);
  assert.deepEqual(events.map(event=>event.slice(0,3)),[['acquire','P0_EXECUTION_CRITICAL','getSlot'],['429','P0_EXECUTION_CRITICAL','getSlot'],['acquire','P0_EXECUTION_CRITICAL','getSlot']]);
});

test('SDK governed fetch uses the same priority coordinator',async()=>{
  const events=[];const coordinator={acquire:async(priority,method)=>events.push([priority,method]),note429:async()=>{},noteRetry:async()=>{}};
  const governed=m.createGovernedRpcFetch({priority:'P1_RECOVERY_CRITICAL',coordinator,fetchImpl:async()=>new Response('{}')});
  await governed('https://rpc.invalid',{method:'POST',body:JSON.stringify({method:'getSignatureStatuses'})});
  assert.deepEqual(events,[['P1_RECOVERY_CRITICAL','getSignatureStatuses']]);
});

test('production RPC constructors use governed connections and priority lanes',async()=>{
  const files=['packages/phase6-live-worker/src/index.ts','packages/phase7-production-service/src/index.ts','apps/execution/src/main.ts','apps/operator/src/main.ts'];
  for(const file of files){const source=await readFile(new URL(`../${file}`,import.meta.url),'utf8');assert.doesNotMatch(source,/new Connection\(/,file);}
  const meteora=await readFile(new URL('../packages/meteora/src/index.ts',import.meta.url),'utf8');
  assert.match(meteora,/createGovernedRpcFetch/);assert.match(meteora,/acquire_rpc_permit/);
  const migration=await readFile(new URL('../packages/db/migrations/M0043_shared_rpc_coordinator.sql',import.meta.url),'utf8');
  assert.match(migration,/FOR UPDATE/);assert.match(migration,/pressure_until/);assert.match(migration,/P0_EXECUTION_CRITICAL/);assert.match(migration,/rpc_provider_metrics/);
});
