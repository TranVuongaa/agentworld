import assert from "node:assert/strict";
import { localDevEnabled, localGithubCliEnabled } from "../app/saas/lib/local";
import { repositories } from "../app/saas/lib/github";

const previous = { ...process.env };
const originalFetch = globalThis.fetch;
try {
  process.env.SAAS_LOCAL_DEV = "1";
  process.env.SAAS_APP_URL = "http://127.0.0.1:7420";
  process.env.SAAS_GITHUB_AUTH = "app";
  assert(localDevEnabled());
  assert(!localGithubCliEnabled());
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input); requested.push(url);
    if (url.includes("/user/installations/12/repositories")) return Response.json({ repositories: [{ id: 42, name: "repo", full_name: "owner/repo", private: true }] });
    if (url.includes("/user/installations?")) return Response.json({ installations: [{ id: 12, account: { login: "owner" } }] });
    throw new Error("Unexpected GitHub request");
  }) as typeof fetch;
  assert.deepEqual(await repositories("fixture"), [{ id: 42, name: "repo", full_name: "owner/repo", private: true, installationId: 12, accountLogin: "owner" }]);
  assert(requested.every((url) => !url.includes("/user/repos?")));
  process.env.SAAS_GITHUB_AUTH = "gh";
  assert(localGithubCliEnabled());
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert(String(input).includes("/user/repos?"));
    return Response.json([{ id: 42, name: "repo", full_name: "owner/repo", private: true, owner: { login: "owner" } }]);
  }) as typeof fetch;
  assert.equal((await repositories("fixture"))[0].installationId, 0);
  process.env.SAAS_GITHUB_AUTH = "invalid";
  assert(!localGithubCliEnabled());
  console.log("Local GitHub App and CLI modes use the correct repository APIs");
} finally { process.env = previous; globalThis.fetch = originalFetch; }
