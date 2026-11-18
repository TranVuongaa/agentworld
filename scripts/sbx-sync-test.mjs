// Reproduce overlapping policy syncs with a local sbx shim, never the real policy store.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { Hub } from '../server/hub.ts';
import { detectRepo } from '../server/repo.ts';
import { Sbx } from '../server/sbx.ts';
import { loadConfig, loadPlan } from '../server/store.ts';

if (process.platform === 'win32') {
  console.log('Sandbox CLI fixture requires a POSIX executable shim; run in WSL on Windows.');
  process.exit(0);
}
const temp = mkdtempSync(join(tmpdir(), 'agentworld-sbx-sync-'));
const home = join(temp, 'home'); const repoDir = join(temp, 'repo'); const bin = join(temp, 'bin');
const operations = join(temp, 'operations.jsonl'); const reads = join(temp, 'reads.jsonl');
mkdirSync(home); mkdirSync(repoDir); mkdirSync(bin); writeFileSync(operations, ''); writeFileSync(reads, '');
const oldEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, PATH: process.env.PATH, TEST_SANDBOX: process.env.TEST_SANDBOX };
Object.assign(process.env, { HOME: home, USERPROFILE: home, PATH: `${bin}${delimiter}${oldEnv.PATH ?? ''}` });
const sbx = join(bin, 'sbx');
writeFileSync(sbx, `#!${process.execPath}\n` + `
const fs = require('fs');
const args = process.argv.slice(2);
const ops = ${JSON.stringify(operations)}; const reads = ${JSON.stringify(reads)};
const sandbox = process.env.TEST_SANDBOX;
function rules() {
 const entries = fs.readFileSync(ops, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
 const active = [{ id: 'external', applies_to: 'sandbox:' + sandbox, resource_type: 'network', decision: 'allow', resources: ['existing.example'], layer: 'local', status: 'active' }];
 for (const e of entries) { if (e.op === 'add') active.push(e.rule); else { const index = active.findIndex(r => r.id === e.id); if (index >= 0) active.splice(index, 1); } }
 return active;
}
if (args[0] === 'ls') console.log(JSON.stringify([{ name: sandbox }]));
else if (args[0] === 'policy' && args[1] === 'ls') {
 const snapshot = JSON.stringify({ rules: rules() });
 fs.appendFileSync(reads, 'x'); const count = fs.readFileSync(reads, 'utf8').length;
 setTimeout(() => console.log(snapshot), count === 1 ? 400 : 0);
} else if (args[0] === 'policy' && args[1] === 'check') console.log('Allowed: ' + args[3]);
else if (args[0] === 'policy' && args[1] === 'allow') {
 const rule = { id: 'rule-' + process.pid, applies_to: 'sandbox:' + sandbox, resource_type: 'network', decision: 'allow', resources: [args[args.length - 1]], layer: 'local', status: 'active' };
 fs.appendFileSync(ops, JSON.stringify({ op: 'add', rule }) + '\\n');
} else if (args[0] === 'policy' && args[1] === 'rm') fs.appendFileSync(ops, JSON.stringify({ op: 'rm', id: args[args.indexOf('--id') + 1] }) + '\\n');
else if (args[0] === 'secret' && args[1] === 'ls') console.log('{"secrets":[]}');
else if (args[0] === 'ports') console.log('[]');
`);
chmodSync(sbx, 0o755);
try {
  execFileSync('git', ['init', '-q', repoDir]);
  const repo = await detectRepo(repoDir); const { config } = loadConfig(repo, 7420); const agent = config.team[1];
  agent.sandbox.allow = ['docs.example.com'];
  process.env.TEST_SANDBOX = `hq-repo-${agent.id}`;
  const hub = new Hub(repo, 'repo', config, loadPlan(repo.root), { sandboxReady: true, checks: [] });
  const manager = new Sbx(hub);
  await Promise.all([manager.syncRules(agent.id), manager.syncRules(agent.id)]);
  const entries = () => readFileSync(operations, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(entries().filter((item) => item.op === 'add').length, 1, 'overlapping syncs must not add the same rule twice');
  agent.sandbox.allow = [];
  await manager.syncRules(agent.id);
  assert.equal(entries().filter((item) => item.op === 'rm').length, 1, 'the owned rule must be removed once');
  assert.equal(manager.state.agents[agent.id].rules.some((rule) => rule.id === 'external'), true, 'unowned rules must remain');
  assert.equal(manager.state.agents[agent.id].rules.some((rule) => rule.resources.includes('docs.example.com')), false, 'removed rule must not remain');
  console.log('✓ Overlapping sandbox policy syncs add and remove one owned rule');
} finally {
  for (const [key, value] of Object.entries(oldEnv)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  rmSync(temp, { recursive: true, force: true });
}
