import test from 'node:test';
import assert from 'node:assert/strict';
import {Transaction, TransactionMessage, VersionedTransaction, SystemProgram, PublicKey} from '@solana/web3.js';
import {createWeb3SimulationTransport} from '../.build/packages/simulation-gateway/src/index.js';

const payer = new PublicKey('11111111111111111111111111111111');
const receiver = new PublicKey('Vote111111111111111111111111111111111111111');
const blockhash = '11111111111111111111111111111111';

test('P5-08 web3 transport does not pass config object to legacy Transaction overload', async()=>{
  const calls=[];
  const connection={async simulateTransaction(...args){calls.push(args);return{value:{err:null,logs:['legacy'],unitsConsumed:150}}}};
  const tx=new Transaction({feePayer:payer,recentBlockhash:blockhash}).add(SystemProgram.transfer({fromPubkey:payer,toPubkey:receiver,lamports:1}));
  const transport=createWeb3SimulationTransport(connection);
  const result=await transport.simulate(tx,{sigVerify:false,replaceRecentBlockhash:true});
  assert.equal(result.err,null);
  assert.equal(calls.length,1);
  assert.equal(calls[0].length,1);
});

test('P5-08 web3 transport passes simulation config to VersionedTransaction overload', async()=>{
  const calls=[];
  const connection={async simulateTransaction(...args){calls.push(args);return{value:{err:null,logs:['v0'],unitsConsumed:150}}}};
  const message=new TransactionMessage({payerKey:payer,recentBlockhash:blockhash,instructions:[SystemProgram.transfer({fromPubkey:payer,toPubkey:receiver,lamports:1})]}).compileToV0Message();
  const tx=new VersionedTransaction(message);
  const options={sigVerify:false,replaceRecentBlockhash:true};
  const transport=createWeb3SimulationTransport(connection);
  const result=await transport.simulate(tx,options);
  assert.equal(result.err,null);
  assert.equal(calls.length,1);
  assert.equal(calls[0].length,2);
  assert.deepEqual(calls[0][1],options);
});
