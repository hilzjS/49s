/**
 * Automatic updates, on two cadences:
 *
 *   • `runDrawCheck` — every minute. While a prediction is "Awaiting draw", it
 *     quietly refreshes the latest results and matches the prediction as soon as
 *     the draw is recorded, then ensures the next draw's prediction exists.
 *   • `runDailyPredictionUpdate` — hourly. A recorded refresh plus the champion
 *     guarantee, so predictions and results stay current even when nothing is
 *     pending.
 *
 * The next-draw prediction only ever targets the day after the latest recorded
 * draw, so it can never skip a draw whose result is missing. Both cycles share a
 * lock so they can never run (or generate) at the same time, and every step is
 * best-effort: a failure is logged and never crashes the server.
 */

import { db } from "@workspace/db";
import { DRAW_TIMES, uk49sDraws, uk49sPredictions, type DrawType } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { refreshLatestDrawsQuietly, updateLatestDraws } from "./ingestion-service";
import {
  generateAndStorePrediction,
  getActiveModel,
  getNextPredictionDate,
  matchPredictionWithResult,
} from "./prediction-service";
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
  /** True when another cycle was already running, so this one did nothing. */
  skipped: boolean;
  ingestionOk: boolean;
  results: DrawTypeUpdateResult[];
}

export interface DrawCheckReport {
  startedAt: string;
  finishedAt: string;
  /** True when another cycle was already running, so this one did nothing. */
  skipped: boolean;
  /** Predictions that were awaiting a draw when the check began. */
  pendingBefore: number;
  /** How many of them were resolved by a newly recorded draw. */
  matched: number;
  /** Still awaiting a draw afterwards (before the next prediction is added). */
  unresolved: number;
  /** Whether the latest results were refreshed from the source. */
  refreshed: boolean;
  results: DrawTypeUpdateResult[];
}

/**
 * Serialises the automatic cycles: the minute-by-minute awaiting-draw check and
 * the hourly full update both ingest and generate, and must never overlap.
 */
let cycleRunning = false;

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

  if (cycleRunning) {
    return { startedAt, finishedAt: startedAt, skipped: true, ingestionOk: false, results: [] };
  }
  cycleRunning = true;

  try {
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
      skipped: false,
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
  } finally {
    cycleRunning = false;
  }
}

/**
 * The every-minute **awaiting-draw check**.
 *
 * A stored prediction stays "pending" (shown as "Awaiting draw") until its
 * result is recorded. This runs on a one-minute timer so a newly published draw
 * is picked up almost immediately instead of waiting for the hourly update:
 *   1. if an awaited draw is due, quietly refresh the latest results;
 *   2. match every pending prediction against the draws now on record;
 *   3. ensure the next draw's prediction exists (idempotent).
 *
 * The refresh bypasses the scrape cache and writes no scrape-run audit row —
 * otherwise a per-minute poll would both miss the result for up to 15 minutes and
 * flood the scrape-run history.
 */
export async function runDrawCheck(): Promise<DrawCheckReport> {
  const startedAt = new Date().toISOString();

  if (cycleRunning) {
    return {
      startedAt,
      finishedAt: startedAt,
      skipped: true,
      pendingBefore: 0,
      matched: 0,
      unresolved: 0,
      refreshed: false,
      results: [],
    };
  }
  cycleRunning = true;

  try {
    const pending = await pendingPredictions();

    // Only hit the source once the awaited draw is actually due. Before that
    // there is nothing to find, and the hourly update keeps everything else
    // fresh — so we never hammer the source for the whole day.
    const due = pending.some((p) => drawDue(p.predictionDate, p.drawType));

    let refreshed = false;
    if (due) {
      try {
        const ingestion = await refreshLatestDrawsQuietly(true);
        refreshed = true;
        logger.info(
          { imported: ingestion.totalImported, rejected: ingestion.totalRejected },
          "Awaiting-draw check: latest results refreshed",
        );
      } catch (error) {
        logger.error({ error }, "Awaiting-draw check: refreshing the latest results failed");
      }
    }

    for (const entry of pending) {
      try {
        await matchPredictionWithResult(entry.id);
      } catch (error) {
        logger.warn({ error, predictionId: entry.id }, "Awaiting-draw check: matching a prediction failed");
      }
    }

    // Counted before the cycle adds the next draw's prediction.
    const unresolved = (await pendingPredictions()).length;
    const matched = pending.length - unresolved;

    const results = await runPredictionCycle();

    const report: DrawCheckReport = {
      startedAt,
      finishedAt: new Date().toISOString(),
      skipped: false,
      pendingBefore: pending.length,
      matched,
      unresolved,
      refreshed,
      results,
    };

    logger.info(
      {
        matched,
        unresolved,
        refreshed,
        predictions: results.map((r) => ({ drawType: r.drawType, date: r.predictionDate, generated: r.generated })),
      },
      "Awaiting-draw check complete",
    );

    return report;
  } finally {
    cycleRunning = false;
  }
}

/** Every prediction still awaiting a recorded draw. */
async function pendingPredictions(): Promise<{ id: number; drawType: DrawType; predictionDate: string }[]> {
  return db
    .select({
      id: uk49sPredictions.id,
      drawType: uk49sPredictions.drawType,
      predictionDate: uk49sPredictions.predictionDate,
    })
    .from(uk49sPredictions)
    .where(eq(uk49sPredictions.status, "pending"));
}

/**
 * Whether a pending prediction's draw time has passed, so a result is expected
 * now. Uses the app's canonical session times; the reference is UTC, so polling
 * simply starts up to an hour early in summer.
 */
function drawDue(predictionDate: string, drawType: DrawType): boolean {
  const at = Date.parse(`${predictionDate}T${DRAW_TIMES[drawType]}:00Z`);
  if (Number.isNaN(at)) return true; // unknown date → check anyway
  return at - 60 * 60 * 1000 <= Date.now();
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
