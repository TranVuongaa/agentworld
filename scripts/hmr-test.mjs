// Verify Fast Refresh and HQ WebSocket together without editing the real checkout.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [process.env.BROWSER_EXECUTABLE, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe')].filter(Boolean);
for (const command of ['google-chrome', 'chromium', 'chromium-browser']) {
  try { candidates.push(execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0]); } catch { /* try the next candidate */ }
}
const executablePath = candidates.find((candidate) => candidate && existsSync(candidate));
if (!executablePath) throw new Error('Set BROWSER_EXECUTABLE to a Chrome or Chromium executable.');
const temp = mkdtempSync(join(tmpdir(), 'agentworld-hmr-'));
const app = join(temp, 'app');
const repo = join(temp, 'repo');
const home = join(temp, 'home');
const excluded = new Set(['node_modules', '.next', '.next-dev', 'dist-server', 'next-env.d.ts']);
cpSync(root, app, { recursive: true, filter: (source) => source === root || (!excluded.has(basename(source)) && !basename(source).startsWith('.agentworld-test-') && !source.endsWith('.tsbuildinfo')) });
symlinkSync(join(root, 'node_modules'), join(app, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
mkdirSync(repo); mkdirSync(home);
execFileSync('git', ['init', '-q', repo]);
const port = await new Promise((resolve, reject) => {
  const server = createServer(); server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), HQ_SESSION_BACKEND: 'pty' };
for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY']) delete env[key];
const child = spawn(process.execPath, [join(app, 'scripts/dev-server.mjs'), '--repo', repo, '--port', String(port), '--no-open'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Development server exited before starting');
    return log.match(/token=([a-f0-9]+)/)?.[1];
  }, 'development server', 120_000);
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/?token=${token}`, { waitUntil: 'networkidle' });
  const welcome = page.getByRole('dialog', { name: 'Welcome to TranVuong HQ' });
  await welcome.waitFor();
  await welcome.getByRole('button', { name: 'Create team' }).click();
  await welcome.waitFor({ state: 'hidden', timeout: 30_000 });
  const setup = page.getByRole('dialog', { name: 'Setup checklist' });
  if (await setup.isVisible()) await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__agentworldHmrSentinel = 'same-document'; });
  const topBar = join(app, 'src/ui/hud/TopBar.tsx');
  const source = readFileSync(topBar, 'utf8');
  const updated = source.replace('>TranVuong HQ</b>', '>TranVuong HQ HMR CHECK</b>');
  assert.notEqual(updated, source, 'HMR test marker not found');
  writeFileSync(topBar, updated);
  await page.locator('header').getByText('TranVuong HQ HMR CHECK', { exact: true }).waitFor({ timeout: 60_000 });
  assert.equal(await page.evaluate(() => window.__agentworldHmrSentinel), 'same-document', 'Fast Refresh should not perform a full page navigation');
  // After refresh, the same page must still be able to send HQ commands.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: /^Boards/ }).click();
  await settings.getByLabel('New board').fill('HMR Board');
  await settings.getByRole('button', { name: 'Create', exact: true }).click();
  const planPath = join(repo, '.jsmhq', 'plan.json');
  await until(() => existsSync(planPath) && JSON.parse(readFileSync(planPath, 'utf8')).boards.some((board) => board.title === 'HMR Board'), 'board command after Fast Refresh');
  assert.deepEqual(errors, [], 'browser raised an unhandled error');
  console.log('✓ Fast Refresh updates the UI without navigation and HQ WebSocket remains usable');
} finally {
  if (browser) await browser.close();
  child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(7000)]);
  rmSync(temp, { recursive: true, force: true });
}
