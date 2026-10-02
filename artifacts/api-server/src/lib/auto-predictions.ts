/**
 * Automatic update.
 *
 * Keeps the app's predictions current without any manual admin action:
 *   1. refresh the latest stored results for both draw types;
 *   2. ensure a tuned champion exists for each draw type (tune once if none);
 *   3. generate the next draw's prediction with the locked champion.
 *
 * Step 3 only ever targets the day after the latest recorded draw, so it can
 * never skip a draw whose result is missing. Every step is best-effort: a
 * failure is logged and never crashes the server.
 */

import { db } from "@workspace/db";
import { uk49sDraws, type DrawType } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { updateLatestDraws } from "./ingestion-service";
import { generateAndStorePrediction, getActiveModel, getNextPredictionDate } from "./prediction-service";
import { startOptimizerJob } from "./optimizer-jobs";
import { logger } from "./logger";

const DRAW_TYPES: DrawType[] = ["lunchtime", "teatime"];

export interface DrawTypeUpdateResult {
  drawType: DrawType;
  predictionDate: string | null;
  generated: boolean;
  note: string | null;
  tuned: boolean;
  tuneNote: string | null;
}

export interface DailyUpdateReport {
  startedAt: string;
  finishedAt: string;
  ingestionOk: boolean;
  results: DrawTypeUpdateResult[];
}

/** Tunes and locks a champion for a draw type when none exists yet. */
async function ensureChampion(drawType: DrawType): Promise<{ tuned: boolean; note: string | null }> {
  const existing = await getActiveModel(drawType);
  if (existing) return { tuned: false, note: null };

  const draws = await db.select().from(uk49sDraws).where(eq(uk49sDraws.drawType, drawType)).orderBy(uk49sDraws.drawDate);
  if (draws.length < 20) {
    return { tuned: false, note: `Not enough ${drawType} draws to tune yet (${draws.length})` };
  }

  const job = await startOptimizerJob({ drawType, draws, autoWindow: true });
  return {
    tuned: true,
    note: `Tuned champion (${job.candidatesTested} candidates, ${job.threePlusCount} 3+ draws, target met: ${job.targetMet})`,
  };
}

export async function runDailyPredictionUpdate(): Promise<DailyUpdateReport> {
  const startedAt = new Date().toISOString();

  let ingestionOk = true;
  try {
    const ingestion = await updateLatestDraws();
    logger.info(
      { imported: ingestion.totalImported, skipped: ingestion.totalSkipped, rejected: ingestion.totalRejected },
      "Automatic update: latest results refreshed",
    );
  } catch (error) {
    ingestionOk = false;
    logger.error({ error }, "Automatic update: refreshing the latest results failed");
  }

  const results = await runPredictionCycle();

  const report: DailyUpdateReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    ingestionOk,
    results,
  };

  logger.info(
    {
      ingestionOk,
      predictions: results.map((r) => ({
        drawType: r.drawType,
        date: r.predictionDate,
        generated: r.generated,
        note: r.note,
        tuned: r.tuned,
      })),
    },
    "Automatic update complete",
  );

  return report;
}

/**
 * Steps 2 and 3 on their own: ensure a champion exists, then generate the next
 * draw's prediction. Also used right after a manual result refresh.
 */
export async function runPredictionCycle(): Promise<DrawTypeUpdateResult[]> {
  const results: DrawTypeUpdateResult[] = [];

  for (const drawType of DRAW_TYPES) {
    const result: DrawTypeUpdateResult = {
      drawType,
      predictionDate: null,
      generated: false,
      note: null,
      tuned: false,
      tuneNote: null,
    };

    try {
      const tune = await ensureChampion(drawType);
      result.tuned = tune.tuned;
      result.tuneNote = tune.note;
    } catch (error) {
      // A tuning conflict (a run is already in progress) is not fatal — the
      // prediction still uses whatever champion is currently locked.
      result.tuneNote = error instanceof Error ? error.message : String(error);
      logger.warn({ error, drawType }, "Automatic update: champion tuning skipped");
    }

    try {
      const predictionDate = await getNextPredictionDate(drawType);
      result.predictionDate = predictionDate;

      if (!predictionDate) {
        result.note = `No ${drawType} draws recorded yet`;
      } else {
        const outcome = await generateAndStorePrediction(drawType, predictionDate);
        result.generated = outcome.success;
        result.note = outcome.success ? null : outcome.error ?? null;
      }
    } catch (error) {
      result.note = error instanceof Error ? error.message : String(error);
      logger.error({ error, drawType }, "Automatic update: prediction generation failed");
    }

    results.push(result);
  }

  return results;
}
