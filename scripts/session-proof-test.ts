import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionProof } from "../server/saas/sessionProof";

const dir = mkdtempSync(join(tmpdir(), "agentworld-proof-"));
const name = `aw-proof-${randomBytes(6).toString("hex")}`;
const proof = new SessionProof(dir, "tmux");
try {
  execFileSync("tmux", ["new-session", "-d", "-s", name, "sleep 60"]);
  assert.equal(await proof.verify("worker", name), false, "unknown sessions must not be trusted");
  await proof.mark("worker", name);
  assert.equal(await proof.verify("worker", name), true);
  execFileSync("tmux", ["kill-session", "-t", `=${name}`]);
  execFileSync("tmux", ["new-session", "-d", "-s", name, "sleep 60"]);
  assert.equal(await proof.verify("worker", name), false, "a new session with a reused name must not inherit trust");
  assert.equal(await proof.verify("../escape", name), false);
  proof.clear("worker");
  console.log("Sandbox session proof rejects unknown and replaced tmux sessions");
} finally {
  try { execFileSync("tmux", ["kill-session", "-t", `=${name}`], { stdio: "ignore" }); } catch { /* already stopped */ }
  rmSync(dir, { recursive: true, force: true });
}
