import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require=createRequire(import.meta.url);
const {Connection,Keypair,PublicKey,sendAndConfirmTransaction}=require('@solana/web3.js');
const DLMM=require('@meteora-ag/dlmm');
const sdkRequire=createRequire(require.resolve('@meteora-ag/dlmm'));
const BN=sdkRequire('bn.js');
const {buildOpenPositionTransaction,buildRemoveLiquidityTransactions}=await import(pathToFileURL(new URL('../.build/packages/meteora-execution/src/index.js',import.meta.url).pathname));

const rpc=process.env.SOLANA_RPC_HTTP_URL;
const pairAddress=process.env.LPFORGE_LOCAL_METEORA_PAIR_ADDRESS;
const mintXAddress=process.env.LPFORGE_LOCAL_METEORA_TOKEN_X;
const mintYAddress=process.env.LPFORGE_LOCAL_METEORA_TOKEN_Y;
const payerPath=process.env.LPFORGE_LOCAL_VALIDATOR_PAYER_KEYPAIR;
const programAddress=process.env.LPFORGE_LOCAL_METEORA_PROGRAM_ID??'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
if(!rpc||!pairAddress||!mintXAddress||!mintYAddress||!payerPath)throw new Error('LPFORGE_LOCAL_METEORA_CONFIG_REQUIRED');
const parsed=new URL(rpc);
if(!['127.0.0.1','localhost','::1'].includes(parsed.hostname))throw new Error('LPFORGE_LOCAL_METEORA_LOOPBACK_REQUIRED');
if(process.env.LPFORGE_LIVE_EXECUTION==='true'||process.env.LPFORGE_MAINNET_CANARY==='true')throw new Error('LPFORGE_LOCAL_METEORA_MAINNET_FLAGS_PROHIBITED');
const connection=new Connection(rpc,'confirmed');
const programId=new PublicKey(programAddress);
const programInfo=await connection.getAccountInfo(programId,'confirmed');
if(!programInfo?.executable)throw new Error('LPFORGE_LOCAL_METEORA_PROGRAM_NOT_EXECUTABLE');
const pair=new PublicKey(pairAddress),mintX=new PublicKey(mintXAddress),mintY=new PublicKey(mintYAddress);
const payer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerPath,'utf8'))));
const pool=await DLMM.create(connection,pair,{cluster:'localhost',programId});
const position=Keypair.generate();
let opened=false;
const signatures=[];
async function simulateAndSend(tx,signers,label){
 tx.feePayer=payer.publicKey;tx.recentBlockhash=(await connection.getLatestBlockhash('confirmed')).blockhash;
 const sim=await connection.simulateTransaction(tx,signers);
 if(sim.value.err)throw new Error(`${label}_SIMULATION_FAILED:${JSON.stringify(sim.value.err)}:${JSON.stringify(sim.value.logs)}`);
 const signature=await sendAndConfirmTransaction(connection,tx,signers,{commitment:'confirmed'});signatures.push({label,signature,unitsConsumed:sim.value.unitsConsumed??null});return sim;
}
try{
 const openBuilt=await buildOpenPositionTransaction(pool,{userAddress:payer.publicKey.toBase58(),positionAddress:position.publicKey.toBase58(),totalXAmount:'1000000000',totalYAmount:'1000000000',lowerBinId:-10,upperBinId:10,strategy:'SPOT'});
 await simulateAndSend(openBuilt.transaction,[payer,position],'OPEN');opened=true;
 let before=await pool.getPosition(position.publicKey);
 if(before.version!==1)throw new Error(`LPFORGE_LOCAL_METEORA_POSITION_NOT_V2:${before.version}`);
 await pool.refetchStates();const activeBefore=pool.lbPair.activeId;
 const arrays=await pool.getBinArrayForSwap(true,3);
 const inAmount=new BN(50_000_000),quote=pool.swapQuote(inAmount,true,new BN(100),arrays,false,3);
 const swapTx=await pool.swap({inToken:mintX,outToken:mintY,inAmount,minOutAmount:quote.minOutAmount,lbPair:pair,user:payer.publicKey,binArraysPubkey:quote.binArraysPubkey});
 await simulateAndSend(swapTx,[payer],'SWAP');
 await pool.refetchStates();const activeAfter=pool.lbPair.activeId;
 const after=await pool.getPosition(position.publicKey);
 const closes=await buildRemoveLiquidityTransactions(pool,{userAddress:payer.publicKey.toBase58(),positionAddress:position.publicKey.toBase58(),fromBinId:after.positionData.lowerBinId,toBinId:after.positionData.upperBinId,bps:10000,claimAndClose:true});
 for(let i=0;i<closes.length;i++)await simulateAndSend(closes[i].transaction,[payer],`CLOSE_${i}`);
 opened=false;
 const stillExists=!!(await connection.getAccountInfo(position.publicKey,'confirmed'));
 if(stillExists)throw new Error('LPFORGE_LOCAL_METEORA_POSITION_STILL_EXISTS');
 console.log(JSON.stringify({status:'PASS',environment:'local-validator',programId:programId.toBase58(),pair:pair.toBase58(),position:position.publicKey.toBase58(),positionVersion:'V2',range:{lower:-10,upper:10},positionBefore:{x:before.positionData.totalXAmount.toString(),y:before.positionData.totalYAmount.toString()},swap:{inAmount:inAmount.toString(),outAmount:quote.outAmount.toString(),fee:quote.fee.toString(),protocolFee:quote.protocolFee.toString(),positionFeeX:after.positionData.feeX.toString(),positionFeeY:after.positionData.feeY.toString(),activeBinBefore:activeBefore,activeBinAfter:activeAfter},close:{transactionCount:closes.length,positionClosed:true},signatures,mainnetTransactionSent:false},null,2));
}catch(error){
 if(opened){
   try{const p=await pool.getPosition(position.publicKey);const closes=await buildRemoveLiquidityTransactions(pool,{userAddress:payer.publicKey.toBase58(),positionAddress:position.publicKey.toBase58(),fromBinId:p.positionData.lowerBinId,toBinId:p.positionData.upperBinId,bps:10000,claimAndClose:true});for(let i=0;i<closes.length;i++)await simulateAndSend(closes[i].transaction,[payer],`CLEANUP_${i}`);}catch{}
 }
 throw error;
}
