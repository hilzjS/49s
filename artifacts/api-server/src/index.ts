import app from "./app";
import { logger } from "./lib/logger";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
