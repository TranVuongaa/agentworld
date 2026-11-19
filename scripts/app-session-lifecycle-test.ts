import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Hub } from "../server/hub";
import { detectRepo } from "../server/repo";
import { Sessions } from "../server/sessions";
import { loadConfig, loadPlan } from "../server/store";
import type { SetupState } from "../src/data/types";

if (process.platform === "win32") { console.log("App session lifecycle fixture requires tmux"); process.exit(0); }
if (process.argv.includes("--worker")) {
  const repo = await detectRepo(process.env.TEST_REPO!), config = loadConfig(repo, 7420).config;
  config.project.githubAuth = "app";
  const slug = process.env.TEST_SLUG!, agent = config.team[0];
  const setup = { sandboxReady: true, checks: [{ id: "tmux", status: "ok" }], machine: { cpus: 2, memoryGb: 4, persistentAgents: true } } as unknown as SetupState;
  const firstHub = new Hub(repo, slug, config, loadPlan(repo.root), setup);
  const first = new Sessions(firstHub, "fixture-token");
  let second: Sessions | null = null;
  try {
    await Promise.all([first.start(agent.id), first.start(agent.id)]);
    assert.equal(firstHub.status(agent.id)?.session.state, "running", firstHub.status(agent.id)?.session.detail ?? "start failed");
    const policyCalls = readFileSync(process.env.TEST_POLICY_LOG!, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
    assert.equal(readFileSync(process.env.TEST_CREATED!, "utf8"), "created\n", "concurrent starts must create the sandbox once before scoped policy is applied");
    assert.equal(policyCalls.length, 2);
    assert(policyCalls.every((args) => args.includes("--sandbox") && args.includes(`hq-${slug}-${agent.id}`)), "coordinator rules must be scoped to the agent sandbox");
    const marker = join(process.env.HOME!, ".jsmhq", slug, `sandbox-session-${agent.id}.proof`);
    assert.match(readFileSync(marker, "utf8"), /^[a-f0-9]{64}$/);
    assert.equal(statSync(marker).mode & 0o777, 0o600);
    first.shutdown();
    assert(await first.backend.exists(`hq-${slug}-${agent.id}`), "tmux session must survive coordinator shutdown");
    const secondHub = new Hub(repo, slug, config, loadPlan(repo.root), setup);
    second = new Sessions(secondHub, "fixture-token");
    second.startPolling();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && secondHub.status(agent.id)?.session.state !== "running") await new Promise((done) => setTimeout(done, 50));
    assert.equal(secondHub.status(agent.id)?.session.state, "running", "verified session should reattach");
    assert(await second.typeInto(agent.id, "fixture-message"), "verified session must accept messages");
    await second.stop(agent.id);
    agent.cli = "codex";
    let setupChecks = 0;
    second.recheckSetup = async () => {
      setupChecks++;
      secondHub.snap.setup.checks.push({ id: "openai-secret", status: "ok" } as SetupState["checks"][number]);
    };
    const starting = second.start(agent.id);
    const stopping = second.stop(agent.id);
    await Promise.all([starting, stopping]);
    assert.equal(setupChecks, 1, "starting a newly added Codex agent must wait for its missing setup check");
    assert.equal(secondHub.status(agent.id)?.session.state, "stopped", "stop during startup must leave the agent stopped");
    assert.equal(await second.backend.exists(`hq-${slug}-${agent.id}`), false, "stop during startup must not leave a session running");
    await second.start(agent.id);
    writeFileSync(process.env.TEST_FAILURE!, "stop");
    await second.stop(agent.id);
    assert.equal(secondHub.status(agent.id)?.session.state, "failed", "a failed sandbox stop must not be reported as stopped");
    writeFileSync(process.env.TEST_FAILURE!, "rm");
    let removedOnFailure = false;
    await second.removeResources(agent.id, { deleteSandbox: true, deleteFolder: true }, () => { removedOnFailure = true; });
    assert.equal(removedOnFailure, false, "a failed sandbox removal must preserve the agent");
    assert(secondHub.cfg(agent.id), "the agent must remain available after a failed removal");
    unlinkSync(process.env.TEST_FAILURE!);
    await second.start(agent.id);
    const removing = second.removeResources(agent.id, { deleteSandbox: true, deleteFolder: false }, () => {
      secondHub.snap.config.team = secondHub.snap.config.team.filter((member) => member.id !== agent.id);
    });
    const restarting = second.start(agent.id);
    await Promise.all([removing, restarting]);
    assert.equal(secondHub.cfg(agent.id), undefined);
    assert.equal(await second.backend.exists(`hq-${slug}-${agent.id}`), false, "a start queued after removal must not create an orphan session");
    // The lifecycle schedules a delayed size check; allow it to finish before deleting fixtures.
    await new Promise((done) => setTimeout(done, 4200));
    console.log("Verified sandbox session starts, reattaches, stops during startup and cannot restart after removal");
  } finally { first.shutdown(); second?.shutdown(); if (await first.backend.exists(`hq-${slug}-${agent.id}`)) await first.backend.kill(`hq-${slug}-${agent.id}`); }
} else {
  const dir = mkdtempSync(join(tmpdir(), "agentworld-session-lifecycle-"));
  const home = join(dir, "home"), repo = join(dir, "repo"), bin = join(dir, "bin"), policyLog = join(dir, "policy-log"), createdFile = join(dir, "created"), failureFile = join(dir, "failure"), tmuxDir = mkdtempSync("/tmp/aw-tmux-");
  mkdirSync(home); mkdirSync(repo); mkdirSync(bin); writeFileSync(policyLog, ""); execFileSync("git", ["init", "-q", repo]);
  const sbx = join(bin, "sbx");
  writeFileSync(sbx, `#!${process.execPath}\n` + `
const fs=require('fs');const args=process.argv.slice(2);
if(fs.existsSync(process.env.TEST_FAILURE) && fs.readFileSync(process.env.TEST_FAILURE,'utf8')===args[0]) {console.error('fixture daemon failure');process.exit(1);}
if(args[0]==='policy' && args[1]==='ls') console.log(JSON.stringify({rules:[]}));
else if(args[0]==='policy' && args[1]==='allow') fs.appendFileSync(process.env.TEST_POLICY_LOG,JSON.stringify(args)+'\\n');
else if(args[0]==='policy' && args[1]==='check') console.log('Allowed: '+args[3]);
else if(args[0]==='ls') console.log(JSON.stringify(fs.existsSync(process.env.TEST_CREATED)?[{name:process.env.TEST_SANDBOX,cpus:1,memory_mib:1024}]:[]));
else if(args[0]==='create') fs.appendFileSync(process.env.TEST_CREATED,'created\\n');
else if(args[0]==='run'){console.log('fixture agent ready');process.stdin.resume();setInterval(()=>{},1000);}
`); chmodSync(sbx, 0o755);
  const slug = `p${randomBytes(16).toString("hex")}`;
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, TMUX_TMPDIR: tmuxDir, HQ_SESSION_BACKEND: "tmux", TEST_REPO: repo, TEST_SLUG: slug, TEST_POLICY_LOG: policyLog, TEST_CREATED: createdFile, TEST_FAILURE: failureFile, TEST_SANDBOX: `hq-${slug}-michael` };
    delete env.HQ_MANAGED_GITHUB;
    const child = spawn(process.execPath, [process.argv[1], "--worker"], { env, stdio: "inherit" });
    const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", (status) => resolve(status ?? 1)); });
    assert.equal(code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(tmuxDir, { recursive: true, force: true }); }
}
