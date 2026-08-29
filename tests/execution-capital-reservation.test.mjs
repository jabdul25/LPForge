import assert from 'node:assert/strict';
import test from 'node:test';
import {assessExecutionCapitalReservation} from '../.build/packages/db/src/index.js';

const L=100_000_000n;
const request={planId:'plan',ownerAddress:'owner',poolAddress:'pool',capitalLamports:10n*L,walletLamports:30n*L,reserveLamports:1n*L,maxPortfolioLamports:50n*L,maxPoolLamports:50n*L,maxTokenLamports:50n*L,maxInitialPositionLamports:50n*L,now:'2026-08-16T00:00:00.000Z'};
const facts={tokenMint:'token',deployedLamports:20n*L,reservedLamports:0n,poolDeployedLamports:20n*L,poolReservedLamports:0n,tokenDeployedLamports:20n*L,tokenReservedLamports:0n};

test('wallet liquidity does not subtract capital already deployed into LP twice',()=>{
  const result=assessExecutionCapitalReservation({request,...facts});
  assert.equal(result.approved,true);
  assert.equal(result.diagnostics.walletDeployableLamports,29n*L);
  assert.equal(result.diagnostics.projectedPortfolioLamports,30n*L);
  assert.deepEqual(result.reasonCodes,[]);
});
test('wallet reserve, portfolio, pool, and token caps each retain specific block reasons',()=>{
  const wallet=assessExecutionCapitalReservation({request:{...request,capitalLamports:30n*L},...facts});
  assert.ok(wallet.reasonCodes.includes('P6_CAPITAL_WALLET_RESERVE_LIMIT'));
  assert.ok(wallet.reasonCodes.includes('P6_CAPITAL_WALLET_OR_PORTFOLIO_LIMIT'));
  const portfolio=assessExecutionCapitalReservation({request:{...request,maxPortfolioLamports:29n*L},...facts});
  assert.ok(portfolio.reasonCodes.includes('P6_CAPITAL_PORTFOLIO_LIMIT'));
  const pool=assessExecutionCapitalReservation({request:{...request,maxPoolLamports:29n*L},...facts});
  assert.ok(pool.reasonCodes.includes('P6_CAPITAL_POOL_LIMIT'));
  const token=assessExecutionCapitalReservation({request:{...request,maxTokenLamports:29n*L},...facts});
  assert.ok(token.reasonCodes.includes('P6_CAPITAL_TOKEN_LIMIT'));
});
test('reservation diagnostics expose independent wallet and exposure projections',()=>{
  const result=assessExecutionCapitalReservation({request,...facts});
  assert.deepEqual(result.diagnostics,{walletBalanceLamports:30n*L,walletReserveLamports:1n*L,pendingCashReservationLamports:0n,walletDeployableLamports:29n*L,deployedPortfolioLamports:20n*L,reservedPortfolioLamports:0n,requestedLamports:10n*L,projectedPortfolioLamports:30n*L,poolCurrentLamports:20n*L,poolReservedLamports:0n,poolProjectedLamports:30n*L,poolLimitLamports:50n*L,tokenCurrentLamports:20n*L,tokenReservedLamports:0n,tokenProjectedLamports:30n*L,tokenLimitLamports:50n*L});
});
