import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {decideLivePositionManagement,parseLivePositionManagementPolicy} from '../.build/packages/live-position-management/src/index.js';

const policy=parseLivePositionManagementPolicy({schemaVersion:1,enabled:true,outOfRangeAction:'RESHAPE',claimAccruedFees:true,missingPositionAction:'HOLD',replacementRange:'PRESERVE_WIDTH_CENTER_ACTIVE',planTtlMs:300000});
const owned={lpforgePositionId:'p',poolAddress:'POOL',positionAddress:'POS',ownerAddress:'OWNER',strategy:'CURVE',orientation:'BALANCED',lowerBinId:90,upperBinId:110,initialCapitalLamports:20_000_000n,thesisId:'thesis'};
const fact={address:'POS',pool:'POOL',owner:'OWNER',lowerBinId:90,upperBinId:110,totalXAmount:'10',totalYAmount:'20',feeX:'0',feeY:'0',stamp:{source:'METEORA_SDK',observedAt:'2026-08-13T00:00:00.000Z'},raw:{}};

test('owned-position management preserves strategy and width for an out-of-range replacement',()=>{const r=decideLivePositionManagement({policy,owned,position:fact,activeBinId:120});assert.equal(r.action,'RESHAPE');assert.deepEqual(r.replacementRange,{lowerBinId:110,upperBinId:130});});
test('owned-position management claims only real accrued fees and holds on unknown chain truth',()=>{assert.equal(decideLivePositionManagement({policy,owned,position:{...fact,feeY:'1'},activeBinId:100}).action,'CLAIM');assert.equal(decideLivePositionManagement({policy,owned,activeBinId:100}).action,'HOLD');});
test('lifecycle worker contains ordered replacement and chain-aware recovery gates',()=>{const src=fs.readFileSync(new URL('../packages/phase6-live-worker/src/index.ts',import.meta.url),'utf8');for(const token of ['REMOVE_OLD','AWAIT_REMOVE_RECONCILIATION','REFRESH_WALLET_TRUTH','BUILD_REPLACEMENT','getSignatureStatus','getPositionV2','P6_SEQUENCE_CHAIN_TRUTH_PENDING'])assert.match(src,new RegExp(token));assert.ok(src.indexOf('P6_MANAGEMENT_OLD_POSITION_STILL_EXISTS')<src.indexOf('BUILD_REPLACEMENT'));});
