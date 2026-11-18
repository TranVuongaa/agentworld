import { appUrl } from "./auth";

/** Development-only bridge to the machine's gh login. Never enable for a public server. */
export function localDevEnabled(): boolean {
  return process.env.SAAS_LOCAL_DEV === "1" && ["localhost", "127.0.0.1", "[::1]"].includes(appUrl().hostname);
}
