-- UK49s Prediction Platform — initial schema
--
-- Target: a fresh Supabase PostgreSQL database (or any PostgreSQL 13+).
-- This file is idempotent: it is safe to run repeatedly and will only create
-- objects that are missing. It mirrors the Drizzle ORM schema in
-- `lib/db/src/schema/*` exactly so that `drizzle-kit push` reports no changes.
--
-- Apply with:  pnpm run db:init   (uses DATABASE_URL)

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE draw_type AS ENUM ('lunchtime', 'teatime');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE validation_status AS ENUM ('valid', 'invalid', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE model_status AS ENUM ('active', 'archived', 'training');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE optimizer_status AS ENUM ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Additive: widen an existing optimizer_status enum with the job states used by
-- the optimizer job runner (queued / cancelled).
ALTER TYPE optimizer_status ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE optimizer_status ADD VALUE IF NOT EXISTS 'cancelled';

DO $$ BEGIN
  CREATE TYPE backtest_status AS ENUM ('pending', 'running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE prediction_status AS ENUM ('pending', 'matched', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- uk49s_scrape_runs — one record per scrape/ingest operation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uk49s_scrape_runs (
  id                 serial PRIMARY KEY,
  draw_type          draw_type NOT NULL,
  year               integer NOT NULL,
  source_url         text,
  urls_requested     integer NOT NULL DEFAULT 0,
  records_discovered integer NOT NULL DEFAULT 0,
  records_accepted   integer NOT NULL DEFAULT 0,
  duplicates_removed integer NOT NULL DEFAULT 0,
  records_rejected   integer NOT NULL DEFAULT 0,
  parsing_errors     integer NOT NULL DEFAULT 0,
  failed_urls        text[],
  validation_errors  text[],
  success            boolean NOT NULL DEFAULT false,
  from_cache         boolean NOT NULL DEFAULT false,
  started_at         timestamp NOT NULL DEFAULT now(),
  completed_at       timestamp,
  created_at         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uk49s_scrape_runs_type_year_idx
  ON uk49s_scrape_runs (draw_type, year);

-- ---------------------------------------------------------------------------
-- uk49s_model_configs — SuperHybrid feature weights and parameters
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uk49s_model_configs (
  id                   serial PRIMARY KEY,
  draw_type            draw_type NOT NULL,
  version              text NOT NULL,
  status               model_status NOT NULL DEFAULT 'training',
  weight_frequency     real NOT NULL DEFAULT 1.0,
  weight_recency       real NOT NULL DEFAULT 1.0,
  weight_hot_cold      real NOT NULL DEFAULT 1.0,
  weight_gap_analysis  real NOT NULL DEFAULT 1.0,
  weight_pairs         real NOT NULL DEFAULT 1.0,
  weight_triples       real NOT NULL DEFAULT 1.0,
  weight_consecutive   real NOT NULL DEFAULT 1.0,
  weight_odd_even      real NOT NULL DEFAULT 1.0,
  weight_low_high      real NOT NULL DEFAULT 1.0,
  weight_sum_range     real NOT NULL DEFAULT 1.0,
  weight_positional    real NOT NULL DEFAULT 1.0,
  weight_repeat        real NOT NULL DEFAULT 1.0,
  weight_first3_minus2 real NOT NULL DEFAULT 1.0,
  lookback_window      integer NOT NULL DEFAULT 90,
  enforce_diversity    boolean NOT NULL DEFAULT true,
  min_number_spread    integer NOT NULL DEFAULT 10,
  max_same_group       integer NOT NULL DEFAULT 2,
  training_cutoff      text,
  validation_4hit_rate real,
  validation_avg_hits  real,
  validation_sample_size integer,
  random_seed          integer,
  description          text,
  created_at           timestamp NOT NULL DEFAULT now(),
  updated_at           timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uk49s_model_configs_type_version_idx
  ON uk49s_model_configs (draw_type, version);

CREATE INDEX IF NOT EXISTS uk49s_model_configs_type_status_idx
  ON uk49s_model_configs (draw_type, status);

-- ---------------------------------------------------------------------------
-- uk49s_optimizer_runs — optimization sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uk49s_optimizer_runs (
  id                    serial PRIMARY KEY,
  draw_type             draw_type NOT NULL,
  status                optimizer_status NOT NULL DEFAULT 'pending',
  max_iterations        integer NOT NULL DEFAULT 1000,
  population_size       integer NOT NULL DEFAULT 100,
  elite_size            integer NOT NULL DEFAULT 10,
  mutation_rate         real NOT NULL DEFAULT 0.1,
  train_start_date      text,
  train_end_date        text,
  validation_start_date text,
  validation_end_date   text,
  test_start_date       text,
  test_end_date         text,
  configs_tested        integer NOT NULL DEFAULT 0,
  configs_failed        integer NOT NULL DEFAULT 0,
  total_configs         integer,
  validation_draw_count integer,
  current_iteration     integer NOT NULL DEFAULT 0,
  auto_window           boolean NOT NULL DEFAULT false,
  error_message         text,
  best_config_id        integer,
  best_4hit_rate        real,
  best_avg_hits         real,
  started_at            timestamp NOT NULL DEFAULT now(),
  heartbeat_at          timestamp,
  completed_at          timestamp,
  created_at            timestamp NOT NULL DEFAULT now()
);

-- Additive: job-progress and diagnostic columns for databases created before
-- the optimizer job runner existed.
ALTER TABLE uk49s_optimizer_runs ADD COLUMN IF NOT EXISTS configs_failed integer NOT NULL DEFAULT 0;
ALTER TABLE uk49s_optimizer_runs ADD COLUMN IF NOT EXISTS total_configs integer;
ALTER TABLE uk49s_optimizer_runs ADD COLUMN IF NOT EXISTS validation_draw_count integer;
ALTER TABLE uk49s_optimizer_runs ADD COLUMN IF NOT EXISTS current_iteration integer NOT NULL DEFAULT 0;
ALTER TABLE uk49s_optimizer_runs ADD COLUMN IF NOT EXISTS auto_window boolean NOT NULL DEFAULT false;
ALTER TABLE uk49s_optimizer_runs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE uk49s_optimizer_runs ADD COLUMN IF NOT EXISTS heartbeat_at timestamp;

CREATE INDEX IF NOT EXISTS uk49s_optimizer_runs_type_status_idx
  ON uk49s_optimizer_runs (draw_type, status);

-- ---------------------------------------------------------------------------
-- uk49s_draws — validated draws (unique on draw_date + draw_type)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uk49s_draws (
  id                serial PRIMARY KEY,
  draw_date         text NOT NULL,
  draw_type         draw_type NOT NULL,
  main_number_1     integer NOT NULL,
  main_number_2     integer NOT NULL,
  main_number_3     integer NOT NULL,
  main_number_4     integer NOT NULL,
  main_number_5     integer NOT NULL,
  main_number_6     integer NOT NULL,
  booster_ball      integer NOT NULL,
  source_url        text,
  validation_status validation_status NOT NULL DEFAULT 'pending',
  scrape_run_id     integer REFERENCES uk49s_scrape_runs (id),
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uk49s_draws_date_type_idx
  ON uk49s_draws (draw_date, draw_type);

CREATE INDEX IF NOT EXISTS uk49s_draws_date_idx
  ON uk49s_draws (draw_date);

CREATE INDEX IF NOT EXISTS uk49s_draws_type_idx
  ON uk49s_draws (draw_type);

CREATE INDEX IF NOT EXISTS uk49s_draws_type_date_idx
  ON uk49s_draws (draw_type, draw_date);

-- ---------------------------------------------------------------------------
-- uk49s_optimizer_configs — every tested configuration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uk49s_optimizer_configs (
  id                          serial PRIMARY KEY,
  run_id                      integer NOT NULL REFERENCES uk49s_optimizer_runs (id),
  draw_type                   draw_type NOT NULL,
  weight_frequency            real NOT NULL,
  weight_recency              real NOT NULL,
  weight_hot_cold             real NOT NULL,
  weight_gap_analysis         real NOT NULL,
  weight_pairs                real NOT NULL,
  weight_triples              real NOT NULL,
  weight_consecutive          real NOT NULL,
  weight_odd_even             real NOT NULL,
  weight_low_high             real NOT NULL,
  weight_sum_range            real NOT NULL,
  weight_positional           real NOT NULL,
  weight_repeat               real NOT NULL,
  weight_first3_minus2        real NOT NULL,
  lookback_window             integer NOT NULL,
  enforce_diversity           boolean NOT NULL,
  min_number_spread           integer NOT NULL,
  max_same_group              integer NOT NULL,
  validation_4hit_rate        real,
  validation_avg_hits         real,
  validation_sample_size      integer,
  validation_booster_hit_rate real,
  stability_score             real,
  random_seed                 integer,
  created_at                  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uk49s_optimizer_configs_run_idx
  ON uk49s_optimizer_configs (run_id);

CREATE INDEX IF NOT EXISTS uk49s_optimizer_configs_type_idx
  ON uk49s_optimizer_configs (draw_type);

-- ---------------------------------------------------------------------------
-- uk49s_backtest_runs — walk-forward validation results incl. baselines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uk49s_backtest_runs (
  id                        serial PRIMARY KEY,
  draw_type                 draw_type NOT NULL,
  status                    backtest_status NOT NULL DEFAULT 'pending',
  model_config_id           integer REFERENCES uk49s_model_configs (id),
  lookback_window           integer NOT NULL,
  test_start_date           text NOT NULL,
  test_end_date             text NOT NULL,
  include_random_baseline   boolean NOT NULL DEFAULT true,
  include_frequency_baseline boolean NOT NULL DEFAULT true,
  total_predictions         integer NOT NULL DEFAULT 0,
  hit_0_count               integer NOT NULL DEFAULT 0,
  hit_1_count               integer NOT NULL DEFAULT 0,
  hit_2_count               integer NOT NULL DEFAULT 0,
  hit_3_count               integer NOT NULL DEFAULT 0,
  hit_4_count               integer NOT NULL DEFAULT 0,
  avg_main_hits             real,
  median_main_hits          real,
  max_main_hits             integer,
  four_hit_rate             real,
  booster_hit_rate          real,
  random_total_predictions  integer,
  random_avg_main_hits      real,
  random_four_hit_rate      real,
  random_booster_hit_rate   real,
  freq_total_predictions    integer,
  freq_avg_main_hits        real,
  freq_four_hit_rate        real,
  freq_booster_hit_rate     real,
  random_seed               integer,
  created_at                timestamp NOT NULL DEFAULT now(),
  completed_at              timestamp
);

CREATE INDEX IF NOT EXISTS uk49s_backtest_runs_type_idx
  ON uk49s_backtest_runs (draw_type);

CREATE INDEX IF NOT EXISTS uk49s_backtest_runs_config_idx
  ON uk49s_backtest_runs (model_config_id);

-- ---------------------------------------------------------------------------
-- uk49s_predictions — immutable prediction history, matched to actual results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uk49s_predictions (
  id               serial PRIMARY KEY,
  draw_type        draw_type NOT NULL,
  prediction_date  text NOT NULL,
  predicted_main_1 integer NOT NULL,
  predicted_main_2 integer NOT NULL,
  predicted_main_3 integer NOT NULL,
  predicted_main_4 integer NOT NULL,
  predicted_booster integer NOT NULL,
  model_config_id  integer REFERENCES uk49s_model_configs (id),
  training_cutoff  text NOT NULL,
  component_scores text,
  overall_score    real,
  matched_draw_id  integer REFERENCES uk49s_draws (id),
  actual_main_1    integer,
  actual_main_2    integer,
  actual_main_3    integer,
  actual_main_4    integer,
  actual_main_5    integer,
  actual_main_6    integer,
  actual_booster   integer,
  main_hits        integer,
  booster_hit      boolean DEFAULT false,
  status           prediction_status NOT NULL DEFAULT 'pending',
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uk49s_predictions_date_type_idx
  ON uk49s_predictions (prediction_date, draw_type);

CREATE INDEX IF NOT EXISTS uk49s_predictions_type_status_idx
  ON uk49s_predictions (draw_type, status);

CREATE INDEX IF NOT EXISTS uk49s_predictions_type_date_idx
  ON uk49s_predictions (draw_type, prediction_date);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- The application connects directly to PostgreSQL as the database owner and
-- never uses Supabase's Data API (no anon/service-role key is shipped to the
-- client). Enabling RLS with no policies denies the `anon`/`authenticated`
-- Data API roles by default, while the owner connection (which bypasses RLS)
-- keeps full access. This prevents the public anon key from reading or writing
-- these tables through PostgREST/GraphQL.
ALTER TABLE uk49s_scrape_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE uk49s_model_configs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE uk49s_optimizer_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE uk49s_draws            ENABLE ROW LEVEL SECURITY;
ALTER TABLE uk49s_optimizer_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE uk49s_backtest_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE uk49s_predictions      ENABLE ROW LEVEL SECURITY;