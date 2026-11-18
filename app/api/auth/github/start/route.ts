import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl, cookieOptions, randomToken } from "../../../../saas/lib/auth";

export const dynamic = "force-dynamic";
export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId || !process.env.GITHUB_CLIENT_SECRET) return new Response("GitHub App credentials are not configured", { status: 503 });
  const state = randomToken();
  const verifier = randomToken();
  (await cookies()).set("agentworld_oauth_verifier", verifier, { ...cookieOptions(), maxAge: 600 });
  (await cookies()).set("agentworld_oauth_state", state, { ...cookieOptions(), maxAge: 600 });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", new URL("/api/auth/github/callback", appUrl()).toString());
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  return NextResponse.redirect(url);
}
