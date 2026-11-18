import { createSign } from "node:crypto";

/** Create an RS256 JWT for authenticating the GitHub App, never a user. */
export function githubAppJwt(clientId: string, privateKey: string, now = Math.floor(Date.now() / 1000)): string {
  if (!clientId || !privateKey) throw new Error("GitHub App credentials are not configured");
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: clientId })}`;
  const signature = createSign("RSA-SHA256").update(content).end().sign(privateKey).toString("base64url");
  return `${content}.${signature}`;
}

/** Mint an installation token limited to exactly one repository. */
export async function githubInstallationToken(input: {
  clientId: string; privateKey: string; installationId: string; repositoryId: string; fetcher?: typeof fetch;
}): Promise<{ token: string; expiresAt: number }> {
  if (!/^[1-9]\d{0,18}$/.test(input.installationId) || !/^[1-9]\d{0,18}$/.test(input.repositoryId)) throw new Error("Invalid GitHub installation or repository ID");
  const jwt = githubAppJwt(input.clientId, input.privateKey);
  const response = await (input.fetcher ?? fetch)(`https://api.github.com/app/installations/${input.installationId}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agentworld" },
    // Validate decimal digits above, then retain full 64-bit precision in JSON.
    body: `{"repository_ids":[${input.repositoryId}]}`,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub installation token request failed (${response.status})`);
  const data = await response.json() as { token?: unknown; expires_at?: unknown };
  const expiresAt = typeof data.expires_at === "string" ? Date.parse(data.expires_at) : NaN;
  if (typeof data.token !== "string" || !data.token || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) throw new Error("GitHub returned an invalid installation token");
  return { token: data.token, expiresAt };
}
