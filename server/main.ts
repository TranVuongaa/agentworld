// tranvuong-hq — start TranVuong HQ for the git repo you're in.
//
//   tranvuong-hq [--repo <path>] [--port 7420] [--dev] [--no-open]
//
// --dev enables the Next.js development server.

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";
import { makeCommands } from "./commands";
import { startHttp } from "./http";
import { Hub } from "./hub";
import { GitHubSync } from "./githubSync";
import { Inbox } from "./inbox";
import { Planner } from "./planner";
import { ActionItems } from "./actionItems";
import { Sbx } from "./sbx";
import { SbxMcp } from "./sbxMcp";
import { run } from "./lib/exec";
import { log } from "./lib/log";
import { ensurePtyHelperExecutable } from "./lib/ptyFix";
import { agentToken, browserToken } from "./paths";
import { detectRepo } from "./repo";
import { Sessions } from "./sessions";
import { runSetupChecks } from "./setup";
import { loadConfig, loadPlan, type PlanFile } from "./store";
import type { HqConfig } from "../src/data/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  ensurePtyHelperExecutable();
  const dev = flag("dev");
  const port = Number(arg("port") ?? process.env.HQ_PORT ?? 7420);
  const repo = await detectRepo(resolve(arg("repo") ?? process.env.HQ_REPO ?? process.cwd()));
  let stored: { config?: HqConfig; plan?: PlanFile } = {};
  if (process.env.HQ_STATE_FILE) {
    stored = JSON.parse(readFileSync(process.env.HQ_STATE_FILE, "utf8")) as typeof stored;
    delete process.env.HQ_STATE_FILE;
  }
  const { config, isNew } = loadConfig(repo, port, stored.config);
  config.project.hqPort = port;
  config.project.managed = process.env.HQ_MANAGED_GITHUB === "1";
  if (process.env.HQ_PROJECT_ID) {
    if (!/^p[a-f0-9]{32}$/.test(process.env.HQ_PROJECT_ID)) throw new Error("Invalid managed project ID");
    config.project.id = process.env.HQ_PROJECT_ID;
  }
  const slug = config.project.id;
  const token = agentToken(slug);
  const uiToken = process.env.HQ_UI_TOKEN ?? browserToken(slug, dev);
  delete process.env.HQ_UI_TOKEN;

  log.info(`repo   ${repo.root}${repo.github ? `  (github.com/${repo.github})` : ""}`);
  log.info("checking setup…");
  const setup = await runSetupChecks(repo, config.team);
  for (const c of setup.checks) log.info(`  ${c.status === "ok" ? "✓" : c.status === "warning" ? "!" : "✗"} ${c.label}: ${c.detail}`);

  const plan = loadPlan(repo.root, stored.plan);
  const persist = process.send ? (kind: "config" | "plan", value: HqConfig | PlanFile) => {
    if (process.connected) process.send?.({ type: "project-state", kind, value });
  } : undefined;
  const hub = new Hub(repo, slug, config, plan, setup, persist);
  if (!isNew) { persist?.("config", config); persist?.("plan", plan); }
  hub.snap.welcome = isNew;
  const sessions = new Sessions(hub, token);
  const inbox = new Inbox(hub, { type: (id, text) => sessions.typeInto(id, text), enter: (id) => sessions.pressEnter(id) });
  sessions.onSessionDown = (id) => inbox.sessionDown(id);
  sessions.onSessionReattached = (id) => inbox.sessionReattached(id);
  sessions.lastHookAt = (id) => inbox.lastHookAt(id);
  const sbx = new Sbx(hub);
  sessions.prepareSandboxKeys = (id) => sbx.prepareManagedKeys(id);
  sessions.envFileFor = (id) => (existsSync(sbx.envFile(id)) ? sbx.envFile(id) : null);
  const mcp = new SbxMcp(hub, (id, file, args, onExit) => sessions.runTerminal(id, file, args, onExit));
  sessions.onSandboxReady = (id) => {
    void sbx.syncRules(id);
    void mcp.attachAll(id);
    void sbx.refreshPorts(id);
  };
  sessions.onSessionDown = ((down) => (id: string) => {
    down(id);
    void sbx.refreshPorts(id);
  })(sessions.onSessionDown);
  sessions.onSandboxRemoved = (id) => {
    mcp.forget(id);
    void sbx.refreshPorts(id);
  };
  void sbx.refresh();
  void mcp.refresh();
  const planner = new Planner(hub, inbox);
  planner.actions = new ActionItems(hub, planner);

  const uiOrigin = `http://127.0.0.1:${port}`;
  // Next automatically registers an upgrade listener on the server associated with
  // its first request. Keep that listener on an unbound server: `startHttp` routes
  // /ws to HQ and explicitly forwards Next's HMR upgrades to that listener.
  // Otherwise both listeners handle /ws, and a matching Next route can close it.
  const nextUpgradeSink = createServer();
  const app = flag("headless") ? null : next({ dev, dir: resolve(dirname(fileURLToPath(import.meta.url)), ".."), hostname: "127.0.0.1", port, httpServer: nextUpgradeSink });
  if (app) await app.prepare();
  await startHttp({
    hub,
    inbox,
    planner,
    port,
    dev,
    browserToken: uiToken,
    agentToken: token,
    runtimeId: process.env.HQ_RUNTIME_ID,
    nextHandler: app ? app.getRequestHandler() : async (_req, res) => { res.writeHead(404); res.end(); },
    nextUpgrade: async (req, socket, head) => {
      // Next registers its router-level upgrade handler on the sink when it
      // handles the first HTTP request. Its public getUpgradeHandler targets
      // the render server and does not handle the dev HMR endpoint.
      if (!nextUpgradeSink.emit("upgrade", req, socket, head)) socket.destroy();
    },
    allowedOrigins: [uiOrigin, `http://localhost:${port}`, ...(process.env.HQ_UI_ORIGIN ? [process.env.HQ_UI_ORIGIN] : [])],
    commands: makeCommands(hub, sessions, planner, inbox, sbx, mcp),
  });
  sessions.startPolling();
  sbx.startApprovalPolling();
  const credentialRefresh = setInterval(() => void sbx.refreshManagedGithub(), 5 * 60_000);
  const github = new GitHubSync(hub, planner, repo.github);
  github.start();

  const url = `${uiOrigin}/?token=${uiToken}`;
  if (process.env.HQ_SUPERVISED !== "1") log.info(`\n\n  TranVuong HQ is running → ${url}\n`);
  if (!flag("no-open")) {
    // Windows: rundll32 hands the URL to the default browser without a shell (the token has no special chars, but `&` would).
    const [opener, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
    // Give the development server a moment to settle.
    setTimeout(() => void run(opener, args), dev ? 1500 : 0);
  }

  const quit = () => {
    log.info(sessions.backend.persistent ? "stopping HQ — agent sessions keep running in tmux" : "stopping HQ and its agents — sandboxes and folders are kept");
    sessions.shutdown();
    clearInterval(credentialRefresh);
    sbx.stopApprovalPolling();
    github.stop();
    process.exit(0);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
}

main().catch((err) => {
  if ((err as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
    log.error(`Port ${arg("port") ?? 7420} is in use — another HQ may be running. Stop it, or pick another port: npm run start -- --port 7421`);
    process.exit(1);
  }
  if ((err as NodeJS.ErrnoException)?.code === "EACCES") {
    const port = arg("port") ?? 7420;
    log.error(
      process.platform === "win32"
        ? `Windows reserved port ${port} (Hyper-V, WSL and Docker reserve port ranges). Pick another: npm run start -- --port 8420\n  See the reserved ranges with: netsh interface ipv4 show excludedportrange protocol=tcp`
        : `Not allowed to use port ${port}. Pick another: npm run start -- --port 8420`,
    );
    process.exit(1);
  }
  log.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
