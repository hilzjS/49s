/**
 * Optimizer job manager.
 *
 * The optimizer search itself is unchanged (see optimizer-engine.ts). This
 * module only owns the *lifecycle* around a run:
 *
 *  - runs the search in a worker thread so the API server stays responsive and
 *    a long run cannot be killed by an HTTP timeout;
 *  - tracks real progress (configurations actually evaluated) in memory and
 *    mirrors it to uk49s_optimizer_runs for durability;
 *  - guarantees a terminal state (completed / failed / cancelled) and never
 *    leaves a job stuck at "running";
 *  - refuses duplicate runs for the same draw type unless explicitly allowed.
 *
 * A failed evaluation is reported as a failure — never as a zero-performance
 * configuration.
 */
import { Worker } from "node:worker_threads";
import { db } from "@workspace/db";
import {
  uk49sOptimizerRuns,
  uk49sOptimizerConfigs,
  type ConfigurationResult,
  type DiversityConstraints,
  type DrawType,
  type FeatureWeights,
  type FourHitRecord,
  type OptimizerConfig,
  type OptimizerResult,
  type OptimizerSearchOptions,
  type OptimizerStopReason,
  type Uk49sDraw,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { updateActiveModel } from "./prediction-service";
import type { OptimizerWorkerInput, OptimizerWorkerMessage } from "./optimizer-protocol";

/** `new URL` resolves next to the bundled server (dist/optimizer-worker.mjs). */
const WORKER_URL = new URL("./optimizer-worker.mjs", import.meta.url);

export type OptimizerJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Configurations are stored up to this many per run (unchanged behaviour). */
const MAX_STORED_CONFIGS = 500;
/** How often progress is mirrored to the database (ms). */
const PERSIST_INTERVAL_MS = 1000;
/** If no progress message arrives for this long, the job is considered hung. */
export const JOB_STALL_TIMEOUT_MS = 15 * 60 * 1000;

export interface OptimizerJobConfig {
  lookbackWindow: number;
  weights: FeatureWeights;
  constraints: DiversityConstraints;
}

export interface OptimizerJobPublicState {
  runId: number;
  drawType: DrawType;
  status: OptimizerJobStatus;
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number;
  totalConfigs: number;
  configsTested: number;
  configsFailed: number;
  currentIteration: number;
  phase: string | null;
  best4HitRate: number | null;
  bestAvgHits: number | null;
  bestScore: number | null;
  currentConfig: OptimizerJobConfig | null;
  errorMessage: string | null;
  validationStartDate: string | null;
  validationEndDate: string | null;
  validationDrawCount: number | null;
  autoWindow: boolean;
  hasResult: boolean;
  /** Search goal / limits. */
  maxConfigurations: number | null;
  stopOnFourHit: boolean;
  stoppedReason: OptimizerStopReason | null;
  /** Best single-prediction hit count seen during the search. */
  maxHits: number;
  /** Number of configurations that produced a genuine 4-hit validation result. */
  fourHitCount: number;
  /** True when a historical validation prediction matched exactly 4 numbers. */
  fourHitFound: boolean;
  /** The evidenced 4-hit record, when one was found. */
  fourHit: FourHitRecord | null;
  fourHitConfigId: number | null;
}

interface OptimizerJob {
  runId: number;
  drawType: DrawType;
  status: OptimizerJobStatus;
  startedAt: number;
  finishedAt: number | null;
  totalConfigs: number;
  configsTested: number;
  configsFailed: number;
  currentIteration: number;
  phase: string | null;
  best4HitRate: number | null;
  bestAvgHits: number | null;
  bestScore: number | null;
  currentConfig: OptimizerJobConfig | null;
  errorMessage: string | null;
  validationStartDate: string | null;
  validationEndDate: string | null;
  validationDrawCount: number | null;
  autoWindow: boolean;
  maxConfigurations: number | null;
  stopOnFourHit: boolean;
  stoppedReason: OptimizerStopReason | null;
  maxHits: number;
  fourHitCount: number;
  fourHitFound: boolean;
  fourHit: FourHitRecord | null;
  fourHitConfigId: number | null;
  result: OptimizerResult | null;
    /**
     * Number of evaluated configurations, counted from the worker's progress
     * messages. The engine restarts its own iteration counter for each elite
     * configuration in the hill-climbing phase, so its value is not a running
     * total and must not be used for progress.
     */
    evaluations: number;
    worker: Worker | null;
    /**
     * Set synchronously as soon as the worker reports a terminal message. The
     * worker exits immediately after posting its result, so the `exit` handler
     * must not treat that as a crash — the async finalize/DB write is still
     * running at that point.
     */
    settled: boolean;
    cancelRequested: boolean;
    lastProgressAt: number;
    lastPersistAt: number;
    /** Mirrors the existing explicit `applyToModel` request flag. */
    applyOnComplete: boolean;
    minValidationSamples: number;
  }

const jobs = new Map<number, OptimizerJob>();

export class OptimizerJobError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 400, code = "optimizer_job_error") {
    super(message);
    this.name = "OptimizerJobError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function toPublic(job: OptimizerJob, includeResult = false): OptimizerJobPublicState & { result?: OptimizerResult } {
  const state: OptimizerJobPublicState = {
    runId: job.runId,
    drawType: job.drawType,
    status: job.status,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
    totalConfigs: job.totalConfigs,
    configsTested: job.configsTested,
    configsFailed: job.configsFailed,
    currentIteration: job.currentIteration,
    phase: job.phase,
    best4HitRate: job.best4HitRate,
    bestAvgHits: job.bestAvgHits,
    bestScore: job.bestScore,
    currentConfig: job.currentConfig,
    errorMessage: job.errorMessage,
    validationStartDate: job.validationStartDate,
    validationEndDate: job.validationEndDate,
    validationDrawCount: job.validationDrawCount,
    autoWindow: job.autoWindow,
    hasResult: job.result !== null,
    maxConfigurations: job.maxConfigurations,
    stopOnFourHit: job.stopOnFourHit,
    stoppedReason: job.stoppedReason,
    maxHits: job.maxHits,
    fourHitCount: job.fourHitCount,
    fourHitFound: job.fourHitFound,
    fourHit: job.fourHit,
    fourHitConfigId: job.fourHitConfigId,
  };

  return includeResult ? { ...state, result: job.result ?? undefined } : state;
}

export function getJobState(runId: number, includeResult = false): (OptimizerJobPublicState & { result?: OptimizerResult }) | null {
  const job = jobs.get(runId);
  return job ? toPublic(job, includeResult) : null;
}

export function getActiveJobForDrawType(drawType: DrawType): OptimizerJobPublicState | null {
  for (const job of jobs.values()) {
    if (job.drawType === drawType && (job.status === "queued" || job.status === "running")) {
      return toPublic(job);
    }
  }
  return null;
}

/** Marks a run as failed, in memory (when present) and in the database. */
async function markRunFailed(runId: number, message: string): Promise<void> {
  const job = jobs.get(runId);
  if (job) {
    job.status = "failed";
    job.errorMessage = message;
    job.finishedAt ??= Date.now();
    job.worker = null;
  }

  try {
    await db
      .update(uk49sOptimizerRuns)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
        heartbeatAt: new Date(),
      })
      .where(eq(uk49sOptimizerRuns.id, runId));
  } catch (error) {
    logger.error({ error, runId }, "Failed to persist optimizer failure state");
  }
}

async function persistProgress(job: OptimizerJob, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - job.lastPersistAt < PERSIST_INTERVAL_MS) return;
  job.lastPersistAt = now;

  try {
    await db
      .update(uk49sOptimizerRuns)
      .set({
        status: job.status === "queued" ? "queued" : "running",
        configsTested: job.configsTested,
        configsFailed: job.configsFailed,
        currentIteration: job.currentIteration,
        best4HitRate: job.best4HitRate,
        bestAvgHits: job.bestAvgHits,
        maxHits: job.maxHits,
        fourHitFound: job.fourHitFound,
        fourHitCount: job.fourHitCount,
        heartbeatAt: new Date(),
      })
      .where(eq(uk49sOptimizerRuns.id, job.runId));
  } catch (error) {
    logger.error({ error, runId: job.runId }, "Failed to persist optimizer progress");
  }
}

/**
 * Splits the optimizer output into successfully evaluated configurations and
 * evaluation failures. A configuration whose validation produced no
 * predictions was never actually evaluated — it is a failure, not a 0%.
 */
function partitionResults(result: OptimizerResult): {
  evaluated: OptimizerResult["allResults"];
  failedCount: number;
} {
  const evaluated = result.allResults.filter((config) => config.validationSampleSize > 0);
  return { evaluated, failedCount: result.allResults.length - evaluated.length };
}

/**
 * The existing selection criteria (unchanged): highest 4-hit rate, with the
 * sample-size guard. Applied here to choose the preferred configuration among
 * those that produced a genuine 4-hit.
 */
function existingSelectionScore(config: ConfigurationResult): number {
  return config.validation4HitRate * 100 + config.stabilityScore * 0.1;
}

/**
 * Chooses the configuration to record/apply. When a 4-hit was found, the choice
 * is made among the successful 4-hit configurations using the existing criteria
 * (no new ranking system is introduced); otherwise the same criteria are applied
 * to all evaluated configurations, which yields the optimizer's existing best.
 */
function selectTargetConfiguration(result: OptimizerResult, minValidationSamples: number): ConfigurationResult | null {
  const source = result.fourHitResults.length > 0 ? result.fourHitResults : result.allResults;
  const eligible = source.filter((config) => config.validationSampleSize >= minValidationSamples);
  const pool = eligible.length > 0 ? eligible : source;

  // Same scoring formula and sample-size guard the optimizer itself uses.
  return [...pool].sort((a, b) => existingSelectionScore(b) - existingSelectionScore(a))[0] ?? null;
}

function toStoredConfigRow(
  runId: number,
  drawType: DrawType,
  config: ConfigurationResult,
): typeof uk49sOptimizerConfigs.$inferInsert {
  const fourHit = config.fourHitExamples[0] ?? null;

  return {
    runId,
    drawType,
    weightFrequency: config.weights.weightFrequency,
    weightRecency: config.weights.weightRecency,
    weightHotCold: config.weights.weightHotCold,
    weightGapAnalysis: config.weights.weightGapAnalysis,
    weightPairs: config.weights.weightPairs,
    weightTriples: config.weights.weightTriples,
    weightConsecutive: config.weights.weightConsecutive,
    weightOddEven: config.weights.weightOddEven,
    weightLowHigh: config.weights.weightLowHigh,
    weightSumRange: config.weights.weightSumRange,
    weightPositional: config.weights.weightPositional,
    weightRepeat: config.weights.weightRepeat,
    weightFirst3Minus2: config.weights.weightFirst3Minus2,
    lookbackWindow: config.lookbackWindow,
    enforceDiversity: config.constraints.enforceDiversity,
    minNumberSpread: config.constraints.minNumberSpread,
    maxSameGroup: config.constraints.maxSameGroup,
    validation4HitRate: config.validation4HitRate,
    validationAvgHits: config.validationAvgHits,
    validationSampleSize: config.validationSampleSize,
    validationBoosterHitRate: config.validationBoosterHitRate,
    maxMainHits: config.validationMaxHits,
    fourHitFound: config.validationFourHitCount > 0,
    fourHitCount: config.validationFourHitCount,
    fourHitDrawDate: fourHit ? fourHit.validationDrawDate : null,
    fourHitPredictedMain: fourHit ? JSON.stringify(fourHit.predictedMain) : null,
    fourHitActualMain: fourHit ? JSON.stringify(fourHit.actualMain) : null,
    fourHitHits: fourHit ? fourHit.mainHits : null,
    stabilityScore: config.stabilityScore,
    randomSeed: config.randomSeed,
  };
}

/**
 * Stores the tested configurations and returns the database id of the chosen
 * configuration (the 4-hit one when the target was reached).
 */
async function storeConfigurationResults(
  runId: number,
  drawType: DrawType,
  result: OptimizerResult,
  target: ConfigurationResult | null,
): Promise<number | null> {
  const stored = result.allResults.slice(0, MAX_STORED_CONFIGS);
  const targetIndex = target ? result.allResults.indexOf(target) : -1;

  // The configuration that achieved the target must always be persisted, even
  // when it falls outside the stored slice.
  const includeTargetSeparately = target !== null && targetIndex >= stored.length;

  const rows = stored.map((config) => toStoredConfigRow(runId, drawType, config));
  if (includeTargetSeparately && target) rows.push(toStoredConfigRow(runId, drawType, target));

  if (rows.length === 0) return null;

  try {
    const inserted = await db.insert(uk49sOptimizerConfigs).values(rows).returning({ id: uk49sOptimizerConfigs.id });

    if (!target) return null;
    const idIndex = includeTargetSeparately ? rows.length - 1 : targetIndex;
    return inserted[idIndex]?.id ?? null;
  } catch (error) {
    logger.error({ error, runId }, "Failed to store optimizer configuration results");
    throw error;
  }
}

async function finalizeSuccess(job: OptimizerJob, result: OptimizerResult): Promise<void> {
  const { evaluated, failedCount } = partitionResults(result);

  job.result = result;
  job.configsTested = evaluated.length;
  job.configsFailed = failedCount;
  job.best4HitRate = result.validationResult.totalPredictions > 0 ? result.validationResult.fourHitRate : null;
  job.bestAvgHits = result.validationResult.totalPredictions > 0 ? result.validationResult.avgMainHits : null;
  job.stoppedReason = result.stoppedReason;
  job.maxHits = result.maxHits;
  job.fourHitCount = result.fourHitResults.length;
  job.fourHitFound = result.fourHitResults.length > 0;

  const target = selectTargetConfiguration(result, job.minValidationSamples);
  job.fourHit = target?.fourHitExamples[0] ?? null;

  /**
   * No configuration produced a single validation prediction: the pipeline
   * never really ran. Reporting this as a completed run with 0.00 / 0% would be
   * a fabricated result, so the run is failed with an explicit reason.
   */
  if (evaluated.length === 0 || result.validationResult.totalPredictions === 0) {
    job.status = "failed";
    job.errorMessage =
      `No configuration could be evaluated: 0 validation predictions were produced for the window ` +
      `${job.validationStartDate} → ${job.validationEndDate}. The validation period contains no eligible draws ` +
      `or none has enough preceding history for a lookback window.`;
    job.finishedAt = Date.now();
    job.worker = null;
    await persistProgress(job, true);
    await markRunFailed(job.runId, job.errorMessage);
    return;
  }

  try {
    const targetConfigId = await storeConfigurationResults(job.runId, job.drawType, result, target);
    job.fourHitConfigId = targetConfigId;

    await db
      .update(uk49sOptimizerRuns)
      .set({
        status: "completed",
        configsTested: job.configsTested,
        configsFailed: job.configsFailed,
        currentIteration: job.currentIteration,
        best4HitRate: job.best4HitRate,
        bestAvgHits: job.bestAvgHits,
        validationDrawCount: job.validationDrawCount,
        stoppedReason: result.stoppedReason,
        maxHits: result.maxHits,
        fourHitFound: job.fourHitFound,
        fourHitCount: job.fourHitCount,
        fourHitConfigId: targetConfigId,
        fourHitDrawDate: job.fourHit?.validationDrawDate ?? null,
        fourHitPredictedMain: job.fourHit ? JSON.stringify(job.fourHit.predictedMain) : null,
        fourHitActualMain: job.fourHit ? JSON.stringify(job.fourHit.actualMain) : null,
        fourHitHits: job.fourHit?.mainHits ?? null,
        bestConfigId: targetConfigId,
        errorMessage: null,
        completedAt: new Date(),
        heartbeatAt: new Date(),
      })
      .where(eq(uk49sOptimizerRuns.id, job.runId));

    job.status = "completed";
    job.finishedAt = Date.now();
    job.worker = null;

    if (job.applyOnComplete && target && target.validationSampleSize >= job.minValidationSamples) {
      try {
        await updateActiveModel(
          job.drawType,
          target.weights,
          target.lookbackWindow,
          target.constraints,
          target.validation4HitRate,
          target.validationAvgHits,
          target.validationSampleSize,
        );
        logger.info(
          { runId: job.runId, drawType: job.drawType, fourHit: job.fourHitFound },
          "Applied optimizer configuration as active model",
        );
      } catch (error) {
        logger.error({ error, runId: job.runId }, "Failed to apply optimizer configuration");
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to store optimizer results";
    job.status = "failed";
    job.errorMessage = message;
    job.finishedAt = Date.now();
    job.worker = null;
    await markRunFailed(job.runId, message);
  }
}

export interface StartOptimizerJobParams {
  drawType: DrawType;
  draws: Uk49sDraw[];
  optimizerConfig: OptimizerConfig;
  validationDrawCount: number;
  autoWindow: boolean;
  /** Explicitly allow a second concurrent run for the same draw type. */
  allowDuplicate?: boolean;
  /**
   * Existing behaviour: when the request explicitly asks for it, the best
   * configuration is applied as the active model once the run completes. Never
   * applied automatically otherwise.
   */
  applyOnComplete?: boolean;
  /** Hard cap on configurations evaluated. */
  maxConfigurations?: number;
  /** Stop the search as soon as a valid 4-hit validation result is found. */
  stopOnFourHit?: boolean;
}

/**
 * Creates the run record and starts the optimizer worker.
 *
 * Throws OptimizerJobError(409) when an equivalent job is already queued or
 * running, so duplicate optimizer jobs cannot be started by accident.
 */
export async function startOptimizerJob(params: StartOptimizerJobParams): Promise<OptimizerJobPublicState> {
  const { drawType, draws, optimizerConfig, validationDrawCount, autoWindow } = params;
  const maxConfigurations = params.maxConfigurations && params.maxConfigurations > 0 ? params.maxConfigurations : null;
  const stopOnFourHit = params.stopOnFourHit === true;

  const inMemory = getActiveJobForDrawType(drawType);

  const runningRows = await db
    .select({ id: uk49sOptimizerRuns.id, status: uk49sOptimizerRuns.status })
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

  const searchCapacity = optimizerConfig.populationSize + optimizerConfig.eliteSize * 50;
  // Reported plan: the cap when one was requested, otherwise the search capacity.
  const totalConfigs = maxConfigurations ? Math.min(maxConfigurations, searchCapacity) : searchCapacity;

  const [run] = await db
    .insert(uk49sOptimizerRuns)
    .values({
      drawType,
      status: "queued",
      maxIterations: optimizerConfig.maxIterations,
      populationSize: optimizerConfig.populationSize,
      eliteSize: optimizerConfig.eliteSize,
      mutationRate: optimizerConfig.mutationRate,
      trainStartDate: optimizerConfig.trainStartDate || null,
      trainEndDate: optimizerConfig.trainEndDate || null,
      validationStartDate: optimizerConfig.validationStartDate,
      validationEndDate: optimizerConfig.validationEndDate,
      testStartDate: optimizerConfig.testStartDate ?? null,
      testEndDate: optimizerConfig.testEndDate ?? null,
      configsTested: 0,
      configsFailed: 0,
      totalConfigs,
      validationDrawCount,
      currentIteration: 0,
      autoWindow,
      maxConfigurations: maxConfigurations ?? null,
      stopOnFourHit,
      startedAt: new Date(),
      heartbeatAt: new Date(),
    })
    .returning();

  const job: OptimizerJob = {
    runId: run.id,
    drawType,
    status: "queued",
    startedAt: Date.now(),
    finishedAt: null,
    totalConfigs,
    configsTested: 0,
    configsFailed: 0,
    currentIteration: 0,
    phase: null,
    best4HitRate: null,
    bestAvgHits: null,
    bestScore: null,
    currentConfig: null,
    errorMessage: null,
    validationStartDate: optimizerConfig.validationStartDate,
    validationEndDate: optimizerConfig.validationEndDate,
    validationDrawCount,
    autoWindow,
    maxConfigurations,
    stopOnFourHit,
    stoppedReason: null,
    maxHits: 0,
    fourHitCount: 0,
    fourHitFound: false,
    fourHit: null,
    fourHitConfigId: null,
    result: null,
    evaluations: 0,
    worker: null,
    settled: false,
    cancelRequested: false,
    lastProgressAt: Date.now(),
    lastPersistAt: 0,
    applyOnComplete: params.applyOnComplete === true,
    minValidationSamples: optimizerConfig.minValidationSamples,
  };

  // Bound the in-memory registry; finished jobs are always recoverable from the
  // database, so only the oldest terminal entries are evicted.
  const finished = [...jobs.entries()].filter(
    ([, entry]) => entry.status !== "running" && entry.status !== "queued",
  );
  for (const [id] of finished.slice(0, Math.max(0, finished.length - 20))) {
    jobs.delete(id);
  }

  jobs.set(run.id, job);

  const searchOptions: OptimizerSearchOptions = {
    maxConfigurations: maxConfigurations ?? undefined,
    stopOnFourHit,
  };
  const workerData: OptimizerWorkerInput = { draws, optimizerConfig, searchOptions };

  let worker: Worker;
  try {
    worker = new Worker(WORKER_URL, { workerData });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start optimizer worker";
    await markRunFailed(run.id, message);
    throw new OptimizerJobError(message, 500, "optimizer_worker_start_failed");
  }

  job.worker = worker;
  job.status = "running";
  job.lastProgressAt = Date.now();
  await persistProgress(job, true);

  logger.info(
    {
      runId: run.id,
      drawType,
      populationSize: optimizerConfig.populationSize,
      eliteSize: optimizerConfig.eliteSize,
      validationStartDate: optimizerConfig.validationStartDate,
      validationEndDate: optimizerConfig.validationEndDate,
      validationDrawCount,
      totalConfigs,
      autoWindow,
    },
    "Optimizer job started",
  );

  worker.on("message", (message: OptimizerWorkerMessage) => {
    // Terminal messages are flagged synchronously so the worker's imminent
    // "exit" is not mistaken for a crash while the result is being stored.
    if (message.type === "done" || message.type === "error") {
      if (job.settled) return;
            job.settled = true;
          }
          void handleWorkerMessage(job, message).catch((error: unknown) => {
            logger.error({ error, runId: job.runId }, "Failed to process optimizer worker message");
            void markRunFailed(job.runId, "Failed to process the optimizer worker result");
          });
        });

  worker.on("error", (error: Error) => {
    logger.error({ error, runId: job.runId }, "Optimizer worker error");
    void markRunFailed(job.runId, `Optimizer worker error: ${error.message}`);
  });

  worker.on("exit", (code) => {
    // A reported result or an explicit cancellation is not a crash.
    if (job.settled) return;

    if (job.status !== "queued" && job.status !== "running") return;

    const message = job.cancelRequested
      ? "Optimizer run cancelled"
      : `Optimizer worker exited unexpectedly (code ${code}) before reporting a result`;

    if (job.cancelRequested) {
      job.status = "cancelled";
      job.finishedAt = Date.now();
      job.errorMessage = message;
      job.worker = null;
      void db
        .update(uk49sOptimizerRuns)
        .set({ status: "cancelled", errorMessage: message, completedAt: new Date(), heartbeatAt: new Date() })
        .where(eq(uk49sOptimizerRuns.id, job.runId))
        .catch((error: unknown) => logger.error({ error, runId: job.runId }, "Failed to persist cancellation"));
    } else {
      void markRunFailed(job.runId, message);
    }
  });

  return toPublic(job);
}

async function handleWorkerMessage(job: OptimizerJob, message: OptimizerWorkerMessage): Promise<void> {
  if (job.cancelRequested && job.status !== "cancelled") {
    return;
  }

  switch (message.type) {
    case "progress": {
      job.status = "running";
      job.currentIteration = message.iteration;
      job.phase = message.phase;
      job.bestScore = message.bestScore;
      job.best4HitRate = message.best4HitRate;
      job.bestAvgHits = message.bestAvgHits;
      job.maxHits = message.maxHits;
      job.fourHitCount = message.fourHitCount;
      job.fourHitFound = message.fourHitFound;
      job.currentConfig = {
        lookbackWindow: message.currentLookbackWindow,
        weights: message.currentWeights,
        constraints: message.currentConstraints,
      };
      // Progress is a real count of configurations that have been evaluated —
      // incremented only for evaluations the worker actually completed.
      job.evaluations += 1;
      job.configsTested = job.evaluations;
      job.lastProgressAt = Date.now();
            await persistProgress(job);
            break;
    }
    case "done": {
      await finalizeSuccess(job, message.result);
      logger.info(
        {
          runId: job.runId,
          configsTested: job.configsTested,
          configsFailed: job.configsFailed,
          best4HitRate: job.best4HitRate,
          bestAvgHits: job.bestAvgHits,
        },
        "Optimizer job finished",
      );
      break;
    }
    case "error": {
      await markRunFailed(job.runId, message.message);
      break;
    }
    default:
      break;
  }
}

/** Requests cancellation; the worker is terminated and the run marked cancelled. */
export async function cancelOptimizerJob(runId: number): Promise<OptimizerJobPublicState> {
  const job = jobs.get(runId);

  if (!job) {
    const rows = await db.select().from(uk49sOptimizerRuns).where(eq(uk49sOptimizerRuns.id, runId)).limit(1);
    if (rows.length === 0) {
      throw new OptimizerJobError(`Optimizer run #${runId} was not found`, 404, "optimizer_job_not_found");
    }
    if (rows[0].status === "queued" || rows[0].status === "running") {
      await markRunFailed(runId, "Cancelled by administrator (interrupted run recovered)");
      return rebuildStateFromRow(runId);
    }
    throw new OptimizerJobError(
      `Optimizer run #${runId} is already ${rows[0].status} and cannot be cancelled`,
      409,
      "optimizer_job_not_cancellable",
    );
  }

  if (job.status !== "queued" && job.status !== "running") {
    throw new OptimizerJobError(
      `Optimizer run #${runId} is already ${job.status} and cannot be cancelled`,
      409,
      "optimizer_job_not_cancellable",
    );
  }

  job.cancelRequested = true;
  job.status = "cancelled";
  job.finishedAt = Date.now();
  job.errorMessage = "Optimizer run cancelled by administrator";

  if (job.worker) {
    try {
      await job.worker.terminate();
    } catch (error) {
      logger.warn({ error, runId }, "Failed to terminate optimizer worker");
    }
    job.worker = null;
  }

  await db
    .update(uk49sOptimizerRuns)
    .set({
      status: "cancelled",
      errorMessage: job.errorMessage,
      completedAt: new Date(),
      heartbeatAt: new Date(),
      configsTested: job.configsTested,
      configsFailed: job.configsFailed,
    })
    .where(eq(uk49sOptimizerRuns.id, runId));

  logger.info({ runId, configsTested: job.configsTested }, "Optimizer job cancelled");

  return toPublic(job);
}

async function rebuildStateFromRow(runId: number): Promise<OptimizerJobPublicState> {
  const rows = await db.select().from(uk49sOptimizerRuns).where(eq(uk49sOptimizerRuns.id, runId)).limit(1);
  const row = rows[0];

  return {
    runId,
    drawType: row.drawType,
    status: row.status as OptimizerJobStatus,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.completedAt ? row.completedAt.toISOString() : null,
    elapsedMs: (row.completedAt ?? new Date()).getTime() - row.startedAt.getTime(),
    totalConfigs: row.totalConfigs ?? 0,
    configsTested: row.configsTested,
    configsFailed: row.configsFailed,
    currentIteration: row.currentIteration,
    phase: null,
    best4HitRate: row.best4HitRate,
    bestAvgHits: row.bestAvgHits,
    bestScore: null,
    currentConfig: null,
    errorMessage: row.errorMessage,
    validationStartDate: row.validationStartDate,
    validationEndDate: row.validationEndDate,
    validationDrawCount: row.validationDrawCount,
    autoWindow: row.autoWindow,
    hasResult: false,
    maxConfigurations: row.maxConfigurations,
    stopOnFourHit: row.stopOnFourHit,
    stoppedReason: (row.stoppedReason as OptimizerStopReason | null) ?? null,
    maxHits: row.maxHits ?? 0,
    fourHitCount: row.fourHitCount,
    fourHitFound: row.fourHitFound,
    fourHit:
      row.fourHitDrawDate && row.fourHitPredictedMain && row.fourHitActualMain
        ? {
            validationDrawDate: row.fourHitDrawDate,
            trainingCutoff: "",
            predictedMain: JSON.parse(row.fourHitPredictedMain) as number[],
            predictedBooster: 0,
            actualMain: JSON.parse(row.fourHitActualMain) as number[],
            actualBooster: 0,
            mainHits: row.fourHitHits ?? 4,
          }
        : null,
    fourHitConfigId: row.fourHitConfigId,
  };
}

/**
 * Failure/restart recovery: any run left in queued/running with no live worker
 * is marked failed. Called once at boot and periodically thereafter so a
 * crashed, timed-out or restarted process can never leave a job permanently
 * "running".
 */
export async function recoverInterruptedJobs(reason: string): Promise<number> {
  let stale: { id: number }[];
  try {
    stale = await db
      .select({ id: uk49sOptimizerRuns.id })
      .from(uk49sOptimizerRuns)
      .where(inArray(uk49sOptimizerRuns.status, ["queued", "running"]));
  } catch (error) {
    // Recovery is best-effort. A transient database failure must not propagate:
    // the periodic sweep calls this every few minutes and will retry.
    logger.error({ error }, "Failed to list interrupted optimizer runs for recovery");
    return 0;
  }

  let recovered = 0;

  for (const row of stale) {
    const job = jobs.get(row.id);
    if (job && (job.status === "queued" || job.status === "running")) {
      // A result is already being stored — do not interfere.
      if (job.settled) continue;
      // A live, healthy worker keeps the job alive.
      if (job.worker && Date.now() - job.lastProgressAt < JOB_STALL_TIMEOUT_MS) continue;
      if (job.worker) {
        try {
          await job.worker.terminate();
        } catch {
          // Ignore — terminating an already-dead worker is harmless.
        }
      }
    }

    await markRunFailed(row.id, reason);
    recovered += 1;
  }

  if (recovered > 0) {
    logger.warn({ recovered, reason }, "Recovered optimizer runs left in a non-terminal state");
  }

  return recovered;
}

/** Stops every worker so a clean shutdown does not leave orphan threads. */
export async function shutdownOptimizerJobs(): Promise<void> {
  for (const job of jobs.values()) {
    if (job.worker) {
      try {
        await job.worker.terminate();
      } catch {
        // Ignore.
      }
      job.worker = null;
    }
  }
}