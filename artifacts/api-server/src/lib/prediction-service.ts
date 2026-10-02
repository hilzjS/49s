/**
 * UK49s Prediction Service
 *
 * Generates, stores and matches predictions using the single app engine
 * (`base44-engine.ts`): a frequency + recency-gap scorer with a tuned
 * hot/overdue/half-life/power blend that produces a 4-number line + 1 booster.
 *
 * The tuned "champion" weights are stored on the active model row for each draw
 * type. Because the engine has only four weights, they are carried on the
 * existing `uk49s_model_configs` columns as follows (no schema change needed):
 *
 *   hot      → weight_frequency
 *   overdue  → weight_recency
 *   halfLife → weight_hot_cold
 *   power    → weight_gap_analysis
 *
 * The tuner statistics (3+ count, average hits, candidates tested, target met)
 * are kept as a small JSON blob in `description`.
 */

import { db } from "@workspace/db";
import {
  uk49sDraws,
  uk49sPredictions,
  uk49sModelConfigs,
  drawToNumbers,
  DEFAULT_WEIGHTS,
  MIN_TRAIN,
  buildPredictions,
  toEngineDraws,
  type Base44Weights,
  type DrawType,
  type BacktestReport,
} from "@workspace/db/schema";
import { eq, and, desc, asc, gte } from "drizzle-orm";
import { logger } from "./logger";

export interface ModelInfo {
  id: number | null;
  drawType: DrawType;
  version: string;
  weights: Base44Weights;
  /** Number of validation draws that matched 3+ numbers. */
  threePlusCount: number | null;
  /** Average main-number matches per line during tuning. */
  avgHitsPerLine: number | null;
  /** Candidate weight sets evaluated by the tuner. */
  candidatesTested: number | null;
  /** True once the champion reached the 4-draw target. */
  targetMet: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface PredictionInfo {
  id: number;
  drawType: DrawType;
  predictionDate: string;
  predictedMain: number[];
  predictedBooster: number;
  modelConfigId: number | null;
  trainingCutoff: string;
  status: string;
  mainHits: number | null;
  boosterHit: boolean | null;
  actualMain: number[] | null;
  actualBooster: number | null;
  createdAt: Date;
}

interface ChampionStats {
  threePlusCount: number | null;
  avgHitsPerLine: number | null;
  candidatesTested: number | null;
  targetMet: boolean;
}

function weightsFromRow(row: {
  weightFrequency: number;
  weightRecency: number;
  weightHotCold: number;
  weightGapAnalysis: number;
}): Base44Weights {
  return {
    hot: row.weightFrequency,
    overdue: row.weightRecency,
    halfLife: row.weightHotCold,
    power: row.weightGapAnalysis,
  };
}

function parseStats(description: string | null): ChampionStats {
  if (!description) return { threePlusCount: null, avgHitsPerLine: null, candidatesTested: null, targetMet: false };
  try {
    const parsed = JSON.parse(description) as Partial<ChampionStats>;
    return {
      threePlusCount: parsed.threePlusCount ?? null,
      avgHitsPerLine: parsed.avgHitsPerLine ?? null,
      candidatesTested: parsed.candidatesTested ?? null,
      targetMet: parsed.targetMet === true,
    };
  } catch {
    return { threePlusCount: null, avgHitsPerLine: null, candidatesTested: null, targetMet: false };
  }
}

// Add whole days to a YYYY-MM-DD date without any timezone shift.
function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The date of the next draw that has NOT yet been recorded: the day immediately
 * after the latest stored draw. Derived from stored history so a prediction can
 * never skip an undrawn (or not-yet-scraped) draw.
 */
export async function getNextPredictionDate(drawType: DrawType): Promise<string | null> {
  const rows = await db
    .select({ drawDate: uk49sDraws.drawDate })
    .from(uk49sDraws)
    .where(eq(uk49sDraws.drawType, drawType))
    .orderBy(desc(uk49sDraws.drawDate))
    .limit(1);

  if (rows.length === 0) return null;
  return addDaysIso(rows[0].drawDate, 1);
}

/**
 * The tuned champion weights for a draw type, or the engine defaults when no
 * model has been locked yet.
 */
export async function getChampionWeights(drawType: DrawType): Promise<Base44Weights> {
  const row = await db
    .select()
    .from(uk49sModelConfigs)
    .where(and(eq(uk49sModelConfigs.drawType, drawType), eq(uk49sModelConfigs.status, "active")))
    .orderBy(desc(uk49sModelConfigs.createdAt))
    .limit(1);

  return row.length > 0 ? weightsFromRow(row[0]) : DEFAULT_WEIGHTS;
}

/** Active model info for a draw type (null when nothing has been locked yet). */
export async function getActiveModel(drawType: DrawType): Promise<ModelInfo | null> {
  const row = await db
    .select()
    .from(uk49sModelConfigs)
    .where(and(eq(uk49sModelConfigs.drawType, drawType), eq(uk49sModelConfigs.status, "active")))
    .orderBy(desc(uk49sModelConfigs.createdAt))
    .limit(1);

  if (row.length === 0) return null;
  const m = row[0];
  const stats = parseStats(m.description);
  return {
    id: m.id,
    drawType: m.drawType,
    version: m.version,
    weights: weightsFromRow(m),
    threePlusCount: stats.threePlusCount,
    avgHitsPerLine: stats.avgHitsPerLine,
    candidatesTested: stats.candidatesTested,
    targetMet: stats.targetMet,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/**
 * Locks a freshly tuned champion as the active model for a draw type, archiving
 * any previous one — the Base44 "one locked weight set per game" behaviour.
 */
export async function lockChampion(
  drawType: DrawType,
  weights: Base44Weights,
  report: BacktestReport,
  candidatesTested: number,
): Promise<number> {
  await db
    .update(uk49sModelConfigs)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(uk49sModelConfigs.drawType, drawType), eq(uk49sModelConfigs.status, "active")));

  const [model] = await db
    .insert(uk49sModelConfigs)
    .values({
      drawType,
      version: `base44-${Date.now()}`,
      status: "active",
      strategy: "base44",
      poolSize: 4,
      weightFrequency: weights.hot,
      weightRecency: weights.overdue,
      weightHotCold: weights.halfLife,
      weightGapAnalysis: weights.power,
      // The four weights above carry the engine parameters; the remaining legacy
      // weight columns are unused by the engine.
      weightPairs: 0,
      weightTriples: 0,
      weightConsecutive: 0,
      weightOddEven: 0,
      weightLowHigh: 0,
      weightSumRange: 0,
      weightPositional: 0,
      weightRepeat: 0,
      weightFirst3Minus2: 0,
      weightBonusInfluence: 0,
      weightMomentum: 0,
      weightNeighbour: 0,
      lookbackWindow: report.historyPerRun,
      enforceDiversity: false,
      minNumberSpread: 0,
      maxSameGroup: 0,
      validation4HitRate: report.threePlusRate,
      validationAvgHits: report.avgHitsPerLine,
      validationSampleSize: report.testedDraws,
      description: JSON.stringify({
        threePlusCount: report.threePlusCount,
        avgHitsPerLine: report.avgHitsPerLine,
        candidatesTested,
        targetMet: report.targetMet === true,
      }),
    })
    .returning();

  logger.info(
    { drawType, modelId: model.id, weights, threePlusCount: report.threePlusCount, candidatesTested },
    "Locked tuned champion weights as the active model",
  );
  return model.id;
}

/** All model versions for a draw type, newest first. */
export async function getModelHistory(drawType: DrawType): Promise<ModelInfo[]> {
  const rows = await db
    .select()
    .from(uk49sModelConfigs)
    .where(eq(uk49sModelConfigs.drawType, drawType))
    .orderBy(desc(uk49sModelConfigs.createdAt));

  return rows.map((m) => {
    const stats = parseStats(m.description);
    return {
      id: m.id,
      drawType: m.drawType,
      version: m.version,
      weights: weightsFromRow(m),
      threePlusCount: stats.threePlusCount,
      avgHitsPerLine: stats.avgHitsPerLine,
      candidatesTested: stats.candidatesTested,
      targetMet: stats.targetMet,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  });
}

/** Generates and stores a prediction for a draw type and target date. */
export async function generateAndStorePrediction(
  drawType: DrawType,
  predictionDate: string,
): Promise<{ success: boolean; prediction?: PredictionInfo | null; error?: string }> {
  try {
    const existing = await db
      .select()
      .from(uk49sPredictions)
      .where(
        and(eq(uk49sPredictions.predictionDate, predictionDate), eq(uk49sPredictions.drawType, drawType)),
      )
      .limit(1);

    if (existing.length > 0) {
      return { success: false, error: "Prediction already exists for this date" };
    }

    const allDraws = await db
      .select()
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, drawType))
      .orderBy(asc(uk49sDraws.drawDate));

    const latestRecorded = allDraws.length > 0 ? allDraws[allDraws.length - 1].drawDate : null;
    if (!latestRecorded) {
      return { success: false, error: `No ${drawType} draws recorded yet — nothing to train on` };
    }

    /**
     * Never predict past a draw whose result is not recorded yet, otherwise the
     * prediction would silently train on stale history.
     */
    const nextRecorded = addDaysIso(latestRecorded, 1);
    if (predictionDate > nextRecorded) {
      return {
        success: false,
        error: `Cannot generate a prediction for ${predictionDate}: the preceding ${drawType} draw (${nextRecorded}) has no recorded result yet. Record that draw first.`,
      };
    }

    const trainingDraws = allDraws.filter((d) => d.drawDate < predictionDate);
    if (trainingDraws.length < MIN_TRAIN) {
      return {
        success: false,
        error: `Not enough historical data before ${predictionDate}. Need ${MIN_TRAIN}, have ${trainingDraws.length}`,
      };
    }

    const activeModel = await getActiveModel(drawType);
    const weights = activeModel?.weights ?? DEFAULT_WEIGHTS;
    const engineDraws = toEngineDraws(trainingDraws, drawType);

    const [set] = buildPredictions({
      draws: engineDraws,
      targetDate: predictionDate,
      drawTime: drawType === "lunchtime" ? "12:30" : "17:49",
      sets: 1,
      weights,
    });

    if (!set) {
      return { success: false, error: "The engine could not produce a balanced line for this history" };
    }

    const trainingCutoff = trainingDraws[trainingDraws.length - 1].drawDate;

    const [storedPrediction] = await db
      .insert(uk49sPredictions)
      .values({
        drawType,
        predictionDate,
        predictedMain1: set.numbers[0],
        predictedMain2: set.numbers[1],
        predictedMain3: set.numbers[2],
        predictedMain4: set.numbers[3],
        predictedBooster: set.bonus_numbers[0],
        modelConfigId: activeModel?.id ?? null,
        trainingCutoff,
        componentScores: JSON.stringify({ method: set.method, confidence: set.confidence, weights }),
        overallScore: set.confidence,
        status: "pending",
      })
      .returning();

    await matchPredictionWithResult(storedPrediction.id);

    return { success: true, prediction: await getPredictionInfo(storedPrediction.id) };
  } catch (error) {
    logger.error({ error, drawType, predictionDate }, "Failed to generate prediction");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/** Matches a pending prediction against its actual draw, when recorded. */
export async function matchPredictionWithResult(predictionId: number): Promise<void> {
  const prediction = await db
    .select()
    .from(uk49sPredictions)
    .where(eq(uk49sPredictions.id, predictionId))
    .limit(1);

  if (prediction.length === 0) return;
  const p = prediction[0];

  const actualDraw = await db
    .select()
    .from(uk49sDraws)
    .where(and(eq(uk49sDraws.drawDate, p.predictionDate), eq(uk49sDraws.drawType, p.drawType)))
    .limit(1);

  if (actualDraw.length === 0) return;

  const draw = actualDraw[0];
  const actualMain = drawToNumbers(draw).main;
  const predictedMain = [p.predictedMain1, p.predictedMain2, p.predictedMain3, p.predictedMain4];
  const mainHits = predictedMain.filter((n) => actualMain.includes(n)).length;
  const boosterHit = p.predictedBooster === draw.boosterBall;

  await db
    .update(uk49sPredictions)
    .set({
      matchedDrawId: draw.id,
      actualMain1: actualMain[0],
      actualMain2: actualMain[1],
      actualMain3: actualMain[2],
      actualMain4: actualMain[3],
      actualMain5: actualMain[4],
      actualMain6: actualMain[5],
      actualBooster: draw.boosterBall,
      mainHits,
      boosterHit,
      status: "matched",
      updatedAt: new Date(),
    })
    .where(eq(uk49sPredictions.id, predictionId));
}

export async function getPredictionInfo(predictionId: number): Promise<PredictionInfo | null> {
  const prediction = await db
    .select({
      id: uk49sPredictions.id,
      drawType: uk49sPredictions.drawType,
      predictionDate: uk49sPredictions.predictionDate,
      predictedMain1: uk49sPredictions.predictedMain1,
      predictedMain2: uk49sPredictions.predictedMain2,
      predictedMain3: uk49sPredictions.predictedMain3,
      predictedMain4: uk49sPredictions.predictedMain4,
      predictedBooster: uk49sPredictions.predictedBooster,
      modelConfigId: uk49sPredictions.modelConfigId,
      trainingCutoff: uk49sPredictions.trainingCutoff,
      status: uk49sPredictions.status,
      mainHits: uk49sPredictions.mainHits,
      boosterHit: uk49sPredictions.boosterHit,
      actualMain1: uk49sPredictions.actualMain1,
      actualMain2: uk49sPredictions.actualMain2,
      actualMain3: uk49sPredictions.actualMain3,
      actualMain4: uk49sPredictions.actualMain4,
      actualMain5: uk49sPredictions.actualMain5,
      actualMain6: uk49sPredictions.actualMain6,
      actualBooster: uk49sPredictions.actualBooster,
      createdAt: uk49sPredictions.createdAt,
    })
    .from(uk49sPredictions)
    .where(eq(uk49sPredictions.id, predictionId))
    .limit(1);

  if (prediction.length === 0) return null;
  const p = prediction[0];

  return {
    id: p.id,
    drawType: p.drawType,
    predictionDate: p.predictionDate,
    predictedMain: [p.predictedMain1, p.predictedMain2, p.predictedMain3, p.predictedMain4],
    predictedBooster: p.predictedBooster,
    modelConfigId: p.modelConfigId,
    trainingCutoff: p.trainingCutoff,
    status: p.status,
    mainHits: p.mainHits,
    boosterHit: p.boosterHit,
    actualMain:
      p.actualMain1 !== null
        ? [p.actualMain1, p.actualMain2!, p.actualMain3!, p.actualMain4!, p.actualMain5!, p.actualMain6!]
        : null,
    actualBooster: p.actualBooster,
    createdAt: p.createdAt,
  };
}

export async function getLatestPrediction(drawType: DrawType): Promise<PredictionInfo | null> {
  const prediction = await db
    .select()
    .from(uk49sPredictions)
    .where(eq(uk49sPredictions.drawType, drawType))
    .orderBy(desc(uk49sPredictions.predictionDate))
    .limit(1);

  if (prediction.length === 0) return null;
  return getPredictionInfo(prediction[0].id);
}

export async function getPredictionHistory(
  drawType: DrawType,
  limit = 50,
  offset = 0,
  since: Date | null = null,
): Promise<PredictionInfo[]> {
  const predictions = await db
    .select()
    .from(uk49sPredictions)
    .where(
      since
        ? and(eq(uk49sPredictions.drawType, drawType), gte(uk49sPredictions.createdAt, since))
        : eq(uk49sPredictions.drawType, drawType),
    )
    .orderBy(desc(uk49sPredictions.predictionDate))
    .limit(limit)
    .offset(offset);

  const infos = await Promise.all(predictions.map((p) => getPredictionInfo(p.id)));
  return infos.filter((p): p is PredictionInfo => p !== null);
}
