import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { recoverInterruptedJobs, shutdownOptimizerJobs } from "./lib/optimizer-jobs";

function resolvePortFromArgv(): string | undefined {
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--port" || arg === "-p") {
      return args[i + 1];
    }

    if (arg.startsWith("--port=")) {
      return arg.slice("--port=".length);
    }
  }

  return undefined;
}

const rawPort = process.env["PORT"] ?? resolvePortFromArgv();

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Names only — values are never logged. This makes a missing database
// connection string obvious in the server logs instead of surfacing as a
// generic ingestion failure later on.
const DB_ENV_CANDIDATES = ["DATABASE_URL", "SUPABASE_DB_URL", "POSTGRES_URL"];
const presentDbEnvVars = DB_ENV_CANDIDATES.filter((name) => Boolean(process.env[name]));

if (presentDbEnvVars.length === 0) {
  logger.warn(
    { checked: DB_ENV_CANDIDATES },
    "No database connection string is configured — database-backed endpoints will fail",
  );
} else {
  logger.info({ found: presentDbEnvVars }, "Database connection string detected");
}

/**
 * Verifies the database connection once at boot so a bad connection string
 * surfaces as a clear log line instead of a confusing failure on the first
 * request. Only the error code/message is logged — never the credentials.
 */
async function verifyDatabaseConnection(): Promise<void> {
  try {
    await pool.query("SELECT 1");
    logger.info("Database connection verified");
  } catch (error) {
    const err = error as { code?: string; message?: string };
    logger.error(
      { code: err.code, message: err.message },
      "Database connection failed",
    );
  }
}

/**
 * Optimizer jobs live in the process. A restart therefore orphans any run that
 * was still queued/running, so those are marked failed on boot. A periodic sweep
 * covers the same case for jobs that die later (crashed worker, stalled run), so
 * a job can never stay permanently "running".
 */
const OPTIMIZER_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function recoverOrphanedOptimizerJobs(): Promise<void> {
  try {
    await recoverInterruptedJobs("Interrupted by server restart — the optimizer run did not finish");
  } catch (error) {
    logger.error({ error }, "Failed to recover interrupted optimizer runs");
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
    void verifyDatabaseConnection().then(() => recoverOrphanedOptimizerJobs());

  const sweep = setInterval(() => {
    void recoverInterruptedJobs("Optimizer run stalled — no progress was reported");
  }, OPTIMIZER_SWEEP_INTERVAL_MS);
  sweep.unref();

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "Shutting down");
    void shutdownOptimizerJobs().finally(() => process.exit(0));
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
});
