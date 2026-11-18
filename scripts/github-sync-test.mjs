// Exercise review automation against a local gh fixture. No GitHub writes occur.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { GitHubSync } from '../server/githubSync.ts';
import { OPEN_LIMIT, reviewOf } from '../server/github.ts';
import { Hub } from '../server/hub.ts';
import { Planner } from '../server/planner.ts';
import { detectRepo } from '../server/repo.ts';
import { loadConfig, loadPlan } from '../server/store.ts';

if (process.platform === 'win32') {
  console.log('GitHub fixture test requires a POSIX executable shim; run in WSL on Windows.');
  process.exit(0);
}
const temp = mkdtempSync(join(tmpdir(), 'agentworld-github-'));
const home = join(temp, 'home');
const repoDir = join(temp, 'repo');
const bin = join(temp, 'bin');
const fixtureFile = join(temp, 'github.json');
mkdirSync(home); mkdirSync(repoDir); mkdirSync(bin);
const oldEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, PATH: process.env.PATH, GH_FIXTURE: process.env.GH_FIXTURE };
Object.assign(process.env, { HOME: home, USERPROFILE: home, PATH: `${bin}${delimiter}${oldEnv.PATH ?? ''}`, GH_FIXTURE: fixtureFile });
const gh = join(bin, 'gh');
writeFileSync(gh, `#!${process.execPath}\nprocess.stdout.write(require('fs').readFileSync(process.env.GH_FIXTURE, 'utf8'));\n`);
chmodSync(gh, 0o755);

try {
  execFileSync('git', ['init', '-q', repoDir]);
  const repo = await detectRepo(repoDir);
  const { config } = loadConfig(repo, 7420);
  config.workflow.review.enabled = true;
  config.workflow.review.tool = 'human';
  const setup = { checks: [{ id: 'gh', status: 'ok' }] };
  const hub = new Hub(repo, 'repo', config, loadPlan(repo.root), setup);
  const inbox = { push() {} };
  const planner = new Planner(hub, inbox);
  const sync = new GitHubSync(hub, planner, 'example/fixture');
  const [lead, worker] = config.team;
  const fixture = { data: { rateLimit: { cost: 1, remaining: 4999, resetAt: '2099-01-01T00:00:00Z' }, repository: { open: { nodes: [] }, merged: { nodes: [] }, closed: { nodes: [] } } } };
  const refresh = async () => {
    writeFileSync(fixtureFile, JSON.stringify(fixture));
    // Bypass the polling interval to exercise successive transitions without delays.
    sync.lastFetch = 0;
    await sync.refresh();
  };
  await refresh(); // Empty baseline, so subsequent PRs are new events.
  const board = planner.createBoard('Review', 'active');
  const task = planner.createTask({ boardId: board.id, title: 'First task' }, lead.id);
  planner.assign(task.id, worker.id, lead.id);
  const pr = {
    number: 42, title: `[${task.id}] First task`, url: 'https://example.invalid/pr/42', headRefName: `${worker.id}/${task.id}`,
    createdAt: '2026-01-01T00:00:00Z', mergedAt: null, state: 'OPEN', mergeable: 'MERGEABLE', isDraft: false, reviewDecision: null,
    reviews: { nodes: [] }, reviewThreads: { nodes: [] }, commits: { nodes: [] },
  };
  fixture.data.repository.open.nodes = [pr];
  await refresh();
  assert.equal(planner.task(task.id).status, 'in-review');
  assert.equal(planner.task(task.id).prNumber, 42);
  assert(hub.snap.activity.some((event) => event.type === 'pr.opened'));

  pr.reviewDecision = 'CHANGES_REQUESTED';
  pr.reviewThreads.nodes = [{ isResolved: false, isOutdated: false, comments: { nodes: [{ author: { login: 'reviewer' } }] } }];
  await refresh();
  assert.equal(hub.snap.pullRequests.find((item) => item.number === 42).review, 'changes-requested');
  assert(hub.snap.messages.some((message) => message.toId === worker.id && /open comment/i.test(message.text)));

  pr.mergeable = 'CONFLICTING';
  await refresh();
  assert(hub.snap.messages.some((message) => message.toId === worker.id && /merge conflicts/i.test(message.text)));
  pr.mergeable = 'MERGEABLE';
  pr.reviewDecision = 'APPROVED';
  pr.reviewThreads.nodes[0].isResolved = true;
  await refresh();
  assert.equal(hub.snap.pullRequests.find((item) => item.number === 42).review, 'passed');
  assert(hub.snap.messages.some((message) => message.toId === lead.id && /passed review/i.test(message.text)));

  pr.state = 'MERGED';
  pr.mergedAt = '2026-01-02T00:00:00Z';
  fixture.data.repository.open.nodes = [];
  fixture.data.repository.merged.nodes = [pr];
  await refresh();
  assert.equal(planner.task(task.id).status, 'done');
  assert(hub.snap.messages.some((message) => message.toId === lead.id && /was merged/i.test(message.text)));

  const second = planner.createTask({ boardId: board.id, title: 'Closed task' }, lead.id);
  planner.assign(second.id, worker.id, lead.id);
  const closed = { ...pr, number: 43, title: `[${second.id}] Closed task`, headRefName: `${worker.id}/${second.id}`, state: 'OPEN', mergedAt: null, reviewDecision: null, reviewThreads: { nodes: [] } };
  fixture.data.repository.open.nodes = [closed];
  await refresh();
  fixture.data.repository.open.nodes = [];
  fixture.data.repository.closed.nodes = [{ number: 43 }];
  await refresh();
  assert.equal(hub.snap.pullRequests.find((item) => item.number === 43).closed, true);
  assert.notEqual(planner.task(second.id).status, 'done');
  // Each supported review bot handles its own status checks and comment threads.
  for (const [tool, check, login] of [
    ['coderabbit', 'CodeRabbit', 'coderabbitai[bot]'],
    ['greptile', 'Greptile', 'greptile-apps[bot]'],
    ['copilot', 'Copilot', 'copilot-pull-request-reviewer[bot]'],
  ]) {
    const candidate = structuredClone(closed);
    candidate.reviews.nodes = [];
    candidate.reviewThreads.nodes = [];
    candidate.commits.nodes = [];
    assert.equal(reviewOf(candidate, tool).review, 'pending');
    const status = { __typename: 'StatusContext', context: check, state: 'PENDING', description: null };
    candidate.commits.nodes = [{ commit: { statusCheckRollup: { contexts: { nodes: [status] } } } }];
    assert.equal(reviewOf(candidate, tool).review, 'reviewing');
    status.state = 'SUCCESS';
    candidate.reviewThreads.nodes = [{ isResolved: false, isOutdated: false, comments: { nodes: [{ author: { login } }] } }];
    assert.equal(reviewOf(candidate, tool).review, 'changes-requested');
    candidate.reviewThreads.nodes[0].isResolved = true;
    assert.equal(reviewOf(candidate, tool).review, 'passed');
    status.state = 'FAILURE';
    status.description = 'Rate limit reached';
    assert.equal(reviewOf(candidate, tool).review, 'pending');
  }

  // A full page of open PRs must not falsely close older PRs omitted from that page.
  const older = { ...closed, number: 44, title: 'Older PR', headRefName: 'older-branch' };
  fixture.data.repository.open.nodes = [older];
  fixture.data.repository.closed.nodes = [];
  await refresh();
  fixture.data.repository.open.nodes = Array.from({ length: OPEN_LIMIT }, (_, index) => ({ ...older, number: 100 + index, title: `Other PR ${index}` }));
  await refresh();
  assert.equal(hub.snap.pullRequests.find((item) => item.number === 44).closed, false);
  fixture.data.repository.closed.nodes = [{ number: 44 }];
  await refresh();
  assert.equal(hub.snap.pullRequests.find((item) => item.number === 44).closed, true);

  // Rate limiting pauses polling and retains the last known PR state.
  const beforeLimit = JSON.stringify(hub.snap.pullRequests);
  fixture.errors = [{ type: 'RATE_LIMITED', message: 'API rate limit reached' }];
  fixture.resources = { graphql: { reset: Math.floor(Date.now() / 1000) + 300 } };
  delete fixture.data.repository;
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await refresh();
    assert.equal(JSON.stringify(hub.snap.pullRequests), beforeLimit);
    assert(hub.snap.activity.some((event) => /rate limit reached/i.test(event.text)));
    assert(sync.pausedUntil > Date.now());
    await refresh();
    assert.equal(JSON.stringify(hub.snap.pullRequests), beforeLimit);
    assert.equal(warnings.filter((message) => /rate limit reached/i.test(message)).length, 1);
  } finally {
    console.warn = previousWarn;
  }

  const persisted = JSON.parse(readFileSync(join(repoDir, '.jsmhq', 'plan.json'), 'utf8'));
  assert.equal(persisted.tasks.find((item) => item.id === task.id).status, 'done');
  console.log('✓ GitHub PR workflows, review bots, pagination and rate-limit handling');
} finally {
  for (const [key, value] of Object.entries(oldEnv)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  rmSync(temp, { recursive: true, force: true });
}
