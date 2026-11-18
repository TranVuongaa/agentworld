import { assertOrigin, currentUser, githubToken } from "../../saas/lib/auth";
import { repositories } from "../../saas/lib/github";
import { db } from "../../saas/lib/db";
import { Projects } from "../../../server/saas/projects";

export const dynamic = "force-dynamic";
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  return Response.json({ projects: await new Projects(db()).list(user.id) });
}
export async function POST(request: Request) {
  try { assertOrigin(request); } catch { return new Response("Forbidden", { status: 403 }); }
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  let body: { repositoryId?: unknown; installationId?: unknown; name?: unknown };
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (typeof body.repositoryId !== "string" || !/^\d+$/.test(body.repositoryId) || typeof body.installationId !== "string" || !/^\d+$/.test(body.installationId) || typeof body.name !== "string" || !body.name.trim() || body.name.length > 120) return new Response("Invalid project", { status: 400 });
  try {
    const available = await repositories(await githubToken(user.id));
    const repo = available.find((item) => String(item.id) === body.repositoryId && String(item.installationId) === body.installationId);
    if (!repo) return new Response("Repository is not accessible through this installation", { status: 403 });
    await db().query(`INSERT INTO saas_github_installations (user_id, id, account_login) VALUES ($1, $2, $3)
      ON CONFLICT (user_id, id) DO UPDATE SET account_login = EXCLUDED.account_login`, [user.id, String(repo.installationId), repo.accountLogin]);
    const project = await new Projects(db()).create(user.id, { installationId: String(repo.installationId), repositoryId: String(repo.id), repositoryFullName: repo.full_name, name: body.name.trim() });
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return new Response("Project already exists", { status: 409 });
    console.error("Create project:", error instanceof Error ? error.message : "unknown error");
    return new Response("Could not create project", { status: 502 });
  }
}
