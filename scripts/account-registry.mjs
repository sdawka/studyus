#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const userId = args[0];
if (!userId || !/^[A-Za-z0-9_-]{1,200}$/.test(userId)) {
  console.error('Usage: node scripts/account-registry.mjs <user-id> [--local | --remote] [--env <name>]');
  process.exit(2);
}
const location = args.includes('--local') ? '--local' : '--remote';
const envIndex = args.indexOf('--env');
const envArgs = envIndex >= 0 && args[envIndex + 1] ? ['--env', args[envIndex + 1]] : [];
const escapedUserId = userId.replaceAll("'", "''");
const query = `SELECT user_id, object_name, state, deletion_event_id, deleted_at, updated_at FROM learner_runtime_registry WHERE user_id = '${escapedUserId}' LIMIT 1`;
const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', location, ...envArgs, '--command', query, '--json'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
process.stdout.write(result.stdout);
