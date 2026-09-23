/**
 * Automatic update.
 *
 * Keeps the app's predictions current without any manual admin action:
 *   1. refresh the latest stored results for both draw types;
 *   2. run BOTH prediction engines over the same validation window and pick the
 *      winner for the next draw (see lib/strategy-showdown.ts);
 *   3. generate the next draw's prediction with the winning engine.
 *
 * Step 3 only ever targets the day after the latest recorded draw, so it can
 * never skip a draw whose result is missing. Every step is best-effort: a
 * failure is logged and never crashes the server.
 */

import type { DrawType } from "@workspace/db/schema";
import { updateLatestDraws } from "./ingestion-service";
import { generateAndStorePrediction, getNextPredictionDate } from "./prediction-service";
import { runStrategyShowdown } from "./strategy-showdown";
import { logger } from "./logger";

const DRAW_TYPES: DrawType[] = ["lunchtime", "teatime"];

export interface ShowdownSummary {
  champion: string;
  winner: string;
  promoted: boolean;
  detail: string;
  evaluations: {
    strategy: string;
    label: string;
    fourHitRate: number;
    avgMainHits: number;
    totalPredictions: number;
  }[];
}

export interface DrawTypeUpdateResult {
  drawType: DrawType;
  predictionDate: string | null;
  generated: boolean;
  /** "already exists" is reported here too, but is a normal outcome. */
  note: string | null;
  showdown: ShowdownSummary | null;
  showdownNote: string | null;
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
        engine: r.showdown ? `${r.showdown.winner}${r.showdown.promoted ? " (promoted)" : ""}` : null,
      })),
    },
    "Automatic update complete",
  );

  return report;
}

/**
 * Steps 2 and 3 on their own: score both engines for every draw type, promote
 * the winner, then generate the next draw's prediction with it. Also used right
 * after a manual result refresh so a newly recorded draw is acted on at once
 * instead of waiting for the hourly sweep.
 */
export async function runPredictionCycle(): Promise<DrawTypeUpdateResult[]> {
  const results: DrawTypeUpdateResult[] = [];

  for (const drawType of DRAW_TYPES) {
    const result: DrawTypeUpdateResult = {
      drawType,
      predictionDate: null,
      generated: false,
      note: null,
      showdown: null,
      showdownNote: null,
    };

    /**
     * Both engines are run before the prediction is generated, so the winner
     * is already the active model by the time the next draw is predicted.
     * The showdown is skipped automatically when no new draw has been recorded.
     */
    try {
      const showdown = await runStrategyShowdown(drawType);
      result.showdown = {
        champion: showdown.champion,
        winner: showdown.winner,
        promoted: showdown.promoted,
        detail: showdown.detail,
        evaluations: showdown.evaluations.map((evaluation) => ({
          strategy: evaluation.strategy,
          label: evaluation.label,
          fourHitRate: evaluation.fourHitRate,
          avgMainHits: evaluation.avgMainHits,
          totalPredictions: evaluation.totalPredictions,
        })),
      };
    } catch (error) {
      result.showdownNote = error instanceof Error ? error.message : String(error);
      logger.error({ error, drawType }, "Automatic update: engine showdown failed");
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