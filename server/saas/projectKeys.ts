import { parseProjectKeyName, projectKeyName } from "./keyNames";
import type { Secrets } from "./secrets";

/** Resolve project defaults, then apply the selected agent's overrides. */
export async function resolveStoredProjectKeys(secrets: Secrets, ownerId: string, projectId: string, agentId: string): Promise<Record<string, string>> {
  const names = (await secrets.list(ownerId, projectId)).map(parseProjectKeyName)
    .filter((name): name is { service: string; agentId: string | null } => !!name && (name.agentId === null || name.agentId === agentId));
  const values: Record<string, string> = {};
  for (const entry of names.sort((a, b) => Number(a.agentId !== null) - Number(b.agentId !== null))) {
    const value = await secrets.get(ownerId, projectId, projectKeyName(entry.service, entry.agentId));
    if (value !== null) values[entry.service] = value;
  }
  return values;
}
