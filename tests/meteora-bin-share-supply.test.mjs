import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBin} from '../.build/packages/meteora/src/index.js';

const stamp={slot:1n,observedAt:'2026-08-22T00:00:00.000Z'};
const bn=(value)=>({toString:()=>value});

test('normalizes the Meteora SDK supply BN exactly for the 5pg production shape',()=>{
  const bin=normalizeBin('5pgJo5izARVfbXWS8P1dEjNstpsamEjTS5N1oZqNv8Ao',{binId:-436,xAmount:bn('0'),yAmount:bn('2582392845'),supply:bn('47593000067008977619962158185'),price:'0.01305813128887906097'},stamp);
  assert.equal(bin.liquiditySupply,'47593000067008977619962158185');
  assert.equal(bin.shareSupplyDiagnostic,undefined);
});

test('normalizes the Meteora SDK supply BN exactly for the FxPP production shape',()=>{
  const bin=normalizeBin('FxPPZGPiTNYzgdMkNgAkA8QRZjNxurjBo7JgPt9z4T5X',{binId:-536,xAmount:bn('0'),yAmount:bn('1978588702'),supply:bn('36497720608719997507383657959'),price:'0.004827737549564282275'},stamp);
  assert.equal(bin.liquiditySupply,'36497720608719997507383657959');
  assert.equal(bin.shareSupplyDiagnostic,undefined);
});

test('missing supply with token inventory is explicit and fail-closed',()=>{
  const bin=normalizeBin('P',{binId:1,xAmount:bn('1'),yAmount:bn('0'),price:'1'},stamp);
  assert.equal(bin.liquiditySupply,undefined);
  assert.equal(bin.shareSupplyDiagnostic,'BIN_SHARE_SUPPLY_MISSING_WITH_TOKEN_INVENTORY');
});

test('genuine zero stays zero; invalid supply is absent and diagnosed',()=>{
  assert.equal(normalizeBin('P',{binId:1,xAmount:bn('0'),yAmount:bn('0'),supply:bn('0'),price:'1'},stamp).liquiditySupply,'0');
  const invalid=normalizeBin('P',{binId:1,xAmount:bn('1'),yAmount:bn('0'),supply:{toString:()=> '[object Object]'},price:'1'},stamp);
  assert.equal(invalid.liquiditySupply,undefined);
  assert.equal(invalid.shareSupplyDiagnostic,'BIN_SHARE_SUPPLY_INVALID');
});
