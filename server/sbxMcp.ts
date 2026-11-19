// MCP servers for agents, through Docker Sandboxes' own registry (`sbx mcp`).
// sbx runs each server behind its gateway, so sign-ins and API keys stay out
// of the sandbox. HQ keeps only which servers each agent should get, attaches
// them when its sandbox starts (or right away if it's running), and remembers
// what's attached: sbx can't detach a server from one sandbox, so an unticked
// server stays until that sandbox is recreated.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer, McpState, NewMcpServer } from "../src/data/types";
import type { Hub } from "./hub";
import { run } from "./lib/exec";
import { parseCliJson } from "./lib/json";
import { projectHome, sessionName } from "./paths";
import { managedCredentialsEnabled } from "./lib/managedCredentials";

export const MCP_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Runs a program in a terminal the browser can watch (id `setup:…`), then calls onExit. */
export type RunTerminal = (id: string, file: string, args: string[], onExit: (code: number) => void) => void;

const firstLine = (s: string) => s.trim().split("\n").filter(Boolean).pop() ?? "";

export class SbxMcp {
  state: McpState = { servers: [], attached: {}, error: null, checkedAt: new Date().toISOString() };
  private attachedFile: string;
  private queue: Promise<unknown> = Promise.resolve();
  private registryNames = new Map<string, string>();

  /** A distinct registry name for each managed project, while keeping UI names short. */
  private projectPrefix() { return `aw-${this.hub.slug}-`; }
  private registryName(name: string) { return this.registryNames.get(name) ?? (managedCredentialsEnabled() ? `${this.projectPrefix()}${name}` : name); }

  constructor(private hub: Hub, private runTerminal: RunTerminal) {
    this.attachedFile = join(projectHome(hub.slug), "mcp-attached.json");
    try {
      if (existsSync(this.attachedFile)) this.state.attached = (parseCliJson<Record<string, string[]>>(readFileSync(this.attachedFile, "utf8")) ?? {}) as Record<string, string[]>;
    } catch {
      /* start empty */
    }
  }

  /** One sbx mcp operation at a time, so attach/forget records stay consistent. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  private publish() {
    this.state.checkedAt = new Date().toISOString();
    this.hub.snap.mcp = this.state;
    this.hub.emit({ type: "mcp.updated", mcp: structuredClone(this.state) });
  }

  private saveAttached() {
    writeFileSync(this.attachedFile, JSON.stringify(this.state.attached, null, 2));
  }

  /** Re-reads sbx's registry. */
  async refresh() {
    if (!this.hub.snap.setup.sandboxReady) {
      this.state.error = "Docker Sandboxes isn't ready on this machine.";
      return this.publish();
    }
    const r = await run("sbx", ["mcp", "ls", "--json"], { timeoutMs: 15_000 });
    // sbx ≤ 0.47 wraps the list ({ "servers": [...] }); 0.48+ prints the array itself.
    type Row = { name: string; transport?: string; status?: string; next_step?: string };
    const data = r.ok ? parseCliJson<Row[] | { servers?: Row[] }>(r.stdout) : null;
    if (!data) {
      this.state.error = firstLine(r.stderr || r.stdout) || "Couldn't read sbx's MCP servers.";
      return this.publish();
    }
    const rows = Array.isArray(data) ? data : (data.servers ?? []);
    this.registryNames.clear();
    const selected = new Map<string, McpServer>();
    for (const s of rows) {
      const prefix = this.projectPrefix();
      const ours = managedCredentialsEnabled() && s.name.startsWith(prefix);
      // Do not expose another managed project's registrations. Unprefixed
      // registrations remain available for compatibility with local installs.
      if (managedCredentialsEnabled() && this.hub.snap.config.project.githubAuth === "app" && !ours) continue;
      if (managedCredentialsEnabled() && /^aw-p[a-f0-9]{32}-/.test(s.name) && !ours) continue;
      const name = ours ? s.name.slice(prefix.length) : s.name;
      if (!MCP_NAME.test(name)) continue;
      if (selected.has(name) && !ours) continue;
      this.registryNames.set(name, s.name);
      selected.set(name, { name, transport: s.transport ?? "", status: s.status ?? "unknown", nextStep: s.next_step?.replaceAll(s.name, name) ?? null });
    }
    this.state.servers = [...selected.values()];
    this.state.error = null;
    this.publish();
  }

  /** Registers a server. OAuth sign-in is a separate step (authorize). An API key goes to sbx's secret store. */
  add(input: NewMcpServer) {
    return this.serial(async () => {
      const name = input.name.trim().toLowerCase();
      if (!MCP_NAME.test(name)) return this.hub.activity("config", null, `MCP server name "${input.name}" isn't valid: use letters, numbers, - or _.`);
      const url = input.url?.trim();
      const command = input.command?.trim();
      if (command && this.hub.snap.config.project.githubAuth === "app") return this.hub.activity("config", null, "Host commands are unavailable for this project; use a remote MCP server.");
      if ((!url && !command) || url?.startsWith("-") || command?.startsWith("-")) return this.hub.activity("config", null, "Give the MCP server a URL (or a command for a local server).");
      const registryName = managedCredentialsEnabled() ? `${this.projectPrefix()}${name}` : name;
      const args = ["mcp", "add", registryName, "--skip-auth"];
      if (url) args.push("--url", url);
      else args.push("--command", command!, ...(input.args?.length ? ["--args", input.args.join(",")] : []));
      const key = input.apiKey?.trim();
      // sbx fills ${token} from its secret store (mcp:<name>:token) when it connects.
      if (key && url) args.push("--header", "Authorization: Bearer ${token}");
      const r = await run("sbx", args, { timeoutMs: 120_000 });
      if (!r.ok) {
        this.hub.activity("config", null, `Couldn't add MCP server ${name}: ${firstLine(r.stderr || r.stdout).slice(0, 200)}`);
        return this.refresh();
      }
      if (key && url) {
        const s = await run("sbx", ["secret", "set", `mcp:${registryName}:token`, "--force"], { timeoutMs: 20_000, input: key + "\n" });
        if (!s.ok) this.hub.activity("config", null, `Added ${name}, but couldn't store its key: ${firstLine(s.stderr).slice(0, 160)}`);
      }
      this.hub.activity("config", null, `Added MCP server ${name}`);
      await this.refresh();
    });
  }

  /** Signs in to a server (opens the browser) in a terminal you can watch. */
  authorize(name: string) {
    if (!MCP_NAME.test(name)) return;
    this.runTerminal(`setup:mcp-auth-${name}`, "sbx", ["mcp", "auth", this.registryName(name)], () => void this.refresh());
  }

  /** Unregisters a server from sbx (every sandbox on this machine), and from every agent. */
  remove(name: string) {
    return this.serial(async () => {
      if (!MCP_NAME.test(name)) return;
      const registryName = this.registryName(name);
      const r = await run("sbx", ["mcp", "rm", registryName, "--force"], { timeoutMs: 30_000 });
      if (!r.ok) {
        this.hub.activity("config", null, `Couldn't remove MCP server ${name}: ${firstLine(r.stderr || r.stdout).slice(0, 200)}`);
        return this.refresh();
      }
      // The API key HQ may have stored for it (no-op when there's none).
      // sbx stores the key plus an ":endpoint" entry that binds it to the server's URL.
      for (const secret of [`mcp:${registryName}:token`, `mcp:${registryName}:token:endpoint`]) await run("sbx", ["secret", "rm", secret, "--force"], { timeoutMs: 15_000 });
      let changed = false;
      for (const a of this.hub.snap.config.team)
        if (a.mcp?.includes(name)) {
          a.mcp = a.mcp.filter((n) => n !== name);
          changed = true;
        }
      if (changed) this.hub.configChanged();
      for (const id of Object.keys(this.state.attached)) this.state.attached[id] = this.state.attached[id].filter((n) => n !== name);
      this.saveAttached();
      this.hub.activity("config", null, `Removed MCP server ${name} from Docker Sandboxes`);
      await this.refresh();
    });
  }

  /** Which servers an agent gets. New ones are attached now if its sandbox is running. */
  setAgent(agentId: string, names: string[]) {
    return this.serial(async () => {
      const agent = this.hub.cfg(agentId);
      if (!agent) return;
      const want = [...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => MCP_NAME.test(n)))];
      const before = agent.mcp ?? [];
      agent.mcp = want;
      this.hub.configChanged();
      const running = agent.mode === "sandbox" && this.hub.status(agentId)?.session.state === "running";
      if (running) await this.attach(agentId, want.filter((n) => !before.includes(n)));
      const stuck = before.filter((n) => !want.includes(n) && this.state.attached[agentId]?.includes(n));
      if (stuck.length)
        this.hub.activity(
          "config",
          agentId,
          `${agent.name}'s sandbox keeps ${stuck.join(", ")} until it's recreated (sbx can't detach a server). Settings → MCP → Recreate sandbox.`,
        );
      this.publish();
    });
  }

  /** The agent's sandbox just started: attach its servers. */
  attachAll(agentId: string) {
    return this.serial(async () => {
      const agent = this.hub.cfg(agentId);
      if (!agent || agent.mode !== "sandbox" || !agent.mcp?.length) return;
      if (managedCredentialsEnabled()) await this.refresh();
      await this.attach(agentId, agent.mcp);
      this.publish();
    });
  }

  /** The agent's sandbox was removed or recreated: nothing is attached any more. */
  forget(agentId: string) {
    delete this.state.attached[agentId];
    this.saveAttached();
    this.publish();
  }

  private async attach(agentId: string, names: string[]) {
    const sandbox = sessionName(this.hub.slug, agentId);
    const failed: string[] = [];
    for (const name of names) {
      const r = await run("sbx", ["mcp", "load", this.registryName(name), "--sandbox", sandbox], { timeoutMs: 60_000 });
      if (r.ok) this.state.attached[agentId] = [...new Set([...(this.state.attached[agentId] ?? []), name])];
      else failed.push(`${name}: ${firstLine(r.stderr || r.stdout).replace(/^error: /, "").slice(0, 140)}`);
    }
    this.saveAttached();
    const needsSignIn = names.filter((n) => this.state.servers.find((s) => s.name === n)?.status === "needs-auth");
    if (failed.length) this.hub.activity("config", agentId, `Couldn't attach MCP to ${this.hub.name(agentId)}: ${failed.join("; ")}`);
    if (needsSignIn.length) this.hub.activity("config", agentId, `${needsSignIn.join(", ")} needs sign-in before ${this.hub.name(agentId)} can use it (Settings → MCP → Sign in).`);
  }
}
