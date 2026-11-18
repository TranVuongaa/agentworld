import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProjectKeyName, projectKeyName } from "../server/saas/keyNames";
import { run } from "../server/lib/exec";
import { projectKeyNames, resolveProjectKeys } from "../server/lib/managedCredentials";

if (process.argv.includes("--worker")) {
  const gh = await run("gh", ["test"]);
  assert.equal(gh.ok, true);
  assert.equal(gh.stdout, "[redacted]");
  const ordinary = await run(process.execPath, ["-e", "process.stdout.write(process.env.GH_TOKEN || 'absent')"]);
  assert.equal(ordinary.stdout, "absent");
  assert.deepEqual(await projectKeyNames(), [{ service: "openai", agentId: null }]);
  assert.deepEqual(await resolveProjectKeys("worker-1"), { openai: "fake-api-key" });
  console.log("Scoped credential IPC and subprocess environment checks passed");
} else {
  assert.equal(projectKeyName("openai", null), "SERVICE_OPENAI");
  const name = projectKeyName("openai", "worker-1");
  assert.deepEqual(parseProjectKeyName(name), { service: "openai", agentId: "worker-1" });
  assert.equal(parseProjectKeyName("SERVICE_OPENAI__AGENT_FF"), null);
  assert.throws(() => projectKeyName("bad-service", null));
  const dir = mkdtempSync(join(tmpdir(), "agentworld-credential-test-"));
  try {
    const gh = join(dir, "gh");
    writeFileSync(gh, '#!/bin/sh\nprintf "%s" "$GH_TOKEN"\n');
    chmodSync(gh, 0o700);
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:${process.env.PATH}`, HQ_MANAGED_GITHUB: "1" };
    delete env.GH_TOKEN;
    const child = spawn(process.execPath, [process.argv[1], "--worker"], { env, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    child.on("message", (raw: unknown) => {
      const request = raw as { type?: string; id?: string; operation?: string };
      if (request.type !== "managed-credential-request") return;
      const value = request.operation === "github" ? "fixture-token" : request.operation === "list" ? [{ service: "openai", agentId: null }] : { openai: "fake-api-key" };
      child.send({ type: "managed-credential-result", id: request.id, ok: true, value });
    });
    const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", (status) => resolve(status ?? 1)); });
    assert.equal(code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
