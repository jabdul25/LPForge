import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveReceiptBackedEntryBasis,deriveReceiptBoundSolContribution} from '../.build/packages/entry-capital-basis/src/index.js';
import {deriveLpPositionMarkToMarket,derivePositionEconomics} from '../.build/packages/live-exit-governor/src/index.js';

test('chunked entry excludes ATA and zero-balance WSOL rent from receipt-backed capital',()=>{
  const r=deriveReceiptBackedEntryBasis({
    requestedLiquidityCapitalLamports:30_000_000n,
    fundingPrincipalLamports:9_652_243n,
    fundedPairedTokenRaw:536_443_931_418n,
    openSolPrincipalLamports:19_971_848n,
    depositedPairedTokenRaw:525_822_840_971n,
    executionCostLamports:25_453n,
    recoverableRentDebitsLamports:3_711_138n,
    recoverableRentRefundsLamports:0n,
  });
  assert.equal(r.managedEconomicContributionLamports,29_624_091n);
  assert.equal(r.lpPositionPrincipalLamports,29_432_985n);
  assert.equal(r.residualPairedTokenPrincipalLamports,191_106n);
  assert.equal(r.unclassifiedLamports,0n);
});

test('parsed ATA creation is removed from native principal at receipt level',()=>{
  const receipt={state:'CONFIRMED_SUCCESS',signature:'rent',feeLamports:0n,staticAccountKeys:['OWNER','ATA'],loadedWritableAddresses:[],loadedReadonlyAddresses:[],resolvedAccountKeys:['OWNER','ATA'],preBalancesLamports:[10_000_000n,0n],postBalancesLamports:[8_144_431n,1_855_569n],preTokenBalances:[],postTokenBalances:[],outerInstructions:[{programId:'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',parsed:{type:'createIdempotent',info:{account:'ATA',wallet:'OWNER'}}}],innerInstructions:[],logMessages:[]};
  const r=deriveReceiptBoundSolContribution({receipt,ownerAddress:'OWNER',feePayerAddress:'OWNER'});
  assert.equal(r?.principalLamports,0n);
  assert.equal(r?.recoverableRentDebitsLamports,1_855_569n);
});

test('a receipt-known position-account rent lock is never principal',()=>{
  const receipt={state:'CONFIRMED_SUCCESS',signature:'position-rent',feeLamports:0n,staticAccountKeys:['OWNER','POSITION'],loadedWritableAddresses:[],loadedReadonlyAddresses:[],resolvedAccountKeys:['OWNER','POSITION'],preBalancesLamports:[80_000_000n,0n],postBalancesLamports:[1_000_000n,57_908_952n],preTokenBalances:[],postTokenBalances:[],outerInstructions:[{programId:'11111111111111111111111111111111',parsed:{type:'createAccount',info:{newAccount:'POSITION',source:'OWNER'}}}],innerInstructions:[],logMessages:[]};
  const r=deriveReceiptBoundSolContribution({receipt,ownerAddress:'OWNER',feePayerAddress:'OWNER',positionAddress:'POSITION'});
  assert.equal(r?.principalLamports,21_091_048n);
  assert.equal(r?.recoverableRentDebitsLamports,57_908_952n);
});

test('a pre-existing owner WSOL account refund is removed from funding principal',()=>{
  const receipt={state:'CONFIRMED_SUCCESS',signature:'wsol-refund',feeLamports:0n,staticAccountKeys:['OWNER','WSOL'],loadedWritableAddresses:[],loadedReadonlyAddresses:[],resolvedAccountKeys:['OWNER','WSOL'],preBalancesLamports:[10_000_000n,1_855_569n],postBalancesLamports:[3_185_569n,0n],preTokenBalances:[{accountIndex:1,resolvedAccountAddress:'WSOL',mint:'So11111111111111111111111111111111111111112',owner:'OWNER',rawAmount:0n,decimals:9}],postTokenBalances:[],outerInstructions:[{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',parsed:{type:'closeAccount',info:{account:'WSOL',destination:'OWNER',owner:'OWNER'}}}],innerInstructions:[],logMessages:[]};
  const r=deriveReceiptBoundSolContribution({receipt,ownerAddress:'OWNER',feePayerAddress:'OWNER'});
  assert.equal(r?.principalLamports,8_670_000n);
  assert.equal(r?.recoverableRentRefundsLamports,1_855_569n);
});

test('paired-token funding and direct SOL are counted once while rent remains outside both bases',()=>{
  const r=deriveReceiptBackedEntryBasis({requestedLiquidityCapitalLamports:30_000_000n,fundingPrincipalLamports:8_670_942n,fundedPairedTokenRaw:422_800_486_519n,openSolPrincipalLamports:21_329_046n,depositedPairedTokenRaw:407_260_210_345n,executionCostLamports:30_147n,recoverableRentDebitsLamports:54_090_153n,recoverableRentRefundsLamports:1_855_569n});
  assert.equal(r.managedEconomicContributionLamports,29_999_988n);
  assert.equal(r.lpPositionPrincipalLamports,29_681_282n);
  assert.equal(r.residualPairedTokenPrincipalLamports,318_706n);
});

test('an impossible paired-token debit fails closed instead of manufacturing a basis',()=>{
  const r=deriveReceiptBackedEntryBasis({requestedLiquidityCapitalLamports:30n,fundingPrincipalLamports:10n,fundedPairedTokenRaw:5n,openSolPrincipalLamports:20n,depositedPairedTokenRaw:6n,executionCostLamports:0n,recoverableRentDebitsLamports:0n,recoverableRentRefundsLamports:0n});
  assert.deepEqual(r.reasonCodes,['ENTRY_BASIS_PAIRED_TOKEN_DEBIT_EXCEEDS_FUNDED']);
});

test('LP-local and managed-economic marks remain explicitly separate',()=>{
  const pool={token_x:{address:'TOKEN',decimals:6,price:2},token_y:{address:'So11111111111111111111111111111111111111112',decimals:9,price:100}};
  const position={totalXAmount:'1000000',totalYAmount:'100000000',feeX:'0',feeY:'0',claimedFeeX:'0',claimedFeeY:'0'};
  const lp=deriveLpPositionMarkToMarket({position,pool,lpPositionPrincipalLamports:100_000_000n,observedAt:'2026-09-07T00:00:00.000Z'});
  const managed=derivePositionEconomics({position,pool,initialCapitalLamports:100_000_000n,actualContributedLamports:100_000_000n,attributedWalletInventory:[{tokenMint:'TOKEN',tokenAmountRaw:'1000000'}],observedAt:'2026-09-07T00:00:00.000Z'});
  assert.equal(lp.netReturnFraction,.2);
  assert.equal(managed.netReturnFraction,.4);
  assert.equal(managed.reasonCodes.includes('EXIT_VALUATION_COMPLETE_MANAGED_NAV'),true);
});

test('a required receipt basis cannot silently fall back to requested capital',()=>{
  const pool={token_x:{address:'TOKEN',decimals:6,price:2},token_y:{address:'So11111111111111111111111111111111111111112',decimals:9,price:100}};
  const position={totalXAmount:'0',totalYAmount:'100000000',feeX:'0',feeY:'0',claimedFeeX:'0',claimedFeeY:'0'};
  const r=derivePositionEconomics({position,pool,initialCapitalLamports:100_000_000n,requireReceiptProvenContribution:true,observedAt:'2026-09-07T00:00:00.000Z'});
  assert.equal(r.evidenceState,'UNAVAILABLE');
  assert.deepEqual(r.reasonCodes,['EXIT_VALUATION_ENTRY_BASIS_UNPROVEN']);
});
