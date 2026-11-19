import { assertOrigin, currentUser, githubToken } from "../../../../saas/lib/auth";
import { repositories } from "../../../../saas/lib/github";
import { db } from "../../../../saas/lib/db";
import { projectGithubToken } from "../../../../saas/lib/projectGithub";
import { localDevEnabled } from "../../../../saas/lib/local";
import { openLocalProject } from "../../../../saas/lib/runtime";
import { Projects } from "../../../../../server/saas/projects";
import { selectAccessibleRepository } from "../../../../../server/saas/repositoryAccess";

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
    const repo = selectAccessibleRepository(available, project.github_repository_id, project.installation_id);
    if (!repo) return new Response("Repository access was revoked", { status: 403 });
    if (repo.full_name !== project.repository_full_name || String(repo.installationId) !== project.installation_id) {
      const rebound = await new Projects(db()).rebindRepository(user.id, project.id, { installationId: String(repo.installationId), accountLogin: repo.accountLogin, repositoryFullName: repo.full_name });
      if (!rebound) return new Response("Not found", { status: 404 });
    }
    const scopedToken = await projectGithubToken(user.id, project.id);
    await openLocalProject(user.id, project.id, repo.full_name, scopedToken);
    await db().query("UPDATE saas_projects SET local_autostart = true WHERE id = $1 AND owner_id = $2", [project.id, user.id]);
    return Response.json({ url: `/office?project=${encodeURIComponent(project.id)}` });
  } catch (error) {
    console.error("Open local project:", error instanceof Error ? error.message : "unknown error");
    return new Response("Không thể mở dự án. Hãy kiểm tra Git, GitHub và server logs.", { status: 500 });
  }
}
