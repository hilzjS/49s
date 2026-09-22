import { pgTable, text, integer, timestamp, boolean, real, serial, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Draw type enum
export const drawTypeEnum = pgEnum("draw_type", ["lunchtime", "teatime"]);

// Validation status enum
export const validationStatusEnum = pgEnum("validation_status", ["valid", "invalid", "pending"]);

// Model status enum
export const modelStatusEnum = pgEnum("model_status", ["active", "archived", "training"]);

// Optimizer status enum
export const optimizerStatusEnum = pgEnum("optimizer_status", ["pending", "queued", "running", "completed", "failed", "cancelled"]);

// Backtest status enum
export const backtestStatusEnum = pgEnum("backtest_status", ["pending", "running", "completed", "failed"]);

// Prediction status enum
export const predictionStatusEnum = pgEnum("prediction_status", ["pending", "matched", "expired"]);

// UK49s Draws Table - stores raw validated draw data
export const uk49sDraws = pgTable("uk49s_draws", {
  id: serial("id").primaryKey(),
  drawDate: text("draw_date").notNull(),
  drawType: drawTypeEnum("draw_type").notNull(),
  mainNumber1: integer("main_number_1").notNull(),
  mainNumber2: integer("main_number_2").notNull(),
  mainNumber3: integer("main_number_3").notNull(),
  mainNumber4: integer("main_number_4").notNull(),
  mainNumber5: integer("main_number_5").notNull(),
  mainNumber6: integer("main_number_6").notNull(),
  boosterBall: integer("booster_ball").notNull(),
  sourceUrl: text("source_url"),
  validationStatus: validationStatusEnum("validation_status").notNull().default("pending"),
  scrapeRunId: integer("scrape_run_id").references(() => uk49sScrapeRuns.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // Unique constraint: one record per date + draw type
  uniqueIndex("uk49s_draws_date_type_idx").on(table.drawDate, table.drawType),
  // Index for chronological queries
  index("uk49s_draws_date_idx").on(table.drawDate),
  // Index for draw type filtering
  index("uk49s_draws_type_idx").on(table.drawType),
  // Composite index for model training queries
  index("uk49s_draws_type_date_idx").on(table.drawType, table.drawDate),
]);

// Scrape Runs Table - tracks each scraping operation
export const uk49sScrapeRuns = pgTable("uk49s_scrape_runs", {
  id: serial("id").primaryKey(),
  drawType: drawTypeEnum("draw_type").notNull(),
  year: integer("year").notNull(),
  sourceUrl: text("source_url"),
  urlsRequested: integer("urls_requested").notNull().default(0),
  recordsDiscovered: integer("records_discovered").notNull().default(0),
  recordsAccepted: integer("records_accepted").notNull().default(0),
  duplicatesRemoved: integer("duplicates_removed").notNull().default(0),
  recordsRejected: integer("records_rejected").notNull().default(0),
  parsingErrors: integer("parsing_errors").notNull().default(0),
  failedUrls: text("failed_urls").array(),
  validationErrors: text("validation_errors").array(),
  success: boolean("success").notNull().default(false),
  fromCache: boolean("from_cache").notNull().default(false),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("uk49s_scrape_runs_type_year_idx").on(table.drawType, table.year),
]);

// Model Configurations Table - stores feature weights and parameters
export const uk49sModelConfigs = pgTable("uk49s_model_configs", {
  id: serial("id").primaryKey(),
  drawType: drawTypeEnum("draw_type").notNull(),
  version: text("version").notNull(),
  status: modelStatusEnum("status").notNull().default("training"),
  // Feature weights (SuperHybrid components)
  weightFrequency: real("weight_frequency").notNull().default(1.0),
  weightRecency: real("weight_recency").notNull().default(1.0),
  weightHotCold: real("weight_hot_cold").notNull().default(1.0),
  weightGapAnalysis: real("weight_gap_analysis").notNull().default(1.0),
  weightPairs: real("weight_pairs").notNull().default(1.0),
  weightTriples: real("weight_triples").notNull().default(1.0),
  weightConsecutive: real("weight_consecutive").notNull().default(1.0),
  weightOddEven: real("weight_odd_even").notNull().default(1.0),
  weightLowHigh: real("weight_low_high").notNull().default(1.0),
  weightSumRange: real("weight_sum_range").notNull().default(1.0),
  weightPositional: real("weight_positional").notNull().default(1.0),
  weightRepeat: real("weight_repeat").notNull().default(1.0),
  weightFirst3Minus2: real("weight_first3_minus2").notNull().default(1.0),
  // Lookback window for training
  lookbackWindow: integer("lookback_window").notNull().default(90),
  // Diversity/balance constraints
  enforceDiversity: boolean("enforce_diversity").notNull().default(true),
  minNumberSpread: integer("min_number_spread").notNull().default(10),
  maxSameGroup: integer("max_same_group").notNull().default(2),
  // Training cutoff date (last draw used for training)
  trainingCutoff: text("training_cutoff"),
  // Validation metrics
  validation4HitRate: real("validation_4hit_rate"),
  validationAvgHits: real("validation_avg_hits"),
  validationSampleSize: integer("validation_sample_size"),
  // Random seed for reproducibility
  randomSeed: integer("random_seed"),
  // Metadata
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uk49s_model_configs_type_version_idx").on(table.drawType, table.version),
  index("uk49s_model_configs_type_status_idx").on(table.drawType, table.status),
]);

// Optimizer Configurations Table - stores tested configurations during optimization
export const uk49sOptimizerConfigs = pgTable("uk49s_optimizer_configs", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").references(() => uk49sOptimizerRuns.id).notNull(),
  drawType: drawTypeEnum("draw_type").notNull(),
  // Configuration parameters tested
  weightFrequency: real("weight_frequency").notNull(),
  weightRecency: real("weight_recency").notNull(),
  weightHotCold: real("weight_hot_cold").notNull(),
  weightGapAnalysis: real("weight_gap_analysis").notNull(),
  weightPairs: real("weight_pairs").notNull(),
  weightTriples: real("weight_triples").notNull(),
  weightConsecutive: real("weight_consecutive").notNull(),
  weightOddEven: real("weight_odd_even").notNull(),
  weightLowHigh: real("weight_low_high").notNull(),
  weightSumRange: real("weight_sum_range").notNull(),
  weightPositional: real("weight_positional").notNull(),
  weightRepeat: real("weight_repeat").notNull(),
  weightFirst3Minus2: real("weight_first3_minus2").notNull(),
  lookbackWindow: integer("lookback_window").notNull(),
  enforceDiversity: boolean("enforce_diversity").notNull(),
  minNumberSpread: integer("min_number_spread").notNull(),
  maxSameGroup: integer("max_same_group").notNull(),
  // Performance metrics on validation set
  validation4HitRate: real("validation_4hit_rate"),
  validationAvgHits: real("validation_avg_hits"),
  validationSampleSize: integer("validation_sample_size"),
  validationBoosterHitRate: real("validation_booster_hit_rate"),
  // Best single-prediction hit count on the validation window
  maxMainHits: integer("max_main_hits"),
  // 4-hit evidence: a historical validation prediction that matched exactly 4
  fourHitFound: boolean("four_hit_found").notNull().default(false),
  fourHitCount: integer("four_hit_count").notNull().default(0),
  fourHitDrawDate: text("four_hit_draw_date"),
  fourHitPredictedMain: text("four_hit_predicted_main"),
  fourHitActualMain: text("four_hit_actual_main"),
  fourHitHits: integer("four_hit_hits"),
  // Stability metrics across multiple periods
  stabilityScore: real("stability_score"),
  // Random seed
  randomSeed: integer("random_seed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("uk49s_optimizer_configs_run_idx").on(table.runId),
  index("uk49s_optimizer_configs_type_idx").on(table.drawType),
]);

// Optimizer Runs Table - tracks optimization sessions
export const uk49sOptimizerRuns = pgTable("uk49s_optimizer_runs", {
  id: serial("id").primaryKey(),
  drawType: drawTypeEnum("draw_type").notNull(),
  status: optimizerStatusEnum("status").notNull().default("pending"),
  // Search parameters
  maxIterations: integer("max_iterations").notNull().default(1000),
  populationSize: integer("population_size").notNull().default(100),
  eliteSize: integer("elite_size").notNull().default(10),
  mutationRate: real("mutation_rate").notNull().default(0.1),
  // Validation strategy
  trainStartDate: text("train_start_date"),
  trainEndDate: text("train_end_date"),
  validationStartDate: text("validation_start_date"),
  validationEndDate: text("validation_end_date"),
  testStartDate: text("test_start_date"),
  testEndDate: text("test_end_date"),
  // Results
  configsTested: integer("configs_tested").notNull().default(0),
  configsFailed: integer("configs_failed").notNull().default(0),
  totalConfigs: integer("total_configs"),
  validationDrawCount: integer("validation_draw_count"),
  currentIteration: integer("current_iteration").notNull().default(0),
  autoWindow: boolean("auto_window").notNull().default(false),
  errorMessage: text("error_message"),
  // Search goal / stop conditions
  maxConfigurations: integer("max_configurations"),
  stopOnFourHit: boolean("stop_on_four_hit").notNull().default(false),
  stoppedReason: text("stopped_reason"),
  maxHits: integer("max_hits"),
  // 4-hit target evidence (a real historical validation prediction vs actual draw)
  fourHitFound: boolean("four_hit_found").notNull().default(false),
  fourHitCount: integer("four_hit_count").notNull().default(0),
  fourHitConfigId: integer("four_hit_config_id"),
  fourHitDrawDate: text("four_hit_draw_date"),
  fourHitPredictedMain: text("four_hit_predicted_main"),
  fourHitActualMain: text("four_hit_actual_main"),
  fourHitHits: integer("four_hit_hits"),
  bestConfigId: integer("best_config_id"),
  best4HitRate: real("best_4hit_rate"),
  bestAvgHits: real("best_avg_hits"),
  // Timestamps
  startedAt: timestamp("started_at").defaultNow().notNull(),
  heartbeatAt: timestamp("heartbeat_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("uk49s_optimizer_runs_type_status_idx").on(table.drawType, table.status),
]);

// Backtest Runs Table - tracks walk-forward validation
export const uk49sBacktestRuns = pgTable("uk49s_backtest_runs", {
  id: serial("id").primaryKey(),
  drawType: drawTypeEnum("draw_type").notNull(),
  status: backtestStatusEnum("status").notNull().default("pending"),
  modelConfigId: integer("model_config_id").references(() => uk49sModelConfigs.id),
  // Backtest parameters
  lookbackWindow: integer("lookback_window").notNull(),
  testStartDate: text("test_start_date").notNull(),
  testEndDate: text("test_end_date").notNull(),
  // Baseline comparison flags
  includeRandomBaseline: boolean("include_random_baseline").notNull().default(true),
  includeFrequencyBaseline: boolean("include_frequency_baseline").notNull().default(true),
  // Results - SuperHybrid model
  totalPredictions: integer("total_predictions").notNull().default(0),
  hit0Count: integer("hit_0_count").notNull().default(0),
  hit1Count: integer("hit_1_count").notNull().default(0),
  hit2Count: integer("hit_2_count").notNull().default(0),
  hit3Count: integer("hit_3_count").notNull().default(0),
  hit4Count: integer("hit_4_count").notNull().default(0),
  avgMainHits: real("avg_main_hits"),
  medianMainHits: real("median_main_hits"),
  maxMainHits: integer("max_main_hits"),
  fourHitRate: real("four_hit_rate"),
  boosterHitRate: real("booster_hit_rate"),
  // Random baseline results
  randomTotalPredictions: integer("random_total_predictions"),
  randomAvgMainHits: real("random_avg_main_hits"),
  randomFourHitRate: real("random_four_hit_rate"),
  randomBoosterHitRate: real("random_booster_hit_rate"),
  // Frequency baseline results
  freqTotalPredictions: integer("freq_total_predictions"),
  freqAvgMainHits: real("freq_avg_main_hits"),
  freqFourHitRate: real("freq_four_hit_rate"),
  freqBoosterHitRate: real("freq_booster_hit_rate"),
  // Random seed for reproducibility
  randomSeed: integer("random_seed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("uk49s_backtest_runs_type_idx").on(table.drawType),
  index("uk49s_backtest_runs_config_idx").on(table.modelConfigId),
]);

// Predictions Table - stores generated predictions
export const uk49sPredictions = pgTable("uk49s_predictions", {
  id: serial("id").primaryKey(),
  drawType: drawTypeEnum("draw_type").notNull(),
  predictionDate: text("prediction_date").notNull(), // Date the prediction is for
  // Predicted numbers - EXACTLY 4 main + 1 booster
  predictedMain1: integer("predicted_main_1").notNull(),
  predictedMain2: integer("predicted_main_2").notNull(),
  predictedMain3: integer("predicted_main_3").notNull(),
  predictedMain4: integer("predicted_main_4").notNull(),
  predictedBooster: integer("predicted_booster").notNull(),
  // Model configuration used
  modelConfigId: integer("model_config_id").references(() => uk49sModelConfigs.id),
  // Training cutoff date
  trainingCutoff: text("training_cutoff").notNull(),
  // Component scores for transparency
  componentScores: text("component_scores"), // JSON string
  overallScore: real("overall_score"),
  // Matched result (if available)
  matchedDrawId: integer("matched_draw_id").references(() => uk49sDraws.id),
  actualMain1: integer("actual_main_1"),
  actualMain2: integer("actual_main_2"),
  actualMain3: integer("actual_main_3"),
  actualMain4: integer("actual_main_4"),
  actualMain5: integer("actual_main_5"),
  actualMain6: integer("actual_main_6"),
  actualBooster: integer("actual_booster"),
  // Result metrics
  mainHits: integer("main_hits"),
  boosterHit: boolean("booster_hit").default(false),
  status: predictionStatusEnum("status").notNull().default("pending"),
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // Unique constraint: one prediction per date + draw type
  uniqueIndex("uk49s_predictions_date_type_idx").on(table.predictionDate, table.drawType),
  index("uk49s_predictions_type_status_idx").on(table.drawType, table.status),
  index("uk49s_predictions_type_date_idx").on(table.drawType, table.predictionDate),
]);

// Insert schemas for validation
export const insertUk49sDrawSchema = createInsertSchema(uk49sDraws).omit({ id: true });
export const insertUk49sScrapeRunSchema = createInsertSchema(uk49sScrapeRuns).omit({ id: true });
export const insertUk49sModelConfigSchema = createInsertSchema(uk49sModelConfigs).omit({ id: true });
export const insertUk49sOptimizerConfigSchema = createInsertSchema(uk49sOptimizerConfigs).omit({ id: true });
export const insertUk49sOptimizerRunSchema = createInsertSchema(uk49sOptimizerRuns).omit({ id: true });
export const insertUk49sBacktestRunSchema = createInsertSchema(uk49sBacktestRuns).omit({ id: true });
export const insertUk49sPredictionSchema = createInsertSchema(uk49sPredictions).omit({ id: true });

// Type exports
export type InsertUk49sDraw = z.infer<typeof insertUk49sDrawSchema>;
export type Uk49sDraw = typeof uk49sDraws.$inferSelect;
export type InsertUk49sScrapeRun = z.infer<typeof insertUk49sScrapeRunSchema>;
export type Uk49sScrapeRun = typeof uk49sScrapeRuns.$inferSelect;
export type InsertUk49sModelConfig = z.infer<typeof insertUk49sModelConfigSchema>;
export type Uk49sModelConfig = typeof uk49sModelConfigs.$inferSelect;
export type InsertUk49sOptimizerConfig = z.infer<typeof insertUk49sOptimizerConfigSchema>;
export type Uk49sOptimizerConfig = typeof uk49sOptimizerConfigs.$inferSelect;
export type InsertUk49sOptimizerRun = z.infer<typeof insertUk49sOptimizerRunSchema>;
export type Uk49sOptimizerRun = typeof uk49sOptimizerRuns.$inferSelect;
export type InsertUk49sBacktestRun = z.infer<typeof insertUk49sBacktestRunSchema>;
export type Uk49sBacktestRun = typeof uk49sBacktestRuns.$inferSelect;
export type InsertUk49sPrediction = z.infer<typeof insertUk49sPredictionSchema>;
export type Uk49sPrediction = typeof uk49sPredictions.$inferSelect;

// Draw type helper
export type DrawType = "lunchtime" | "teatime";

// Helper to convert draw to array format
export function drawToNumbers(draw: Uk49sDraw): { main: number[]; booster: number } {
  return {
    main: [draw.mainNumber1, draw.mainNumber2, draw.mainNumber3, draw.mainNumber4, draw.mainNumber5, draw.mainNumber6],
    booster: draw.boosterBall,
  };
}

// Helper to create draw from raw scrape result
export function createDrawFromScrape(
  drawDate: string,
  drawType: DrawType,
  winningNumbers: number[],
  boosterBall: number,
  sourceUrl: string,
  scrapeRunId?: number
): InsertUk49sDraw {
  if (winningNumbers.length !== 6) {
    throw new Error(`Expected 6 winning numbers, got ${winningNumbers.length}`);
  }
  if (boosterBall < 1 || boosterBall > 49) {
    throw new Error(`Booster ball must be 1-49, got ${boosterBall}`);
  }
  if (winningNumbers.some(n => n < 1 || n > 49)) {
    throw new Error(`All numbers must be 1-49`);
  }
  
  return {
    drawDate,
    drawType,
    mainNumber1: winningNumbers[0],
    mainNumber2: winningNumbers[1],
    mainNumber3: winningNumbers[2],
    mainNumber4: winningNumbers[3],
    mainNumber5: winningNumbers[4],
    mainNumber6: winningNumbers[5],
    boosterBall,
    sourceUrl,
    validationStatus: "valid",
    scrapeRunId,
  };
}
