import { canonicalJson, sha256Hex } from '../../domain/src/index.js';

export interface TimedRecord { observedAt:string; }
export interface ChronologicalSplit<T>{research:T[];validation:T[];test:T[];}
export function chronologicalSplit<T extends TimedRecord>(rows:T[],ratios={research:.6,validation:.2,test:.2}):ChronologicalSplit<T>{const sum=ratios.research+ratios.validation+ratios.test;if(Math.abs(sum-1)>.000001)throw new Error('LPFORGE_RESEARCH_SPLIT_RATIO');const s=[...rows].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));const r=Math.floor(s.length*ratios.research),v=Math.floor(s.length*ratios.validation);return{research:s.slice(0,r),validation:s.slice(r,r+v),test:s.slice(r+v)};}

export interface ExperimentSpec {id:string;hypothesis:string;primaryMetric:string;secondaryMetrics:string[];controlPolicyId:string;treatmentPolicyId:string;createdAt:string;}
export interface ExperimentObservation {episodeId:string;policyId:string;metrics:Record<string,number>;observedAt:string;}
export interface ExperimentResult {spec:ExperimentSpec;controlN:number;treatmentN:number;controlPrimaryMean:number;treatmentPrimaryMean:number;delta:number;secondary:Record<string,{controlMean:number;treatmentMean:number;delta:number}>;resultHash:string;}
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
export async function evaluateExperiment(spec:ExperimentSpec,obs:ExperimentObservation[]):Promise<ExperimentResult>{const c=obs.filter((o)=>o.policyId===spec.controlPolicyId),t=obs.filter((o)=>o.policyId===spec.treatmentPolicyId);const cm=mean(c.map((o)=>o.metrics[spec.primaryMetric]??0)),tm=mean(t.map((o)=>o.metrics[spec.primaryMetric]??0));const secondary:ExperimentResult['secondary']={};for(const k of spec.secondaryMetrics){const a=mean(c.map((o)=>o.metrics[k]??0)),b=mean(t.map((o)=>o.metrics[k]??0));secondary[k]={controlMean:a,treatmentMean:b,delta:b-a};}const core={spec,controlN:c.length,treatmentN:t.length,controlPrimaryMean:cm,treatmentPrimaryMean:tm,delta:tm-cm,secondary};return{...core,resultHash:await sha256Hex(canonicalJson(core))};}

export interface Counterfactual<T>{label:string;input:T;}
export async function runCounterfactuals<T,R>(cases:Counterfactual<T>[],runner:(input:T)=>R|Promise<R>):Promise<Array<{label:string;result:R}>>{const out:Array<{label:string;result:R}>=[];for(const c of cases)out.push({label:c.label,result:await runner(c.input)});return out;}

export function assertNoLookahead<T extends TimedRecord>(decisionAt:string,inputs:T[]):void{const t=Date.parse(decisionAt);for(const i of inputs)if(Date.parse(i.observedAt)>t)throw new Error(`LPFORGE_LOOKAHEAD:${i.observedAt}`);}
