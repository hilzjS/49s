import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let poolInstance: pg.Pool | undefined;
let dbInstance: NodePgDatabase<typeof schema> | undefined;

function getPool(): pg.Pool {
  if (!poolInstance) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?",
      );
    }

    poolInstance = new Pool({ connectionString });
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
