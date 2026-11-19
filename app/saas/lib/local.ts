import { appUrl } from "./appUrl";

/** Development-only bridge to the machine's gh login. Never enable for a public server. */
export function localDevEnabled(): boolean {
  return process.env.SAAS_LOCAL_DEV === "1" && ["localhost", "127.0.0.1", "[::1]"].includes(appUrl().hostname);
}

/** The gh bridge is optional; GitHub App authentication also works on localhost. */
export function localGithubCliEnabled(): boolean {
  return localDevEnabled() && (process.env.SAAS_GITHUB_AUTH || "gh") === "gh";
}
