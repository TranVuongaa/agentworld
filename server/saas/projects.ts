import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface Project {
  id: string;
  name: string;
  repository_full_name: string;
  github_repository_id: string;
  installation_id: string;
  config: unknown;
  plan: unknown;
}

/** Every project lookup and mutation requires the authenticated owner's ID. */
export class Projects {
  constructor(private readonly db: Pool) {}

  async list(ownerId: string): Promise<Project[]> {
    const result = await this.db.query<Project>("SELECT id, name, repository_full_name, github_repository_id, installation_id, config, plan FROM saas_projects WHERE owner_id = $1 ORDER BY created_at DESC", [ownerId]);
    return result.rows;
  }

  async get(ownerId: string, projectId: string): Promise<Project | null> {
    const result = await this.db.query<Project>("SELECT id, name, repository_full_name, github_repository_id, installation_id, config, plan FROM saas_projects WHERE owner_id = $1 AND id = $2", [ownerId, projectId]);
    return result.rows[0] ?? null;
  }

  async create(ownerId: string, input: { installationId: string; repositoryId: string; repositoryFullName: string; name: string }): Promise<Project> {
    const result = await this.db.query<Project>(`INSERT INTO saas_projects (id, owner_id, installation_id, github_repository_id, repository_full_name, name)
      SELECT $1, $2, id, $4, $5, $6 FROM saas_github_installations WHERE user_id = $2 AND id = $3
      RETURNING id, name, repository_full_name, github_repository_id, installation_id, config, plan`,
    [randomUUID(), ownerId, input.installationId, input.repositoryId, input.repositoryFullName, input.name]);
    if (!result.rows[0]) throw new Error("GitHub installation not found for owner");
    return result.rows[0];
  }

  async updateState(ownerId: string, projectId: string, config: unknown, plan: unknown): Promise<boolean> {
    const result = await this.db.query("UPDATE saas_projects SET config = $3::jsonb, plan = $4::jsonb, config_updated_at = now(), plan_updated_at = now(), updated_at = now() WHERE owner_id = $1 AND id = $2", [ownerId, projectId, JSON.stringify(config), JSON.stringify(plan)]);
    return result.rowCount === 1;
  }

  async remove(ownerId: string, projectId: string): Promise<boolean> {
    const result = await this.db.query("DELETE FROM saas_projects WHERE owner_id = $1 AND id = $2", [ownerId, projectId]);
    return result.rowCount === 1;
  }
}
