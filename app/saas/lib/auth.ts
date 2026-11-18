import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { decryptSecret, encryptSecret, readEncryptionKey } from "../../../server/saas/crypto";

const sessionCookie = "agentworld_session";
export const cookieOptions = () => ({ httpOnly: true, secure: appUrl().protocol === "https:", sameSite: "lax" as const, path: "/" });
export function appUrl(): URL {
  const url = new URL(process.env.SAAS_APP_URL || "http://127.0.0.1:7420");
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid SAAS_APP_URL");
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("SAAS_APP_URL must use HTTPS outside localhost");
  return url;
}
export function randomToken(): string { return randomBytes(32).toString("base64url"); }
function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function assertOrigin(request: Request): void {
  if (request.headers.get("origin") !== appUrl().origin) throw new Error("Invalid request origin");
}
export async function currentUser(): Promise<{ id: string; login: string } | null> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await db().query<{ id: string; login: string }>(`SELECT u.id, u.github_login AS login FROM saas_sessions s
    JOIN saas_users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [hashToken(token)]);
  return result.rows[0] ?? null;
}
export interface GithubTokens { access_token: string; refresh_token?: string; expires_in?: number }
export async function loginGithub(githubId: string, login: string, tokens: GithubTokens): Promise<void> {
  const client = await db().connect();
  const token = randomToken();
  try {
    await client.query("BEGIN");
    const user = await client.query<{id: string}>(`INSERT INTO saas_users (id, github_user_id, github_login) VALUES ($1, $2, $3)
      ON CONFLICT (github_user_id) DO UPDATE SET github_login = EXCLUDED.github_login RETURNING id`, [randomUUID(), githubId, login]);
    const userId = user.rows[0].id;
    const encrypted = encryptSecret(readEncryptionKey(process.env.SAAS_ENCRYPTION_KEY), userId, "GITHUB_TOKEN", tokens.access_token);
    const refresh = tokens.refresh_token ? encryptSecret(readEncryptionKey(process.env.SAAS_ENCRYPTION_KEY), userId, "GITHUB_REFRESH_TOKEN", tokens.refresh_token) : null;
    await client.query(`INSERT INTO saas_user_credentials (user_id, github_token, github_refresh_token, github_expires_at) VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET github_token = EXCLUDED.github_token, github_refresh_token = EXCLUDED.github_refresh_token, github_expires_at = EXCLUDED.github_expires_at, updated_at = now()`, [userId, encrypted, refresh, tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null]);
    await client.query("INSERT INTO saas_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')", [hashToken(token), userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  (await cookies()).set(sessionCookie, token, { ...cookieOptions(), maxAge: 7 * 86400 });
}
export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(sessionCookie)?.value;
  if (token) await db().query("DELETE FROM saas_sessions WHERE token_hash = $1", [hashToken(token)]);
  jar.set(sessionCookie, "", { ...cookieOptions(), maxAge: 0 });
}
export async function githubToken(userId: string): Promise<string> {
  const client = await db().connect();
  const key = readEncryptionKey(process.env.SAAS_ENCRYPTION_KEY);
  try {
    await client.query("BEGIN");
    const result = await client.query<{ github_token: string; github_refresh_token: string | null; github_expires_at: Date | null }>("SELECT github_token, github_refresh_token, github_expires_at FROM saas_user_credentials WHERE user_id = $1 FOR UPDATE", [userId]);
    const record = result.rows[0];
    if (!record) throw new Error("GitHub connection missing");
    let token = decryptSecret(key, userId, "GITHUB_TOKEN", record.github_token);
    if (record.github_expires_at && record.github_expires_at.getTime() <= Date.now() + 60_000) {
      if (!record.github_refresh_token || !process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) throw new Error("GitHub authorization expired; sign in again");
      const refresh = decryptSecret(key, userId, "GITHUB_REFRESH_TOKEN", record.github_refresh_token);
      const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: refresh }) });
      const data = await response.json() as Partial<GithubTokens>;
      if (!response.ok || !data.access_token || !data.refresh_token || !data.expires_in) throw new Error("GitHub authorization refresh failed; sign in again");
      token = data.access_token;
      await client.query("UPDATE saas_user_credentials SET github_token = $2, github_refresh_token = $3, github_expires_at = $4, updated_at = now() WHERE user_id = $1", [userId, encryptSecret(key, userId, "GITHUB_TOKEN", token), encryptSecret(key, userId, "GITHUB_REFRESH_TOKEN", data.refresh_token), new Date(Date.now() + data.expires_in * 1000)]);
    }
    await client.query("COMMIT");
    return token;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
