import { assertOrigin, currentUser, githubToken } from "../../../../saas/lib/auth";
import { repositories } from "../../../../saas/lib/github";
import { db } from "../../../../saas/lib/db";
import { localDevEnabled } from "../../../../saas/lib/local";
import { openLocalProject } from "../../../../saas/lib/runtime";
import { Projects } from "../../../../../server/saas/projects";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!localDevEnabled()) return new Response("Local runtime disabled", { status: 404 });
  try { assertOrigin(request); } catch { return new Response("Forbidden", { status: 403 }); }
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response("Not found", { status: 404 });
  const project = await new Projects(db()).get(user.id, id);
  if (!project) return new Response("Not found", { status: 404 });
  try {
    const token = await githubToken(user.id);
    const available = await repositories(token);
    const repo = available.find((item) => String(item.id) === project.github_repository_id && String(item.installationId) === project.installation_id);
    if (!repo) return new Response("Repository access was revoked", { status: 403 });
    if (repo.full_name !== project.repository_full_name) {
      await db().query("UPDATE saas_projects SET repository_full_name = $3, updated_at = now() WHERE id = $1 AND owner_id = $2", [project.id, user.id, repo.full_name]);
    }
    await openLocalProject(user.id, project.id, repo.full_name, token);
    await db().query("UPDATE saas_projects SET local_autostart = true WHERE id = $1 AND owner_id = $2", [project.id, user.id]);
    return Response.json({ url: `/office?project=${encodeURIComponent(project.id)}` });
  } catch (error) {
    console.error("Open local project:", error instanceof Error ? error.message : "unknown error");
    return new Response("Không thể mở dự án. Hãy kiểm tra Git, GitHub và server logs.", { status: 500 });
  }
}
