// LPFORGE_PHASE6_MAINNET_MODULE
import {createPrivateKey,sign as signEd25519} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Keypair} from '@solana/web3.js';
import {assertPhase6Authority,type Phase6Authority,type Phase6CanaryTicket} from '../../phase6-contracts/src/index.js';

export interface MainnetSignerBackend {
  backendId:string;
  publicKeyAddress:string;
  clusterLock:'mainnet-beta';
  custodyMode:'HARDWARE'|'REMOTE_KMS'|'LOCAL_ENCRYPTED_KEYSTORE'|'LOCAL_KEYPAIR_FILE'|'LOCAL_PRIVATE_KEY';
  secretExportable:false;
  signMessage(message:Uint8Array,context:{ticketId:string;transactionId:string;cluster:'mainnet-beta'}):Promise<Uint8Array>;
}

export interface RemoteKmsHttpSignerConfig {backendId:string;publicKeyAddress:string;endpoint:string;authorizationToken:string;timeoutMs?:number;}
export interface LocalKeypairFileSignerConfig {backendId:string;publicKeyAddress:string;keypairPath:string;}
export interface LocalPrivateKeySignerConfig {backendId:string;publicKeyAddress:string;privateKeyBase58:string;}
export type RemoteKmsFetch=(input:string,init:{method:'POST';headers:Record<string,string>;body:string;signal:AbortSignal})=>Promise<{ok:boolean;status:number;json():Promise<unknown>}>;
function requiredRemoteText(name:string,value:string){if(!value.trim())throw new Error(`LPFORGE_P6_REMOTE_SIGNER_${name}_REQUIRED`);return value.trim();}
function base64(bytes:Uint8Array){let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);}
function fromBase64(value:string){const text=atob(value);return Uint8Array.from(text,char=>char.charCodeAt(0));}
function decodeBase58(value:string){const source=value.trim();if(!source||source.length>128)throw new Error('LPFORGE_P6_LOCAL_SIGNER_PRIVATE_KEY_FORMAT');const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n;for(const char of source){const index=alphabet.indexOf(char);if(index<0)throw new Error('LPFORGE_P6_LOCAL_SIGNER_PRIVATE_KEY_FORMAT');n=n*58n+BigInt(index);}const bytes:number[]=[];while(n>0n){bytes.push(Number(n&255n));n>>=8n;}for(const char of source){if(char!=='1')break;bytes.push(0);}return Uint8Array.from(bytes.reverse());}
function localKeypairFile(config:LocalKeypairFileSignerConfig){if(!config.keypairPath.trim())throw new Error('LPFORGE_P6_LOCAL_SIGNER_KEYPAIR_PATH_REQUIRED');const keypairPath=resolve(config.keypairPath.trim());let stat;try{stat=lstatSync(keypairPath);}catch{throw new Error('LPFORGE_P6_LOCAL_SIGNER_KEYPAIR_FILE_UNREADABLE');}if(!stat.isFile()||stat.isSymbolicLink())throw new Error('LPFORGE_P6_LOCAL_SIGNER_KEYPAIR_FILE_INVALID');if((stat.mode&0o077)!==0)throw new Error('LPFORGE_P6_LOCAL_SIGNER_KEYPAIR_FILE_PERMISSIONS');let parsed:unknown;try{parsed=JSON.parse(readFileSync(keypairPath,'utf8'));}catch{throw new Error('LPFORGE_P6_LOCAL_SIGNER_KEYPAIR_FILE_INVALID');}if(!Array.isArray(parsed)||parsed.length!==64||parsed.some(value=>!Number.isInteger(value)||value<0||value>255))throw new Error('LPFORGE_P6_LOCAL_SIGNER_KEYPAIR_FORMAT');try{return Keypair.fromSecretKey(Uint8Array.from(parsed));}catch{throw new Error('LPFORGE_P6_LOCAL_SIGNER_KEYPAIR_INVALID');}}
function ed25519PrivateKey(secretKey:Uint8Array){const seed=secretKey.slice(0,32);const der=Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20,...seed]);return createPrivateKey({key:der,format:'der',type:'pkcs8'});}
/** Local signer compatible with the existing LP repositories' KEYPAIR_PATH model. */
export function createLocalKeypairFileSigner(config:LocalKeypairFileSignerConfig):MainnetSignerBackend{const backendId=requiredRemoteText('BACKEND_ID',config.backendId),publicKeyAddress=requiredRemoteText('PUBLIC_KEY',config.publicKeyAddress),keypair=localKeypairFile(config);if(keypair.publicKey.toBase58()!==publicKeyAddress)throw new Error('LPFORGE_P6_LOCAL_SIGNER_OWNER_MISMATCH');const privateKey=ed25519PrivateKey(keypair.secretKey);return{backendId,publicKeyAddress,clusterLock:'mainnet-beta',custodyMode:'LOCAL_KEYPAIR_FILE',secretExportable:false,async signMessage(message){return new Uint8Array(signEd25519(null,message,privateKey));}};}
/** Local Base58 private-key signer compatible with LPERS/Meribot. The secret is read only from ignored .env.execution. */
export function createLocalPrivateKeySigner(config:LocalPrivateKeySignerConfig):MainnetSignerBackend{const backendId=requiredRemoteText('BACKEND_ID',config.backendId),publicKeyAddress=requiredRemoteText('PUBLIC_KEY',config.publicKeyAddress);let keypair:Keypair;try{const secret=decodeBase58(config.privateKeyBase58);if(secret.byteLength!==64)throw new Error();keypair=Keypair.fromSecretKey(secret);}catch{throw new Error('LPFORGE_P6_LOCAL_SIGNER_PRIVATE_KEY_INVALID');}if(keypair.publicKey.toBase58()!==publicKeyAddress)throw new Error('LPFORGE_P6_LOCAL_SIGNER_OWNER_MISMATCH');const privateKey=ed25519PrivateKey(keypair.secretKey);return{backendId,publicKeyAddress,clusterLock:'mainnet-beta',custodyMode:'LOCAL_PRIVATE_KEY',secretExportable:false,async signMessage(message){return new Uint8Array(signEd25519(null,message,privateKey));}};}
/**
 * Adapter for an operator-managed remote Ed25519 signer/KMS service.
 * The private key never enters LPForge. The remote endpoint must accept the
 * documented request and return {"signatureBase64":"..."}; it must bind the
 * request to the supplied mainnet ticket and transaction identifier.
 */
export function createRemoteKmsHttpSigner(config:RemoteKmsHttpSignerConfig,fetchFn:RemoteKmsFetch=fetch as unknown as RemoteKmsFetch):MainnetSignerBackend{
  const backendId=requiredRemoteText('BACKEND_ID',config.backendId),publicKeyAddress=requiredRemoteText('PUBLIC_KEY',config.publicKeyAddress),authorizationToken=requiredRemoteText('AUTH_TOKEN',config.authorizationToken);let endpoint:URL;try{endpoint=new URL(requiredRemoteText('URL',config.endpoint));}catch{throw new Error('LPFORGE_P6_REMOTE_SIGNER_URL_INVALID');}if(endpoint.protocol!=='https:')throw new Error('LPFORGE_P6_REMOTE_SIGNER_HTTPS_REQUIRED');const timeoutMs=config.timeoutMs??5000;if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw new Error('LPFORGE_P6_REMOTE_SIGNER_TIMEOUT');return{backendId,publicKeyAddress,clusterLock:'mainnet-beta',custodyMode:'REMOTE_KMS',secretExportable:false,async signMessage(message,context){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetchFn(endpoint.toString(),{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${authorizationToken}`},body:JSON.stringify({version:1,algorithm:'ed25519',cluster:'mainnet-beta',publicKeyAddress,messageBase64:base64(message),ticketId:context.ticketId,transactionId:context.transactionId}),signal:controller.signal});if(!response.ok)throw new Error(`LPFORGE_P6_REMOTE_SIGNER_HTTP_${response.status}`);const value=await response.json();if(!value||typeof value!=='object'||typeof (value as {signatureBase64?:unknown}).signatureBase64!=='string')throw new Error('LPFORGE_P6_REMOTE_SIGNER_RESPONSE');const signature=fromBase64((value as {signatureBase64:string}).signatureBase64);if(signature.byteLength!==64)throw new Error('LPFORGE_P6_REMOTE_SIGNER_SIGNATURE_LENGTH');return signature;}finally{clearTimeout(timer);}}};}

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
