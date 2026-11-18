import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertOrigin, loginGithub } from "../../../saas/lib/auth";
import { github } from "../../../saas/lib/github";
import { localDevEnabled } from "../../../saas/lib/local";

export async function POST(request: Request) {
  if (!localDevEnabled()) return new Response("Not found", { status: 404 });
  try { assertOrigin(request); } catch { return new Response("Forbidden", { status: 403 }); }
  try {
    const { stdout } = await promisify(execFile)("gh", ["auth", "token", "--hostname", "github.com"], { timeout: 10000, maxBuffer: 16384 });
    const token = stdout.trim();
    if (!token) throw new Error("No GitHub CLI token");
    const user = await github<{ id: number; login: string }>(token, "/user");
    await loginGithub(String(user.id), user.login, { access_token: token });
    return Response.json({ user: { login: user.login } });
  } catch (error) {
    console.error("Local GitHub authentication:", error instanceof Error ? error.message : "unknown error");
    return new Response("Không thể đăng nhập bằng GitHub CLI. Hãy chạy gh auth login trước.", { status: 502 });
  }
}
