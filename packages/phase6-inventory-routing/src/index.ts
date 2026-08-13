// LPFORGE_PHASE6_MAINNET_MODULE
import type {Phase3Orientation,Phase3StrategyFamily} from '../../contracts/src/index.js';

export interface Phase6InventoryRouting {orientations:Phase3Orientation[];strategies:Phase3StrategyFamily[];reasonCodes:string[];tradable:boolean;}

/** Constrains autonomous range selection to assets the owner actually has; it never creates an implicit swap. */
export function routePhase6Inventory(input:{tokenXRaw:bigint;tokenYRaw:bigint}):Phase6InventoryRouting{
  if(input.tokenXRaw<0n||input.tokenYRaw<0n)throw new Error('LPFORGE_P6_INVENTORY_NEGATIVE');
  if(input.tokenXRaw>0n&&input.tokenYRaw>0n)return{orientations:['BALANCED','SKEWED_X','SKEWED_Y'],strategies:['SPOT','CURVE','BID_ASK'],reasonCodes:['P6_INVENTORY_TWO_SIDED'],tradable:true};
  if(input.tokenYRaw>0n)return{orientations:['ONE_SIDED_Y'],strategies:['BID_ASK'],reasonCodes:['P6_INVENTORY_SOL_SIDED_BID_ASK'],tradable:true};
  if(input.tokenXRaw>0n)return{orientations:['ONE_SIDED_X'],strategies:['BID_ASK'],reasonCodes:['P6_INVENTORY_TOKEN_X_SIDED_BID_ASK'],tradable:true};
  return{orientations:[],strategies:[],reasonCodes:['P6_INVENTORY_NO_POOL_ASSET'],tradable:false};
}
