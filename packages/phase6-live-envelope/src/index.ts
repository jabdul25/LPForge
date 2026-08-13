// LPFORGE_PHASE6_MAINNET_MODULE
import {PublicKey,Transaction} from '@solana/web3.js';
import type {SerializableMainnetEnvelope} from '../../phase6-canary-runtime/src/index.js';

/** Adapts a fully built legacy Meteora transaction to the isolated signer API. */
export function createLegacyMainnetEnvelope(transaction:Transaction):SerializableMainnetEnvelope{
  if(!transaction.recentBlockhash||!transaction.feePayer)throw new Error('LPFORGE_P6_LEGACY_TRANSACTION_NOT_FINALIZED');
  return{serializeMessage(){return transaction.serializeMessage();},attachSignature(publicKeyAddress,signature){transaction.addSignature(new PublicKey(publicKeyAddress),signature as never);},serializeSigned(){return transaction.serialize({requireAllSignatures:true,verifySignatures:true});}};
}
