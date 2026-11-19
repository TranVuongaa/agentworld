import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Hub } from "../server/hub";
import { detectRepo } from "../server/repo";
import { Sbx } from "../server/sbx";
import { loadConfig, loadPlan } from "../server/store";
import type { SetupState } from "../src/data/types";

if (process.platform === "win32") { console.log("Sandbox credential fixture requires a POSIX executable shim"); process.exit(0); }
if (process.argv.includes("--worker")) {
  const repo = await detectRepo(process.env.TEST_REPO!), config = loadConfig(repo, 7420).config;
  config.project.githubAuth = "app";
  const hub = new Hub(repo, "sandbox-fixture", config, loadPlan(repo.root), { sandboxReady: true, checks: [] } as unknown as SetupState);
  const manager = new Sbx(hub);
  await assert.rejects(() => manager.prepareManagedKeys("worker-1"), /openai/);
  await assert.rejects(() => manager.removeKey(null, "openai"), /machine-wide key/);
  assert.equal(readFileSync(process.env.TEST_OPERATIONS!, "utf8"), "", "failed isolation must not write credentials");
  assert.deepEqual((await manager.prepareManagedKeys("worker-2")).sort(), ["github", "openai"]);
  const writes = readFileSync(process.env.TEST_OPERATIONS!, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  assert.equal(writes.length, 2);
  assert(writes.every((args) => args.includes("--sandbox") && args.includes("hq-sandbox-fixture-worker-2")));
  await manager.removeKey(config.team[1].id, "openai");
  const afterRemoval = readFileSync(process.env.TEST_OPERATIONS!, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  assert(afterRemoval.some((args) => args[1] === "set" && args[2] === "openai" && args.includes(`hq-sandbox-fixture-${config.team[1].id}`)), "agent removal must restore the project default");
  config.project.githubAuth = "gh";
  assert.deepEqual((await manager.prepareManagedKeys("worker-1")).sort(), ["github", "openai"]);
  manager.cleanupManagedEnv();
  console.log("Sandbox credentials are scoped and App mode rejects uncovered global keys");
} else {
  const dir = mkdtempSync(join(tmpdir(), "agentworld-sandbox-key-test-")), home = join(dir, "home"), repo = join(dir, "repo"), bin = join(dir, "bin"), operations = join(dir, "ops");
  mkdirSync(home); mkdirSync(repo); mkdirSync(bin); writeFileSync(operations, ""); execFileSync("git", ["init", "-q", repo]);
  const sbx = join(bin, "sbx");
  writeFileSync(sbx, `#!${process.execPath}\n` + `
const fs=require('fs');const args=process.argv.slice(2);
if(args[0]==='secret'&&args[1]==='ls') console.log(JSON.stringify({secrets:[{name:'github',scope:'global',type:'service'},{name:'openai',scope:'global',type:'service'}]}));
else if(args[0]==='secret'&&args[1]==='set'){process.stdin.resume();process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(operations)},JSON.stringify(args)+'\\n'));}
`); chmodSync(sbx, 0o755);
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, HQ_MANAGED_GITHUB: "1", TEST_REPO: repo, TEST_OPERATIONS: operations };
    const child = spawn(process.execPath, [process.argv[1], "--worker"], { env, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    child.on("message", (raw: unknown) => {
      const request = raw as { type?: string; id?: string; operation?: string; payload?: { agentId?: string | null } };
      if (request.type !== "managed-credential-request") return;
      const value = request.operation === "list" ? [{ service: "openai", agentId: null }, { service: "openai", agentId: "dwight" }] : request.payload?.agentId === "worker-2" || request.payload?.agentId === "dwight" ? { github: "fixture-gh", openai: "fixture-openai" } : { github: "fixture-gh" };
      if (request.operation === "remove") assert.notEqual(request.payload?.agentId, null, "unsafe deletion must not reach credential store");
      child.send({ type: "managed-credential-result", id: request.id, ok: true, value });
    });
    const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", (status) => resolve(status ?? 1)); });
    assert.equal(code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
