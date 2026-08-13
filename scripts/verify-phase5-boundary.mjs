import fs from 'node:fs';
import path from 'node:path';
const roots=['apps','packages'];
const allowedSendPrefixes=['packages/execution-submission/'];
const allowedSignerPrefixes=['packages/signer/','packages/devnet-signing/'];
const allowedMeteoraMutationPrefixes=['packages/meteora-execution/'];
function walk(dir){if(!fs.existsSync(dir))return[];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=roots.flatMap(walk).filter(f=>f.endsWith('.ts'));
for(const file of files){const rel=file.replaceAll('\\','/');const text=fs.readFileSync(file,'utf8');
  if((/sendTransaction\s*\(/.test(text)||/sendRawTransaction\s*\(/.test(text))&&!allowedSendPrefixes.some(p=>rel.startsWith(p))){console.error('PHASE5_UNGUARDED_SEND_PATH',rel);process.exit(1);}
  if(/Keypair\.fromSecretKey\s*\(/.test(text)){console.error('PHASE5_SECRET_KEY_LOADER_PROHIBITED',rel);process.exit(1);}
  if(/Keypair\.generate\s*\(/.test(text)&&!rel.startsWith('packages/devnet-signing/')){console.error('PHASE5_KEYPAIR_GENERATION_OUTSIDE_DEVNET_HARNESS',rel);process.exit(1);}
  if((/initializePositionAndAddLiquidityByStrategy\s*\(/.test(text)||/addLiquidityByStrategy\s*\(/.test(text)||/removeLiquidity\s*\(/.test(text)||/claimAllRewardsByPosition\s*\(/.test(text))&&!allowedMeteoraMutationPrefixes.some(p=>rel.startsWith(p))){console.error('PHASE5_METEORA_MUTATION_OUTSIDE_EXECUTION_ADAPTER',rel);process.exit(1);}
  if(/sendAndConfirmTransaction\s*\(/.test(text)){console.error('PHASE5_SEND_AND_CONFIRM_PROHIBITED',rel);process.exit(1);}
  if((/\bsignTransaction\s*\(/.test(text)||/\.partialSign\s*\(/.test(text))&&!allowedSignerPrefixes.some(p=>rel.startsWith(p))&&!rel.startsWith('packages/execution-submission/')){console.error('PHASE5_SIGNING_OUTSIDE_SIGNER_BOUNDARY',rel);process.exit(1);}
}
const envText=fs.readFileSync('.env.example','utf8');if(!/^LIVE_SIGNING=false$/m.test(envText)||!/^LPFORGE_LIVE_EXECUTION=false$/m.test(envText)||!/^LPFORGE_MAINNET_CANARY=false$/m.test(envText)){console.error('PHASE5_ENV_DEFAULTS_UNSAFE');process.exit(1);}
for(const secret of ['PRIVATE_KEY','SEED_PHRASE','WALLET_SECRET','WALLET_PRIVATE_KEY','SIGNER_KEYPAIR']){if(process.env[secret]){console.error('PHASE5_RAW_SECRET_ENV_PROHIBITED',secret);process.exit(1);}}
console.log(`PHASE5_BOUNDARY_OK scanned=${files.length}`);
