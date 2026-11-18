import { assertOrigin, logout } from "../../../saas/lib/auth";
export async function POST(request: Request) {
  try { assertOrigin(request); } catch { return new Response("Forbidden", { status: 403 }); }
  await logout();
  return Response.json({ ok: true });
}
