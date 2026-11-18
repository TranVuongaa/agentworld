// Exercise the Next.js server and the original HQ protocol on an isolated repo.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), 'agentworld-smoke-'));
const repo = join(tmp, 'repo');
const home = join(tmp, 'home');
mkdirSync(repo); mkdirSync(home);
const fakeBin = join(tmp, 'bin');
mkdirSync(fakeBin);
// The default is an offline stand-in. The optional real CLI check uses an empty HOME and no API keys.
const realCodex = process.argv.includes('--real-codex');
const fakeCodex = join(fakeBin, 'codex');
if (realCodex) {
  const binary = execFileSync('which', ['codex'], { encoding: 'utf8' }).trim();
  symlinkSync(binary, fakeCodex);
} else {
  writeFileSync(fakeCodex, `#!${process.execPath}\nif (process.argv.includes('--version')) { console.log('codex smoke-test'); process.exit(0); }\nconsole.log('FAKE_CODEX_READY'); process.stdin.setEncoding('utf8'); process.stdin.on('data', data => console.log('FAKE_CODEX_INPUT:' + data));\n`);
  chmodSync(fakeCodex, 0o755);
}
execFileSync('git', ['init', '-q', repo]);
writeFileSync(join(repo, 'README.md'), '# smoke test\n');
execFileSync('git', ['-C', repo, 'add', 'README.md']);
execFileSync('git', ['-C', repo, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'initial']);
const sandboxFixture = process.argv.includes('--sandbox');
const sbxLog = join(tmp, 'sbx.log');
const rulesFile = join(tmp, 'sbx-rules.json');
const secretsFile = join(tmp, 'sbx-secrets.json');
const secretHashFile = join(tmp, 'sbx-secret-hash');
const proxyFile = join(tmp, 'sbx-proxy');
const mcpFile = join(tmp, 'sbx-mcp.json');
if (sandboxFixture) {
  writeFileSync(mcpFile, '[]');
  writeFileSync(secretsFile, JSON.stringify([{ type: 'service', scope: 'global', name: 'github' }, { type: 'service', scope: 'global', name: 'openai' }]));
  writeFileSync(rulesFile, JSON.stringify([{ id: 'external-rule', applies_to: 'sandbox:hq-repo-sandbox-worker', resource_type: 'network', decision: 'allow', resources: ['existing.example'], layer: 'local', status: 'active' }]));
  const fakeSbx = join(fakeBin, 'sbx');
  const stateFile = join(tmp, 'sbx-state.json');
  writeFileSync(fakeSbx, `#!${process.execPath}\n` + `
const fs = require('fs');
const args = process.argv.slice(2);
const state = ${JSON.stringify(stateFile)};
const rulesFile = ${JSON.stringify(rulesFile)};
const secretsFile = ${JSON.stringify(secretsFile)};
const secretHashFile = ${JSON.stringify(secretHashFile)};
const proxyFile = ${JSON.stringify(proxyFile)};
const mcpFile = ${JSON.stringify(mcpFile)};
fs.appendFileSync(${JSON.stringify(sbxLog)}, JSON.stringify(args) + '\\n');
if (args[0] === 'run') {
  const name = args[args.indexOf('--name') + 1];
  fs.writeFileSync(state, JSON.stringify([{ name }]));
  console.log('FAKE_SANDBOX_READY');
  process.stdin.resume();
} else if (args[0] === 'version') console.log('sbx version smoke');
else if (args[0] === 'ls') console.log(fs.existsSync(state) ? fs.readFileSync(state, 'utf8') : '[]');
else if (args[0] === 'secret' && args[1] === 'ls') {
  const secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
  console.log(args.includes('--json') ? JSON.stringify({ secrets }) : secrets.map((entry) => entry.name).join(' '));
} else if (args[0] === 'secret' && args[1] === 'set') {
  let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (data) => input += data);
  process.stdin.on('end', () => {
    const scope = args.includes('--sandbox') ? args[args.indexOf('--sandbox') + 1] : 'global';
    const secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8')).filter((entry) => !(entry.name === args[2] && entry.scope === scope));
    secrets.push({ type: 'service', scope, name: args[2] });
    fs.writeFileSync(secretsFile, JSON.stringify(secrets));
    fs.writeFileSync(secretHashFile, require('crypto').createHash('sha256').update(input).digest('hex'));
  });
} else if (args[0] === 'secret' && args[1] === 'rm') {
  const scope = args.includes('--sandbox') ? args[args.indexOf('--sandbox') + 1] : 'global';
  const secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8')).filter((entry) => !(entry.name === args[2] && entry.scope === scope));
  fs.writeFileSync(secretsFile, JSON.stringify(secrets));
} else if (args[0] === 'settings' && args[1] === 'get') {
  if (fs.existsSync(proxyFile)) process.stdout.write(fs.readFileSync(proxyFile, 'utf8'));
} else if (args[0] === 'settings' && args[1] === 'set') fs.writeFileSync(proxyFile, args[3]);
else if (args[0] === 'settings' && args[1] === 'unset') fs.rmSync(proxyFile, { force: true });
else if (args[0] === 'mcp' && args[1] === 'ls') console.log(JSON.stringify({ servers: JSON.parse(fs.readFileSync(mcpFile, 'utf8')) }));
else if (args[0] === 'mcp' && args[1] === 'add') {
  const servers = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
  servers.push({ name: args[2], transport: args.includes('--url') ? 'remote http' : 'local stdio', status: 'ready' });
  fs.writeFileSync(mcpFile, JSON.stringify(servers));
} else if (args[0] === 'mcp' && args[1] === 'rm') {
  const servers = JSON.parse(fs.readFileSync(mcpFile, 'utf8')).filter((entry) => entry.name !== args[2]);
  fs.writeFileSync(mcpFile, JSON.stringify(servers));
} else if (args[0] === 'mcp' && args[1] === 'auth') console.log('FAKE_MCP_AUTH');
else if (args[0] === 'mcp' && args[1] === 'load') console.log('FAKE_MCP_LOADED');
else if (args[0] === 'policy' && args[1] === 'check') console.log('Allowed: ' + args[3]);
else if (args[0] === 'policy' && args[1] === 'ls') console.log(JSON.stringify({ rules: JSON.parse(fs.readFileSync(rulesFile, 'utf8')) }));
else if (args[0] === 'policy' && (args[1] === 'allow' || args[1] === 'deny')) {
  if (args[args.length - 1] === 'refused.example.com') { console.error('fixture refusal'); process.exit(1); }
  const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
  const name = args[args.indexOf('--sandbox') + 1];
  rules.push({ id: 'test-' + Date.now(), applies_to: 'sandbox:' + name, resource_type: 'network', decision: args[1], resources: [args[args.length - 1]], layer: 'local', status: 'active' });
  fs.writeFileSync(rulesFile, JSON.stringify(rules));
} else if (args[0] === 'policy' && args[1] === 'rm') {
  const id = args[args.indexOf('--id') + 1];
  const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8')).filter((rule) => rule.id !== id);
  fs.writeFileSync(rulesFile, JSON.stringify(rules));
} else console.log('[]');
`);
  chmodSync(fakeSbx, 0o755);
}
const githubFixture = process.argv.includes('--github');
const githubFixtureFile = join(tmp, 'github.json');
if (githubFixture) {
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example/fixture.git']);
  const pr = { number: 42, title: '[SB-T01] Smoke task', url: 'https://github.com/example/fixture/pull/42', headRefName: 'smoke-worker/SB-T01', createdAt: '2026-01-01T00:00:00Z', mergedAt: null, state: 'OPEN', mergeable: 'MERGEABLE', isDraft: false, reviewDecision: 'APPROVED', reviews: { nodes: [] }, reviewThreads: { nodes: [] }, commits: { nodes: [] } };
  const fixture = { data: { rateLimit: { cost: 1, remaining: 4999, resetAt: '2099-01-01T00:00:00Z' }, repository: { open: { nodes: [pr] }, merged: { nodes: [] }, closed: { nodes: [] } } } };
  const fakeGh = join(fakeBin, 'gh');
  writeFileSync(githubFixtureFile, JSON.stringify(fixture));
  writeFileSync(fakeGh, `#!${process.execPath}\nif (process.argv.includes('graphql')) console.log(require('fs').readFileSync(${JSON.stringify(githubFixtureFile)}, 'utf8')); else console.log('gh version 1.0 account smoke');\n`);
  chmodSync(fakeGh, 0o755);
}

const port = 18000 + Math.floor(Math.random() * 20000);
const child = spawn(process.execPath, [join(root, 'bin/agentworld.mjs'), '--repo', repo, '--port', String(port), '--no-open', ...(process.argv.includes('--dev') ? ['--dev'] : [])], {
  cwd: tmp, env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), OPENAI_API_KEY: '', CODEX_API_KEY: '', PATH: `${fakeBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`, HQ_SESSION_BACKEND: 'pty' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (d) => { logs += d; });
child.stderr.on('data', (d) => { logs += d; });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let token;
  for (let i = 0; i < 1200; i++) {
    if (child.exitCode !== null) throw new Error(`server exited: ${logs}`);
    token = logs.match(/token=([a-f0-9]+)/)?.[1];
    if (token) break;
    await delay(100);
  }
  assert(token, `server did not start: ${logs}`);
  const origin = `http://127.0.0.1:${port}`;
  const page = await fetch(`${origin}/?token=${token}`);
  assert(page.ok && (await page.text()).includes('id="root"'), 'Next.js page unavailable');
  const fallback = await fetch(`${origin}/unrecognized/nested-path?token=${token}`);
  assert(fallback.ok && (await fallback.text()).includes('id="root"'), 'SPA fallback page unavailable');
  assert((await (await fetch(`${origin}/api/health`)).json()).ok, 'health check failed');
  assert((await fetch(`${origin}/hook/nobody/SessionStart`, { method: 'POST' })).status === 401, 'hook authentication failed');
  assert((await fetch(`${origin}/mcp`, { method: 'POST' })).status === 401, 'MCP authentication failed');
  await new Promise((resolve, reject) => {
    const bad = new WebSocket(`${origin.replace('http', 'ws')}/ws?token=wrong`, { headers: { Origin: origin } });
    bad.on('unexpected-response', (_, res) => res.statusCode === 401 ? resolve() : reject(new Error('invalid token accepted')));
    bad.on('open', () => reject(new Error('invalid token accepted')));
    bad.on('error', reject);
  });
  await new Promise((resolve, reject) => {
    const crossOrigin = new WebSocket(`${origin.replace('http', 'ws')}/ws?token=${token}`, { headers: { Origin: 'https://untrusted.example' } });
    crossOrigin.on('unexpected-response', (_, res) => res.statusCode === 401 ? resolve() : reject(new Error('unexpected origin response')));
    crossOrigin.on('open', () => reject(new Error('untrusted origin accepted')));
    crossOrigin.on('error', reject);
  });
  await new Promise((resolve, reject) => {
    const unknown = new WebSocket(`${origin.replace('http', 'ws')}/unrecognized-upgrade?token=${token}`, { headers: { Origin: origin } });
    unknown.on('unexpected-response', (_, res) => res.statusCode === 401 ? resolve() : reject(new Error('unexpected upgrade response')));
    unknown.on('open', () => reject(new Error('unknown upgrade accepted')));
    unknown.on('error', reject);
  });
  const ws = new WebSocket(`${origin.replace('http', 'ws')}/ws?token=${token}`, { headers: { Origin: origin } });
  const events = [];
  ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
  const wait = async (predicate, label, attempts = 200) => {
    for (let i = 0; i < attempts; i++) { const event = events.find(predicate); if (event) return event; await delay(50); }
    throw new Error(`missing ${label}`);
  };
  const snapshot = await wait((e) => e.type === 'snapshot', 'snapshot');
  if (process.argv.includes('--dev')) {
    await new Promise((resolve, reject) => {
      const hmr = new WebSocket(`${origin.replace('http', 'ws')}/_next/webpack-hmr`, { headers: { Origin: origin } });
      const timer = setTimeout(() => { hmr.terminate(); reject(new Error('Next.js HMR did not connect')); }, 10_000);
      hmr.on('message', () => { clearTimeout(timer); hmr.close(); resolve(); });
      hmr.on('error', (error) => { clearTimeout(timer); reject(error); });
    });
  }
  assert(snapshot.snapshot.welcome === true, 'fresh repository should show welcome');
  const agentId = snapshot.snapshot.config.team[0].id;
  const agentToken = readFileSync(join(home, '.jsmhq/repo/agent-token'), 'utf8').trim();
  const hook = await fetch(`${origin}/hook/${agentId}/UserPromptSubmit`, {
    method: 'POST', headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'smoke test' }),
  });
  assert(hook.status === 204, `authenticated hook returned ${hook.status}`);
  await wait((e) => e.type === 'agent.updated' && e.agent.agentId === agentId && e.agent.state === 'working', 'hook update');
  const mcp = await fetch(`${origin}/mcp`, {
    method: 'POST', headers: { Authorization: `Bearer ${agentToken}`, 'x-hq-agent': agentId, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } }),
  });
  assert(mcp.ok && (await mcp.text()).includes('protocolVersion'), `MCP initialize returned ${mcp.status}`);
  ws.send(JSON.stringify({ cmd: 'createBoard' , args: ['Smoke Board'] }));
  await wait((e) => e.type === 'board.updated' && e.board.title === 'Smoke Board', 'board update');
  assert(JSON.parse(readFileSync(join(repo, '.jsmhq/plan.json'), 'utf8')).boards.some((b) => b.title === 'Smoke Board'), 'board was not persisted');
  // Exercise a local agent through HQ, including workspace creation and real terminal I/O.
  ws.send(JSON.stringify({ cmd: 'addAgent', args: [{ name: 'Smoke Worker', role: 'Developer', cli: 'codex', mode: 'local' }] }));
  await wait((e) => e.type === 'config.updated' && e.config.team.some((a) => a.id === 'smoke-worker'), 'new agent');
  await wait((e) => e.type === 'setup.updated' && e.setup.checks.some((c) => c.id === 'codex' && c.status === 'ok'), 'Codex setup check');
  ws.send(JSON.stringify({ cmd: 'startAgent', args: ['smoke-worker'] }));
  await wait((e) => e.type === 'agent.updated' && e.agent.agentId === 'smoke-worker' && e.agent.session.state === 'running', 'running agent');
  await wait((e) => e.type === 'terminal.output' && e.agentId === 'smoke-worker' && (realCodex || e.data.includes('FAKE_CODEX_READY')), 'agent terminal');
  assert(readFileSync(join(home, '.jsmhq/repo/smoke-worker/.codex/config.toml'), 'utf8').includes('[mcp_servers.hq]'), 'agent MCP configuration missing');
  if (realCodex) {
    // Stop before assigning a task: the CLI remains unauthenticated and receives no prompt.
    ws.send(JSON.stringify({ cmd: 'stopAgent', args: ['smoke-worker'] }));
    await wait((e) => e.type === 'agent.updated' && e.agent.agentId === 'smoke-worker' && e.agent.session.state === 'stopped', 'stopped real Codex');
  } else {
    ws.send(JSON.stringify({ cmd: 'sendTerminalInput', args: ['smoke-worker', 'hello-agent\r'] }));
    await wait((e) => e.type === 'terminal.output' && e.agentId === 'smoke-worker' && e.data.includes('FAKE_CODEX_INPUT:'), 'agent input');
  }

  const callTool = async (name, args, caller = agentId, expectError = false) => {
    const response = await fetch(`${origin}/mcp`, {
      method: 'POST', headers: { Authorization: `Bearer ${agentToken}`, 'x-hq-agent': caller, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await response.text();
    const data = body.split('\n').find((line) => line.startsWith('data:'));
    const message = JSON.parse(data ? data.slice(5).trim() : body);
    assert(response.ok && message.result && !message.error, `MCP ${name} failed at protocol level`);
    assert(!!message.result.isError === expectError, `MCP ${name} returned an unexpected tool result`);
    return message.result;
  };
  await callTool('create_task', { title: 'Smoke task', boardId: 'SB' });
  const task = (await wait((e) => e.type === 'task.updated' && e.task.title === 'Smoke task', 'created task')).task;
  await callTool('create_task', { title: 'Forbidden task', boardId: 'SB' }, 'smoke-worker', true);
  await callTool('assign_task', { taskId: task.id, agent: 'smoke-worker' });
  await wait((e) => e.type === 'task.updated' && e.task.id === task.id && e.task.ownerId === 'smoke-worker', 'assigned task');
  await callTool('get_my_task', {}, 'smoke-worker');
  await wait((e) => e.type === 'task.updated' && e.task.id === task.id && e.task.status === 'in-progress', 'task in progress');
  await callTool('set_my_status', { status: 'blocked', note: 'Smoke blocker' }, 'smoke-worker');
  await wait((e) => e.type === 'task.updated' && e.task.id === task.id && e.task.status === 'blocked', 'blocked task');
  const beforeResume = events.length;
  await callTool('set_my_status', { status: 'in-progress' }, 'smoke-worker');
  await wait((e) => events.indexOf(e) >= beforeResume && e.type === 'task.updated' && e.task.id === task.id && e.task.status === 'in-progress', 'resumed task');
  await callTool('ask_user', { title: 'Smoke action', details: 'Temporary test item', waiting: false }, 'smoke-worker');
  const action = (await wait((e) => e.type === 'action.updated' && e.item.title === 'Smoke action', 'action item')).item;
  ws.send(JSON.stringify({ cmd: 'resolveActionItem', args: [action.id, 'done', 'Completed in test'] }));
  await wait((e) => e.type === 'action.updated' && e.item.id === action.id && e.item.status === 'done', 'resolved action item');
  const savedActions = JSON.parse(readFileSync(join(home, '.jsmhq/repo/action-items.json'), 'utf8'));
  assert(savedActions.some((item) => item.id === action.id && item.status === 'done'), 'resolved action item was not persisted');
  if (!githubFixture) {
    await callTool('set_my_status', { status: 'done' }, 'smoke-worker');
    await wait((e) => e.type === 'task.updated' && e.task.id === task.id && e.task.status === 'done', 'completed task');
  }
  if (githubFixture) {
    const pr = await wait((e) => e.type === 'pr.updated' && e.pr.number === 42, 'GitHub PR', 600).catch(() => ({ pr: snapshot.snapshot.pullRequests.find((p) => p.number === 42) }));
    assert(pr.pr?.review === 'passed', 'approved PR was not synchronized');
    await wait((e) => e.type === 'task.updated' && e.task.id === task.id && e.task.status === 'in-review' && e.task.prNumber === 42, 'GitHub PR task sync', 700);
    const fixture = JSON.parse(readFileSync(githubFixtureFile, 'utf8'));
    const merged = fixture.data.repository.open.nodes.pop();
    merged.state = 'MERGED';
    merged.mergedAt = '2026-01-02T00:00:00Z';
    fixture.data.repository.merged.nodes.push(merged);
    writeFileSync(githubFixtureFile, JSON.stringify(fixture));
    await wait((e) => e.type === 'task.updated' && e.task.id === task.id && e.task.status === 'done', 'merged PR completes task', 700);
  }
  ws.send(JSON.stringify({ cmd: 'stopAgent' , args: ['smoke-worker'] }));
  await wait((e) => e.type === 'agent.updated' && e.agent.agentId === 'smoke-worker' && e.agent.session.state === 'stopped', 'stopped agent');

  if (sandboxFixture) {
    assert(snapshot.snapshot.setup.sandboxReady, 'fixture platform does not support the sandbox setup');
    ws.send(JSON.stringify({ cmd: 'addAgent', args: [{ name: 'Sandbox Worker', role: 'Developer', cli: 'claude', mode: 'sandbox' }] }));
    await wait((e) => e.type === 'config.updated' && e.config.team.some((a) => a.id === 'sandbox-worker'), 'new sandbox agent');
    ws.send(JSON.stringify({ cmd: 'startAgent', args: ['sandbox-worker'] }));
    await wait((e) => e.type === 'agent.updated' && e.agent.agentId === 'sandbox-worker' && e.agent.session.state === 'running', 'running sandbox agent');
    await wait((e) => e.type === 'terminal.output' && e.agentId === 'sandbox-worker' && e.data.includes('FAKE_SANDBOX_READY'), 'sandbox terminal');
    assert(readFileSync(join(home, '.jsmhq/repo/sandbox-worker/.claude/hq-mcp.json'), 'utf8').includes('host.docker.internal'), 'sandbox MCP configuration missing');
    // Wait for onSandboxReady's initial rule synchronization before testing changes.
    const ownedPath = join(home, '.jsmhq/repo/sbx-owned.json');
    const sandboxName = 'hq-repo-sandbox-worker';
    for (let i = 0; i < 400; i++) {
      if (existsSync(ownedPath) && Object.hasOwn(JSON.parse(readFileSync(ownedPath, 'utf8')), sandboxName)) break;
      await delay(50);
    }
    assert(existsSync(ownedPath) && Object.hasOwn(JSON.parse(readFileSync(ownedPath, 'utf8')), sandboxName), 'initial sandbox rule sync did not finish');
    await callTool('request_access', { domain: 'https://docs.example.com/guide', reason: 'Read documentation' }, 'sandbox-worker');
    const request = (await wait((e) => e.type === 'access.updated' && e.request.domain === 'docs.example.com' && e.request.status === 'pending', 'access request')).request;
    ws.send(JSON.stringify({ cmd: 'resolveAccess', args: [request.id, 'agent'] }));
    await wait((e) => e.type === 'access.updated' && e.request.id === request.id && e.request.status === 'allowed', 'allowed access request');
    const readRules = () => JSON.parse(readFileSync(rulesFile, 'utf8'));
    assert(readRules().some((rule) => rule.resources.includes('docs.example.com')), 'sandbox allow rule was not added');
    assert(readRules().some((rule) => rule.id === 'external-rule'), 'existing external sandbox rule was removed');
    ws.send(JSON.stringify({ cmd: 'updateSandbox', args: ['sandbox-worker', { allow: [] }] }));
    for (let i = 0; i < 200 && readRules().some((rule) => rule.resources.includes('docs.example.com')); i++) await delay(50);
    assert(!readRules().some((rule) => rule.resources.includes('docs.example.com')), 'owned sandbox rule was not removed');
    assert(readRules().some((rule) => rule.id === 'external-rule'), 'unowned sandbox rule was removed');
    await callTool('request_access', { domain: 'denied.example.com', reason: 'Temporary test' }, 'sandbox-worker');
    const denied = (await wait((e) => e.type === 'access.updated' && e.request.domain === 'denied.example.com' && e.request.status === 'pending', 'second access request')).request;
    ws.send(JSON.stringify({ cmd: 'resolveAccess', args: [denied.id, 'deny'] }));
    await wait((e) => e.type === 'access.updated' && e.request.id === denied.id && e.request.status === 'denied', 'denied access request');
    assert(!readRules().some((rule) => rule.resources.includes('denied.example.com')), 'denied domain received a rule');
    await callTool('request_access', { domain: 'refused.example.com', reason: 'Temporary test' }, 'sandbox-worker');
    const refused = (await wait((e) => e.type === 'access.updated' && e.request.domain === 'refused.example.com' && e.request.status === 'pending', 'third access request')).request;
    ws.send(JSON.stringify({ cmd: 'resolveAccess', args: [refused.id, 'agent'] }));
    await wait((e) => e.type === 'activity' && e.event.text.includes("Couldn't allow refused.example.com"), 'failed rule activity');
    assert(!readRules().some((rule) => rule.resources.includes('refused.example.com')), 'failed sandbox rule was applied');
    const savedConfig = JSON.parse(readFileSync(join(repo, '.jsmhq/config.json'), 'utf8'));
    assert(!savedConfig.team.find((agent) => agent.id === 'sandbox-worker').sandbox.allow.includes('refused.example.com'), 'failed rule was not rolled back');
    assert(!events.some((e) => e.type === 'access.updated' && e.request.id === refused.id && e.request.status !== 'pending'), 'failed request should remain pending');
    const dummySecret = 'agentworld-dummy-secret-for-isolated-test';
    const beforeSecret = events.length;
    ws.send(JSON.stringify({ cmd: 'setSecret', args: ['sandbox-worker', 'groq', dummySecret] }));
    await wait((e) => events.indexOf(e) >= beforeSecret && e.type === 'sbx.updated' && e.sbx.agents['sandbox-worker']?.keys.includes('groq'), 'sandbox secret metadata');
    assert(readFileSync(secretHashFile, 'utf8') === createHash('sha256').update(dummySecret + '\n').digest('hex'), 'sandbox CLI did not receive the secret through stdin');
    assert(!readFileSync(sbxLog, 'utf8').includes(dummySecret), 'secret appeared in CLI arguments');
    assert(!JSON.stringify(events).includes(dummySecret) && !logs.includes(dummySecret), 'secret appeared in server output');
    assert(!readFileSync(join(repo, '.jsmhq/config.json'), 'utf8').includes(dummySecret), 'secret was persisted in project config');
    const beforeRemoval = events.length;
    ws.send(JSON.stringify({ cmd: 'removeSecret', args: ['sandbox-worker', 'groq'] }));
    await wait((e) => events.indexOf(e) >= beforeRemoval && e.type === 'activity' && e.event.text.includes('Removed the groq key'), 'sandbox secret removal');
    assert(!JSON.parse(readFileSync(secretsFile, 'utf8')).some((entry) => entry.name === 'groq'), 'sandbox CLI did not remove the secret');
    const proxy = 'http://127.0.0.1:3128';
    const beforeProxy = events.length;
    ws.send(JSON.stringify({ cmd: 'setProxy', args: [proxy] }));
    await wait((e) => events.indexOf(e) >= beforeProxy && e.type === 'sbx.updated' && e.sbx.proxy === proxy, 'sandbox proxy');
    assert(readFileSync(proxyFile, 'utf8') === proxy, 'sandbox CLI did not set the proxy');
    const beforeProxyRemoval = events.length;
    ws.send(JSON.stringify({ cmd: 'setProxy', args: [null] }));
    await wait((e) => events.indexOf(e) >= beforeProxyRemoval && e.type === 'activity' && e.event.text.includes('Removed the sandbox proxy'), 'sandbox proxy removal');
    assert(!existsSync(proxyFile), 'sandbox CLI did not remove the proxy');
    const dummyMcpKey = 'agentworld-dummy-mcp-key-for-isolated-test';
    const beforeMcp = events.length;
    ws.send(JSON.stringify({ cmd: 'addMcp', args: [{ name: 'fixture-mcp', url: 'https://mcp.example.com/api', apiKey: dummyMcpKey }] }));
    await wait((e) => events.indexOf(e) >= beforeMcp && e.type === 'mcp.updated' && e.mcp.servers.some((server) => server.name === 'fixture-mcp'), 'registered MCP server');
    assert(readFileSync(secretHashFile, 'utf8') === createHash('sha256').update(dummyMcpKey + '\n').digest('hex'), 'MCP key was not sent via stdin');
    assert(!readFileSync(sbxLog, 'utf8').includes(dummyMcpKey), 'MCP key appeared in CLI arguments');
    assert(!JSON.stringify(events).includes(dummyMcpKey) && !logs.includes(dummyMcpKey), 'MCP key appeared in server output');
    assert(!readFileSync(join(repo, '.jsmhq/config.json'), 'utf8').includes(dummyMcpKey), 'MCP key was persisted in project config');
    ws.send(JSON.stringify({ cmd: 'setAgentMcp', args: ['sandbox-worker', ['fixture-mcp']] }));
    await wait((e) => e.type === 'mcp.updated' && e.mcp.attached['sandbox-worker']?.includes('fixture-mcp'), 'attached MCP server');
    const attached = JSON.parse(readFileSync(join(home, '.jsmhq/repo/mcp-attached.json'), 'utf8'));
    assert(attached['sandbox-worker'].includes('fixture-mcp'), 'MCP attachment was not persisted');
    ws.send(JSON.stringify({ cmd: 'authMcp', args: ['fixture-mcp'] }));
    await wait((e) => e.type === 'terminal.output' && e.agentId === 'setup:mcp-auth-fixture-mcp' && e.data.includes('FAKE_MCP_AUTH'), 'MCP authorization terminal');
    ws.send(JSON.stringify({ cmd: 'setAgentMcp', args: ['sandbox-worker', []] }));
    await wait((e) => e.type === 'activity' && e.event.text.includes("sandbox keeps fixture-mcp until it's recreated"), 'MCP detach notice');
    ws.send(JSON.stringify({ cmd: 'setAgentMcp', args: ['sandbox-worker', ['fixture-mcp']] }));
    await wait((e) => e.type === 'config.updated' && e.config.team.find((agent) => agent.id === 'sandbox-worker')?.mcp.includes('fixture-mcp'), 'MCP reassignment');
    const beforeMcpRemoval = events.length;
    ws.send(JSON.stringify({ cmd: 'removeMcp', args: ['fixture-mcp'] }));
    await wait((e) => events.indexOf(e) >= beforeMcpRemoval && e.type === 'mcp.updated' && !e.mcp.servers.some((server) => server.name === 'fixture-mcp'), 'MCP server removal');
    const afterMcp = JSON.parse(readFileSync(join(repo, '.jsmhq/config.json'), 'utf8'));
    assert(!afterMcp.team.find((agent) => agent.id === 'sandbox-worker').mcp.includes('fixture-mcp'), 'MCP server remained in agent config');
    assert(!JSON.parse(readFileSync(secretsFile, 'utf8')).some((entry) => entry.name.startsWith('mcp:fixture-mcp:')), 'MCP secret was not removed');
    ws.send(JSON.stringify({ cmd: 'addMcp', args: [{ name: 'fixture-local', command: 'node', args: ['server.js', '--safe'] }] }));
    await wait((e) => e.type === 'mcp.updated' && e.mcp.servers.some((server) => server.name === 'fixture-local' && server.transport === 'local stdio'), 'local MCP server');
    ws.send(JSON.stringify({ cmd: 'removeMcp', args: ['fixture-local'] }));
    await wait((e) => e.type === 'activity' && e.event.text.includes('Removed MCP server fixture-local'), 'local MCP removal');
    const calls = readFileSync(sbxLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert(calls.some((args) => args[0] === 'run' && args.includes('hq-repo-sandbox-worker') && args.includes('claude')), 'sandbox launch arguments missing');
    assert(calls.some((args) => args[0] === 'mcp' && args[1] === 'add' && args[2] === 'fixture-mcp' && args.includes('Authorization: Bearer ${token}')), 'remote MCP token placeholder missing');
    assert(calls.some((args) => args[0] === 'mcp' && args[1] === 'load' && args[2] === 'fixture-mcp' && args.includes('hq-repo-sandbox-worker')), 'MCP server was not loaded into the sandbox');
    assert(calls.some((args) => args[0] === 'mcp' && args[1] === 'add' && args[2] === 'fixture-local' && args.includes('server.js,--safe')), 'local MCP command arguments missing');
    ws.send(JSON.stringify({ cmd: 'stopAgent', args: ['sandbox-worker'] }));
    await wait((e) => e.type === 'agent.updated' && e.agent.agentId === 'sandbox-worker' && e.agent.session.state === 'stopped', 'stopped sandbox agent');
  }

  ws.send(JSON.stringify({ cmd: 'openHostShell' , args: ['', true] }));
  await delay(1000);
  ws.send(JSON.stringify({ cmd: 'sendTerminalInput', args: ['shell:@host', 'echo AGENTWORLD_SMOKE_OK\r'] }));
  await wait((e) => e.type === 'terminal.output' && e.agentId === 'shell:@host' && e.data.includes('AGENTWORLD_SMOKE_OK'), 'terminal output');
  ws.send(JSON.stringify({ cmd: 'closeHostShell', args: [] }));
  ws.close();
  console.log(`✓ Next.js page, health, authentication, hooks, MCP, agent lifecycle, task and action-item workflows, persistence and terminal${githubFixture ? ', GitHub PR sync' : ''}${realCodex ? ', real unauthenticated Codex startup' : ''}${sandboxFixture ? ', sandbox rules, secrets, proxy and MCP integration' : ''}`);
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
  rmSync(tmp, { recursive: true, force: true });
}
