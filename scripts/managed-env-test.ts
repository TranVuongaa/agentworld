import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../server/hub";
import { detectRepo } from "../server/repo";
import { Sbx } from "../server/sbx";
import { loadConfig, loadPlan } from "../server/store";
import type { SetupState } from "../src/data/types";

if (process.platform === "win32") { console.log("Managed environment fixture requires a POSIX HOME"); process.exit(0); }

if (process.argv.includes("--worker")) {
  const repoDir = process.env.TEST_REPO!;
  const repo = await detectRepo(repoDir), config = loadConfig(repo, 7420).config;
  const hub = new Hub(repo, "managed-env-fixture", config, loadPlan(repo.root), { sandboxReady: false, checks: [] } as unknown as SetupState);
  const manager = new Sbx(hub), agent = config.team[0].id;
  const legacy = manager.ensureEnvFile(agent);
  writeFileSync(legacy, "OLD=value\nEXAMPLE=legacy\n", { mode: 0o600 });
  await manager.changeManagedEnv(agent, "EXAMPLE", "a value=with spaces");
  assert.deepEqual(manager.state.agents[agent].envFile.variables, ["EXAMPLE"]);
  await manager.prepareManagedEnv(agent);
  const effective = manager.effectiveEnvFile(agent)!;
  assert.notEqual(effective, legacy);
  assert.match(readFileSync(effective, "utf8"), /OLD=value\nEXAMPLE=legacy\nEXAMPLE=a value=with spaces\n/);
  assert.equal(statSync(effective).mode & 0o777, 0o600);
  await manager.changeManagedEnv(agent, "__proto__", "prototype-value");
  assert.match(readFileSync(effective, "utf8"), /__proto__=prototype-value/);
  await manager.changeManagedEnv(agent, "__proto__", null);
  await manager.changeManagedEnv(agent, "EXAMPLE", null);
  assert.deepEqual(manager.state.agents[agent].envFile.variables, []);
  assert.equal(readFileSync(legacy, "utf8"), "OLD=value\nEXAMPLE=legacy\n");
  assert.doesNotMatch(readFileSync(effective, "utf8"), /a value=with spaces/);
  manager.cleanupManagedEnv();
  assert(!existsSync(effective));
  console.log("Managed agent variables are isolated, merged and cleaned up");
} else {
  const dir = mkdtempSync(join(tmpdir(), "agentworld-env-test-")), home = join(dir, "home"), repo = join(dir, "repo");
  mkdirSync(home); mkdirSync(repo); execFileSync("git", ["init", "-q", repo]);
  const values = new Map<string, Map<string, string>>();
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, TEST_REPO: repo, HQ_MANAGED_GITHUB: "1" };
    const child = spawn(process.execPath, [process.argv[1], "--worker"], { env, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    child.on("message", (raw: unknown) => {
      const request = raw as { type?: string; id?: string; operation?: string; payload?: { agentId: string; name: string; value: string } };
      if (request.type !== "managed-credential-request") return;
      const payload = request.payload ?? { agentId: "", name: "", value: "" }, vars = values.get(payload.agentId) ?? new Map<string, string>();
      if (payload.agentId) values.set(payload.agentId, vars);
      let value: unknown = true;
      if (request.operation === "env-list-all") value = Object.fromEntries([...values].map(([agentId, entries]) => [agentId, [...entries.keys()].sort()]));
      else if (request.operation === "env-set") vars.set(payload.name, payload.value);
      else if (request.operation === "env-remove") vars.delete(payload.name);
      else if (request.operation === "env-list") value = [...vars.keys()].sort();
      else if (request.operation === "env-resolve") value = Object.fromEntries(vars);
      else value = [];
      child.send({ type: "managed-credential-result", id: request.id, ok: true, value });
    });
    const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", (status) => resolve(status ?? 1)); });
    assert.equal(code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
