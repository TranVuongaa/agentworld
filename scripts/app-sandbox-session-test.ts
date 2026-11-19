import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../server/hub";
import { detectRepo } from "../server/repo";
import { Sessions } from "../server/sessions";
import { loadConfig, loadPlan } from "../server/store";
import type { SetupState } from "../src/data/types";

if (process.platform === "win32") { console.log("Sandbox session fixture requires tmux"); process.exit(0); }
const dir = mkdtempSync(join(tmpdir(), "agentworld-app-session-")), repoDir = join(dir, "repo"), home = join(dir, "home");
const previous = process.env.HOME, backend = process.env.HQ_SESSION_BACKEND;
const slug = `p${randomBytes(16).toString("hex")}`;
mkdirSync(repoDir); mkdirSync(home); process.env.HOME = home; process.env.HQ_SESSION_BACKEND = "tmux";
let sessions: Sessions | undefined, sessionName = "";
try {
  execFileSync("git", ["init", "-q", repoDir]);
  const repo = await detectRepo(repoDir), config = loadConfig(repo, 7420).config;
  config.project.githubAuth = "app";
  const agent = config.team[0];
  const setup = { sandboxReady: true, checks: [{ id: "tmux", status: "ok" }] } as unknown as SetupState;
  const hub = new Hub(repo, slug, config, loadPlan(repo.root), setup);
  sessions = new Sessions(hub, "fixture-token");
  agent.mode = "local";
  await sessions.start(agent.id);
  assert.match(hub.status(agent.id)?.session.detail ?? "", /require Sandbox mode/);
  agent.mode = "sandbox"; agent.workspacePath = "/tmp/untrusted";
  await sessions.start(agent.id);
  assert.match(hub.status(agent.id)?.session.detail ?? "", /HQ-managed workspace/);
  agent.workspacePath = null;
  sessionName = `hq-${slug}-${agent.id}`;
  execFileSync("tmux", ["new-session", "-d", "-s", sessionName, "sleep 60"]);
  sessions.startPolling();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !(hub.status(agent.id)?.session.detail ?? "").includes("unverified")) await new Promise((done) => setTimeout(done, 50));
  assert.match(hub.status(agent.id)?.session.detail ?? "", /Existing session is unverified/);
  assert.equal((await sessions.backend.exists(sessionName)), true, "unknown sessions must remain untouched");
  assert.equal(await sessions.typeInto(agent.id, "fixture"), false, "messages must not reach unverified sessions");
  console.log("App projects reject host agents, custom paths and unverified existing sessions");
} finally {
  sessions?.shutdown();
  if (sessionName) try { execFileSync("tmux", ["kill-session", "-t", `=${sessionName}`], { stdio: "ignore" }); } catch { /* already stopped */ }
  previous === undefined ? delete process.env.HOME : (process.env.HOME = previous);
  backend === undefined ? delete process.env.HQ_SESSION_BACKEND : (process.env.HQ_SESSION_BACKEND = backend);
  rmSync(dir, { recursive: true, force: true });
}
