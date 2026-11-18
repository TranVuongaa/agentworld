import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { db } from "./db";
import { localDevEnabled } from "./local";
import { openLocalProject } from "./runtime";

/** Resume local project coordinators so already-running agents can reach their hooks after restart. */
export async function restoreLocalProjects(): Promise<void> {
  if (!localDevEnabled()) return;
  const result = await db().query<{ id: string; owner_id: string; repository_full_name: string }>("SELECT id, owner_id, repository_full_name FROM saas_projects WHERE local_autostart = true");
  const root = resolve(process.env.SAAS_DATA_DIR || join(homedir(), ".agentworld-saas"), "projects");
  await Promise.all(result.rows.map(async (project) => {
    if (!existsSync(join(root, project.id, ".git"))) return;
    try { await openLocalProject(project.owner_id, project.id, project.repository_full_name, ""); }
    catch (error) { console.error(`Could not restore project ${project.id}:`, error instanceof Error ? error.message : "unknown error"); }
  }));
}
