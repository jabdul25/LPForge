import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('operational history uses one ordered bulk read for bounded immutable bin frames', async () => {
  const source=await readFile('packages/db/src/index.ts','utf8');
  const start=source.indexOf('const stampValues = stamps.rows.map');
  const end=source.indexOf('const swaps = await db.query',start);
  assert.ok(start>=0&&end>start);
  const section=source.slice(start,end);
  assert.match(section,/WITH selected_stamps AS \(SELECT unnest\(\$2::timestamptz\[\]\) AS observed_at\)/);
  assert.match(section,/JOIN LATERAL \([\s\S]*pool_snapshots[\s\S]*observed_at<=s\.observed_at/);
  assert.match(section,/ORDER BY s\.observed_at ASC,b\.bin_id ASC/);
  assert.doesNotMatch(section,/for \(const stamp of stampValues\.reverse\(\)\)[\s\S]*?await db\.query/);
  assert.match(section,/frameObservedAt !== observedAt/);
});
