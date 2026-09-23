/**
 * Automatic daily update.
 *
 * Keeps the app's predictions current without any manual admin action:
 *   1. refresh the latest stored results for both draw types;
 *   2. generate the prediction for the next draw that has not been recorded yet.
 *
 * Step 2 only ever targets the day after the latest recorded draw, so it can
 * never skip a draw whose result is missing. Both steps are best-effort: a
 * failure is logged and never crashes the server.
 */

import type { DrawType } from "@workspace/db/schema";
import { updateLatestDraws } from "./ingestion-service";
import { generateAndStorePrediction, getNextPredictionDate } from "./prediction-service";
import { logger } from "./logger";

const DRAW_TYPES: DrawType[] = ["lunchtime", "teatime"];

export interface DrawTypeUpdateResult {
  drawType: DrawType;
  predictionDate: string | null;
  generated: boolean;
  /** "already exists" is reported here too, but is a normal outcome. */
  note: string | null;
}

export interface DailyUpdateReport {
  startedAt: string;
  finishedAt: string;
  ingestionOk: boolean;
  results: DrawTypeUpdateResult[];
}

export async function runDailyPredictionUpdate(): Promise<DailyUpdateReport> {
  const startedAt = new Date().toISOString();

  let ingestionOk = true;
  try {
    const ingestion = await updateLatestDraws();
    logger.info(
      {
        imported: ingestion.totalImported,
        skipped: ingestion.totalSkipped,
        rejected: ingestion.totalRejected,
      },
      "Automatic update: latest results refreshed",
    );
  } catch (error) {
    ingestionOk = false;
    logger.error({ error }, "Automatic update: refreshing the latest results failed");
  }

  const results: DrawTypeUpdateResult[] = [];

  for (const drawType of DRAW_TYPES) {
    const result: DrawTypeUpdateResult = { drawType, predictionDate: null, generated: false, note: null };

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

  const report: DailyUpdateReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    ingestionOk,
    results,
  };

  logger.info(
    {
      ingestionOk,
      predictions: results.map((r) => ({ drawType: r.drawType, date: r.predictionDate, generated: r.generated, note: r.note })),
    },
    "Automatic update complete",
  );

  return report;
}