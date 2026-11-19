/** Sandboxes inherit machine-wide service credentials unless overridden by a scoped secret. */
export function uncoveredGlobalCredentials(entries: { name: string; scope: string; type?: string }[], scoped: Record<string, string>): string[] {
  return [...new Set(entries.filter((entry) => entry.scope === "global" && entry.type === "service" && !Object.hasOwn(scoped, entry.name)).map((entry) => entry.name))].sort();
}
