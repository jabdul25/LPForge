import fs from 'node:fs';
import path from 'node:path';
const roots=['packages','apps'];
const forbidden=[
  /Keypair\.fromSecretKey\s*\(/,
  /sendRawTransaction\s*\(/,
  /sendTransaction\s*\(/,
  /sendAndConfirmTransaction\s*\(/,
  /from\s+['"][^'"]*phase6-mainnet-signer[^'"]*['"]/,
  /from\s+['"][^'"]*execution-submission[^'"]*['"]/,
  /automaticPolicyPromotion\s*:\s*true/,
  /productionAuthorityIssued\s*:\s*true\s*[,}]/
];
let scanned=0;const bad=[];
function walk(d){if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){if(['node_modules','.build','dist'].includes(e.name))continue;walk(p);}else if(e.isFile()&&p.endsWith('.ts')){const rel=p.split(path.sep).join('/');if(!rel.includes('phase7')&&!rel.startsWith('apps/production/'))continue;scanned++;const s=fs.readFileSync(p,'utf8');for(const re of forbidden)if(re.test(s))bad.push(`${rel}:${re}`);}}}
for(const r of roots)walk(r);
if(bad.length){console.error('PHASE7_BOUNDARY_FAIL');for(const b of bad)console.error(b);process.exit(1);}
console.log(`PHASE7_BOUNDARY_OK scanned=${scanned}`);
