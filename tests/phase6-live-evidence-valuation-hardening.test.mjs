import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorEventBase64FromCpiInstruction, extractInnerInstructionDataForProgram } from '../.build/packages/meteora/src/index.js';
import { swapEventFromDbRow } from '../.build/packages/db/src/index.js';
import { generateStrategyCandidates } from '../.build/packages/rangeforge/src/index.js';
import { simulateCandidateSet } from '../.build/packages/candidate-simulator/src/index.js';
import { rankCandidates } from '../.build/packages/candidate-ranking/src/index.js';
import { deriveCandidateValuationCalibration } from '../.build/packages/operational-runtime/src/index.js';

const ALPH='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes){let zeros=0;while(zeros<bytes.length&&bytes[zeros]===0)zeros++;let n=0n;for(const b of bytes)n=(n<<8n)+BigInt(b);let out='';while(n>0){out=ALPH[Number(n%58n)]+out;n/=58n;}return '1'.repeat(zeros)+(out||'');}

test('v1.0.5 extracts Anchor event-CPI instruction payloads for the Meteora program',()=>{
  const program='LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
  const payload=Uint8Array.from([46,116,82,215,148,27,84,77,1,2,3,4]);
  const raw=Uint8Array.from([9,9,9,9,9,9,9,9,...payload]);
  const data=b58(raw);
  const tx={transaction:{message:{accountKeys:['11111111111111111111111111111111',program]}},meta:{innerInstructions:[{index:0,instructions:[{programIdIndex:1,data}]}]}};
  assert.deepEqual(extractInnerInstructionDataForProgram(tx,program),[data]);
  assert.equal(anchorEventBase64FromCpiInstruction(data),btoa(String.fromCharCode(...payload)));
});

test('v1.0.5 DB history reconstruction preserves Swap2Evt fee-side fields',()=>{
  const e=swapEventFromDbRow({signature:'sig',event_index:2,pool_address:'pool',chain_slot:'10',block_time:'2026-08-12T20:00:00Z',observed_at:'2026-08-12T20:00:01Z',start_bin_id:-2,end_bin_id:3,swap_for_y:true,amount_in:'100',amount_left:'4',amount_out:'95',fee_bps:'25',mm_fee:'3',protocol_fee:'1',limit_order_fee:'0',host_fee:'0',fees_on_input:true,fees_on_token_x:false,payload:{eventTransport:'EVENT_CPI'}});
  assert.equal(e.amountLeft,'4');assert.equal(e.feeBps,'25');assert.equal(e.feesOnInput,true);assert.equal(e.feesOnTokenX,false);assert.equal(e.raw.eventTransport,'EVENT_CPI');
});

test('v1.0.5 derives SOL-denominated raw-unit calibration from exact token decimals and price',()=>{
  const pool={tokenXMint:'So11111111111111111111111111111111111111112',tokenYMint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',activeBinId:1};
  const api={token_x:{address:pool.tokenXMint,decimals:9},token_y:{address:pool.tokenYMint,decimals:6},current_price:80};
  const c=deriveCandidateValuationCalibration(pool,api,[{binId:1,price:'80'}]);
  assert.equal(c.valid,true);assert.equal(c.valueUnit,'TOKEN_X');assert.equal(c.rawUnitValueX,1e-9);assert.ok(Math.abs(c.rawUnitValueY-1.25e-8)<1e-20);assert.equal(c.source,'METEORA_DATA_API_CURRENT_PRICE');
});

const geom={id:'g',family:'BASE',lowerBinId:99,upperBinId:101,centerBinId:100,widthBins:3,lowerOffsetBins:-1,upperOffsetBins:1,lowerDistancePct:-1,upperDistancePct:1,reasonCodes:[]};
const [candidate]=generateStrategyCandidates({universe:{activeBinId:100,binStep:10,horizonMinutes:60,candidates:[geom],movementBasisBins:2,volatilityMultiplier:1},orientations:['BALANCED'],capitalFractions:[1]});
const frame=(t,m=1)=>({observedAt:t,activeBinId:100,bins:[99,100,101].map((binId,i)=>({binId,price:'80',amountX:String(BigInt(1_000_000_000_000+i*100_000_000)*BigInt(m)),amountY:String(BigInt(80_000_000_000_000-i*1_000_000)*BigInt(m)),liquiditySupply:'1000000'}))});
const frames=[frame('2026-08-12T20:00:00Z',1),frame('2026-08-12T20:01:00Z',1)];

test('v1.0.5 candidate simulation normalizes arbitrary liquidity-share scale to requested capital',()=>{
  const sims=simulateCandidateSet({candidates:[candidate],pool:'pool',frames,events:[{signature:'s',eventIndex:0,pool:'pool',startBinId:99,endBinId:101,mmFee:'1000000',feesOnTokenX:true,stamp:{source:'FIXTURE',observedAt:'2026-08-12T20:00:30Z'},raw:{}}],totalPositionShareRaw:1000n,rawUnitValueX:1e-9,rawUnitValueY:1.25e-8,capitalValue:.02,costs:{transactionFeeValue:'0.00001'}});
  const s=sims[0];assert.equal(s.unitScaleValid,true);assert.equal(s.evidenceActionable,true);assert.ok(Math.abs(s.startInventoryValue-.02)<1e-12);assert.ok(Math.abs(s.netValue)<.1);assert.equal(s.valueUnit,'TOKEN_X');
});

test('v1.0.5 zero-swap candidate evidence is explicitly non-actionable',()=>{
  const [s]=simulateCandidateSet({candidates:[candidate],pool:'pool',frames,events:[],totalPositionShareRaw:1000n,rawUnitValueX:1e-9,rawUnitValueY:1.25e-8,capitalValue:.02});
  assert.equal(s.evidenceActionable,false);assert.ok(s.warnings.includes('CANDIDATE_EVENT_PATH_NO_SWAP_EVIDENCE'));
  const r=rankCandidates({candidates:[candidate],simulations:[s],survivalForecasts:{}});assert.equal(r.winner,'NO_TRADE');assert.ok(r.reasonCodes.includes('NO_TRADE_EVIDENCE_NON_ACTIONABLE'));
});

test('v1.0.5 non-positive aggregate economics makes RangeForge ranking non-actionable',()=>{
  const [s]=simulateCandidateSet({candidates:[candidate],pool:'pool',frames,events:[{signature:'s',eventIndex:0,pool:'pool',startBinId:99,endBinId:101,mmFee:'1000000',feesOnTokenX:true,stamp:{source:'FIXTURE',observedAt:'2026-08-12T20:00:30Z'},raw:{}}],totalPositionShareRaw:1000n,rawUnitValueX:1e-9,rawUnitValueY:1.25e-8,capitalValue:.02});
  const r=rankCandidates({candidates:[candidate],simulations:[s],survivalForecasts:{},globalActionable:false});assert.equal(r.winner,'NO_TRADE');assert.deepEqual(r.reasonCodes,['NO_TRADE_ECONOMICS_NON_POSITIVE']);assert.equal(r.rankings[0].actionable,false);
});

test('v1.0.5 scanner carries program-matched CPI instruction data into the transaction record',async()=>{
  const program='LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
  const data=b58(Uint8Array.from([1,2,3,4,5,6,7,8,46,116,82,215,148,27,84,77,9]));
  const rpc={
    async getSignaturesForAddress(){return[{signature:'sig',slot:99,blockTime:1000,err:null}]},
    async getTransaction(){return{transaction:{message:{accountKeys:['11111111111111111111111111111111',program]}},meta:{logMessages:[],innerInstructions:[{index:0,instructions:[{programIdIndex:1,data}]}]}}}
  };
  const { scanAddressTransactions }=await import('../.build/packages/meteora/src/index.js');
  const [tx]=await scanAddressTransactions({rpc,address:'pool',limit:1,programId:program});
  assert.deepEqual(tx.cpiInstructionData,[data]);
});
