// Development entrypoint used by the app preview.
//
// Starts two processes together:
//   - the API server (Express) on a free port (API_PORT, default 3000)
//   - the dashboard (Vite) on the port the platform provides via --port
// The dashboard's /api requests are proxied to the API server, so the preview
// renders the real application UI.
import { spawn } from "node:child_process";
import net from "node:net";

const args = process.argv.slice(2);

function readFlag(name, fallback) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === name && args[i + 1]) {
      return args[i + 1];
    }

    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }

  return fallback;
}

const webPort = readFlag("--port", process.env.PORT ?? "5000");

/**
 * A previous dev run can leave an orphaned API process holding the default
 * port. Without this, the freshly started server exits with EADDRINUSE while
 * the stale process keeps serving old code. Probe upwards for a free port.
 */
async function findFreePort(startPort, attempts = 20) {
  for (let port = startPort; port < startPort + attempts; port += 1) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.unref();
      probe.once("error", () => resolve(false));
      probe.listen(port, () => probe.close(() => resolve(true)));
    });

    if (free) return port;
  }

  return startPort;
}

const requestedApiPort = Number(process.env.API_PORT ?? "3000");
const apiPort = await findFreePort(requestedApiPort);
const proxyTarget = `http://localhost:${apiPort}`;

console.log(`[dev] api port ${apiPort} (requested ${requestedApiPort}) → ${proxyTarget}`);

function start(label, command, env) {
  const child = spawn(command, {
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    console.log(`[dev] ${label} exited with code ${code}`);
  });

  return child;
}

const api = start("api", "pnpm --filter @workspace/api-server run dev", {
  PORT: String(apiPort),
  API_PROXY_TARGET: proxyTarget,
});

const web = start(
  "web",
  `pnpm --filter @workspace/uk49s-scraper run dev --port ${webPort}`,
  { PORT: webPort, API_PROXY_TARGET: proxyTarget },
);

// The dashboard is the preview server: when it stops, stop everything.
web.on("exit", (code) => {
  if (api.exitCode === null) {
    api.kill();
  }

  process.exit(code ?? 0);
});
