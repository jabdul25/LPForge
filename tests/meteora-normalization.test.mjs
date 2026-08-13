import test from 'node:test';import assert from 'node:assert/strict';const m=await import('../.build/packages/meteora/src/index.js');test('SDK pool normalizer maps current conceptual fields',()=>{const c={lbPair:{activeId:5,parameters:{binStep:20,functionType:1,collectFeeMode:0}},tokenX:{publicKey:{toString:()=> 'So11111111111111111111111111111111111111112'}},tokenY:{publicKey:{toString:()=> 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'}}};const p=m.normalizePoolFromSdk('11111111111111111111111111111111',c,10n,'0.02');assert.equal(p.activeBinId,5);assert.equal(p.functionType,'LIQUIDITY_MINING');assert.equal(p.collectFeeMode,'INPUT_ONLY');});test('extracts Anchor Program data logs only',()=>{assert.deepEqual(m.extractProgramDataLogs(['Program log: x','Program data: abc','Program data: def']),['abc','def']);});

test('program-scoped event extraction ignores Program data emitted by nested non-Meteora programs',()=>{
  const program='LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
  const nested='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const logs=[
    `Program ${program} invoke [1]`,
    'Program data: meteora-before',
    `Program ${nested} invoke [2]`,
    'Program data: nested-token-data',
    `Program ${nested} success`,
    'Program data: meteora-after',
    `Program ${program} success`
  ];
  assert.deepEqual(m.extractProgramDataLogsForProgram(logs,program),['meteora-before','meteora-after']);
});

test('program-scoped event extraction handles Meteora CPI invocation',()=>{
  const program='LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
  const outer='11111111111111111111111111111111';
  const logs=[
    `Program ${outer} invoke [1]`,
    `Program ${program} invoke [2]`,
    'Program data: cpi-meteora-event',
    `Program ${program} success`,
    `Program ${outer} success`
  ];
  assert.deepEqual(m.extractProgramDataLogsForProgram(logs,program),['cpi-meteora-event']);
});

test('Anchor event decoder quarantine converts ERR_OUT_OF_RANGE into non-fatal evidence',()=>{
  const coder={decode(){const e=new RangeError('The value of "offset" is out of range. Received 112');e.code='ERR_OUT_OF_RANGE';throw e;}};
  const result=m.tryDecodeAnchorEvent(coder,'malformed-event-payload');
  assert.equal(result.decoded,null);
  assert.equal(result.error?.name,'RangeError');
  assert.match(result.error?.message??'',/offset.*out of range/i);
});
