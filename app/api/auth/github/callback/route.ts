import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl, cookieOptions, loginGithub } from "../../../../saas/lib/auth";
import { github } from "../../../../saas/lib/github";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const expected = jar.get("agentworld_oauth_state")?.value ?? "";
  const verifier = jar.get("agentworld_oauth_verifier")?.value ?? "";
  jar.set("agentworld_oauth_verifier", "", { ...cookieOptions(), maxAge: 0 });
  jar.set("agentworld_oauth_state", "", { ...cookieOptions(), maxAge: 0 });
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const a = Buffer.from(expected), b = Buffer.from(state);
  if (!code || !expected || !verifier || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Invalid OAuth request", { status: 400 });
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) return new Response("GitHub App credentials are not configured", { status: 503 });
  try {
    const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, code_verifier: verifier, redirect_uri: new URL("/api/auth/github/callback", appUrl()).toString() }) });
    const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!response.ok || !data.access_token) throw new Error("GitHub token exchange failed");
    const user = await github<{ id: number; login: string }>(data.access_token, "/user");
    await loginGithub(String(user.id), user.login, { ...data, access_token: data.access_token });
    return NextResponse.redirect(new URL("/dashboard", appUrl()));
  } catch (error) {
    console.error("GitHub login failed:", error instanceof Error ? error.message : "unknown error");
    return new Response("GitHub login failed. Check server configuration and try again.", { status: 502 });
  }
}
