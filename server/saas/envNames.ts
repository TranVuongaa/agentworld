import { validAgent } from "./keyNames";

export function validEnvName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value);
}
export function envSecretName(agentId: string, name: string): string {
  if (!validAgent(agentId) || !validEnvName(name)) throw new Error("Invalid environment variable scope");
  return `ENV_${Buffer.from(agentId).toString("hex").toUpperCase()}_${Buffer.from(name).toString("hex").toUpperCase()}`;
}
export function parseEnvSecretName(value: string): { agentId: string; name: string } | null {
  const match = /^ENV_([A-F0-9]+)_([A-F0-9]+)$/.exec(value);
  if (!match || match[1].length % 2 || match[2].length % 2) return null;
  const agentId = Buffer.from(match[1], "hex").toString("utf8"), name = Buffer.from(match[2], "hex").toString("utf8");
  if (!validAgent(agentId) || !validEnvName(name) || envSecretName(agentId, name) !== value) return null;
  return { agentId, name };
}
