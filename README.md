# UK49s Prediction Platform

A production-ready platform for UK49s **Lunchtime** and **Teatime** historical-data
collection, walk-forward backtesting, model optimization, and statistical prediction.

> **Honesty notice**: UK49s draws are random. Everything this platform produces is a
> statistical pattern analysis of historical data. It does not and cannot predict
> lottery outcomes. All metrics shown are real, out-of-sample, and unedited — including
> when the model performs at or below chance level.

## Architecture

```
SOURCE SCRAPER → RAW/VALIDATED DATA → DATABASE → FEATURE ENGINE
  → WALK-FORWARD BACKTEST → OPTIMIZER → SELECTED MODEL
  → DAILY PREDICTION → RESULT TRACKING → PERFORMANCE ANALYTICS → WEB DASHBOARD
```

Lunchtime and Teatime are two **completely separate** datasets and models at every
stage — separate scrape targets, separate DB rows (`draw_type`), separate model
configs, separate backtests, separate optimizer runs, separate predictions.

## Data model

Each draw record contains the 6 official winning numbers plus 1 separate Booster Ball,
all validated as 1–49, booster never mixed into the main numbers:

- `uk49s_draws` — validated draws (unique on `draw_date + draw_type`)
- `uk49s_scrape_runs` — one record per scrape/ingest operation with full stats
- `uk49s_model_configs` — SuperHybrid feature weights, lookback window, constraints
- `uk49s_optimizer_runs` / `uk49s_optimizer_configs` — every tested configuration
- `uk49s_backtest_runs` — walk-forward validation results incl. both baselines
- `uk49s_predictions` — immutable prediction history, auto-matched to actual results

## Prediction format

Every prediction is **exactly 4 main numbers** (sorted, 1–49) plus **1 separate
Booster Ball** (1–49, never one of the four). Never 5 or 6 main numbers.

## Feature Engine (SuperHybrid)

Configurable, independently testable components: frequency, recency, hot/cold,
gap analysis, pairs, triples, consecutive patterns, odd/even balance, low/high
balance, sum/range behaviour, positional behaviour, repeat numbers, First3Minus2.

## Walk-forward backtesting

For every historical prediction date, features are computed **only** from draws
strictly earlier than the target draw. Tested lookback windows: 30/60/90/180/365.
Baselines (random 4-number and frequency-only) run on the identical periods for
honest comparison.

## Setup

```bash
# 1. Install dependencies (pnpm required)
pnpm install

# 2. Provision PostgreSQL and set env vars
export DATABASE_URL="postgresql://user:password@localhost:5432/uk49s"
export ADMIN_API_KEY="choose-a-strong-key"   # protects admin endpoints
export PORT=3000

# 3. Create database schema
pnpm run db:generate   # or: pnpm --filter @workspace/db run push

# 4. Start the API server
pnpm run dev:api

# 5. Start the web dashboard (proxies /api to the API server)
pnpm run dev:scraper
```

## Commands

| Script | Purpose |
|---|---|
| `pnpm run scrape:uk49s` | Scrape + ingest 2015 (verification year) |
| `pnpm run ingest:uk49s` | Ingest full history 2015–present (idempotent) |
| `pnpm run backtest:uk49s` | Walk-forward backtest (Lunchtime, 2024) |
| `pnpm run optimize:uk49s` | Random Search + Hill Climbing optimization |
| `pnpm run predict:uk49s` | Generate next Lunchtime prediction |
| `pnpm run update:uk49s` | Update-latest: ingest newest draws, match pending predictions |
| `pnpm run verify:uk49s` | Run tests + typecheck |
| `pnpm run test` | 32 unit tests (scraper, features, leakage, format) |

## API

Public (read-only):

- `GET /api/health` — scraper health
- `GET /api/scrape/:drawType/:year` — raw scrape (preserved from original)
- `GET /api/data/summary` — totals, year counts, quality
- `GET /api/data/latest/:drawType` — latest draws
- `GET /api/data/export?drawType=&format=json|csv` — export
- `GET /api/predictions/latest/:drawType` — latest prediction
- `GET /api/predictions/history/:drawType` — prediction history
- `GET /api/predictions/model/:drawType` — active model
- `GET /api/backtest/latest/:drawType` — latest backtest with baselines
- `GET /api/backtest/history/:drawType` — backtest history
- `GET /api/optimizer/history/:drawType` — optimizer runs

Administrative (require `Authorization: Bearer $ADMIN_API_KEY`):

- `POST /api/data/ingest` — body: `{ year }` | `{ startYear, endYear }` | `{ drawType: "latest" }`
- `POST /api/backtest/run` — body: `{ drawType, lookbackWindow, testStartDate, testEndDate }`
- `POST /api/backtest/compare-windows` — compare 30/60/90/180/365 windows
- `POST /api/optimizer/run` — body: `{ drawType, validationStartDate, validationEndDate, testStartDate?, testEndDate?, applyToModel? }`
- `POST /api/optimizer/cross-validate` — k-fold stability check
- `POST /api/predictions/generate` — body: `{ drawType, predictionDate? }`

## Dashboard

`/dashboard` — Overview, Data, Scraper, Lunchtime, Teatime, Predictions, Backtest,
Optimizer, Performance, Settings.

## Verified results (real, not fabricated)

- 2015 Lunchtime scrape: **363 records**
- 2015 Teatime scrape: **362 records**
- Full history 2015–2026-09: **4,163 Lunchtime / 4,162 Teatime** draws, 0 rejected
- 2024 walk-forward backtest (90-draw window, 365 predictions each):
  - Lunchtime: avg hits **0.436** vs random **0.523** — *no edge detected*
  - Teatime: avg hits **0.485** vs random **0.425** — *within noise*
- Optimizer: 180 configurations per draw type, validated on 2023, tested on held-out
  2024 H1. Selected configurations perform at chance level — reported as-is.

## Testing

```bash
pnpm run test
```

Includes an explicit **leakage test**: a future draw is mutated after predictions are
made and the earlier predictions are verified to be unchanged.

## Experiment Lab (v2)

The Lab (`/dashboard/lab`, API under `/api/experiments`) is the research layer:

- **Feature ablation** — SuperHybrid with each of the 13 features removed one at a
  time, plus Frequency-only, Recency-only, Pattern-only, Random, and an Ensemble
  (Frequency + Recency + Pattern + SuperHybrid rank-averaged). 19 variants per run.
- **Multi-period walk-forward** — variants are evaluated per calendar year
  (e.g. 2016–2025), strictly out-of-sample, with paired random/frequency baselines.
- **Stability analysis** — per-variant volatility (std-dev of yearly avg hits) and a
  Welch t-test vs the paired random baseline. A variant only counts as "beating
  random" with p < 0.05.
- **Separate booster model** — booster-frequency / booster-recency / booster-random
  are evaluated as an independent prediction problem.

### Real research findings (2026-09-02, lookback 90, seed 42)

**Lunchtime ablation** — 19 variants × 10 years (2016–2025), ~3,600 predictions per
variant: best variant (SuperHybrid − Repeat) 0.4983 avg hits vs random 0.4719.
**No variant beat random at p < 0.05** (best p = 0.11).

**Teatime ablation** — 19 variants × 9 years (2017–2025): best variant
(Pattern-only) 0.4947 vs random 0.4925. **No variant beat random at p < 0.05**.

**Booster model** — 3,192 predictions each, per draw type: booster-frequency hit
2.29% (Lunch) / 2.04% (Tea) vs 2.04% random expectation — **within noise**.

Conclusion: the current feature set carries no statistically detectable edge. The
value of the platform is that this is now *provable* out-of-sample, and any future
feature can be tested the same way before it is trusted.

### Experiment API

- `POST /api/experiments/run` (admin) — `{ drawType, kind, lookbackWindow, randomSeed, periods? }`
- `POST /api/experiments/booster` (admin) — `{ drawType, lookbackWindow, randomSeed, periods? }`
- `GET /api/experiments/runs` — list runs
- `GET /api/experiments/runs/:id` — full detail (variants, per-period rows, booster results)
- `GET /api/experiments/latest/:drawType` — latest run leaderboard

## Security

- `DATABASE_URL` and `ADMIN_API_KEY` are server-side environment variables only
- No secrets in frontend code or version control
- Admin endpoints return 401 without a valid key (dev mode logs a warning if unset)

## Troubleshooting

- **`DATABASE_URL must be set`** — export it before starting the API or pushing schema
- **401 on admin endpoints** — pass `Authorization: Bearer $ADMIN_API_KEY`
- **Empty dashboard metrics** — run ingestion first, then a backtest, then optimize
- **2020 shows fewer draws (281)** — the source archive itself has fewer draws that
  year (draw suspension); the platform reports source data as-is
