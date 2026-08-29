import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import {createLegacyMainnetEnvelope} from '../.build/packages/phase6-live-envelope/src/index.js';

test('P6 legacy envelope exposes signing bytes and a serialized signed transaction',()=>{
  const owner=Keypair.generate(),recipient=Keypair.generate();
  const transaction=new Transaction({feePayer:owner.publicKey,recentBlockhash:'11111111111111111111111111111111'}).add(SystemProgram.transfer({fromPubkey:owner.publicKey,toPubkey:recipient.publicKey,lamports:1}));
  const envelope=createLegacyMainnetEnvelope(transaction),message=envelope.serializeMessage();
  assert.ok(message.byteLength>0);
  transaction.partialSign(owner);
  assert.ok(envelope.serializeSigned().byteLength>0);
});
