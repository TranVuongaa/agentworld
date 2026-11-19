import type { Pool } from "pg";
import { decryptSecret, encryptSecret } from "./crypto";

export class Secrets {
  constructor(private readonly db: Pool, private readonly key: Buffer) {}

  async set(ownerId: string, projectId: string, name: string, value: string): Promise<boolean> {
    if (!/^[A-Z][A-Z0-9_]{0,319}$/.test(name)) throw new Error("Invalid secret name");
    const ciphertext = encryptSecret(this.key, projectId, name, value);
    const result = await this.db.query(`INSERT INTO saas_secrets (project_id, name, ciphertext)
      SELECT id, $3, $4 FROM saas_projects WHERE owner_id = $1 AND id = $2
      ON CONFLICT (project_id, name) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, updated_at = now()`, [ownerId, projectId, name, ciphertext]);
    return result.rowCount === 1;
  }

  async list(ownerId: string, projectId: string): Promise<string[]> {
    const result = await this.db.query<{ name: string }>(`SELECT s.name FROM saas_secrets s JOIN saas_projects p ON p.id = s.project_id
      WHERE p.owner_id = $1 AND p.id = $2 ORDER BY s.name`, [ownerId, projectId]);
    return result.rows.map((row) => row.name);
  }

  async get(ownerId: string, projectId: string, name: string): Promise<string | null> {
    const result = await this.db.query<{ ciphertext: string }>(`SELECT s.ciphertext FROM saas_secrets s JOIN saas_projects p ON p.id = s.project_id
      WHERE p.owner_id = $1 AND p.id = $2 AND s.name = $3`, [ownerId, projectId, name]);
    return result.rows[0] ? decryptSecret(this.key, projectId, name, result.rows[0].ciphertext) : null;
  }

  async remove(ownerId: string, projectId: string, name: string): Promise<boolean> {
    const result = await this.db.query(`DELETE FROM saas_secrets s USING saas_projects p
      WHERE s.project_id = p.id AND p.owner_id = $1 AND p.id = $2 AND s.name = $3`, [ownerId, projectId, name]);
    return result.rowCount === 1;
  }
}
