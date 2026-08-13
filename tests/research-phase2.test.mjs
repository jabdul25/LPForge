import test from 'node:test';
import assert from 'node:assert/strict';
import {chronologicalSplit,assertNoLookahead,evaluateExperiment,runCounterfactuals} from '../.build/packages/research/src/index.js';

test('chronological split never shuffles market time',()=>{const rows=Array.from({length:10},(_,i)=>({observedAt:`2026-08-12T00:${String(i).padStart(2,'0')}:00Z`,i}));const s=chronologicalSplit(rows);assert.equal(s.research.length,6);assert.equal(s.validation[0].i,6);assert.equal(s.test.at(-1).i,9);});
test('lookahead guard rejects post-decision observation',()=>{assert.throws(()=>assertNoLookahead('2026-08-12T00:01:00Z',[{observedAt:'2026-08-12T00:02:00Z'}]),/LPFORGE_LOOKAHEAD/);});
test('experiment output is reproducibly hashed',async()=>{const spec={id:'e1',hypothesis:'treatment improves net',primaryMetric:'net',secondaryMetrics:['dd'],controlPolicyId:'c',treatmentPolicyId:'t',createdAt:'2026-08-12T00:00:00Z'};const obs=[{episodeId:'1',policyId:'c',metrics:{net:1,dd:-2},observedAt:'2026-08-12T00:00:00Z'},{episodeId:'2',policyId:'t',metrics:{net:3,dd:-1},observedAt:'2026-08-12T00:01:00Z'}];const a=await evaluateExperiment(spec,obs),b=await evaluateExperiment(spec,obs);assert.equal(a.delta,2);assert.equal(a.resultHash,b.resultHash);});
test('counterfactual runner keeps labels attached to outputs',async()=>{const r=await runCounterfactuals([{label:'wide',input:2},{label:'narrow',input:3}],x=>x*x);assert.deepEqual(r,[{label:'wide',result:4},{label:'narrow',result:9}]);});
