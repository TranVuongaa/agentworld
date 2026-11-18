import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appUrl } from "./auth";
import { projectGithubToken } from "./projectGithub";
import { localDevEnabled } from "./local";
import { db } from "./db";
import { Secrets } from "../../../server/saas/secrets";
import { readEncryptionKey } from "../../../server/saas/crypto";
import { parseProjectKeyName, projectKeyName, validAgent, validService } from "../../../server/saas/keyNames";
import { resolveStoredProjectKeys } from "../../../server/saas/projectKeys";

interface Runtime { child: ChildProcess; port: number; token: string }
interface RuntimeRegistry { running: Map<string, Runtime>; starting: Map<string, Promise<Runtime>>; children: Set<ChildProcess> }
declare global { var agentworldRuntimeRegistry: RuntimeRegistry | undefined }
const registry = globalThis.agentworldRuntimeRegistry ??= { running: new Map(), starting: new Map(), children: new Set() };
registry.children ??= new Set();
declare global { var agentworldRuntimeCleanupRegistered: boolean | undefined }
if (!globalThis.agentworldRuntimeCleanupRegistered) {
  globalThis.agentworldRuntimeCleanupRegistered = true;
  process.on("exit", () => { for (const child of registry.children) child.kill("SIGTERM"); });
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); if (code === 0) resolveRun(); else reject(new Error(`Git clone failed: ${stderr.replaceAll(env.AGENTWORLD_GIT_TOKEN ?? "\0", "[redacted]")}`)); });
  });
}
async function workspace(projectId: string, repo: string, token: string): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Invalid project or repository");
  const base = resolve(process.env.SAAS_DATA_DIR || join(homedir(), ".agentworld-saas"), "projects");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const destination = join(base, projectId);
  if (existsSync(join(destination, ".git"))) {
    await run("git", ["-C", destination, "remote", "set-url", "origin", `https://github.com/${repo}.git`], process.env);
    return destination;
  }
  if (existsSync(destination)) throw new Error("Project directory already exists without a Git repository");
  const tmp = await mkdtemp(join(base, `${projectId}-clone-`));
  const helperDir = await mkdtemp(join(tmpdir(), "agentworld-askpass-"));
  try {
    const helper = join(helperDir, "askpass");
    await writeFile(helper, '#!/bin/sh\ncase "$1" in *sername*) printf "%s\\n" x-access-token ;; *) printf "%s\\n" "$AGENTWORLD_GIT_TOKEN" ;; esac\n', { mode: 0o700 });
    await chmod(helper, 0o700);
    await run("git", ["-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", "clone", "--", `https://github.com/${repo}.git`, join(tmp, "repo")], { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: helper, AGENTWORLD_GIT_TOKEN: token });
    await rename(join(tmp, "repo"), destination);
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await rm(helperDir, { recursive: true, force: true });
  }
  return destination;
}
async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Cannot allocate port"));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}
async function projectPort(projectId: string): Promise<number> {
  const base = resolve(process.env.SAAS_DATA_DIR || join(homedir(), ".agentworld-saas"), "projects");
  const path = join(base, `${projectId}.port`);
  if (!existsSync(path)) {
    const candidate = await freePort();
    try { await writeFile(path, String(candidate), { mode: 0o600, flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  const value = (await readFile(path, "utf8")).trim();
  if (!/^\d{4,5}$/.test(value) || Number(value) > 65535 || Number(value) < 1024) throw new Error("Invalid saved project port");
  return Number(value);
}
async function start(ownerId: string, projectId: string, repo: string, githubToken: string): Promise<Runtime> {
  const stateResult = await db().query<{ config: Record<string, unknown>; plan: Record<string, unknown>; config_updated_at: Date | null; plan_updated_at: Date | null }>("SELECT config, plan, config_updated_at, plan_updated_at FROM saas_projects WHERE id = $1 AND owner_id = $2", [projectId, ownerId]);
  const state = stateResult.rows[0];
  if (!state) throw new Error("Project no longer exists");
  const root = await workspace(projectId, repo, githubToken);
  const port = await projectPort(projectId);
  const stateDir = await mkdtemp(join(tmpdir(), "agentworld-state-"));
  const stateFile = join(stateDir, "state.json");
  // A local file newer than the last successful database write may contain an
  // update made just before PostgreSQL or the supervisor went down.
  const newerLocalFile = (name: string, updated: Date | null) => {
    const file = join(root, ".jsmhq", name);
    return existsSync(file) && (!updated || statSync(file).mtimeMs > updated.getTime());
  };
  const config = !newerLocalFile("config.json", state.config_updated_at) && state.config && typeof state.config.project === "object" && Array.isArray(state.config.team) && typeof state.config.workflow === "object" ? state.config : undefined;
  const plan = !newerLocalFile("plan.json", state.plan_updated_at) && state.plan && Array.isArray(state.plan.boards) && Array.isArray(state.plan.tasks) ? state.plan : undefined;
  await writeFile(stateFile, JSON.stringify({ config, plan }), { mode: 0o600 });
  const token = randomBytes(24).toString("hex");
  const runtimeId = randomBytes(24).toString("hex");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("SAAS_") || key.startsWith("GITHUB_") || ["DATABASE_URL", "GH_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"].includes(key)) delete env[key];
  }
  const child = spawn(process.execPath, [join(process.cwd(), "dist-server/main.mjs"), "--repo", root, "--port", String(port), "--no-open", "--headless"], {
    cwd: process.cwd(), stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...env, HQ_STATE_FILE: stateFile, HQ_MANAGED_GITHUB: "1", HQ_PROJECT_ID: `p${projectId.replaceAll("-", "")}`, HQ_UI_TOKEN: token, HQ_RUNTIME_ID: runtimeId, HQ_UI_ORIGIN: appUrl().origin, HQ_SUPERVISED: "1" },
  });
  registry.children.add(child);
  let failed: Error | null = null;
  let pendingWrite = Promise.resolve();
  child.on("message", (message: unknown) => {
    const data = message as { type?: unknown; kind?: unknown; value?: unknown; id?: unknown };
    if (data?.type === "managed-credential-request" && typeof data.id === "string" && /^[0-9a-f-]{36}$/i.test(data.id)) {
      const id = data.id;
      const request = message as { operation?: unknown; payload?: Record<string, unknown> };
      const payload = request.payload ?? {};
      const respond = (ok: boolean, value?: unknown) => {
        if (child.connected) child.send({ type: "managed-credential-result", id, ok, value }, () => {});
      };
      void (async () => {
        if (request.operation === "github") return projectGithubToken(ownerId, projectId);
        const secrets = new Secrets(db(), readEncryptionKey(process.env.SAAS_ENCRYPTION_KEY));
        if (request.operation === "list") return (await secrets.list(ownerId, projectId)).map(parseProjectKeyName).filter(Boolean);
        if (request.operation === "resolve" && validAgent(payload.agentId) && payload.agentId !== null) {
          const resolved = await resolveStoredProjectKeys(secrets, ownerId, projectId, payload.agentId);
          if (!localDevEnabled() || !resolved.github) resolved.github = await projectGithubToken(ownerId, projectId);
          return resolved;
        }
        if ((request.operation === "set" || request.operation === "remove") && validAgent(payload.agentId) && validService(payload.service)) {
          const name = projectKeyName(payload.service, payload.agentId);
          if (request.operation === "remove") return secrets.remove(ownerId, projectId, name);
          if (typeof payload.value !== "string" || !payload.value.trim() || payload.value.length > 8192 || /[\r\n\0]/.test(payload.value)) throw new Error("Invalid key");
          if (!await secrets.set(ownerId, projectId, name, payload.value.trim())) throw new Error("Project not found");
          return true;
        }
        throw new Error("Invalid credential operation");
      })().then((value) => respond(true, value)).catch(() => respond(false));
      return;
    }
    if (data?.type !== "project-state" || (data.kind !== "config" && data.kind !== "plan")) return;
    const column = data.kind === "config" ? "config" : "plan";
    const json = JSON.stringify(data.value);
    pendingWrite = pendingWrite.then(async () => {
      await db().query(`UPDATE saas_projects SET ${column} = $3::jsonb, ${column}_updated_at = now(), updated_at = now() WHERE id = $1 AND owner_id = $2`, [projectId, ownerId, json]);
    }).catch((error: unknown) => console.error(`Could not save project ${projectId} ${column}:`, error instanceof Error ? error.message : "unknown error"));
  });
  child.on("error", (error) => { failed = error; });
  const runtime = { child, port, token };
  child.once("exit", () => { registry.children.delete(child); if (registry.running.get(projectId) === runtime) registry.running.delete(projectId); });
  try {
    for (let i = 0; i < 100; i++) {
      if (failed) throw failed;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Project server stopped during startup");
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok && (await response.json() as { runtimeId?: string }).runtimeId === runtimeId) return runtime;
      } catch { /* still starting */ }
      await new Promise((done) => setTimeout(done, 300));
    }
    throw new Error("Project server did not start in time");
  } catch (error) { child.kill("SIGTERM"); throw error; }
  finally { await rm(stateDir, { recursive: true, force: true }); }
}

/** Local-only bridge while the multi-tenant runtime is under development. */
export async function openLocalProject(ownerId: string, projectId: string, repo: string, githubToken: string): Promise<{ port: number; token: string }> {
  if (!localDevEnabled()) throw new Error("Local project runtime is disabled");
  const running = registry.running.get(projectId);
  if (running && running.child.exitCode === null && running.child.signalCode === null) return running;
  let pending = registry.starting.get(projectId);
  if (!pending) {
    pending = start(ownerId, projectId, repo, githubToken).then((runtime) => { registry.running.set(projectId, runtime); return runtime; });
    registry.starting.set(projectId, pending);
  }
  try { return await pending; } finally { if (registry.starting.get(projectId) === pending) registry.starting.delete(projectId); }
}
