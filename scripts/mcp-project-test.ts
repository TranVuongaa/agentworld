import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Hub } from "../server/hub";
import { detectRepo } from "../server/repo";
import { SbxMcp } from "../server/sbxMcp";
import { loadConfig, loadPlan } from "../server/store";
import type { SetupState } from "../src/data/types";

if (process.platform === "win32") { console.log("MCP fixture requires a POSIX executable shim"); process.exit(0); }
const dir = mkdtempSync(join(tmpdir(), "agentworld-mcp-test-"));
const home = join(dir, "home"), repoDir = join(dir, "repo"), bin = join(dir, "bin"), state = join(dir, "state.json"), ops = join(dir, "ops.jsonl");
const a = `p${"a".repeat(32)}`, b = `p${"b".repeat(32)}`;
const previous = { HOME: process.env.HOME, PATH: process.env.PATH, HQ_MANAGED_GITHUB: process.env.HQ_MANAGED_GITHUB };
mkdirSync(home); mkdirSync(repoDir); mkdirSync(bin);
writeFileSync(state, JSON.stringify([{ name: `aw-${a}-docs`, status: "ready" }, { name: `aw-${b}-private`, status: "ready" }, { name: "legacy", status: "ready" }]));
writeFileSync(ops, "");
const shim = join(bin, "sbx");
writeFileSync(shim, `#!${process.execPath}\n` + `
const fs=require('fs');const args=process.argv.slice(2);const state=${JSON.stringify(state)},ops=${JSON.stringify(ops)};
fs.appendFileSync(ops,JSON.stringify(args)+'\\n');
const rows=JSON.parse(fs.readFileSync(state,'utf8'));
if(args[0]==='mcp' && args[1]==='ls') console.log(JSON.stringify(rows));
else if(args[0]==='mcp' && args[1]==='add') {rows.push({name:args[2],status:'ready'});fs.writeFileSync(state,JSON.stringify(rows));}
else if(args[0]==='mcp' && args[1]==='rm') fs.writeFileSync(state,JSON.stringify(rows.filter(r=>r.name!==args[2])));
`);
chmodSync(shim, 0o755);
Object.assign(process.env, { HOME: home, PATH: `${bin}${delimiter}${previous.PATH ?? ""}`, HQ_MANAGED_GITHUB: "1" });
try {
  execFileSync("git", ["init", "-q", repoDir]);
  const repo = await detectRepo(repoDir), config = loadConfig(repo, 7420).config;
  const hub = new Hub(repo, a, config, loadPlan(repo.root), { sandboxReady: true, checks: [] } as unknown as SetupState);
  const agent = config.team[1];
  hub.status(agent.id)!.session.state = "running";
  const manager = new SbxMcp(hub, () => {});
  await manager.refresh();
  assert.deepEqual(manager.state.servers.map((s) => s.name).sort(), ["docs", "legacy"]);
  await manager.add({ name: "custom", command: "fixture" });
  assert(manager.state.servers.some((s) => s.name === "custom"));
  await manager.setAgent(agent.id, ["custom"]);
  const operations = () => readFileSync(ops, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
  assert(operations().some((args) => args[0] === "mcp" && args[1] === "add" && args[2] === `aw-${a}-custom`));
  assert(operations().some((args) => args[0] === "mcp" && args[1] === "load" && args[2] === `aw-${a}-custom`));
  await manager.remove("custom");
  assert(operations().some((args) => args[0] === "mcp" && args[1] === "rm" && args[2] === `aw-${a}-custom`));
  assert(JSON.parse(readFileSync(state, "utf8")).some((row: { name: string }) => row.name === `aw-${b}-private`));
  console.log("Managed MCP registrations are namespaced by project");
} finally {
  for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  rmSync(dir, { recursive: true, force: true });
}
