import { currentUser, githubToken } from "../../../saas/lib/auth";
import { repositories } from "../../../saas/lib/github";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  try { return Response.json({ repositories: await repositories(await githubToken(user.id)) }); }
  catch (error) { console.error("GitHub repositories:", error instanceof Error ? error.message : "unknown error"); return new Response("Could not load GitHub repositories. Reconnect GitHub and verify the app installation.", { status: 502 }); }
}
