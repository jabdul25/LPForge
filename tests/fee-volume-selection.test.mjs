import test from 'node:test';
import assert from 'node:assert/strict';
import {feeVolumeSelectionRank} from '../.build/packages/db/src/index.js';

test('a zero rolling placeholder cannot erase a populated historical fee bucket',()=>{
 const historical={source:'METEORA_API_HISTORICAL_5M',fees:33.6168,protocolFees:0,volume:6241.25,evidenceState:'MEASURED'};
 const placeholder={source:'METEORA_API_ROLLING_5M',fees:0,protocolFees:0,volume:0};
 assert.ok(feeVolumeSelectionRank(historical)<feeVolumeSelectionRank(placeholder));
});

test('a measured rolling zero remains valid rather than being treated as missing',()=>{
 const measuredZero={source:'METEORA_API_ROLLING_5M',fees:0,protocolFees:0,volume:0,evidenceState:'MEASURED'};
 const partialHistorical={source:'METEORA_API_HISTORICAL_5M',fees:0,protocolFees:0,volume:0,evidenceState:'PARTIAL'};
 assert.ok(feeVolumeSelectionRank(measuredZero)<feeVolumeSelectionRank(partialHistorical));
});

test('a measured rolling observation wins over older populated history for one bucket',()=>{
 const rolling={source:'METEORA_API_ROLLING_5M',fees:4,protocolFees:0,volume:1200,evidenceState:'MEASURED'};
 const historical={source:'METEORA_API_HISTORICAL_5M',fees:3,protocolFees:0,volume:1000,evidenceState:'MEASURED'};
 assert.equal(feeVolumeSelectionRank(rolling),feeVolumeSelectionRank(historical));
});
