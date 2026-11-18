// Install the packed application without development dependencies and exercise it
// from another directory, as an npm consumer would.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "agentworld-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (command, args, cwd, capture = false) => execFileSync(command, args, {
  cwd,
  encoding: "utf8",
  stdio: capture ? "pipe" : "inherit",
  ...(process.platform === "win32" ? { shell: true } : {}),
});

try {
  // The npm script builds first; skip prepack here to avoid a second build.
  const output = run(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", temp], root, true);
  const packed = JSON.parse(output)[0];
  const paths = packed.files.map((file) => file.path);
  if (!paths.includes(".next/BUILD_ID") || paths.some((path) => path.startsWith(".next/cache/"))) {
    throw new Error("Package must contain the Next.js build but not its build cache");
  }
  const consumer = join(temp, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), '{"private":true}\n');
  run(npm, ["install", "--omit=dev", "--no-audit", "--no-fund", join(temp, packed.filename)], consumer);
  const installed = join(consumer, "node_modules", "agentworld");
  // This test helper stays outside the published package, but runs against its files.
  copyFileSync(join(root, "scripts", "smoke-test.mjs"), join(installed, "scripts", "smoke-test.mjs"));
  run(process.execPath, [join(installed, "scripts", "smoke-test.mjs")], consumer);
  console.log("✓ packed application works with production dependencies only");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
