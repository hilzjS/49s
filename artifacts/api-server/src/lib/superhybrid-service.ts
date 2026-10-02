/**
 * SuperHybrid service — the DB-backed configuration and live flip-flop
 * prediction for the SuperHybrid strategy.
 *
 * IMPORTANT: SuperHybrid is a *separate, selectable* strategy. Its config is
 * stored as its own `uk49s_model_configs` row (strategy = "superhybrid") with
 * status "archived", so it is NEVER picked up as the active model by
 * `getActiveModel` / `getChampionWeights` (they filter status = "active"). The
 * existing model (including vv1790135925577) is left completely untouched.
 *
 * SuperHybrid weights are configured but never auto-optimised here.
 *
 * The live call follows the flip-flop cycle exactly:
 *   latest actual draw → opposite session → next valid date → prediction.
 * The requested target never drives source selection, and because the engine is
 * a pure function of (source, history, weights) the call is idempotent: running
 * it repeatedly without a new draw returns the identical prediction and cannot
 * create a duplicate.
 */

import { db } from "@workspace/db";
import {
  uk49sDraws,
  uk49sModelConfigs,
  DEFAULT_SUPERHYBRID_WEIGHTS,
  SUPERHYBRID_STRATEGY,
  SUPERHYBRID_VERSION,
  SUPERHYBRID_WEIGHT_ORDER,
  buildSuperHybridPrediction,
  drawTimeFor,
  flipFlopTargetOf,
  latestCompletedDraw,
  oppositeSession,
  sortChronological,
  toSessionDraws,
  type DrawType,
  type SuperHybridPrediction,
  type SuperHybridWeights,
} from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "./logger";

export interface SuperHybridConfig {
  /** null until the config row exists (defaults are still applied). */
  id: number | null;
  drawType: DrawType;
  strategy: typeof SUPERHYBRID_STRATEGY;
  version: string;
  weights: SuperHybridWeights;
  lookback: number;
  createdAt: Date | null;
}

export interface SuperHybridLivePrediction {
  /** The flip-flop target session — the opposite of the latest draw's session. */
  drawType: DrawType;
  targetDate: string;
  source: SuperHybridPrediction["source"];
  numbers: number[];
  bonus_numbers: number[];
  confidence: number;
  contributions: SuperHybridWeights;
  version: string;
  modelConfigId: number | null;
  /** Ready-made admin caption, e.g. "Predicting TEA — Source: LUNCH 2026-10-01". */
  sourceLabel: string;
  /** The complete flip-flop step, for transparency on the client. */
  cycle: { sourceSession: DrawType; sourceDate: string; targetSession: DrawType; targetDate: string };
  /** `${targetDate}|${targetSession}` — the natural dedupe key for this step. */
  cycleKey: string;
}

const SESSION_LABEL: Record<DrawType, string> = { lunchtime: "LUNCH", teatime: "TEA" };

// Existing model-config columns carrying the eight SuperHybrid weights (the
// strategy reuses the current infrastructure rather than a new table).
function weightsToColumns(weights: SuperHybridWeights) {
  return {
    weightFrequency: weights.existingModel,
    weightRecency: weights.crossSession,
    weightHotCold: weights.frequency,
    weightGapAnalysis: weights.recency,
    weightPairs: weights.gap,
    weightTriples: weights.pair,
    weightConsecutive: weights.flipFlop,
    weightOddEven: weights.pattern,
  };
}

function parseWeights(description: string | null): SuperHybridWeights {
  if (!description) return DEFAULT_SUPERHYBRID_WEIGHTS;
  try {
    const parsed = JSON.parse(description) as { weights?: Partial<SuperHybridWeights> };
    const weights = { ...DEFAULT_SUPERHYBRID_WEIGHTS };
    for (const key of SUPERHYBRID_WEIGHT_ORDER) {
      const value = parsed.weights?.[key];
      if (typeof value === "number" && Number.isFinite(value)) weights[key] = value;
    }
    return weights;
  } catch {
    return DEFAULT_SUPERHYBRID_WEIGHTS;
  }
}

async function readRow(drawType: DrawType) {
  const rows = await db
    .select()
    .from(uk49sModelConfigs)
    .where(and(eq(uk49sModelConfigs.drawType, drawType), eq(uk49sModelConfigs.strategy, SUPERHYBRID_STRATEGY)))
    .orderBy(desc(uk49sModelConfigs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Returns the SuperHybrid config for a session, creating its own (archived)
 * model-config record on first use. Never touches the active model.
 */
export async function getSuperHybridConfig(drawType: DrawType): Promise<SuperHybridConfig> {
  let row = await readRow(drawType);

  if (!row) {
    try {
      const [created] = await db
        .insert(uk49sModelConfigs)
        .values({
          drawType,
          version: SUPERHYBRID_VERSION,
          // Archived so it can never become the live/active model.
          status: "archived",
          strategy: SUPERHYBRID_STRATEGY,
          poolSize: 4,
          ...weightsToColumns(DEFAULT_SUPERHYBRID_WEIGHTS),
          lookbackWindow: 90,
          enforceDiversity: true,
          description: JSON.stringify({
            engine: SUPERHYBRID_STRATEGY,
            version: SUPERHYBRID_VERSION,
            weights: DEFAULT_SUPERHYBRID_WEIGHTS,
            note: "Flip-flop strategy (latest draw → opposite session). Weights are configured, not auto-optimised.",
          }),
        })
        .returning();
      row = created;
      logger.info({ drawType, modelConfigId: created.id }, "Created SuperHybrid model config");
    } catch (error) {
      // A concurrent request may have inserted it first; re-read rather than fail.
      logger.warn({ error, drawType }, "SuperHybrid config insert raced; re-reading");
      row = await readRow(drawType);
    }
  }

  return {
    id: row?.id ?? null,
    drawType,
    strategy: SUPERHYBRID_STRATEGY,
    version: row?.version ?? SUPERHYBRID_VERSION,
    weights: parseWeights(row?.description ?? null),
    lookback: row?.lookbackWindow ?? 90,
    createdAt: row?.createdAt ?? null,
  };
}

/**
 * The single live flip-flop prediction. The chronologically latest actual draw
 * is resolved from the database first; its session determines the opposite
 * target session and the next valid target date. The requested target is never
 * used to pick the source.
 */
export async function getSuperHybridNextPrediction(): Promise<
  { ok: true; prediction: SuperHybridLivePrediction } | { ok: false; error: string }
> {
  const draws = await db.select().from(uk49sDraws);
  if (draws.length === 0) return { ok: false, error: "No draws are recorded yet." };

  const allAsc = sortChronological(toSessionDraws(draws));
  const source = latestCompletedDraw(allAsc);
  if (!source) return { ok: false, error: "No draws are recorded yet." };

  // Latest draw → opposite target session → next valid date for that session.
  const { targetType, targetDate } = flipFlopTargetOf(source);
  const targetKey = `${targetDate}T${drawTimeFor(targetType)}`;
  // Only draws strictly before the target are eligible, exactly like the backtest.
  const before = allAsc.filter((draw) => `${draw.draw_date}T${draw.draw_time}` < targetKey);

  const config = await getSuperHybridConfig(targetType);
  const prediction = buildSuperHybridPrediction({
    before,
    targetType,
    targetDate,
    weights: config.weights,
  });

  if (!prediction) {
    const hasSourceHistory = before.some((draw) => draw.drawType === oppositeSession(targetType));
    return {
      ok: false,
      error: hasSourceHistory
        ? `Not enough history to build a ${SESSION_LABEL[targetType]} prediction (need at least 20 prior draws).`
        : `No previous ${SESSION_LABEL[oppositeSession(targetType)]} history available for ${SESSION_LABEL[targetType]} prediction.`,
    };
  }

  return {
    ok: true,
    prediction: {
      drawType: targetType,
      targetDate,
      source: prediction.source,
      numbers: prediction.numbers,
      bonus_numbers: prediction.bonus_numbers,
      confidence: prediction.confidence,
      contributions: prediction.contributions,
      version: config.version,
      modelConfigId: config.id,
      sourceLabel: `Predicting ${SESSION_LABEL[targetType]} — Source: ${SESSION_LABEL[prediction.source.drawType]} ${prediction.source.draw_date}`,
      cycle: {
        sourceSession: source.drawType,
        sourceDate: source.draw_date,
        targetSession: targetType,
        targetDate,
      },
      cycleKey: `${targetDate}|${targetType}`,
    },
  };
}
