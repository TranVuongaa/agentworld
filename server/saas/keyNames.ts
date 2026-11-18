import { SERVICE_KEYS } from "../../src/data/types";

const allowed = new Set<string>(SERVICE_KEYS);
export function validService(value: unknown): value is string { return typeof value === "string" && allowed.has(value); }
export function validAgent(value: unknown): value is string | null { return value === null || (typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value)); }
export function projectKeyName(service: string, agentId: string | null): string {
  if (!validService(service) || !validAgent(agentId)) throw new Error("Invalid project key scope");
  return `SERVICE_${service.toUpperCase()}${agentId ? `__AGENT_${Buffer.from(agentId).toString("hex").toUpperCase()}` : ""}`;
}
export function parseProjectKeyName(name: string): { service: string; agentId: string | null } | null {
  const match = /^SERVICE_([A-Z]+)(?:__AGENT_([A-F0-9]+))?$/.exec(name);
  if (!match || !validService(match[1].toLowerCase()) || (match[2] && match[2].length % 2)) return null;
  const agentId = match[2] ? Buffer.from(match[2], "hex").toString("utf8") : null;
  if (!validAgent(agentId) || projectKeyName(match[1].toLowerCase(), agentId) !== name) return null;
  return { service: match[1].toLowerCase(), agentId };
}
