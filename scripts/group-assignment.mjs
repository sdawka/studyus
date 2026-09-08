#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const groupId = args[0];
const newOwnerUserId = args[1];
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const operatorLabel = value('--operator');
const reason = value('--reason');
const safeId = (candidate) => typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(candidate);
if (!safeId(groupId) || !safeId(newOwnerUserId) || !operatorLabel?.trim() || operatorLabel.length > 200 || !reason?.trim() || reason.length > 500) {
  console.error('Usage: node scripts/group-assignment.mjs <group-id> <new-owner-user-id> --operator <label> --reason <reason> [--local | --remote] [--env <name>]');
  process.exit(2);
}

// Local is deliberately the default; an operator must explicitly choose
// --remote for a production/staging administrative write.
const location = args.includes('--remote') ? '--remote' : '--local';
const envName = value('--env');
const envArgs = envName ? ['--env', envName] : [];
const quote = (input) => `'${input.replaceAll("'", "''")}'`;
const now = Date.now();
// Migration-owned triggers validate the active existing-member target and
// perform the owner/member/group state transition in this same INSERT.
const command = `INSERT INTO group_owner_reassignments(id,group_id,previous_owner_user_id,new_owner_user_id,operator_label,reason,created_at) VALUES (${quote(randomUUID())},${quote(groupId)},NULL,${quote(newOwnerUserId)},${quote(operatorLabel.trim())},${quote(reason.trim())},${now});`;
const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', location, ...envArgs, '--command', command, '--json'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
process.stdout.write(result.stdout);
