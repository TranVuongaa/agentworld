// Rebuild the HQ server on source changes and restart it alongside Next's dev UI.
// esbuild's native binary also supports Node versions before module.register().
import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist-server', 'main.mjs');
let child = null;
let closing = false;
let buildContext;

async function stopChild() {
  const processToStop = child;
  child = null;
  if (!processToStop || processToStop.exitCode !== null || processToStop.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => { processToStop.kill('SIGKILL'); resolve(); }, 5000);
    processToStop.once('exit', () => { clearTimeout(timer); resolve(); });
    processToStop.kill('SIGTERM');
  });
}

const restart = {
  name: 'restart-hq',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length || closing) return;
      await stopChild();
      if (!closing) child = spawn(process.execPath, [output, '--dev', ...process.argv.slice(2)], { stdio: 'inherit', cwd: process.cwd(), env: process.env });
    });
  },
};

async function shutdown() {
  if (closing) return;
  closing = true;
  await stopChild();
  await buildContext?.dispose();
  process.exit(0);
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

buildContext = await context({
  absWorkingDir: root,
  entryPoints: ['server/main.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  logLevel: 'warning',
  plugins: [restart],
});
await buildContext.watch();
