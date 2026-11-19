import { readFile } from "node:fs/promises";
import { githubInstallationToken } from "../../../server/saas/githubApp";
import { githubToken } from "./auth";
import { db } from "./db";
import { repositories } from "./github";
import { localGithubCliEnabled } from "./local";

interface Token { token: string; expiresAt: number }
declare global { var agentworldInstallationTokens: Map<string, Promise<Token>> | undefined }
const cache = globalThis.agentworldInstallationTokens ??= new Map();

/** Only the developer-only gh bridge uses the machine account's unscoped token. */
export async function projectGithubToken(ownerId: string, projectId: string): Promise<string> {
  const result = await db().query<{ installation_id: string; github_repository_id: string }>("SELECT installation_id, github_repository_id FROM saas_projects WHERE id = $1 AND owner_id = $2", [projectId, ownerId]);
  const project = result.rows[0];
  if (!project) throw new Error("Project not found");
  const userToken = await githubToken(ownerId);
  if (localGithubCliEnabled()) return userToken;
  const visible = await repositories(userToken);
  if (!visible.some((repo) => String(repo.id) === project.github_repository_id && String(repo.installationId) === project.installation_id)) throw new Error("GitHub repository access was revoked");
  const key = `${ownerId}:${projectId}:${project.installation_id}:${project.github_repository_id}`;
  const existing = cache.get(key);
  if (existing) {
    try { const token = await existing; if (token.expiresAt > Date.now() + 2 * 60_000) return token.token; }
    catch { /* Retry the request below. */ }
    if (cache.get(key) === existing) cache.delete(key);
  }
  const clientId = process.env.GITHUB_CLIENT_ID;
  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (!clientId || !keyPath) throw new Error("GitHub App private key is not configured");
  const pending = readFile(keyPath, "utf8").then((privateKey) => githubInstallationToken({ clientId, privateKey, installationId: project.installation_id, repositoryId: project.github_repository_id }));
  cache.set(key, pending);
  try { return (await pending).token; }
  catch (error) { if (cache.get(key) === pending) cache.delete(key); throw error; }
}
