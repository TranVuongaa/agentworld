import { createHash } from "node:crypto";
import type { Pool } from "pg";

/** Authenticate the opaque session cookie and project ownership together. */
export async function authorizedProjectSession(db: Pool, cookieHeader: string | undefined, projectId: string): Promise<boolean> {
  if (!cookieHeader || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) return false;
  const matches = cookieHeader.split(";").map((part) => part.trim()).filter((part) => part.startsWith("agentworld_session="));
  if (matches.length !== 1) return false;
  const token = matches[0].slice("agentworld_session=".length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const hash = createHash("sha256").update(token).digest("hex");
  const result = await db.query(`SELECT 1 FROM saas_sessions s JOIN saas_projects p ON p.owner_id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND p.id = $2`, [hash, projectId]);
  return result.rowCount === 1;
}
