import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import {prepareAutonomousMeteoraOpen} from '../.build/packages/phase6-autonomous-dispatch/src/index.js';

test('P6 autonomous dispatcher creates a new non-exportable PositionV2 signer for an operator plan',async()=>{
  const owner=Keypair.generate().publicKey.toBase58(),plan={planId:'plan-1',intentId:'intent-1',idempotencyKey:'key-1',poolAddress:'pool-1',ownerAddress:owner,thesisId:'thesis-1',observedAt:'2026-08-13T00:00:00Z',expiresAt:'2030-08-13T00:05:00Z',intentPayload:{entryFunding:{totalPairedTokenRaw:'0',solForLpLamports:'20000000'}},planPayload:{intent:{lowerBinId:1,upperBinId:2,strategy:'BID_ASK'}},transactionId:'tx-1',transactionMetadata:{}};
  const pool={async initializePositionAndAddLiquidityByStrategy(args){return new Transaction({feePayer:new Keypair().publicKey,recentBlockhash:'11111111111111111111111111111111'}).add(SystemProgram.transfer({fromPubkey:args.user,toPubkey:args.user,lamports:1}));},async addLiquidityByStrategy(){throw new Error('unexpected');}};
  const prepared=await prepareAutonomousMeteoraOpen({plan,pool});
  assert.equal(prepared.positionSigner.secretExportable,false);
  assert.equal(prepared.positionSigner.purpose,'POSITION_ACCOUNT');
  assert.ok(prepared.requiredSignerAddresses.includes(owner));
  assert.ok(prepared.requiredSignerAddresses.includes(prepared.positionSigner.publicKeyAddress));
  assert.equal(prepared.metadata.positionAddress,prepared.positionSigner.publicKeyAddress);
});
