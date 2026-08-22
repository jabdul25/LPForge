export type Base58Address = string;
export type IsoTimestamp = string;
export type Freshness = 'GOOD' | 'DEGRADED' | 'BAD';
export type ProtocolCompatibilityState = 'VERIFIED' | 'HOLD' | 'UNKNOWN';
export type FunctionType = 'UNDETERMINED' | 'LIQUIDITY_MINING' | 'LIMIT_ORDER' | 'UNKNOWN';
export type CollectFeeMode = 'INPUT_ONLY' | 'ONLY_Y' | 'UNKNOWN';

export interface SourceStamp {
  source: 'SOLANA_RPC' | 'METEORA_SDK' | 'METEORA_DATA_API' | 'FIXTURE' | 'EXTERNAL';
  chainSlot?: bigint;
  blockTime?: IsoTimestamp;
  sourceTimestamp?: IsoTimestamp;
  observedAt: IsoTimestamp;
  processedAt?: IsoTimestamp;
}

export interface TokenFact {
  mint: Base58Address;
  decimals?: number;
  tokenProgram?: Base58Address;
  symbol?: string;
  name?: string;
}

export interface PoolIdentity {
  address: Base58Address;
  tokenXMint: Base58Address;
  tokenYMint: Base58Address;
  binStep: number;
  functionType: FunctionType;
  collectFeeMode: CollectFeeMode;
}

export interface PoolStateFact extends PoolIdentity {
  activeBinId: number;
  baseFeePct?: string;
  dynamicFeePct?: string;
  maxFeePct?: string;
  protocolFeePct?: string;
  reserveX?: string;
  reserveY?: string;
  stamp: SourceStamp;
  raw?: Record<string, unknown>;
}

export interface BinLiquidityFact {
  pool: Base58Address;
  binId: number;
  price: string;
  amountX: string;
  amountY: string;
  liquiditySupply?: string;
  /**
   * Adapter-level data-quality signal. A missing denominator remains
   * fail-closed; this distinguishes it from genuine zero bin supply.
   */
  shareSupplyDiagnostic?: 'BIN_SHARE_SUPPLY_MISSING_WITH_TOKEN_INVENTORY' | 'BIN_SHARE_SUPPLY_INVALID';
  feeAmountXPerTokenStored?: string;
  feeAmountYPerTokenStored?: string;
  stamp: SourceStamp;
}

export interface PositionV2Fact {
  address: Base58Address;
  pool: Base58Address;
  owner: Base58Address;
  feeOwner?: Base58Address;
  lowerBinId: number;
  upperBinId: number;
  totalXAmount: string;
  totalYAmount: string;
  feeX?: string;
  feeY?: string;
  claimedFeeX?: string;
  claimedFeeY?: string;
  stamp: SourceStamp;
  raw?: Record<string, unknown>;
}

export interface SwapEventFact {
  signature: string;
  eventIndex: number;
  pool: Base58Address;
  sender?: Base58Address;
  startBinId?: number;
  endBinId?: number;
  swapForY?: boolean;
  amountIn?: string;
  amountOut?: string;
  amountLeft?: string;
  feeBps?: string;
  mmFee?: string;
  protocolFee?: string;
  limitOrderFee?: string;
  hostFee?: string;
  feesOnInput?: boolean;
  feesOnTokenX?: boolean;
  stamp: SourceStamp;
  raw: Record<string, unknown>;
}

export interface FeatureEnvelope<T extends object> {
  pool: Base58Address;
  schemaVersion: string;
  sourceWatermark: { slot?: bigint; apiObservedAt?: IsoTimestamp };
  freshness: Freshness;
  missing: string[];
  features: T;
  createdAt: IsoTimestamp;
}

export interface ProtocolCompatibilityCheck {
  state: ProtocolCompatibilityState;
  programId: Base58Address;
  expectedSdkVersion: string;
  decoderVersion: string;
  checkedAt: IsoTimestamp;
  details: Record<string, unknown>;
}

export function nowIso(): string { return new Date().toISOString(); }

export function assertBase58Like(value: string, field = 'address'): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) throw new Error(`LPFORGE_INVALID_BASE58:${field}`);
  return value;
}

export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && 'toString' in value) {
    const s = String(value);
    if (s !== '[object Object]') return s;
  }
  return fallback;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(asString(value, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (typeof input === 'bigint') return input.toString();
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        const v = (input as Record<string, unknown>)[key];
        if (v !== undefined) out[key] = normalize(v);
      }
      return out;
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
