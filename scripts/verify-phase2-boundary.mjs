import fs from 'node:fs';
import path from 'node:path';
const roots=['apps','packages'];
const prohibited=[/sendRawTransaction\s*\(/,/sendTransaction\s*\(/,/Keypair\.fromSecretKey/,/bs58\.decode\([^)]*(secret|private|seed)/i,/initializePositionAndAddLiquidityByStrategy\s*\(/,/addLiquidityByStrategy\s*\(/,/removeLiquidity\s*\(/,/rebalanceLiquidity\s*\(/,/\.swap\s*\(/];
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap((e)=>{const p=path.join(dir,e.name);return e.isDirectory()?walk(p):[p]});}
const violations=[];
for(const root of roots)for(const file of walk(root).filter((x)=>x.endsWith('.ts'))){const text=fs.readFileSync(file,'utf8');if(text.includes('LPFORGE_PHASE5_EXECUTION_MODULE'))continue;for(const re of prohibited)if(re.test(text))violations.push(`${file}: ${re}`);}
if(violations.length){console.error('PHASE2_BOUNDARY_VIOLATION\n'+violations.join('\n'));process.exit(1);}
console.log('PHASE2_BOUNDARY_OK: research/simulation/pool-intelligence only; no signing or state-changing Meteora path found.');
