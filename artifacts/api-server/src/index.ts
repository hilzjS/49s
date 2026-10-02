import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { recoverInterruptedJobs, shutdownOptimizerJobs } from "./lib/optimizer-jobs";
import { runDailyPredictionUpdate, runDrawCheck } from "./lib/auto-predictions";

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

/**
 * How often the app refreshes its latest results and (re)generates the next
 * prediction for each draw type. Runs shortly after boot and then hourly, so a
 * prediction is always ready for the upcoming draw without any manual action.
 */
const AUTO_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_UPDATE_INITIAL_DELAY_MS = 15 * 1000;

/**
 * How often the app checks whether an awaited draw has been published. A stored
 * prediction stays "Awaiting draw" until its result is recorded, so this polls
 * every minute and resolves it as soon as the result is available (instead of
 * waiting for the hourly update). It goes to the source (bypassing the scrape
 * cache) once the awaited draw is due, and writes no scrape-run audit row.
 */
const DRAW_CHECK_INTERVAL_MS = 60 * 1000;
const DRAW_CHECK_INITIAL_DELAY_MS = 5 * 1000;

function safeAutoUpdate(): void {
  void runDailyPredictionUpdate().catch((error: unknown) => {
    // A failed update must never become an unhandled rejection and take the API
    // process down; it is retried on the next interval.
    logger.error({ error }, "Automatic draw/prediction update failed");
  });
}

function safeDrawCheck(): void {
  void runDrawCheck().catch((error: unknown) => {
    // Same rule: a failed check is logged and retried on the next minute.
    logger.error({ error }, "Awaiting-draw check failed");
  });
}

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
      void recoverInterruptedJobs("Optimizer run stalled — no progress was reported").catch((error: unknown) => {
        // A failed sweep must never become an unhandled rejection: that would
        // terminate the API process and take every endpoint down with it.
        logger.error({ error }, "Optimizer stall sweep failed");
      });
    }, OPTIMIZER_SWEEP_INTERVAL_MS);
    sweep.unref();
  
    // Automatic results refresh + prediction generation for the upcoming draw.
    const autoUpdate = setInterval(safeAutoUpdate, AUTO_UPDATE_INTERVAL_MS);
    autoUpdate.unref();
  
    const autoUpdateInitial = setTimeout(safeAutoUpdate, AUTO_UPDATE_INITIAL_DELAY_MS);
    autoUpdateInitial.unref();

    // Minute-by-minute "awaiting draw" check: resolve pending predictions as
    // soon as their result is published.
    const drawCheck = setInterval(safeDrawCheck, DRAW_CHECK_INTERVAL_MS);
    drawCheck.unref();

    const drawCheckInitial = setTimeout(safeDrawCheck, DRAW_CHECK_INITIAL_DELAY_MS);
    drawCheckInitial.unref();

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "Shutting down");
    void shutdownOptimizerJobs()
      .catch((error: unknown) => logger.error({ error }, "Failed to shut down optimizer jobs cleanly"))
      .finally(() => process.exit(0));
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
});
