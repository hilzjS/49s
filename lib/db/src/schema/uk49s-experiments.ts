import { pgTable, pgEnum, text, integer, timestamp, boolean, real, serial, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { drawTypeEnum, uk49sModelConfigs } from "./uk49s";

// Experiment status
export const experimentStatusEnum = pgEnum("experiment_status", ["pending", "running", "completed", "failed"]);

// Model kind for experiment tracking
export const modelKindEnum = pgEnum("model_kind", [
  "superhybrid",
  "frequency",
  "recency",
  "pattern",
  "random",
  "ensemble",
  "superhybrid_ablated",
]);

/**
 * Experiment runs — top-level container for a batch of variant evaluations.
 * One run = one research question (e.g. "ablation over 2015-2026").
 */
export const uk49sExperimentRuns = pgTable("uk49s_experiment_runs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // "ablation" | "multi_period" | "ensemble" | "booster_model" | "custom"
  drawType: drawTypeEnum("draw_type").notNull(),
  status: experimentStatusEnum("status").notNull().default("pending"),
  // Chronological periods tested, e.g. [["2019-01-01","2019-12-31"],...]
  periods: jsonb("periods").$type<{ start: string; end: string }[]>().notNull(),
  lookbackWindow: integer("lookback_window").notNull().default(90),
  baseModelConfigId: integer("base_model_config_id").references(() => uk49sModelConfigs.id),
  randomSeed: integer("random_seed"),
  // Summary once completed
  variantsTested: integer("variants_tested").notNull().default(0),
  bestVariantId: integer("best_variant_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("uk49s_experiment_runs_type_idx").on(table.drawType),
  index("uk49s_experiment_runs_status_idx").on(table.status),
]);

/**
 * Experiment variants — one row per model variant per run.
 * e.g. "SuperHybrid", "SuperHybrid - Frequency", "Frequency-only", "Ensemble".
 */
export const uk49sExperimentVariants = pgTable("uk49s_experiment_variants", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").references(() => uk49sExperimentRuns.id).notNull(),
  name: text("name").notNull(), // e.g. "SuperHybrid - Gap"
  modelKind: modelKindEnum("model_kind").notNull(),
  // Which features were disabled (ablation) — empty for full model
  disabledFeatures: text("disabled_features").array().notNull().default([]),
  // Full weight vector used (for reproducibility)
  weights: jsonb("weights").$type<Record<string, number>>().notNull(),
  lookbackWindow: integer("lookback_window").notNull(),
  // Ensemble membership (for ensemble variants)
  ensembleMembers: text("ensemble_members").array(),
  // Aggregated metrics across all periods
  totalPredictions: integer("total_predictions").notNull().default(0),
  avgMainHits: real("avg_main_hits"),
  fourHitRate: real("four_hit_rate"),
  boosterHitRate: real("booster_hit_rate"),
  medianMainHits: real("median_main_hits"),
  maxMainHits: integer("max_main_hits"),
  // Stability: std-dev of avgHits across periods (lower = more stable)
  avgHitsVolatility: real("avg_hits_volatility"),
  fourHitRateVolatility: real("four_hit_rate_volatility"),
  boosterHitRateVolatility: real("booster_hit_rate_volatility"),
  // Significance vs random baseline (t-statistic on per-prediction hits)
  tStatVsRandom: real("t_stat_vs_random"),
  pValueVsRandom: real("p_value_vs_random"),
  // Rank within the run (1 = best avgMainHits)
  rank: integer("rank"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("uk49s_experiment_variants_run_idx").on(table.runId),
  uniqueIndex("uk49s_experiment_variants_run_name_idx").on(table.runId, table.name),
]);

/**
 * Per-period results — each variant evaluated on each chronological period.
 */
export const uk49sExperimentPeriods = pgTable("uk49s_experiment_periods", {
  id: serial("id").primaryKey(),
  variantId: integer("variant_id").references(() => uk49sExperimentVariants.id).notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  predictions: integer("predictions").notNull().default(0),
  avgMainHits: real("avg_main_hits"),
  fourHitRate: real("four_hit_rate"),
  boosterHitRate: real("booster_hit_rate"),
  // Baseline metrics on the same period (for paired comparison)
  randomAvgMainHits: real("random_avg_main_hits"),
  randomFourHitRate: real("random_four_hit_rate"),
  freqAvgMainHits: real("freq_avg_main_hits"),
  freqFourHitRate: real("freq_four_hit_rate"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("uk49s_experiment_periods_variant_idx").on(table.variantId),
  uniqueIndex("uk49s_experiment_periods_variant_period_idx").on(table.variantId, table.periodStart),
]);

/**
 * Booster ball experiment results — booster treated as its own prediction problem.
 */
export const uk49sBoosterExperiments = pgTable("uk49s_booster_experiments", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").references(() => uk49sExperimentRuns.id).notNull(),
  name: text("name").notNull(), // e.g. "booster-frequency", "booster-recency", "random"
  drawType: drawTypeEnum("draw_type").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  lookbackWindow: integer("lookback_window").notNull(),
  predictions: integer("predictions").notNull().default(0),
  hits: integer("hits").notNull().default(0),
  hitRate: real("hit_rate"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("uk49s_booster_experiments_run_idx").on(table.runId),
]);

export const insertUk49sExperimentRunSchema = createInsertSchema(uk49sExperimentRuns).omit({ id: true });
export const insertUk49sExperimentVariantSchema = createInsertSchema(uk49sExperimentVariants).omit({ id: true });
export const insertUk49sExperimentPeriodSchema = createInsertSchema(uk49sExperimentPeriods).omit({ id: true });
export const insertUk49sBoosterExperimentSchema = createInsertSchema(uk49sBoosterExperiments).omit({ id: true });

export type InsertUk49sExperimentRun = z.infer<typeof insertUk49sExperimentRunSchema>;
export type Uk49sExperimentRun = typeof uk49sExperimentRuns.$inferSelect;
export type InsertUk49sExperimentVariant = z.infer<typeof insertUk49sExperimentVariantSchema>;
export type Uk49sExperimentVariant = typeof uk49sExperimentVariants.$inferSelect;
export type InsertUk49sExperimentPeriod = z.infer<typeof insertUk49sExperimentPeriodSchema>;
export type Uk49sExperimentPeriod = typeof uk49sExperimentPeriods.$inferSelect;
export type InsertUk49sBoosterExperiment = z.infer<typeof insertUk49sBoosterExperimentSchema>;
export type Uk49sBoosterExperiment = typeof uk49sBoosterExperiments.$inferSelect;
