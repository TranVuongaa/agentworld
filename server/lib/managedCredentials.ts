import { randomUUID } from "node:crypto";

export const managedCredentialsEnabled = () => process.env.HQ_MANAGED_GITHUB === "1";

/** Requests are served by the owning supervisor over the private child-process IPC channel. */
export async function managedRequest<T>(operation: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!managedCredentialsEnabled() || !process.send || !process.connected) throw new Error("Project credential supervisor is unavailable");
  const id = randomUUID();
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); process.off("message", onMessage); process.off("disconnect", onDisconnect); };
    const onMessage = (raw: unknown) => {
      const reply = raw as { type?: unknown; id?: unknown; ok?: unknown; value?: unknown };
      if (reply?.type !== "managed-credential-result" || reply.id !== id) return;
      cleanup();
      if (reply.ok === true) resolve(reply.value as T);
      else reject(new Error("Project credential is unavailable; reconnect GitHub or check the project key"));
    };
    const onDisconnect = () => { cleanup(); reject(new Error("Project credential supervisor disconnected")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Project credential request timed out")); }, 20_000);
    process.on("message", onMessage);
    process.once("disconnect", onDisconnect);
    process.send?.({ type: "managed-credential-request", id, operation, payload }, (error) => {
      if (error) { cleanup(); reject(new Error("Could not request project credential")); }
    });
  });
}
export interface ProjectKeyName { service: string; agentId: string | null }
export const projectKeyNames = () => managedRequest<ProjectKeyName[]>("list");
export const resolveProjectKeys = (agentId: string) => managedRequest<Record<string, string>>("resolve", { agentId });
export const setProjectKey = (agentId: string | null, service: string, value: string) => managedRequest<void>("set", { agentId, service, value });
export const removeProjectKey = (agentId: string | null, service: string) => managedRequest<void>("remove", { agentId, service });

export const listAllManagedEnv = () => managedRequest<Record<string, string[]>>("env-list-all");
export const resolveManagedEnv = (agentId: string) => managedRequest<Record<string, string>>("env-resolve", { agentId });
export const setManagedEnv = (agentId: string, name: string, value: string) => managedRequest<void>("env-set", { agentId, name, value });
export const removeManagedEnv = (agentId: string, name: string) => managedRequest<void>("env-remove", { agentId, name });
