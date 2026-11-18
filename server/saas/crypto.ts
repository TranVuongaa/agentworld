import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** A 32-byte key encoded as base64. Keep it outside the database and backups. */
export function readEncryptionKey(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("SAAS_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) throw new Error("Invalid SAAS_ENCRYPTION_KEY");
  return key;
}

export function encryptSecret(key: Buffer, projectId: string, name: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify([projectId, name])));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(key: Buffer, projectId: string, name: string, value: string): string {
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Invalid encrypted secret");
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted secret");
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify([projectId, name])));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(Buffer.from(parts[3], "base64")), cipher.final()]).toString("utf8");
}
