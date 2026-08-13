import fs from 'node:fs';
import path from 'node:path';
const roots=['apps','packages'];
const forbidden=[/sendTransaction\s*\(/,/sendRawTransaction\s*\(/,/Keypair\.fromSecretKey\s*\(/,/initializePositionAndAddLiquidityByStrategy\s*\(/,/addLiquidityByStrategy\s*\(/,/removeLiquidity\s*\(/,/rebalanceLiquidity\s*\(/,/\.swap\s*\(/];
const allowedMentions=new Set(['packages/meteora/src/index.ts']);
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=roots.flatMap(r=>walk(r)).filter(f=>f.endsWith('.ts'));
for(const file of files){const rel=file.replaceAll('\\','/');if(allowedMentions.has(rel))continue;const text=fs.readFileSync(file,'utf8');if(text.includes('LPFORGE_PHASE5_EXECUTION_MODULE')||text.includes('LPFORGE_PHASE6_MAINNET_MODULE'))continue;for(const rule of forbidden)if(rule.test(text)){console.error('PHASE4_BOUNDARY_FAIL',rel,rule);process.exit(1);}}
for(const secret of ['PRIVATE_KEY','SEED_PHRASE','WALLET_SECRET','WALLET_PRIVATE_KEY','SIGNER_KEYPAIR']){if(process.env[secret]){console.error('PHASE4_SECRET_MATERIAL_PRESENT',secret);process.exit(1);}}
console.log('PHASE4_BOUNDARY_OK');
