// Bundle a TypeScript test for the current Node runtime, without a loader.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, process.argv[2] ?? '');
const rel = relative(join(root, 'scripts'), entry);
if (!rel || rel.startsWith(`..${sep}`) || rel === '..') throw new Error('Expected a test inside scripts/.');
const temp = mkdtempSync(join(root, '.agentworld-test-'));
const output = join(temp, 'test.mjs');
try {
  await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node20', packages: 'external', logLevel: 'warning' });
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [output], { cwd: root, env: process.env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = code;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
