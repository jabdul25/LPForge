// LPFORGE_PHASE6_MAINNET_MODULE
import {assertPhase6Authority,type Phase6Authority,type Phase6CanaryTicket} from '../../phase6-contracts/src/index.js';

export interface MainnetSignerBackend {
  backendId:string;
  publicKeyAddress:string;
  clusterLock:'mainnet-beta';
  custodyMode:'HARDWARE'|'REMOTE_KMS'|'LOCAL_ENCRYPTED_KEYSTORE';
  secretExportable:false;
  signMessage(message:Uint8Array,context:{ticketId:string;transactionId:string;cluster:'mainnet-beta'}):Promise<Uint8Array>;
}

export interface AuxiliaryMainnetSignerBackend {
  backendId:string;
  publicKeyAddress:string;
  clusterLock:'mainnet-beta';
  custodyMode:'EPHEMERAL_MEMORY';
  purpose:'POSITION_ACCOUNT';
  secretExportable:false;
  signMessage(message:Uint8Array,context:{ticketId:string;transactionId:string;cluster:'mainnet-beta';purpose:'POSITION_ACCOUNT'}):Promise<Uint8Array>;
}

export interface MainnetSignableEnvelope {
  serializeMessage():Uint8Array;
  attachSignature(publicKeyAddress:string,signature:Uint8Array):void;
}

export interface MainnetSignerAudit {
  ticketId:string;
  transactionId:string;
  backendId:string;
  publicKeyAddress:string;
  custodyMode:MainnetSignerBackend['custodyMode']|AuxiliaryMainnetSignerBackend['custodyMode'];
  purpose:'OWNER'|'POSITION_ACCOUNT';
  signedAt:string;
  messageLength:number;
  signatureLength:number;
  secretExportable:false;
}

function assertCommon(input:{authority:Phase6Authority;ticket:Phase6CanaryTicket;signedAt:string}){
  assertPhase6Authority(input.authority,['MAINNET_CANARY_OPEN','MAINNET_CANARY_MANAGE','MAINNET_CANARY_CLOSE'],input.signedAt);
  if(input.authority.ticketId!==input.ticket.ticketId)throw new Error('LPFORGE_P6_SIGN_TICKET_MISMATCH');
  if(Date.parse(input.ticket.expiresAt)<=Date.parse(input.signedAt))throw new Error('LPFORGE_P6_SIGN_TICKET_EXPIRED');
}

export async function signMainnetCanary(input:{authority:Phase6Authority;ticket:Phase6CanaryTicket;transactionId:string;requiredSignerAddresses:string[];backend:MainnetSignerBackend;envelope:MainnetSignableEnvelope;signedAt:string}):Promise<MainnetSignerAudit>{
  assertCommon(input);
  if(input.backend.clusterLock!=='mainnet-beta')throw new Error('LPFORGE_P6_SIGN_CLUSTER_LOCK');
  if(input.backend.secretExportable!==false)throw new Error('LPFORGE_P6_SIGN_SECRET_EXPORTABLE');
  if(input.backend.publicKeyAddress!==input.ticket.ownerAddress)throw new Error('LPFORGE_P6_SIGN_OWNER_MISMATCH');
  if(!input.requiredSignerAddresses.includes(input.backend.publicKeyAddress))throw new Error('LPFORGE_P6_SIGNER_NOT_REQUIRED');
  const message=input.envelope.serializeMessage();
  const sig=await input.backend.signMessage(message,{ticketId:input.ticket.ticketId,transactionId:input.transactionId,cluster:'mainnet-beta'});
  if(sig.byteLength!==64)throw new Error('LPFORGE_P6_SIGNATURE_LENGTH');
  input.envelope.attachSignature(input.backend.publicKeyAddress,sig);
  return{ticketId:input.ticket.ticketId,transactionId:input.transactionId,backendId:input.backend.backendId,publicKeyAddress:input.backend.publicKeyAddress,custodyMode:input.backend.custodyMode,purpose:'OWNER',signedAt:input.signedAt,messageLength:message.byteLength,signatureLength:sig.byteLength,secretExportable:false};
}

export async function signMainnetCanaryWithAuxiliaries(input:{authority:Phase6Authority;ticket:Phase6CanaryTicket;transactionId:string;requiredSignerAddresses:string[];ownerBackend:MainnetSignerBackend;auxiliaryBackends?:AuxiliaryMainnetSignerBackend[]|undefined;envelope:MainnetSignableEnvelope;signedAt:string}):Promise<MainnetSignerAudit[]>{
  assertCommon(input);
  const auxiliaryBackends=input.auxiliaryBackends??[];
  const required=[...new Set(input.requiredSignerAddresses)];
  if(required.length!==input.requiredSignerAddresses.length)throw new Error('LPFORGE_P6_DUPLICATE_REQUIRED_SIGNER');
  if(!required.includes(input.ticket.ownerAddress))throw new Error('LPFORGE_P6_OWNER_SIGNER_REQUIRED');
  const provided=[input.ownerBackend.publicKeyAddress,...auxiliaryBackends.map(x=>x.publicKeyAddress)];
  if(new Set(provided).size!==provided.length)throw new Error('LPFORGE_P6_DUPLICATE_SIGNER_BACKEND');
  const missing=required.filter(x=>!provided.includes(x));
  const extras=provided.filter(x=>!required.includes(x));
  if(missing.length)throw new Error(`LPFORGE_P6_REQUIRED_SIGNER_MISSING:${missing.join(',')}`);
  if(extras.length)throw new Error(`LPFORGE_P6_UNEXPECTED_SIGNER_BACKEND:${extras.join(',')}`);
  const audits:MainnetSignerAudit[]=[];
  audits.push(await signMainnetCanary({authority:input.authority,ticket:input.ticket,transactionId:input.transactionId,requiredSignerAddresses:required,backend:input.ownerBackend,envelope:input.envelope,signedAt:input.signedAt}));
  const message=input.envelope.serializeMessage();
  for(const backend of auxiliaryBackends){
    if(backend.clusterLock!=='mainnet-beta')throw new Error('LPFORGE_P6_AUX_SIGN_CLUSTER_LOCK');
    if(backend.secretExportable!==false)throw new Error('LPFORGE_P6_AUX_SIGN_SECRET_EXPORTABLE');
    if(backend.custodyMode!=='EPHEMERAL_MEMORY'||backend.purpose!=='POSITION_ACCOUNT')throw new Error('LPFORGE_P6_AUX_SIGN_PURPOSE');
    if(backend.publicKeyAddress===input.ticket.ownerAddress)throw new Error('LPFORGE_P6_AUX_SIGN_OWNER_FORBIDDEN');
    if(!required.includes(backend.publicKeyAddress))throw new Error('LPFORGE_P6_AUX_SIGNER_NOT_REQUIRED');
    const sig=await backend.signMessage(message,{ticketId:input.ticket.ticketId,transactionId:input.transactionId,cluster:'mainnet-beta',purpose:'POSITION_ACCOUNT'});
    if(sig.byteLength!==64)throw new Error('LPFORGE_P6_AUX_SIGNATURE_LENGTH');
    input.envelope.attachSignature(backend.publicKeyAddress,sig);
    audits.push({ticketId:input.ticket.ticketId,transactionId:input.transactionId,backendId:backend.backendId,publicKeyAddress:backend.publicKeyAddress,custodyMode:backend.custodyMode,purpose:'POSITION_ACCOUNT',signedAt:input.signedAt,messageLength:message.byteLength,signatureLength:sig.byteLength,secretExportable:false});
  }
  return audits;
}
