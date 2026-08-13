// LPFORGE_PHASE7_PRODUCTION_OPERATIONS_MODULE
export type Phase7HealthDomain='RPC'|'METEORA_API'|'DATABASE'|'DECISION'|'EXECUTION'|'PORTFOLIO'|'RECONCILIATION';
export type Phase7DomainStatus='HEALTHY'|'DEGRADED'|'CRITICAL';
export interface Phase7HealthObservation {domain:Phase7HealthDomain;observedAt:string;status:Phase7DomainStatus;reasonCodes:string[];metrics?:Record<string,number|string|boolean>;}
export interface Phase7HealthPolicy {requiredDomains:Phase7HealthDomain[];hardStaleDomains:Phase7HealthDomain[];maxAgeMs:Partial<Record<Phase7HealthDomain,number>>;maxDegradedDomains:number;}
export interface Phase7HealthAssessment {status:Phase7DomainStatus;observedAt:string;domainStatus:Record<Phase7HealthDomain,Phase7DomainStatus|'MISSING'>;staleDomains:Phase7HealthDomain[];missingDomains:Phase7HealthDomain[];reasonCodes:string[];newEntriesAllowed:boolean;managementWritesAllowed:boolean;emergencyCloseAllowed:true;}
const domains:Phase7HealthDomain[]=['RPC','METEORA_API','DATABASE','DECISION','EXECUTION','PORTFOLIO','RECONCILIATION'];
const rank:Record<Phase7DomainStatus,number>={HEALTHY:0,DEGRADED:1,CRITICAL:2};

export function assessPhase7Health(observations:Phase7HealthObservation[],policy:Phase7HealthPolicy,now:string):Phase7HealthAssessment{
  if(policy.maxDegradedDomains<0)throw new Error('LPFORGE_P7_HEALTH_POLICY');
  const nowMs=Date.parse(now);if(!Number.isFinite(nowMs))throw new Error('LPFORGE_P7_HEALTH_NOW');
  const latest=new Map<Phase7HealthDomain,Phase7HealthObservation>();
  for(const o of observations){
    const t=Date.parse(o.observedAt);if(!Number.isFinite(t))throw new Error(`LPFORGE_P7_HEALTH_TIMESTAMP:${o.domain}`);
    if(t>nowMs)throw new Error(`LPFORGE_P7_HEALTH_FUTURE_OBSERVATION:${o.domain}`);
    const prior=latest.get(o.domain);if(!prior||Date.parse(prior.observedAt)<t)latest.set(o.domain,o);
  }
  const domainStatus=Object.fromEntries(domains.map(d=>[d,'MISSING'])) as Record<Phase7HealthDomain,Phase7DomainStatus|'MISSING'>;
  const staleDomains:Phase7HealthDomain[]=[];const missingDomains:Phase7HealthDomain[]=[];const reasons:string[]=[];
  let aggregate:Phase7DomainStatus='HEALTHY';let degradedCount=0;
  for(const d of domains){
    const o=latest.get(d);const required=policy.requiredDomains.includes(d);
    if(!o){if(required){missingDomains.push(d);reasons.push(`P7_HEALTH_${d}_MISSING`);aggregate='CRITICAL';}continue;}
    const maxAge=policy.maxAgeMs[d];
    const stale=maxAge!=null&&nowMs-Date.parse(o.observedAt)>maxAge;
    let status=o.status;
    if(stale){staleDomains.push(d);reasons.push(`P7_HEALTH_${d}_STALE`);status=policy.hardStaleDomains.includes(d)?'CRITICAL':'DEGRADED';}
    domainStatus[d]=status;
    for(const r of o.reasonCodes)reasons.push(r);
    if(status==='DEGRADED')degradedCount++;
    if(rank[status]>rank[aggregate])aggregate=status;
  }
  if(aggregate!=='CRITICAL'&&degradedCount>policy.maxDegradedDomains){aggregate='CRITICAL';reasons.push('P7_HEALTH_TOO_MANY_DEGRADED_DOMAINS');}
  return{
    status:aggregate,observedAt:now,domainStatus,
    staleDomains:[...new Set(staleDomains)].sort(),missingDomains:[...new Set(missingDomains)].sort(),reasonCodes:[...new Set(reasons)].sort(),
    newEntriesAllowed:aggregate==='HEALTHY',
    managementWritesAllowed:aggregate!=='CRITICAL',
    emergencyCloseAllowed:true
  };
}

export const defaultPhase7HealthPolicy:Phase7HealthPolicy={
  requiredDomains:['RPC','METEORA_API','DATABASE','DECISION','EXECUTION','PORTFOLIO','RECONCILIATION'],
  hardStaleDomains:['RPC','DATABASE','DECISION','RECONCILIATION'],
  maxAgeMs:{RPC:30_000,METEORA_API:60_000,DATABASE:60_000,DECISION:120_000,EXECUTION:120_000,PORTFOLIO:120_000,RECONCILIATION:60_000},
  maxDegradedDomains:2
};
