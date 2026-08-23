# UK49s Historical Results

Standalone UK49s historical-results scraper and console for validated Lunch and Tea draw data.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/lib/uk49s-scraper.ts` — fetch, parse, validate, deduplicate, sort, cache, and diagnostics.
- `artifacts/api-server/src/routes/scrape.ts` — scraper and health routes.
- `artifacts/uk49s-scraper/src/pages/home.tsx` — collection console and exports.
- `lib/api-spec/openapi.yaml` — API source of truth.

## Architecture decisions

- The scraper is intentionally independent of prediction, AI, optimization, and backtesting logic.
- Results are cached in memory for 15 minutes; `forceRefresh=true` bypasses the cache.
- The archive is parsed with row-level HTML fallbacks to tolerate small markup changes.
- PostgreSQL is not required because this app returns source data on demand and keeps the product standalone.

## Product

The console supports Lunch, Tea, Both, year, year-range, and full-history collection with JSON/CSV exports and visible quality diagnostics.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
