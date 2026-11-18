import { Pool } from "pg";

declare global { var saasPool: Pool | undefined; }
export function db(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return globalThis.saasPool ??= new Pool({ connectionString: process.env.DATABASE_URL });
}
