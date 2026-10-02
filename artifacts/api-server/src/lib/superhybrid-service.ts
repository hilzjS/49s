/**
 * SuperHybrid service — the DB-backed configuration and live cross-session
 * prediction for the SuperHybrid strategy.
 *
 * IMPORTANT: SuperHybrid is a *separate, selectable* strategy. Its config is
 * stored as its own `uk49s_model_configs` row (strategy = "superhybrid") with
 * status "archived", so it is NEVER picked up as the active model by
 * `getActiveModel` / `getChampionWeights` (they filter status = "active"). The
 * existing model (including vv1790135925577) is left completely untouched.
 *
 * SuperHybrid weights are configured but never auto-optimised here.
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
  sortChronological,
  toSessionDraws,
  type SuperHybridPrediction,
  type SuperHybridWeights,
} from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "./logger";

export interface SuperHybridConfig {
  /** null until the config row exists (defaults are still applied). */
  id: number | null;
  drawType: "lunchtime" | "teatime";
  strategy: typeof SUPERHYBRID_STRATEGY;
  version: string;
  weights: SuperHybridWeights;
  lookback: number;
  createdAt: Date | null;
}

export interface SuperHybridLivePrediction {
  drawType: "lunchtime" | "teatime";
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
}

const SESSION_LABEL: Record<"lunchtime" | "teatime", string> = { lunchtime: "LUNCH", teatime: "TEA" };

/** Whole-day date arithmetic without timezone drift. */
function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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

async function readRow(drawType: "lunchtime" | "teatime") {
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
export async function getSuperHybridConfig(drawType: "lunchtime" | "teatime"): Promise<SuperHybridConfig> {
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
            note: "Cross-session strategy. Weights are configured, not auto-optimised.",
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
 * The live SuperHybrid prediction for a session: the target is the next undrawn
 * date for that session, and the source is the latest completed draw of the
 * opposite session (auto-detected from the database — never hardcoded).
 */
export async function getSuperHybridLivePrediction(
  drawType: "lunchtime" | "teatime",
): Promise<{ ok: true; prediction: SuperHybridLivePrediction } | { ok: false; error: string }> {
  const draws = await db.select().from(uk49sDraws);
  if (draws.length === 0) return { ok: false, error: "No draws are recorded yet." };

  const sessionDraws = toSessionDraws(draws);
  const allAsc = sortChronological(sessionDraws);

  const own = allAsc.filter((draw) => draw.drawType === drawType);
  if (own.length === 0) {
    return { ok: false, error: `No ${SESSION_LABEL[drawType]} draws are recorded yet.` };
  }

  const config = await getSuperHybridConfig(drawType);
  const targetDate = addDaysIso(own[own.length - 1].draw_date, 1);
  const drawTime = drawTimeFor(drawType);
  const targetKey = `${targetDate}T${drawTime}`;

  // Only draws strictly before the target are eligible as a source, exactly like
  // the backtest. This keeps the live call leakage-free even if the opposite
  // session's data is ahead of this session's (a missing/lagging draw).
  const before = allAsc.filter((draw) => `${draw.draw_date}T${draw.draw_time}` < targetKey);

  const prediction = buildSuperHybridPrediction({
    before,
    targetType: drawType,
    targetDate,
    weights: config.weights,
  });

  if (!prediction) {
    const opposite: "lunchtime" | "teatime" = drawType === "lunchtime" ? "teatime" : "lunchtime";
    const hasSource = before.some((draw) => draw.drawType === opposite);
    return {
      ok: false,
      error: hasSource
        ? `Not enough history to build a ${SESSION_LABEL[drawType]} prediction (need at least 20 prior draws).`
        : `No previous ${SESSION_LABEL[opposite]} draw available for ${SESSION_LABEL[drawType]} prediction.`,
    };
  }

  return {
    ok: true,
    prediction: {
      drawType,
      targetDate,
      source: prediction.source,
      numbers: prediction.numbers,
      bonus_numbers: prediction.bonus_numbers,
      confidence: prediction.confidence,
      contributions: prediction.contributions,
      version: config.version,
      modelConfigId: config.id,
      sourceLabel: `Predicting ${SESSION_LABEL[drawType]} — Source: ${SESSION_LABEL[prediction.source.drawType]} ${prediction.source.draw_date}`,
    },
  };
}
