import test from 'node:test';import assert from 'node:assert/strict';const m=await import('../.build/packages/meteora/src/index.js');test('RPC scanner preserves slots and program logs',async()=>{const fetchImpl=async(_url,init)=>{const body=JSON.parse(String(init.body));let result;if(body.method==='getSignaturesForAddress')result=[{signature:'s1',slot:12,blockTime:1000,err:null}];else if(body.method==='getTransaction')result={meta:{logMessages:['Program data: AAA','Program log: ok']}};else if(body.method==='getSlot')result=12;return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}),{status:200,headers:{'content-type':'application/json'}})};const rpc=m.createSolanaRpcClient({url:'https://rpc.test',fetchImpl});assert.equal(await rpc.getSlot(),12n);const txs=await m.scanAddressTransactions({rpc,address:'11111111111111111111111111111111',limit:1});assert.equal(txs.length,1);assert.equal(txs[0].slot,12n);assert.deepEqual(txs[0].logs,['Program data: AAA','Program log: ok']);});

test('RPC client retries HTTP 429 with bounded backoff and eventually succeeds',async()=>{
  let calls=0; const sleeps=[];
  const fetchImpl=async(_url,init)=>{calls++;const body=JSON.parse(String(init.body));if(calls<3)return new Response('rate limited',{status:429,headers:{'retry-after':'0.01'}});return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:77}),{status:200,headers:{'content-type':'application/json'}});};
  let now=0; const rpc=m.createSolanaRpcClient({url:'https://rpc.test',fetchImpl,minIntervalMs:0,maxRetries:3,retryBaseDelayMs:5,retryMaxDelayMs:20,nowImpl:()=>now,sleepImpl:async ms=>{sleeps.push(ms);now+=ms;}});
  assert.equal(await rpc.getSlot(),77n);assert.equal(calls,3);assert.deepEqual(sleeps,[10,10]);
});

test('RPC client fails closed after retry budget is exhausted',async()=>{
  let calls=0; const rpc=m.createSolanaRpcClient({url:'https://rpc.test',fetchImpl:async()=>{calls++;return new Response('busy',{status:429});},minIntervalMs:0,maxRetries:2,retryBaseDelayMs:1,retryMaxDelayMs:2,sleepImpl:async()=>{}});
  await assert.rejects(()=>rpc.getSlot(),/LPFORGE_RPC_HTTP:429/);assert.equal(calls,3);
});

test('RPC client paces sequential requests',async()=>{
  let now=0; const sleeps=[]; const fetchImpl=async(_url,init)=>{const body=JSON.parse(String(init.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:1}),{status:200,headers:{'content-type':'application/json'}});};
  const rpc=m.createSolanaRpcClient({url:'https://rpc.test',fetchImpl,minIntervalMs:125,maxRetries:0,nowImpl:()=>now,sleepImpl:async ms=>{sleeps.push(ms);now+=ms;}});
  await rpc.getSlot();await rpc.getSlot();await rpc.getSlot();assert.deepEqual(sleeps,[125,125]);
});
