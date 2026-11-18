// Exercises the production Next.js UI against an isolated HQ server and git repo.
// Set BROWSER_EXECUTABLE to a Chromium/Chrome binary if it is not on PATH.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [process.env.BROWSER_EXECUTABLE,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);
for (const command of ['google-chrome', 'chromium', 'chromium-browser']) {
  try { candidates.push(execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0]); } catch { /* try the next candidate */ }
}
const executablePath = candidates.find((candidate) => candidate && existsSync(candidate));
if (!executablePath) throw new Error('Set BROWSER_EXECUTABLE to a Chrome or Chromium executable.');
const temp = mkdtempSync(join(tmpdir(), 'agentworld-browser-'));
const home = join(temp, 'home');
const repo = join(temp, 'repo');
mkdirSync(home); mkdirSync(repo);
execFileSync('git', ['init', '-q', repo]);
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), HQ_SESSION_BACKEND: 'pty' };
for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY']) delete env[key];
const child = spawn(process.execPath, [join(root, 'bin/agentworld.mjs'), '--repo', repo, '--port', String(port), '--no-open'], {
  cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (data) => { log += data; });
child.stderr.on('data', (data) => { log += data; });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn, label, timeout = 30_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = fn(); if (value) return value; await delay(100); }
  throw new Error(`Timed out waiting for ${label}`);
};
let browser;
try {
  const token = await until(() => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('HQ exited before starting');
    return log.match(/token=([a-f0-9]+)/)?.[1];
  }, 'HQ startup', 120_000);
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/nested/office?token=${token}`, { waitUntil: 'networkidle' });
  assert.equal(new URL(page.url()).pathname, '/nested/office');
  const welcome = page.getByRole('dialog', { name: 'Welcome to TranVuong HQ' });
  await welcome.waitFor();
  await welcome.getByLabel('Project name').fill('Browser Test Project');
  await welcome.getByRole('button', { name: 'Create team' }).click();
  await welcome.waitFor({ state: 'hidden', timeout: 30_000 });
  const configPath = join(repo, '.jsmhq', 'config.json');
  const config = await until(() => existsSync(configPath) && JSON.parse(readFileSync(configPath, 'utf8')), 'project config');
  assert.equal(config.project.name, 'Browser Test Project');
  assert.equal(config.team.length, 2);
  const setup = page.getByRole('dialog', { name: 'Setup checklist' });
  if (await setup.isVisible()) await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: /^Boards/ }).click();
  await settings.getByLabel('New board').fill('Browser Board');
  await settings.getByRole('button', { name: 'Create', exact: true }).click();
  const planPath = join(repo, '.jsmhq', 'plan.json');
  await until(() => existsSync(planPath) && JSON.parse(readFileSync(planPath, 'utf8')).boards.some((b) => b.title === 'Browser Board'), 'board persistence');
  await settings.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  const boards = page.getByRole('dialog', { name: 'Boards' });
  await boards.getByRole('button', { name: 'Browser Board' }).waitFor();
  await boards.getByRole('button', { name: 'Close', exact: true }).click();

  // Simulate the agent-side MCP call, then resolve it through the real UI.
  const agentToken = readFileSync(join(home, '.jsmhq', 'repo', 'agent-token'), 'utf8').trim();
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST', headers: { Authorization: `Bearer ${agentToken}`, 'x-hq-agent': config.team[1].id, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask_user', arguments: { title: 'Browser action', details: 'Temporary test request', waiting: false } } }),
  });
  assert.equal(response.status, 200);
  await page.getByRole('button', { name: /^Action items/ }).click();
  const drawer = page.locator('aside[aria-label="Details"]');
  await drawer.getByText('Browser action', { exact: true }).waitFor();
  await drawer.getByRole('button', { name: 'Done', exact: true }).click();
  const actionsPath = join(home, '.jsmhq', 'repo', 'action-items.json');
  await until(() => existsSync(actionsPath) && JSON.parse(readFileSync(actionsPath, 'utf8')).some((item) => item.title === 'Browser action' && item.status === 'done'), 'action resolution');
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  const terminal = page.locator('aside[aria-label="Details"]');
  await terminal.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type("printf 'BROWSER_%s_OK\\n' TEST", { delay: 5 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('BROWSER_TEST_OK'), null, { timeout: 20_000 });
  assert.deepEqual(errors, [], 'browser raised an unhandled error');
  console.log('✓ Browser SPA fallback, welcome, board, MCP action resolution, and interactive terminal');
} finally {
  if (browser) await browser.close();
  child.kill('SIGTERM');
  if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
  rmSync(temp, { recursive: true, force: true });
}
