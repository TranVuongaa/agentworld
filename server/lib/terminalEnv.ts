/** Exclude coordinator-only secrets from all interactive processes and PTYs. */
export function terminalEnvironment(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const result: Record<string, string> = {};
  const privateNames = new Set(["HQ_UI_TOKEN", "HQ_STATE_FILE", "HQ_RUNTIME_ID", "SAAS_LOCAL_BOOT_TOKEN", "AGENTWORLD_GIT_TOKEN"]);
  for (const [key, value] of Object.entries(source)) if (value !== undefined && !privateNames.has(key)) result[key] = value;
  result.TERM = "xterm-256color";
  result.COLORTERM = "truecolor";
  return result;
}
