import { readFile } from "node:fs/promises";
import pg from "pg";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL("../server/saas/schema.sql", import.meta.url), "utf8"));
  console.log("SaaS schema is ready.");
} finally {
  await pool.end();
}
