import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { db } from "./db";
import { localDevEnabled } from "./local";
import { openLocalProject } from "./runtime";
import { Recovery } from "../../../server/saas/recovery";

/** Resume local project coordinators so already-running agents can reach their hooks after restart. */
export async function restoreLocalProjects(): Promise<void> {
  if (!localDevEnabled()) return;
  const result = await db().query<{ id: string; owner_id: string; repository_full_name: string }>("SELECT id, owner_id, repository_full_name FROM saas_projects WHERE local_autostart = true");
  const root = resolve(process.env.SAAS_DATA_DIR || join(homedir(), ".agentworld-saas"), "projects");
  const attempts = await Promise.allSettled(result.rows.map(async (project) => {
    if (!existsSync(join(root, project.id, ".git"))) return;
    await openLocalProject(project.owner_id, project.id, project.repository_full_name, "");
  }));
  if (attempts.some((attempt) => attempt.status === "rejected")) throw new Error("Some project coordinators could not be restored");
}

// Keep retrying after temporary database or coordinator startup failures.
declare global { var agentworldRestoreRecovery: Recovery | undefined }
const recovery = globalThis.agentworldRestoreRecovery ??= new Recovery();
export function restoreLocalProjectsWithRetry(): void {
  void restoreLocalProjects().then(() => recovery.started("startup")).catch(() => {
    console.error("Could not restore local projects; retrying in the background");
    recovery.schedule("startup", async () => { await restoreLocalProjects(); return true; });
  });
}
