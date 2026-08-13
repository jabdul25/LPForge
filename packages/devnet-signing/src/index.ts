// LPFORGE_PHASE5_EXECUTION_MODULE
import { Keypair, Transaction } from '@solana/web3.js';
import { assertAuthority, type ExecutionAuthority } from '../../execution-contracts/src/index.js';
import type { ExecutionRiskDecision } from '../../execution-risk/src/index.js';
export interface EphemeralDevnetSignerHarness {publicKeyAddress:string;backendId:'ephemeral-devnet';createEphemeralReceiverAddress():string;signLegacyTransaction(transaction:Transaction,input:{authority:ExecutionAuthority;riskDecision:ExecutionRiskDecision;transactionId:string;signedAt:string}):Uint8Array;}
export function createEphemeralDevnetSignerHarness(input:{cluster:'devnet'|'mainnet-beta';allowEphemeralSigner:boolean}):EphemeralDevnetSignerHarness{
  if(input.cluster!=='devnet')throw new Error('LPFORGE_EPHEMERAL_SIGNER_DEVNET_ONLY');if(!input.allowEphemeralSigner)throw new Error('LPFORGE_EPHEMERAL_SIGNER_EXPLICIT_ENABLE_REQUIRED');const keypair=Keypair.generate();
  return{publicKeyAddress:keypair.publicKey.toBase58(),backendId:'ephemeral-devnet',createEphemeralReceiverAddress(){return Keypair.generate().publicKey.toBase58();},signLegacyTransaction(transaction,ctx){assertAuthority(ctx.authority,['DEVNET_SIGN','DEVNET_SUBMIT'],ctx.signedAt);if(ctx.authority.cluster!=='devnet')throw new Error('LPFORGE_EPHEMERAL_SIGNER_DEVNET_ONLY');if(ctx.riskDecision.decision!=='APPROVE'||!ctx.riskDecision.permitId||!ctx.riskDecision.expiresAt)throw new Error('LPFORGE_DEVNET_SIGN_RISK_PERMIT_REQUIRED');if(Date.parse(ctx.riskDecision.expiresAt)<=Date.parse(ctx.signedAt))throw new Error('LPFORGE_DEVNET_SIGN_RISK_PERMIT_EXPIRED');transaction.partialSign(keypair);return transaction.serialize({requireAllSignatures:false,verifySignatures:true});}};
}
