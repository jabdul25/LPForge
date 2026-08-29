export const BIN_SNAPSHOT_OPERATIONAL_LOOKBACK_MS=4*60*60_000;

export type BinSnapshotProtectionSource='SELECTED_FORWARD'|'CANDIDATE_COUNTERFACTUAL'|'INVENTORY_FORECAST_V2'|'OPERATIONAL_HISTORY';
export interface BinSnapshotRetentionPlan {
 state:'READY'|'UNKNOWN';
 protectionFloor?:string;
 protectionInputs:Partial<Record<BinSnapshotProtectionSource,string>>;
 reasonCodes:string[];
}
export interface BinSnapshotRetentionStore {
 loadBinSnapshotRetentionPlan(now:string):Promise<BinSnapshotRetentionPlan>;
 deleteBinSnapshotsBefore(protectionFloor:string,limit:number):Promise<{deleted:number;oldestDeletedAt?:string;newestDeletedAt?:string}>;
}

const validIso=(value:unknown):string|undefined=>{
 if(typeof value!=='string')return undefined;
 const time=Date.parse(value);
 return Number.isFinite(time)?new Date(time).toISOString():undefined;
};

/** A missing or malformed dependency never permits deletion.  The resulting
 * floor is the oldest protected baseline, not an outcome's terminal time. */
export function binSnapshotProtectionPlan(input:{now:string;selectedForwardFloor?:string;candidateCounterfactualFloor?:string;inventoryForecastV2Floor?:string;unknownDependencies?:readonly string[]}):BinSnapshotRetentionPlan {
 const now=validIso(input.now);
 if(!now)return{state:'UNKNOWN',protectionInputs:{},reasonCodes:['RETENTION_PROTECTION_FLOOR_UNKNOWN','RETENTION_NOW_INVALID']};
 if(input.unknownDependencies?.length)return{state:'UNKNOWN',protectionInputs:{},reasonCodes:['RETENTION_PROTECTION_FLOOR_UNKNOWN',...input.unknownDependencies]};
 const candidates:[BinSnapshotProtectionSource,string|undefined][]=[
  ['SELECTED_FORWARD',validIso(input.selectedForwardFloor)],
  ['CANDIDATE_COUNTERFACTUAL',validIso(input.candidateCounterfactualFloor)],
  ['INVENTORY_FORECAST_V2',validIso(input.inventoryForecastV2Floor)],
  ['OPERATIONAL_HISTORY',new Date(Date.parse(now)-BIN_SNAPSHOT_OPERATIONAL_LOOKBACK_MS).toISOString()],
 ];
 const protectionInputs=Object.fromEntries(candidates.filter((entry):entry is [BinSnapshotProtectionSource,string]=>Boolean(entry[1]))) as Partial<Record<BinSnapshotProtectionSource,string>>;
 const times=Object.values(protectionInputs).map(Date.parse).filter(Number.isFinite);
 if(!times.length)return{state:'UNKNOWN',protectionInputs,reasonCodes:['RETENTION_PROTECTION_FLOOR_UNKNOWN','RETENTION_FLOOR_EMPTY']};
 return{state:'READY',protectionFloor:new Date(Math.min(...times)).toISOString(),protectionInputs,reasonCodes:[]};
}

export function boundedBinSnapshotRetentionDeleteLimit(value:number|undefined):number {
 const requested=Math.floor(value??2000);
 return Number.isFinite(requested)?Math.max(1,Math.min(10_000,requested)):2000;
}

/** One committed bounded batch.  The store calculates the dynamic floor on
 * every call; no stale audit timestamp or fixed age is ever used. */
export async function runBoundedBinSnapshotRetention(input:{store:BinSnapshotRetentionStore;now:string;limit?:number;dryRun?:boolean;emit?:(event:Record<string,unknown>)=>void}):Promise<{state:'READY'|'UNKNOWN';protectionFloor?:string;deleted:number;dryRun:boolean;reasonCodes:string[]}> {
 const emit=input.emit??(()=>{});
 let plan:BinSnapshotRetentionPlan;
 try{plan=await input.store.loadBinSnapshotRetentionPlan(input.now);}catch(error){const reason='RETENTION_PROTECTION_FLOOR_UNKNOWN';emit({event:'BIN_SNAPSHOT_RETENTION_SKIPPED',reason,error:error instanceof Error?error.message:String(error)});return{state:'UNKNOWN',deleted:0,dryRun:Boolean(input.dryRun),reasonCodes:[reason]};}
 if(plan.state!=='READY'||!plan.protectionFloor){emit({event:'BIN_SNAPSHOT_RETENTION_SKIPPED',reasonCodes:plan.reasonCodes,protectionInputs:plan.protectionInputs});return{state:'UNKNOWN',deleted:0,dryRun:Boolean(input.dryRun),reasonCodes:plan.reasonCodes};}
 if(input.dryRun){emit({event:'BIN_SNAPSHOT_RETENTION_DRY_RUN',protectionFloor:plan.protectionFloor,protectionInputs:plan.protectionInputs,limit:boundedBinSnapshotRetentionDeleteLimit(input.limit)});return{state:'READY',protectionFloor:plan.protectionFloor,deleted:0,dryRun:true,reasonCodes:[]};}
 const deleted=await input.store.deleteBinSnapshotsBefore(plan.protectionFloor,boundedBinSnapshotRetentionDeleteLimit(input.limit));
 emit({event:'BIN_SNAPSHOT_RETENTION_BATCH',protectionFloor:plan.protectionFloor,protectionInputs:plan.protectionInputs,deleted:deleted.deleted,...(deleted.oldestDeletedAt?{oldestDeletedAt:deleted.oldestDeletedAt}:{}),...(deleted.newestDeletedAt?{newestDeletedAt:deleted.newestDeletedAt}:{})});
 return{state:'READY',protectionFloor:plan.protectionFloor,deleted:deleted.deleted,dryRun:false,reasonCodes:[]};
}
