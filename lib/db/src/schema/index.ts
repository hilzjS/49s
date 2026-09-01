import { pgTable, text, timestamp, integer, boolean, pgEnum, uuid, varchar, numeric, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const drawTypeEnum = pgEnum("draw_type", ["lunchtime", "teatime"]);

export const uk49s_draws = pgTable("uk49s_draws", {
  id: uuid("id").defaultRandom().primaryKey(),
  draw_date: text("draw_date").notNull(), // YYYY-MM-DD
  draw_type: drawTypeEnum("draw_type").notNull(),
  winning_numbers: text("winning_numbers").notNull(), // CSV of 5 numbers
  booster_ball: integer("booster_ball").notNull(),
  source_url: text("source_url"),
  scrape_timestamp: timestamp("scrape_timestamp").defaultNow(),
  validation_status: varchar("validation_status", { length: 20 }).default("valid"), // valid, invalid, duplicate
  source_metadata: text("source_metadata"), // JSON string for any extra metadata
}, (table) => [
  unique("uk49s_draws_draw_date_draw_type_idx").on(table.draw_date, table.draw_type),
]);

export const uk49s_scrape_runs = pgTable("uk49s_scrape_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  draw_type: drawTypeEnum("draw_type"),
  year: integer("year").notNull(),
  started_at: timestamp("started_at").defaultNow(),
  finished_at: timestamp("finished_at"),
  success: boolean("success"),
  records_requested: integer("records_requested"),
  records_discovered: integer("records_discovered"),
  records_accepted: integer("records_accepted"),
  duplicates_removed: integer("duplicates_removed"),
  records_rejected: integer("records_rejected"),
  parsing_errors: integer("parsing_errors"),
  failed_urls: text("failed_urls"), // CSV
  validation_errors: text("validation_errors"), // CSV
  from_cache: boolean("from_cache").default(false),
});

export const uk49s_model_configs = pgTable("uk49s_model_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  draw_type: drawTypeEnum("draw_type").notNull(),
  name: varchar("name", { length: 50 }).notNull(),
  description: text("description"),
  is_active: boolean("is_active").default(false),
  feature_weights: text("feature_weights").notNull(), // JSON string of weights
  lookback_window: integer("lookback_window").notNull(),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

export const uk49s_optimizer_configs = pgTable("uk49s_optimizer_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  description: text("description"),
  optimizer_type: varchar("optimizer_type", { length: 30 }).notNull(), // e.g., "random_search", "hill_climbing"
  parameters: text("parameters").notNull(), // JSON string
  created_at: timestamp("created_at").defaultNow(),
});

export const uk49s_optimizer_runs = pgTable("uk49s_optimizer_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  optimizer_config_id: uuid("optimizer_config_id").references(() => uk49s_optimizer_configs.id),
  draw_type: drawTypeEnum("draw_type").notNull(),
  started_at: timestamp("started_at").defaultNow(),
  finished_at: timestamp("finished_at"),
  success: boolean("success"),
  total_configs_tested: integer("total_configs_tested"),
  best_config_id: uuid("best_config_id").references(() => uk49s_model_configs.id),
  best_validation_metric: numeric("best_validation_metric"),
  validation_period_start: text("validation_period_start"), // YYYY-MM-DD
  validation_period_end: text("validation_period_end"), // YYYY-MM-DD
  random_seed: integer("random_seed"),
});

export const uk49s_backtest_runs = pgTable("uk49s_backtest_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  model_config_id: uuid("model_config_id").references(() => uk49s_model_configs.id),
  draw_type: drawTypeEnum("draw_type").notNull(),
  started_at: timestamp("started_at").defaultNow(),
  finished_at: timestamp("finished_at"),
  success: boolean("success"),
  total_predictions: integer("total_predictions"),
  avg_main_hits: numeric("avg_main_hits"),
  median_main_hits: numeric("median_main_hits"),
  max_main_hits: integer("max_main_hits"),
  four_hit_count: integer("four_hit_count"),
  four_hit_rate: numeric("four_hit_rate"),
  booster_hit_rate: numeric("booster_hit_rate"),
  validation_period_start: text("validation_period_start"), // YYYY-MM-DD
  validation_period_end: text("validation_period_end"), // YYYY-MM-DD
  random_seed: integer("random_seed"),
});

export const uk49s_predictions = pgTable("uk49s_predictions", {
  id: uuid("id").defaultRandom().primaryKey(),
  prediction_date: text("prediction_date").notNull(), // The date for which the prediction is made (YYYY-MM-DD)
  draw_type: drawTypeEnum("draw_type").notNull(),
  model_config_id: uuid("model_config_id").references(() => uk49s_model_configs.id),
  predicted_main_numbers: text("predicted_main_numbers").notNull(), // CSV of 4 numbers
  predicted_booster_ball: integer("predicted_booster_ball").notNull(),
  actual_main_numbers: text("actual_main_numbers"), // CSV of 5 numbers (filled after draw)
  actual_booster_ball: integer("actual_booster_ball"), // Filled after draw
  main_number_hits: integer("main_number_hits"), // 0-4
  booster_hit: boolean("booster_hit"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// Insert schemas
export const insertUk49sDrawsSchema = createInsertSchema(uk49s_draws);
export const insertUk49sScrapeRunsSchema = createInsertSchema(uk49s_scrape_runs);
export const insertUk49sModelConfigsSchema = createInsertSchema(uk49s_model_configs);
export const insertUk49sOptimizerConfigsSchema = createInsertSchema(uk49s_optimizer_configs);
export const insertUk49sOptimizerRunsSchema = createInsertSchema(uk49s_optimizer_runs);
export const insertUk49sBacktestRunsSchema = createInsertSchema(uk49s_backtest_runs);
export const insertUk49sPredictionsSchema = createInsertSchema(uk49s_predictions);

// Types
export type Uk49sDraws = typeof uk49s_draws.$inferSelect;
export type Uk49sScrapeRuns = typeof uk49s_scrape_runs.$inferSelect;
export type Uk49sModelConfigs = typeof uk49s_model_configs.$inferSelect;
export type Uk49sOptimizerConfigs = typeof uk49s_optimizer_configs.$inferSelect;
export type Uk49sOptimizerRuns = typeof uk49s_optimizer_runs.$inferSelect;
export type Uk49sBacktestRuns = typeof uk49s_backtest_runs.$inferSelect;
export type Uk49sPredictions = typeof uk49s_predictions.$inferSelect;

export type InsertUk49sDraws = z.infer<typeof insertUk49sDrawsSchema>;
export type InsertUk49sScrapeRuns = z.infer<typeof insertUk49sScrapeRunsSchema>;
export type InsertUk49sModelConfigs = z.infer<typeof insertUk49sModelConfigsSchema>;
export type InsertUk49sOptimizerConfigs = z.infer<typeof insertUk49sOptimizerConfigsSchema>;
export type InsertUk49sOptimizerRuns = z.infer<typeof insertUk49sOptimizerRunsSchema>;
export type InsertUk49sBacktestRuns = z.infer<typeof insertUk49sBacktestRunsSchema>;
export type InsertUk49sPredictions = z.infer<typeof insertUk49sPredictionsSchema>;

export {}