// Local-only SaaS development entry point. Docker Desktop/Engine must be running.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';
import nextEnv from '@next/env';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const envFile = resolve(root, '.env.local');
if (!existsSync(envFile)) {
  const template = readFileSync(resolve(root, '.env.example'), 'utf8');
  const content = template.replace('SAAS_ENCRYPTION_KEY=', `SAAS_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`).replace('SAAS_LOCAL_DEV=0', 'SAAS_LOCAL_DEV=1');
  writeFileSync(envFile, content, { mode: 0o600, flag: 'wx' });
  console.log('Created .env.local with a new encryption key. Keep this file to retain access to encrypted data.');
}
nextEnv.loadEnvConfig(root, true);
const app = new URL(process.env.SAAS_APP_URL || 'http://127.0.0.1:7420');
if (process.env.SAAS_LOCAL_DEV !== '1' || app.protocol !== 'http:' || app.hostname !== '127.0.0.1' || app.pathname !== '/' || app.search || app.hash || app.username || app.password) {
  throw new Error('Local development requires SAAS_LOCAL_DEV=1 and a loopback SAAS_APP_URL such as http://127.0.0.1:7420 in .env.local');
}
const key = process.env.SAAS_ENCRYPTION_KEY || '';
if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32 || Buffer.from(key, 'base64').toString('base64') !== key) throw new Error('SAAS_ENCRYPTION_KEY must be a base64-encoded 32-byte key in .env.local');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in .env.local');
function run(file, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(file, args, { cwd: root, env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${file} exited with ${signal || code}`)));
  });
}
await run('docker', ['compose', 'up', '-d', '--wait', 'postgres']);
await run(process.execPath, ['scripts/migrate-saas.mjs']);
let gateway = null;
let stopping = false;
let build;
const bootToken = randomBytes(32).toString('base64url');

async function stopGateway(signal = 'SIGTERM') {
  const child = gateway;
  gateway = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((done) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 5000);
    child.once('exit', () => { clearTimeout(timer); done(); });
    child.kill(signal);
  });
}
function startGateway() {
  const child = spawn(process.execPath, [resolve(root, 'dist-server/saasGateway.mjs')], { cwd: root, env: { ...process.env, SAAS_LOCAL_BOOT_TOKEN: bootToken }, stdio: 'inherit' });
  gateway = child;
  child.once('error', (error) => { if (gateway === child) { console.error(error.message); process.exitCode = 1; void stop(); } });
  child.once('exit', (code, signal) => {
    if (gateway !== child || stopping) return;
    gateway = null;
    if (code !== 0) process.exitCode = code || (signal ? 1 : 0);
    void stop();
  });
  void (async () => {
    for (let attempt = 0; attempt < 150 && !stopping && gateway === child; attempt++) {
      try {
        const response = await fetch(new URL('/api/local/restore', app), { method: 'POST', headers: { 'x-agentworld-local-boot': bootToken }, signal: AbortSignal.timeout(2000) });
        if (response.ok) return;
      } catch { /* Gateway is still starting. */ }
      await new Promise((done) => setTimeout(done, 200));
    }
    if (!stopping && gateway === child) console.error('Could not restore local project coordinators automatically.');
  })();
}
const restartGateway = { name: 'restart-local-gateway', setup(builder) {
  builder.onEnd(async (result) => {
    if (result.errors.length || stopping) return;
    await stopGateway();
    if (!stopping) startGateway();
  });
} };
build = await context({ absWorkingDir: root, entryPoints: { main: 'server/main.ts', saasGateway: 'server/saasGateway.ts' }, outdir: 'dist-server', outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', target: 'node20', packages: 'external', logLevel: 'warning', plugins: [restartGateway] });
async function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  await stopGateway(signal);
  await build.dispose();
}
process.on('SIGINT', () => { void stop('SIGINT'); });
process.on('SIGTERM', () => { void stop('SIGTERM'); });
await build.watch();
