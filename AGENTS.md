# AGENTS.md — UK49s Platform

## Environment quirks

- **Corepack is broken in this sandbox**: `pnpm` via corepack hangs downloading.
  Workaround already in place: `~/bin/pnpm` wrapper runs
  `node ~/pnpm-manual/package/bin/pnpm.cjs`. Always `export PATH="$HOME/bin:$PATH"`
  before running pnpm commands.
- PostgreSQL 17 runs locally (`sudo service postgresql start`). Database `uk49s`,
  user `uk49s`, password `uk49s_dev_password` (local dev only).
  `DATABASE_URL=postgresql://uk49s:uk49s_dev_password@localhost:5432/uk49s`
- API server runs on port 3000; frontend (vite preview) on 5000 with `/api` proxy.
- `ADMIN_API_KEY=dev-admin-key-12345` was used for local verification runs.

## Build/test commands

- `pnpm run typecheck` — typecheck all workspaces (must pass before commit)
- `pnpm --filter @workspace/api-server run test` — 32 unit tests via `tsx --test`
- `pnpm --filter @workspace/api-server run build` — esbuild bundle to dist/
- `pnpm --filter @workspace/uk49s-scraper run build` — vite production build

## Architecture rules (do not break)

- Draws have 6 main numbers + 1 booster (real UK49s format). Predictions are
  exactly 4 main + 1 booster. Booster never in main numbers.
- Lunchtime and Teatime are fully separate datasets/models.
- Walk-forward backtests must never use data from the target date or later.
- `generateAndStorePrediction` filters training draws to `drawDate < predictionDate`.
- Random seeds must fit Postgres int4 (< 2147483647) — do not use Date.now() as a seed.
- Scraper behavior is preserved; stats counting includes text-level dedup in
  `duplicatesRemoved` (see `candidateTexts` returning `{ texts, exactDuplicates }`).

## Key files

- `lib/db/src/schema/uk49s.ts` — all 7 tables
- `lib/db/src/schema/feature-engine.ts` — SuperHybrid components
- `lib/db/src/schema/backtest-engine.ts` — walk-forward validation + baselines
- `lib/db/src/schema/optimizer-engine.ts` — Random Search + Hill Climbing
- `artifacts/api-server/src/lib/uk49s-scraper.ts` — preserved source scraper
- `artifacts/api-server/src/routes/{data,predictions,backtest,optimizer}.ts`
- `artifacts/uk49s-scraper/src/pages/dashboard/*` — dashboard pages
