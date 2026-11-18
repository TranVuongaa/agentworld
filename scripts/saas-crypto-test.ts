import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, readEncryptionKey } from "../server/saas/crypto";

const key = randomBytes(32);
assert.deepEqual(readEncryptionKey(key.toString("base64")), key);
assert.throws(() => readEncryptionKey("invalid"));
const ciphertext = encryptSecret(key, "project-1", "API_KEY", "private-value");
assert(!ciphertext.includes("private-value"));
assert.equal(decryptSecret(key, "project-1", "API_KEY", ciphertext), "private-value");
assert.notEqual(ciphertext, encryptSecret(key, "project-1", "API_KEY", "private-value"));
assert.throws(() => decryptSecret(key, "project-2", "API_KEY", ciphertext));
assert.throws(() => decryptSecret(key, "project-1", "OTHER", ciphertext));
assert.throws(() => decryptSecret(randomBytes(32), "project-1", "API_KEY", ciphertext));
console.log("SaaS secret encryption checks passed");
