import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let poolInstance: pg.Pool | undefined;
let dbInstance: NodePgDatabase<typeof schema> | undefined;

/**
 * Supabase (and most managed PostgreSQL providers) require TLS. `pg` only
 * enables TLS when told to, so we resolve an explicit SSL configuration from
 * the connection string.
 *
 * The `sslmode` parameter is stripped from the string before it is handed to
 * `pg` because `pg-connection-string` maps `sslmode=require` to strict
 * certificate verification, which fails against Supabase's pooled endpoints.
 * We instead control TLS via the `ssl` option below.
 *
 * Credentials themselves never leave the server: only the value read from
 * `DATABASE_URL` is used here, and it is never returned to clients.
 */
function resolveConnection(connectionString: string): {
  connectionString: string;
  ssl: pg.PoolConfig["ssl"];
} {
  const sslmodeMatch = connectionString.match(/[?&]sslmode=([^&]*)/i);
  const sslmode = sslmodeMatch ? decodeURIComponent(sslmodeMatch[1]).toLowerCase() : null;

  // Remove the sslmode parameter without disturbing the rest of the URL
  // (avoids re-encoding passwords that contain reserved characters).
  let clean = connectionString;
  if (sslmodeMatch) {
    clean = clean
      .replace(/[?&]sslmode=[^&]*/i, "")
      .replace(/[?&]$/, "")
      .replace(/\?&/, "?");
  }

  const override = (process.env.DATABASE_SSL ?? "").toLowerCase();

  // Explicit opt-out wins for local development databases.
  if (override === "false" || override === "disable" || sslmode === "disable") {
    return { connectionString: clean, ssl: false };
  }

  let host = "";
  try {
    host = new URL(clean).hostname;
  } catch {
    // Non-URL connection strings are passed through untouched.
  }

  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLocal) {
    return { connectionString: clean, ssl: false };
  }

  return { connectionString: clean, ssl: { rejectUnauthorized: false } };
}

/**
 * Accepts the common names a managed PostgreSQL provider may use, so the
 * server works whether the connection string was provisioned as
 * `DATABASE_URL` or as a provider-specific variable.
 */
function resolveConnectionString(): string | undefined {
  return (
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL
  );
}

function getPool(): pg.Pool {
  if (!poolInstance) {
    const connectionString = resolveConnectionString();

    if (!connectionString) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?",
      );
    }

    const connection = resolveConnection(connectionString);
    poolInstance = new Pool(connection);
  }

  return poolInstance;
}

function getDb(): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema });
  }

  return dbInstance;
}

// Lazily created so the server can boot (and serve non-database routes) even
// when DATABASE_URL is not configured. Any actual database operation fails
// with a clear error until a connection string is provided.
export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    const target = getPool();
    const value = (target as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    const target = getDb();
    const value = (target as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export * from "./schema";