import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [templateDirectory, runtimeDirectory] = process.argv.slice(2);
if (!templateDirectory || !runtimeDirectory) throw new Error('LPFORGE_POLICY_DEPLOYMENT_PLAN_ARGUMENTS_REQUIRED');

const domains = Object.freeze({
  'live-execution-policy.json': Object.freeze({ domain: 'LIVE_EXECUTION', services: ['production', 'execution', 'discovery'] }),
  'pool-discovery-policy.json': Object.freeze({ domain: 'POOL_DISCOVERY', services: ['production', 'discovery', 'discovery-learning'] }),
  'autonomous-entry-policy.json': Object.freeze({ domain: 'AUTONOMOUS_ENTRY', services: ['production', 'execution'] }),
  'live-position-management-policy.json': Object.freeze({ domain: 'LIVE_POSITION_MANAGEMENT', services: ['production', 'execution'] }),
  'oor-lifecycle-policy.json': Object.freeze({ domain: 'OOR_LIFECYCLE', services: ['production', 'execution'] }),
  'live-exit-governor-policy.json': Object.freeze({ domain: 'LIVE_EXIT_GOVERNOR', services: ['production', 'execution'] }),
});
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const changes = Object.entries(domains).flatMap(([file, definition]) => {
  const templatePath = join(templateDirectory, file);
  const runtimePath = join(runtimeDirectory, file);
  const templateHash = hash(templatePath);
  const runtimeHash = hash(runtimePath);
  return templateHash === runtimeHash ? [] : [{ file, ...definition, previousHash: runtimeHash, nextHash: templateHash }];
});
const services = [...new Set(changes.flatMap(change => change.services))];
process.stdout.write(`${JSON.stringify({ changes, services }, null, 2)}\n`);
