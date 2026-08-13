import type {MainnetCanaryDeploymentPolicy,MainnetCanaryPoolPolicy} from '../../canary/src/index.js';
import type {Phase1Store} from '../../db/src/index.js';

export interface ResolvedLiveExecutionUniverse {
  policy: MainnetCanaryDeploymentPolicy;
  staticPoolAddresses: string[];
  discoveryPoolAddresses: string[];
  rejectedDiscoveryPoolAddresses: string[];
}

/**
 * Resolves the execution allowlist at the same trust boundary used by production
 * and execution. Discovery candidates never carry their own capital authority;
 * limits come only from the versioned live-execution policy.
 */
export async function resolveLiveExecutionUniverse(input:{
  policy:MainnetCanaryDeploymentPolicy;
  store:Pick<Phase1Store,'listDiscoveryCandidates'>;
  observedAt:string;
}):Promise<ResolvedLiveExecutionUniverse>{
  const staticPoolAddresses=[...new Set(input.policy.pools.map(x=>x.address))],feed=input.policy.discoveryFeed;
  if(!feed?.enabled)return{policy:input.policy,staticPoolAddresses,discoveryPoolAddresses:[],rejectedDiscoveryPoolAddresses:[]};
  const cutoff=Date.parse(input.observedAt)-feed.maxCandidateAgeMs;
  const rows=await input.store.listDiscoveryCandidates([...feed.eligibleTiers]);
  const accepted:string[]=[],rejected:string[]=[];
  for(const row of rows){
    const seen=Date.parse(row.lastSeenAt);
    if(!Number.isFinite(seen)||seen<cutoff||row.state!=='PREFILTERED'){rejected.push(row.poolAddress);continue;}
    if(staticPoolAddresses.includes(row.poolAddress)||accepted.includes(row.poolAddress))continue;
    if(accepted.length>=feed.maxCandidates)break;
    accepted.push(row.poolAddress);
  }
  const pools:MainnetCanaryPoolPolicy[]=[...input.policy.pools,...accepted.map(address=>({address,maxCapitalLamports:feed.maxCapitalLamports,maxOpenPositions:feed.maxOpenPositions}))];
  return{policy:{...input.policy,pools},staticPoolAddresses,discoveryPoolAddresses:accepted,rejectedDiscoveryPoolAddresses:rejected};
}
