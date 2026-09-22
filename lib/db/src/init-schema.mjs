/**
 * Applies the UK49s schema (lib/db/migrations/0000_uk49s_schema.sql) to the
 * database in DATABASE_URL.
 *
 * Usage:  pnpm run db:init         (from the repo root)
 *      or  pnpm --filter @workspace/db run init
 *
 * The SQL is idempotent, so this is safe to run against a fresh Supabase
 * database or an existing one. Credentials are read from the server-side
 * environment only and are never printed.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "DATABASE_URL must be set (e.g. your Supabase PostgreSQL connection string).",
  );
  process.exit(1);
}

// Mirrors resolveConnection() in ./index.ts so the CLI and server use the same
// TLS behaviour (Supabase requires TLS; sslmode is handled explicitly).
function resolveConnectionString(value) {
  const sslmodeMatch = value.match(/[?&]sslmode=([^&]*)/i);
  if (!sslmodeMatch) return value;
  return value
    .replace(/[?&]sslmode=[^&]*/i, "")
    .replace(/[?&]$/, "")
    .replace(/\?&/, "?");
}

function resolveSsl(value) {
  const sslmodeMatch = value.match(/[?&]sslmode=([^&]*)/i);
  const sslmode = sslmodeMatch
    ? decodeURIComponent(sslmodeMatch[1]).toLowerCase()
    : null;

  const override = (process.env.DATABASE_SSL ?? "").toLowerCase();
  if (override === "false" || override === "disable" || sslmode === "disable") {
    return false;
  }

  let host = "";
  try {
    host = new URL(resolveConnectionString(value)).hostname;
  } catch {
    // ignore
  }

  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return isLocal ? false : { rejectUnauthorized: false };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(here, "..", "migrations", "0000_uk49s_schema.sql");

const client = new Client({
  connectionString: resolveConnectionString(connectionString),
  ssl: resolveSsl(connectionString),
});

try {
  const sql = await readFile(sqlPath, "utf8");
  await client.connect();
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("UK49s schema applied successfully.");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // ignore rollback errors
  }
  console.error(
    "Failed to apply schema:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}