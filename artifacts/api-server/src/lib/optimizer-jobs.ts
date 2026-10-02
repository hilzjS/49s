/**
 * Optimizer job manager.
 *
 * The search is the Base44 walk-forward tuner (`findChampionAsync` in
 * `base44-engine.ts`): each of the 392 candidate weight sets is scored over past
 * draws, and the one with the most 3+ match lines wins. The winning weights are
 * locked as the active model for the draw type.
 *
 * The tuner yields to the event loop between candidates, so it cannot block the
 * HTTP server. A run always reaches a terminal state (completed / failed /
 * cancelled) and is mirrored to `uk49s_optimizer_runs` for history.
 */
import { db } from "@workspace/db";
import {
  uk49sOptimizerRuns,
  DEFAULT_TARGET,
  findChampionAsync,
  toEngineDraws,
  type Base44Weights,
  type BacktestReport,
  type DrawType,
  type Uk49sDraw,
} from "@workspace/db/schema";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { logger } from "./logger";
import { lockChampion } from "./prediction-service";

export type OptimizerJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Draws the tuner evaluates per candidate weight set. */
const DEFAULT_MAX_TESTS = 30;

export interface OptimizerJobPublicState {
  runId: number;
  drawType: DrawType;
  status: OptimizerJobStatus;
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number;
  candidatesTested: number;
  candidatesTotal: number;
  threePlusCount: number;
  avgHitsPerLine: number | null;
  targetMet: boolean;
  weights: Base44Weights | null;
  errorMessage: string | null;
  hasResult: boolean;
}

interface OptimizerJob {
  runId: number;
  drawType: DrawType;
  status: OptimizerJobStatus;
  startedAt: number;
  finishedAt: number | null;
  candidatesTested: number;
  candidatesTotal: number;
  threePlusCount: number;
  avgHitsPerLine: number | null;
  targetMet: boolean;
  weights: Base44Weights | null;
  errorMessage: string | null;
  result: BacktestReport | null;
}

const jobs = new Map<number, OptimizerJob>();

export class OptimizerJobError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 400, code = "optimizer_job_error") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function toPublic(job: OptimizerJob): OptimizerJobPublicState {
  return {
    runId: job.runId,
    drawType: job.drawType,
    status: job.status,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
    candidatesTested: job.candidatesTested,
    candidatesTotal: job.candidatesTotal,
    threePlusCount: job.threePlusCount,
    avgHitsPerLine: job.avgHitsPerLine,
    targetMet: job.targetMet,
    weights: job.weights,
    errorMessage: job.errorMessage,
    hasResult: job.result !== null,
  };
}

export function getJobState(runId: number): OptimizerJobPublicState | null {
  const job = jobs.get(runId);
  return job ? toPublic(job) : null;
}

export function getActiveJobForDrawType(drawType: DrawType): OptimizerJobPublicState | null {
  for (const job of jobs.values()) {
    if (job.drawType === drawType && (job.status === "queued" || job.status === "running")) {
      return toPublic(job);
    }
  }
  return null;
}

export interface StartOptimizerJobParams {
  drawType: DrawType;
  draws: Uk49sDraw[];
  maxTests?: number;
  autoWindow?: boolean;
  allowDuplicate?: boolean;
}

/**
 * Creates the run record and runs the tuner. Throws OptimizerJobError(409) when
 * an equivalent job is already running, so duplicate runs cannot be started.
 */
export async function startOptimizerJob(params: StartOptimizerJobParams): Promise<OptimizerJobPublicState> {
  const { drawType, draws, autoWindow = false } = params;
  const maxTests = params.maxTests && params.maxTests > 0 ? Math.floor(params.maxTests) : DEFAULT_MAX_TESTS;

  const inMemory = getActiveJobForDrawType(drawType);
  const runningRows = await db
    .select({ id: uk49sOptimizerRuns.id })
    .from(uk49sOptimizerRuns)
    .where(and(eq(uk49sOptimizerRuns.drawType, drawType), inArray(uk49sOptimizerRuns.status, ["queued", "running"])));

  if (!params.allowDuplicate && (inMemory || runningRows.length > 0)) {
    const existingId = inMemory?.runId ?? runningRows[0]?.id;
    throw new OptimizerJobError(
      `An optimizer run for ${drawType} is already in progress (run #${existingId}). Wait for it to finish or cancel it first.`,
      409,
      "optimizer_job_conflict",
    );
  }

  const [run] = await db
    .insert(uk49sOptimizerRuns)
    .values({
      drawType,
      strategy: "base44",
      status: "running",
      configsTested: 0,
      configsFailed: 0,
      autoWindow,
      startedAt: new Date(),
      heartbeatAt: new Date(),
    })
    .returning();

  const job: OptimizerJob = {
    runId: run.id,
    drawType,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    candidatesTested: 0,
    candidatesTotal: 392,
    threePlusCount: 0,
    avgHitsPerLine: null,
    targetMet: false,
    weights: null,
    errorMessage: null,
    result: null,
  };

  // Bound the in-memory registry — finished jobs are recoverable from the database.
  const finished = [...jobs.entries()].filter(
    ([, entry]) => entry.status !== "running" && entry.status !== "queued",
  );
  for (const [id] of finished.slice(0, Math.max(0, finished.length - 20))) jobs.delete(id);
  jobs.set(run.id, job);

  logger.info({ runId: run.id, drawType, maxTests, autoWindow }, "Optimizer job started");

  try {
    const history = toEngineDraws(draws, drawType);
    const champion = await findChampionAsync(history, maxTests);

    job.candidatesTested = champion.candidatesTested;
    job.candidatesTotal = champion.candidatesTested;
    job.threePlusCount = champion.report.threePlusCount;
    job.avgHitsPerLine = champion.report.avgHitsPerLine;
    job.targetMet = champion.targetMet;
    job.weights = champion.weights;
    job.result = champion.report;

    await lockChampion(drawType, champion.weights, champion.report, champion.candidatesTested);

    await db
      .update(uk49sOptimizerRuns)
      .set({
        status: "completed",
        configsTested: champion.candidatesTested,
        configsFailed: 0,
        stoppedReason: champion.targetMet ? "target_reached" : "exhausted",
        maxHits: champion.report.bestEver?.bestHits ?? 0,
        fourHitFound: champion.targetMet,
        fourHitCount: champion.report.threePlusCount,
        best4HitRate: champion.report.threePlusRate,
        bestAvgHits: champion.report.avgHitsPerLine,
        completedAt: new Date(),
        heartbeatAt: new Date(),
      })
      .where(eq(uk49sOptimizerRuns.id, run.id));

    job.status = "completed";
    job.finishedAt = Date.now();

    logger.info(
      {
        runId: run.id,
        drawType,
        weights: champion.weights,
        threePlusCount: champion.report.threePlusCount,
        avgHitsPerLine: champion.report.avgHitsPerLine,
        target: DEFAULT_TARGET,
        targetMet: champion.targetMet,
      },
      "Optimizer job completed and champion locked",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Optimizer run failed";
    job.status = "failed";
    job.errorMessage = message;
    job.finishedAt = Date.now();
    await db
      .update(uk49sOptimizerRuns)
      .set({ status: "failed", errorMessage: message, completedAt: new Date(), heartbeatAt: new Date() })
      .where(eq(uk49sOptimizerRuns.id, run.id))
      .catch((dbError: unknown) => logger.error({ error: dbError, runId: run.id }, "Failed to persist run failure"));
    logger.error({ error, runId: run.id, drawType }, "Optimizer job failed");
  }

  return toPublic(job);
}

/** Cancels a running job (the tuner cannot be interrupted mid-candidate, so the
 *  flag flips once the current champion has been recorded). */
export async function cancelOptimizerJob(runId: number): Promise<OptimizerJobPublicState> {
  const job = jobs.get(runId);
  if (!job || (job.status !== "queued" && job.status !== "running")) {
    throw new OptimizerJobError(`Optimizer run #${runId} is not running`, 409, "optimizer_job_not_running");
  }
  job.status = "cancelled";
  job.finishedAt = Date.now();
  await db
    .update(uk49sOptimizerRuns)
    .set({ status: "cancelled", completedAt: new Date(), heartbeatAt: new Date() })
    .where(eq(uk49sOptimizerRuns.id, runId));
  return toPublic(job);
}

/**
 * Marks orphaned queued/running rows as failed. Runs that are still active in
 * this process are excluded, so the periodic sweep never clobbers a job that is
 * genuinely in progress; on boot the map is empty and every leftover row is
 * recovered.
 */
export async function recoverInterruptedJobs(message: string): Promise<void> {
  const activeIds = [...jobs.values()]
    .filter((job) => job.status === "queued" || job.status === "running")
    .map((job) => job.runId);

  const where =
    activeIds.length > 0
      ? and(inArray(uk49sOptimizerRuns.status, ["queued", "running"]), notInArray(uk49sOptimizerRuns.id, activeIds))
      : inArray(uk49sOptimizerRuns.status, ["queued", "running"]);

  await db
    .update(uk49sOptimizerRuns)
    .set({ status: "failed", errorMessage: message, completedAt: new Date(), heartbeatAt: new Date() })
    .where(where);
}

/** No background workers are kept, so shutdown is a no-op kept for the boot hook. */
export async function shutdownOptimizerJobs(): Promise<void> {
  return;
}
