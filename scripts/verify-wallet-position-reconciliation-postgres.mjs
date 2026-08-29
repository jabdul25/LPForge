import { createPostgresStore } from '../.build/packages/db/src/index.js';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');
const suffix = String(process.pid);
const owner = `WALLET_OWNER_${suffix}`;
const pool = `WALLET_POOL_${suffix}`;
const position = `WALLET_POSITION_${suffix}`;
const unknown = `UNKNOWN_POSITION_${suffix}`;
const at = '2026-08-28T00:00:00.000Z';
const store = await createPostgresStore(url);
try {
  await store.upsertPool({
    address: pool,
    tokenXMint: `X_${suffix}`,
    tokenYMint: `Y_${suffix}`,
    binStep: 10,
    functionType: 'LIQUIDITY_MINING',
    collectFeeMode: 'INPUT_ONLY',
    activeBinId: 0,
    stamp: { source: 'FIXTURE', observedAt: at },
  });
  await store.upsertWalletPositionDiscovery({
    ownerAddress: owner,
    positionAddress: unknown,
    poolAddress: pool,
    classification: 'UNKNOWN_WALLET_POSITION',
    firstSeenAt: at,
    lastSeenAt: at,
    lastReconciledAt: at,
    payload: { source: 'wallet-wide-sweep' },
  });
  await store.upsertWalletPositionDiscovery({
    ownerAddress: owner,
    positionAddress: unknown,
    poolAddress: pool,
    classification: 'UNKNOWN_WALLET_POSITION',
    firstSeenAt: '2026-08-28T00:01:00.000Z',
    lastSeenAt: '2026-08-28T00:01:00.000Z',
    lastReconciledAt: '2026-08-28T00:01:00.000Z',
    payload: { source: 'wallet-wide-sweep-repeat' },
  });
  await store.upsertOwnedPosition({
    lpforgePositionId: `position-${position}`,
    poolAddress: pool,
    positionAddress: position,
    ownerAddress: owner,
    strategy: 'SPOT',
    orientation: 'ONE_SIDED_Y',
    lowerBinId: -10,
    upperBinId: 10,
    activeBinAtEntry: 0,
    initialCapitalLamports: 123_456n,
    entrySignature: `SIG_${suffix}`,
    entrySlot: 987_654_321n,
    enteredAt: at,
    lifecycleState: 'OPEN',
    reconciliationStatus: 'MATCH',
    payload: { source: 'isolated-postgres-test' },
  });
  await store.upsertWalletPositionDiscovery({
    ownerAddress: owner,
    positionAddress: position,
    poolAddress: pool,
    classification: 'KNOWN_LPFORGE_POSITION',
    lpforgePositionId: `position-${position}`,
    firstSeenAt: at,
    lastSeenAt: at,
    lastReconciledAt: at,
    payload: { source: 'owned-position-match' },
  });
  const discoveries = await store.loadWalletPositionDiscoveries(owner);
  if (discoveries.length !== 2)
    throw new Error('LPFORGE_WALLET_DISCOVERY_ROW_COUNT');
  const unknownRow = discoveries.find((row) => row.positionAddress === unknown);
  if (!unknownRow || unknownRow.classification !== 'UNKNOWN_WALLET_POSITION')
    throw new Error('LPFORGE_WALLET_UNKNOWN_NOT_PRESERVED');
  const knownRow = discoveries.find((row) => row.positionAddress === position);
  if (knownRow?.lpforgePositionId !== `position-${position}`)
    throw new Error('LPFORGE_WALLET_KNOWN_LINK_MISSING');
} finally {
  await store.close();
}

const db = new Client({ connectionString: url });
await db.connect();
try {
  const owned = await db.query(
    `SELECT entry_slot::text AS entry_slot,last_reconciled_at
       FROM execution.owned_positions WHERE position_address=$1`,
    [position],
  );
  if (
    owned.rows.length !== 1 ||
    owned.rows[0].entry_slot !== '987654321' ||
    !owned.rows[0].last_reconciled_at
  ) throw new Error('LPFORGE_OWNED_POSITION_RECONCILIATION_COLUMNS');
  let rejected = false;
  try {
    await db.query(
      `INSERT INTO execution.wallet_position_discoveries
        (owner_address,position_address,classification,first_seen_at,last_seen_at,last_reconciled_at,payload)
       VALUES($1,$2,'UNSAFE_AUTO_ADOPT',$3,$3,$3,'{}'::jsonb)`,
      [owner, `INVALID_${suffix}`, at],
    );
  } catch { rejected = true; }
  if (!rejected) throw new Error('LPFORGE_WALLET_DISCOVERY_CLASSIFICATION_GUARD');
} finally {
  await db.end();
}
console.log('WALLET_POSITION_RECONCILIATION_POSTGRES_OK discovery_idempotency=PASS unknown_not_adopted=PASS owned_entry_slot=PASS classification_guard=PASS');
