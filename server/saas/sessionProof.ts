import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../lib/exec";

/** A host-side proof tied to the tmux session itself, not just its reusable name. */
export class SessionProof {
  private inMemory = new Map<string, string>();
  constructor(private readonly directory: string, private readonly backend: "tmux" | "pty") {}
  private file(agentId: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(agentId)) throw new Error("Invalid agent ID");
    return join(this.directory, `sandbox-session-${agentId}.proof`);
  }
  async mark(agentId: string, sessionName: string): Promise<void> {
    this.file(agentId); // Validate before touching the session.
    const nonce = randomBytes(32).toString("hex");
    if (this.backend === "pty") { this.inMemory.set(agentId, nonce); return; }
    const result = await run("tmux", ["set-option", "-t", `=${sessionName}:`, "@agentworld_sandbox_proof", nonce], { timeoutMs: 5000 });
    if (!result.ok) throw new Error("Could not verify the new sandbox session");
    const target = this.file(agentId);
    const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
    try { writeFileSync(temporary, nonce, { mode: 0o600, flag: "wx" }); renameSync(temporary, target); }
    finally { rmSync(temporary, { force: true }); }
  }
  async verify(agentId: string, sessionName: string): Promise<boolean> {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(agentId)) return false;
    if (this.backend === "pty") return this.inMemory.has(agentId);
    try {
      const file = this.file(agentId);
      if (!existsSync(file) || !lstatSync(file).isFile()) return false;
      const expected = readFileSync(file, "utf8").trim();
      if (!/^[a-f0-9]{64}$/.test(expected)) return false;
      const result = await run("tmux", ["show-options", "-v", "-t", `=${sessionName}:`, "@agentworld_sandbox_proof"], { timeoutMs: 5000 });
      const actual = result.stdout.trim();
      return result.ok && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
    } catch { return false; }
  }
  clear(agentId: string): void {
    this.inMemory.delete(agentId);
    if (/^[a-z0-9][a-z0-9-]{0,79}$/.test(agentId)) rmSync(this.file(agentId), { force: true });
  }
}
