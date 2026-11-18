import { timingSafeEqual } from "node:crypto";
import { localDevEnabled } from "../../../saas/lib/local";
import { restoreLocalProjects } from "../../../saas/lib/restore";

export async function POST(request: Request) {
  if (!localDevEnabled()) return new Response("Not found", { status: 404 });
  const expected = Buffer.from(process.env.SAAS_LOCAL_BOOT_TOKEN || "");
  const provided = Buffer.from(request.headers.get("x-agentworld-local-boot") || "");
  if (!expected.length || expected.length !== provided.length || !timingSafeEqual(expected, provided)) return new Response("Forbidden", { status: 403 });
  void restoreLocalProjects().catch((error: unknown) => console.error("Could not restore local projects:", error instanceof Error ? error.message : "unknown error"));
  return Response.json({ ok: true });
}
