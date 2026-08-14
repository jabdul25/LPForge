import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import {prepareAutonomousMeteoraOpen} from '../.build/packages/phase6-autonomous-dispatch/src/index.js';

test('P6 autonomous dispatcher creates a new non-exportable PositionV2 signer for an operator plan',async()=>{
  const owner=Keypair.generate().publicKey.toBase58(),plan={planId:'plan-1',intentId:'intent-1',idempotencyKey:'key-1',poolAddress:'pool-1',ownerAddress:owner,thesisId:'thesis-1',observedAt:'2026-08-13T00:00:00Z',expiresAt:'2030-08-13T00:05:00Z',intentPayload:{entryFunding:{totalPairedTokenRaw:'0',solForLpLamports:'20000000'}},planPayload:{intent:{lowerBinId:1,upperBinId:2,strategy:'BID_ASK'}},transactionId:'tx-1',transactionMetadata:{}};
  const pool={async initializePositionAndAddLiquidityByStrategy(args){return new Transaction({feePayer:new Keypair().publicKey,recentBlockhash:'11111111111111111111111111111111'}).add(SystemProgram.transfer({fromPubkey:args.user,toPubkey:args.user,lamports:1}));},async addLiquidityByStrategy(){throw new Error('unexpected');}};
  const prepared=await prepareAutonomousMeteoraOpen({plan,pool,liquiditySlippageBps:100});
  assert.equal(prepared.positionSigner.secretExportable,false);
  assert.equal(prepared.positionSigner.purpose,'POSITION_ACCOUNT');
  assert.ok(prepared.requiredSignerAddresses.includes(owner));
  assert.ok(prepared.requiredSignerAddresses.includes(prepared.positionSigner.publicKeyAddress));
  assert.equal(prepared.metadata.positionAddress,prepared.positionSigner.publicKeyAddress);
});
test('P6 autonomous dispatcher maps an extended position and every SDK chunk to durable plan steps',async()=>{
  const owner=Keypair.generate().publicKey.toBase58(),plan={planId:'plan-extended',intentId:'intent-extended',idempotencyKey:'key-extended',poolAddress:'pool-1',ownerAddress:owner,thesisId:'thesis-1',observedAt:'2026-08-13T00:00:00Z',expiresAt:'2030-08-13T00:05:00Z',intentPayload:{entryFunding:{totalPairedTokenRaw:'0',solForLpLamports:'20000000'}},planPayload:{intent:{lowerBinId:-50,upperBinId:49,strategy:'BID_ASK',maxPositionWidthBins:100}},transactionId:'tx-extend',transactionMetadata:{maxPositionWidthBins:100},steps:[{transactionId:'tx-extend',kind:'METEORA_POSITION_EXTEND',metadata:{}},{transactionId:'tx-chunk-1',kind:'METEORA_OPEN_CHUNK',metadata:{}},{transactionId:'tx-chunk-2',kind:'METEORA_OPEN_CHUNK',metadata:{}}]};
  const tx=()=>new Transaction({feePayer:new Keypair().publicKey,recentBlockhash:'11111111111111111111111111111111'}).add(SystemProgram.transfer({fromPubkey:new Keypair().publicKey,toPubkey:new Keypair().publicKey,lamports:1})),pool={async initializePositionAndAddLiquidityByStrategy(){throw new Error('unexpected')},async createExtendedEmptyPosition(){return tx()},async addLiquidityByStrategyChunkable(){return[tx(),tx()]},async addLiquidityByStrategy(){throw new Error('unexpected')}};
  const prepared=await prepareAutonomousMeteoraOpen({plan,pool,liquiditySlippageBps:100});assert.deepEqual(prepared.steps.map(step=>step.transactionId),['tx-extend','tx-chunk-1','tx-chunk-2']);assert.deepEqual(prepared.steps.map(step=>step.kind),['METEORA_POSITION_EXTEND','METEORA_OPEN_CHUNK','METEORA_OPEN_CHUNK']);assert.ok(prepared.steps[0].requiredSignerAddresses.includes(prepared.positionSigner.publicKeyAddress));
});
