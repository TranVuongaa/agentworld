// Verify multi-agent access decisions and rollback without changing real sandbox policy.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestAccess, resolveAccess } from '../server/access.ts';
import { Hub } from '../server/hub.ts';
import { Planner } from '../server/planner.ts';
import { detectRepo } from '../server/repo.ts';
import { loadConfig, loadPlan } from '../server/store.ts';

const temp = mkdtempSync(join(tmpdir(), 'agentworld-access-'));
const repoDir = join(temp, 'repo');
mkdirSync(repoDir);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  execFileSync('git', ['init', '-q', repoDir]);
  const repo = await detectRepo(repoDir);
  const { config } = loadConfig(repo, 7420);
  const hub = new Hub(repo, 'repo', config, loadPlan(repo.root), { checks: [] });
  const inbox = { items: [], push(id, item) { this.items.push({ id, ...item }); } };
  const planner = new Planner(hub, inbox);
  const [lead, worker] = config.team;
  hub.setStatus(lead.id, { state: 'working', note: 'Lead work' });
  hub.setStatus(worker.id, { state: 'working', note: 'Worker work' });

  // Snapshot desired rules before an asynchronous operation, as a real CLI call would.
  // The lead finishes late so rollback must wait for every attempted change.
  const applied = new Map(config.team.map((agent) => [agent.id, new Set()]));
  let failure = null;
  const sbx = {
    state: { agents: Object.fromEntries(config.team.map((agent) => [agent.id, { syncError: null }])) },
    async syncRules(id) {
      const wanted = [...hub.cfg(id).sandbox.allow];
      const fail = failure && id === worker.id && wanted.includes(failure.domain) ? failure : null;
      if (fail) failure = null;
      await delay(id === lead.id ? 40 : 5);
      if (fail?.mode === 'throw') throw new Error(`fixture refused ${fail.domain}`);
      if (fail?.mode === 'syncError') { this.state.agents[id].syncError = `fixture refused ${fail.domain}`; return; }
      this.state.agents[id].syncError = null;
      applied.set(id, new Set(wanted));
    },
  };
  const pending = (agentId, domain) => hub.snap.accessRequests.find((request) => request.agentId === agentId && request.domain === domain && request.status === 'pending');

  requestAccess(hub, lead.id, 'https://Docs.Example.com/guide', 'Read docs');
  requestAccess(hub, worker.id, 'docs.example.com', 'Same docs');
  assert.equal(hub.snap.accessRequests.length, 2);
  assert.match(requestAccess(hub, worker.id, 'docs.example.com', 'Duplicate'), /already asked/i);
  assert.equal(hub.snap.accessRequests.length, 2);
  await resolveAccess(hub, sbx, planner, pending(lead.id, 'docs.example.com').id, 'everyone');
  assert(hub.snap.accessRequests.filter((r) => r.domain === 'docs.example.com').every((r) => r.status === 'allowed'));
  assert(config.team.every((agent) => applied.get(agent.id).has('docs.example.com')));
  assert.equal(hub.status(lead.id).state, 'working');
  assert.equal(hub.status(worker.id).state, 'working');
  assert(inbox.items.some((item) => item.id === worker.id && /allowed docs\.example\.com/i.test(item.text)));

  for (const [domain, mode] of [['throw.example.com', 'throw'], ['refused.example.com', 'syncError']]) {
    requestAccess(hub, worker.id, domain, 'Expected failure');
    const request = pending(worker.id, domain);
    failure = { domain, mode };
    await resolveAccess(hub, sbx, planner, request.id, 'everyone');
    assert.equal(request.status, 'pending');
    assert(config.team.every((agent) => !agent.sandbox.allow.includes(domain)));
    assert(config.team.every((agent) => !applied.get(agent.id).has(domain)), 'late sandbox rule must be rolled back');
    const saved = JSON.parse(readFileSync(join(repoDir, '.jsmhq/config.json'), 'utf8'));
    assert(saved.team.every((agent) => !agent.sandbox.allow.includes(domain)));
    await resolveAccess(hub, sbx, planner, request.id, 'deny');
  }

  requestAccess(hub, worker.id, 'queued.example.com', 'Queue test');
  const queued = pending(worker.id, 'queued.example.com');
  await Promise.all([resolveAccess(hub, sbx, planner, queued.id, 'agent'), resolveAccess(hub, sbx, planner, queued.id, 'deny')]);
  assert.equal(queued.status, 'allowed');
  assert(applied.get(worker.id).has('queued.example.com'));
  assert(!applied.get(lead.id).has('queued.example.com'));

  requestAccess(hub, worker.id, 'first.example.com', 'First');
  requestAccess(hub, worker.id, 'second.example.com', 'Second');
  await resolveAccess(hub, sbx, planner, pending(worker.id, 'first.example.com').id, 'deny');
  assert.equal(hub.status(worker.id).state, 'needs-input');
  await resolveAccess(hub, sbx, planner, pending(worker.id, 'second.example.com').id, 'deny');
  assert.equal(hub.status(worker.id).state, 'working');
  assert.throws(() => requestAccess(hub, worker.id, '127.0.0.1', 'Invalid'), /isn't a domain/);
  worker.mode = 'local';
  assert.match(requestAccess(hub, worker.id, 'local.example.com', 'Local'), /outside a sandbox/i);
  console.log('✓ Multi-agent access, denial, queued decisions and rollback on partial failure');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
