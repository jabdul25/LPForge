import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const production='packages/phase7-production-service/src/index.ts';
const db='packages/db/src/index.ts';

test('portfolio facts aggregate per pool and per token with grouped sums, never duplicate jsonb keys',()=>{
  const src=fs.readFileSync(db,'utf8');
  const at=src.indexOf('async loadPhase7PortfolioFacts(');
  const end=src.indexOf('async ',at+10);
  const fn=src.slice(at,end);
  // Multiple positions may share a pool or token. The old row-level
  // jsonb_object_agg would raise "duplicate key value" for the second row;
  // each aggregation must run over a grouped SUM subquery instead.
  assert.ok(fn.includes('GROUP BY p.address'),'positions grouped by pool');
  assert.ok(fn.includes('GROUP BY p.token_x_mint'),'positions grouped by token');
  assert.ok(fn.includes('GROUP BY pool_address'),'reservations grouped by pool');
  assert.ok(fn.includes('GROUP BY token_mint'),'reservations grouped by token');
  for(const agg of ['jsonb_object_agg(g.pool_address,g.deployed)','jsonb_object_agg(g.token_x_mint,g.deployed)','jsonb_object_agg(g.pool_address,g.reserved)','jsonb_object_agg(g.token_mint,g.reserved)'])assert.ok(fn.includes(agg),`${agg} reads the grouped subquery`);
  assert.ok(fn.includes('AND p.token_x_mint IS NOT NULL'),'null token keys excluded');
  assert.ok(fn.includes('AND pool_address IS NOT NULL')&&fn.includes('AND token_mint IS NOT NULL'),'null reservation keys excluded');
});

test('partial-entry recovery rows feed the phase-7 hold gate and recovery facts',()=>{
  const src=fs.readFileSync(db,'utf8');
  assert.match(src,/partialEntryRecoveryCount:\s*number;/,'facts interface carries the count');
  assert.ok(src.includes("SELECT count(*)::int AS n FROM execution.partial_entry_recovery WHERE state<>'RESOLVED'"),'postgres counts unresolved partial entries');
  assert.ok(src.includes('partialEntryRecoveryCount: Number(partial.rows[0]?.n ?? 0)'),'postgres result feeds the facts');
  assert.ok(src.includes('partialEntryRecoveryCount: 0,'),'memory stub stays zero');
  const service=fs.readFileSync(production,'utf8');
  assert.match(service,/recovery\.partialEntryRecoveryCount>0/,'unresolved partial entries hold phase 7');
});

test('wallet token balances join the NAV through the same pool price feed',()=>{
  const src=fs.readFileSync(production,'utf8');
  assert.match(src,/const TOKEN_PROGRAM_ID='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';/);
  const accountsAt=src.indexOf('getParsedTokenAccountsByOwner(new PublicKey(owner),{programId:new PublicKey(TOKEN_PROGRAM_ID)}');
  const pricesAt=src.indexOf('const tokenPrices=new Map<string,number>();');
  const solPriceAt=src.indexOf('const solPriceUsd=tokenPrices.get(WSOL_MINT);');
  const loopAt=src.indexOf('let walletTokenValueLamports=0n;');
  const currentAt=src.indexOf('current=BigInt(wallet)+positionValueLamports+walletTokenValueLamports+rentReserveLamports');
  const upsertAt=src.indexOf('walletTokenValueLamports:walletTokenValueLamports.toString(),valuedWalletTokens,rentReserveLamports:rentReserveLamports.toString()');
  assert.ok(accountsAt>=0,'wallet token accounts are read');
  assert.ok(accountsAt<pricesAt,'accounts are fetched before pricing');
  assert.ok(pricesAt<solPriceAt&&solPriceAt<loopAt,'prices derive from the same pool feed that values positions');
  assert.ok(loopAt<currentAt,'token value enters current equity');
  assert.ok(currentAt<upsertAt,'the persisted state records the new NAV lines');
  assert.match(src,/'POSITION_AND_WALLET_TOKENS_USD_TO_SOL_V2'/, 'valuation method v2 names both components');
  assert.match(src,/positionUsdValueToSolLamports\(usd,solPriceUsd\)/,'token USD converts through the WSOL price');
  assert.match(src,/if\(!mint\|\|!amount\|\|typeof decimals!=='number'\)continue;/,'unknown or unparsable rows are skipped, not guessed');
});

test('rent locked in open position accounts is exact recoverable book-value equity and policy precedes valuation',()=>{
  const src=fs.readFileSync(production,'utf8');
  const policyAt=src.indexOf("const policy=loadDeploymentPolicyFile(input.env.LPFORGE_EXECUTION_POLICY_PATH?.trim()||'policies/live-execution-policy.json'),capital=policy.productionCapital;");
  const accountAt=src.indexOf('connection.getAccountInfo(new PublicKey(positionAddress)');
  const rentAt=src.indexOf('const rentReserveLamports=valuations.reduce((sum,value)=>sum+value.recoverableRentLamports,0n);');
  const currentAt=src.indexOf('current=BigInt(wallet)+positionValueLamports+walletTokenValueLamports+rentReserveLamports');
  assert.ok(policyAt>=0&&rentAt>policyAt,'the policy is loaded before the equity computation');
  assert.ok(accountAt>=0&&accountAt<rentAt,'actual PositionV2 account lamports are read before valuation');
  assert.ok(rentAt<currentAt,'rent reserve joins current equity');
  assert.match(src,/recoverableRentLamports:BigInt\(account\?\.lamports\?\?0\)/,'NAV uses exact recoverable account lamports, not a policy maximum');
  assert.match(src,/rentReserveLamports:rentReserveLamports\.toString\(\)/,'rent reserve is persisted with the risk state');
});
