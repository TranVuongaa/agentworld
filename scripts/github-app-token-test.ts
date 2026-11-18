import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { githubAppJwt, githubInstallationToken } from "../server/saas/githubApp";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const jwt = githubAppJwt("test-client", privateKey, 1700000000);
const [header, payload, signature] = jwt.split(".");
assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), { iat: 1699999940, exp: 1700000540, iss: "test-client" });
assert(createVerify("RSA-SHA256").update(`${header}.${payload}`).end().verify(publicKey, Buffer.from(signature, "base64url")));
let called = false;
const token = await githubInstallationToken({ clientId: "test-client", privateKey, installationId: "123", repositoryId: "9007199254740993", fetcher: async (url, init) => {
  called = true;
  assert.equal(url, "https://api.github.com/app/installations/123/access_tokens");
  assert.equal(init?.body, '{"repository_ids":[9007199254740993]}');
  assert.equal(init?.method, "POST");
  assert.match(new Headers(init?.headers).get("Authorization") ?? "", /^Bearer [A-Za-z0-9_.-]+$/);
  return Response.json({ token: "fixture-token", expires_at: new Date(Date.now() + 3600000).toISOString() });
} });
assert(called);
assert.equal(token.token, "fixture-token");
await assert.rejects(() => githubInstallationToken({ clientId: "test-client", privateKey, installationId: "1/evil", repositoryId: "123" }));
await assert.rejects(() => githubInstallationToken({ clientId: "test-client", privateKey, installationId: "123", repositoryId: "456", fetcher: async () => new Response("error", { status: 403 }) }));
console.log("GitHub App JWT and single-repository installation token checks passed");
