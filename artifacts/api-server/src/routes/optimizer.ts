/**
 * UK49s Optimizer API Routes
 *
 * The optimizer evaluates configurations against the EXISTING predictor
 * (Random Search + Hill Climbing, unchanged). This route layer only handles the
 * workflow around it: automatic validation-window selection, preflight checks,
 * background job management, progress reporting and pipeline diagnostics.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { uk49sDraws, uk49sOptimizerRuns, uk49sOptimizerConfigs, type DrawType } from "@workspace/db/schema";
import {
  crossValidateModel,
  calculateStabilityMetrics,
  type CrossValidationResult,
} from "@workspace/db/schema";
import { DEFAULT_WEIGHTS, type OptimizerConfig } from "@workspace/db/schema";
import { updateActiveModel } from "../lib/prediction-service";
import {
  MIN_VALIDATION_DRAWS,
  OptimizerPreflightError,
  assertPreflight,
  resolveValidationWindow,
  runPipelineDiagnostic,
  runPreflightChecks,
  sortDrawsForType,
  type ValidationWindow,
} from "../lib/optimizer-window";
import {
  OptimizerJobError,
  cancelOptimizerJob,
  getActiveJobForDrawType,
  getJobState,
  startOptimizerJob,
} from "../lib/optimizer-jobs";
import { eq, desc, and, gt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "../lib/admin-auth";

const router: IRouter = Router();

function parseDrawType(value: unknown): DrawType | null {
  return value === "lunchtime" || value === "teatime" ? value : null;
}

function asyncHandler(fn: (req: any, res: any) => Promise<void>) {
  return (req: any, res: any, next: any) => {
    fn(req, res).catch(next);
  };
}

async function loadDrawsForType(drawType: DrawType) {
  return db
    .select()
    .from(uk49sDraws)
    .where(eq(uk49sDraws.drawType, drawType))
    .orderBy(uk49sDraws.drawDate);
}

/**
 * Builds a validation window from administrator-supplied dates. The dates must
 * still describe a usable, leakage-free period — an invalid custom window is
 * rejected with an explanation instead of silently producing zeros.
 */
function windowFromExplicitDates(
  draws: Parameters<typeof resolveValidationWindow>[0],
  drawType: DrawType,
  startDate: string,
  endDate: string,
): ValidationWindow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new OptimizerJobError("validationStartDate and validationEndDate must be YYYY-MM-DD", 400, "invalid_dates");
  }
  if (endDate <= startDate) {
    throw new OptimizerJobError("validationEndDate must be after validationStartDate", 400, "invalid_dates");
  }

  const series = sortDrawsForType(draws, drawType);
  if (series.length < 2) {
    throw new OptimizerJobError(`Not enough ${drawType} draws to validate a window`, 400, "insufficient_data");
  }

  const latestDrawDate = series[series.length - 1].drawDate;
  if (endDate >= latestDrawDate) {
    throw new OptimizerJobError(
      `The validation period must end before the latest ${drawType} draw (${latestDrawDate}) — that draw is the current prediction reference and cannot be part of its own evaluation.`,
      400,
      "future_leakage",
    );
  }

  const inWindow = series.filter((draw) => draw.drawDate >= startDate && draw.drawDate <= endDate);
  if (inWindow.length < MIN_VALIDATION_DRAWS) {
    throw new OptimizerJobError(
      `The selected validation period contains only ${inWindow.length} ${drawType} draws (minimum ${MIN_VALIDATION_DRAWS}). Widen the period or use automatic selection.`,
      400,
      "window_too_small",
    );
  }

  const startIdx = series.findIndex((draw) => draw.drawDate >= startDate);

  return {
    drawType,
    earliestDrawDate: series[0].drawDate,
    latestDrawDate,
    referenceDrawDate: latestDrawDate,
    totalDraws: series.length,
    trainingDrawsBeforeWindow: startIdx,
    validationStartDate: inWindow[0].drawDate,
    validationEndDate: inWindow[inWindow.length - 1].drawDate,
    validationDrawCount: inWindow.length,
    monthsCovered:
      Math.round(
        ((Date.parse(`${inWindow[inWindow.length - 1].drawDate}T00:00:00Z`) -
          Date.parse(`${inWindow[0].drawDate}T00:00:00Z`)) /
          86_400_000 /
          30.4375) *
          10,
      ) / 10,
    usedLargestAvailableWindow: false,
  };
}

/** Preflight: automatic validation window plus every data check. */
router.get(
  "/preflight/:drawType",
  asyncHandler(async (req, res) => {
    const drawType = parseDrawType(req.params.drawType);
    if (!drawType) {
      res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
      return;
    }

    try {
      const draws = await loadDrawsForType(drawType);
      const window = resolveValidationWindow(draws, drawType);
      const checks = runPreflightChecks(draws, drawType, window);
      const activeJob = getActiveJobForDrawType(drawType);

      res.json({
        success: true,
        drawType,
        ready: checks.every((check) => !check.critical || check.ok),
        window,
        checks,
        activeJob,
        modelLabel: `${drawType === "lunchtime" ? "Lunchtime" : "Teatime"} model`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preflight failed";
      logger.error({ error, drawType }, "Optimizer preflight failed");
      res.status(400).json({ success: false, error: message });
    }
  }),
);

/**
 * Starts an optimization run. The validation window is derived automatically
 * from the stored history unless explicit dates are supplied.
 */
router.post(
  "/run",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const {
      drawType: rawDrawType,
      maxIterations = 1000,
      populationSize = 100,
      eliteSize = 10,
      mutationRate = 0.1,
      validationStartDate,
      validationEndDate,
      testStartDate,
      testEndDate,
      minValidationSamples = 50,
      randomSeed,
      applyToModel = false,
      allowDuplicate = false,
      customWindow = false,
    } = req.body ?? {};

    const drawType = parseDrawType(rawDrawType);
    if (!drawType) {
      res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
      return;
    }

    try {
      const draws = await loadDrawsForType(drawType);

      const useCustom = customWindow === true && validationStartDate && validationEndDate;
      const window = useCustom
        ? windowFromExplicitDates(draws, drawType, String(validationStartDate), String(validationEndDate))
        : resolveValidationWindow(draws, drawType);

      const checks = runPreflightChecks(draws, drawType, window);
      assertPreflight(checks);

      // Section 3 diagnostics — logged before the search starts.
      const series = sortDrawsForType(draws, drawType);
      const firstValidationDraw = series.find((draw) => draw.drawDate === window.validationStartDate);
      const trainingBeforeFirst = firstValidationDraw
        ? series.filter((draw) => draw.drawDate < firstValidationDraw.drawDate).length
        : 0;

      logger.info(
        {
          drawType,
          validationDrawCount: window.validationDrawCount,
          validationStartDate: window.validationStartDate,
          validationEndDate: window.validationEndDate,
          latestDrawDate: window.latestDrawDate,
          totalHistoricalDraws: series.length,
          trainingDrawsBeforeFirstValidationDraw: trainingBeforeFirst,
          autoWindow: !useCustom,
        },
        "Optimizer validation window resolved",
      );

      const optimizerConfig: OptimizerConfig = {
        drawType,
        maxIterations,
        populationSize,
        eliteSize,
        mutationRate,
        trainStartDate: "",
        trainEndDate: "",
        validationStartDate: window.validationStartDate,
        validationEndDate: window.validationEndDate,
        testStartDate,
        testEndDate,
        minValidationSamples,
        randomSeed,
      };

      const state = await startOptimizerJob({
        drawType,
        draws,
        optimizerConfig,
        validationDrawCount: window.validationDrawCount,
        autoWindow: !useCustom,
        allowDuplicate: allowDuplicate === true,
        applyOnComplete: applyToModel === true,
      });

      res.status(202).json({
        success: true,
        runId: state.runId,
        window,
        checks,
        job: state,
      });
    } catch (error) {
      if (error instanceof OptimizerJobError) {
        res.status(error.statusCode).json({ success: false, code: error.code, error: error.message });
        return;
      }
      if (error instanceof OptimizerPreflightError) {
        res.status(400).json({ success: false, code: "preflight_failed", error: error.message, checks: error.checks });
        return;
      }
      logger.error({ error, drawType }, "Failed to start optimization run");
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Optimization failed" });
    }
  }),
);

/** The currently queued/running job for a draw type, if any. */
router.get("/active/:drawType", (req, res) => {
  const drawType = parseDrawType(req.params.drawType);
  if (!drawType) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  res.json({ success: true, drawType, job: getActiveJobForDrawType(drawType) });
});

/** Live progress for a run (in-memory when live, database row otherwise). */
router.get(
  "/status/:runId",
  asyncHandler(async (req, res) => {
    const runId = Number.parseInt(req.params.runId, 10);
    if (!Number.isInteger(runId)) {
      res.status(400).json({ error: "runId must be an integer" });
      return;
    }

    const live = getJobState(runId);
    if (live) {
      res.json({ success: true, source: "live", job: live });
      return;
    }

    const rows = await db.select().from(uk49sOptimizerRuns).where(eq(uk49sOptimizerRuns.id, runId)).limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: "Optimization run not found" });
      return;
    }

    const row = rows[0];
    res.json({
      success: true,
      source: "database",
      job: {
        runId: row.id,
        drawType: row.drawType,
        status: row.status,
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
      },
    });
  }),
);

/** Cancels a queued/running job; the run becomes "cancelled". */
router.post(
  "/cancel/:runId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const runId = Number.parseInt(req.params.runId, 10);
    if (!Number.isInteger(runId)) {
      res.status(400).json({ error: "runId must be an integer" });
      return;
    }

    try {
      const job = await cancelOptimizerJob(runId);
      res.json({ success: true, job });
    } catch (error) {
      if (error instanceof OptimizerJobError) {
        res.status(error.statusCode).json({ success: false, code: error.code, error: error.message });
        return;
      }
      logger.error({ error, runId }, "Failed to cancel optimization run");
      res.status(500).json({ success: false, error: "Failed to cancel optimization run" });
    }
  }),
);

/**
 * Explicit administrator action: apply a successfully evaluated run's best
 * configuration as the active model. Every precondition is verified first.
 */
router.post(
  "/apply/:runId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const runId = Number.parseInt(req.params.runId, 10);
    if (!Number.isInteger(runId)) {
      res.status(400).json({ error: "runId must be an integer" });
      return;
    }

    try {
      const rows = await db.select().from(uk49sOptimizerRuns).where(eq(uk49sOptimizerRuns.id, runId)).limit(1);
      if (rows.length === 0) {
        res.status(404).json({ success: false, error: `Optimizer run #${runId} was not found` });
        return;
      }

      const run = rows[0];
      if (run.status !== "completed") {
        res.status(409).json({
          success: false,
          error: `Optimizer run #${runId} is ${run.status}, not completed. Only a successfully completed run can be applied.`,
        });
        return;
      }

      const bestConfigs = await db
        .select()
        .from(uk49sOptimizerConfigs)
        .where(
          and(
            eq(uk49sOptimizerConfigs.runId, runId),
            eq(uk49sOptimizerConfigs.drawType, run.drawType),
            gt(uk49sOptimizerConfigs.validationSampleSize, 0),
          ),
        )
        .orderBy(desc(uk49sOptimizerConfigs.validation4HitRate), desc(uk49sOptimizerConfigs.validationSampleSize))
        .limit(1);

      const best = bestConfigs[0];
      if (!best) {
        res.status(409).json({
          success: false,
          error: `Run #${runId} has no successfully evaluated configuration for ${run.drawType}, so nothing can be applied.`,
        });
        return;
      }

      const modelId = await updateActiveModel(
        run.drawType,
        {
          weightFrequency: best.weightFrequency,
          weightRecency: best.weightRecency,
          weightHotCold: best.weightHotCold,
          weightGapAnalysis: best.weightGapAnalysis,
          weightPairs: best.weightPairs,
          weightTriples: best.weightTriples,
          weightConsecutive: best.weightConsecutive,
          weightOddEven: best.weightOddEven,
          weightLowHigh: best.weightLowHigh,
          weightSumRange: best.weightSumRange,
          weightPositional: best.weightPositional,
          weightRepeat: best.weightRepeat,
          weightFirst3Minus2: best.weightFirst3Minus2,
        },
        best.lookbackWindow,
        {
          enforceDiversity: best.enforceDiversity,
          minNumberSpread: best.minNumberSpread,
          maxSameGroup: best.maxSameGroup,
        },
        best.validation4HitRate ?? 0,
        best.validationAvgHits ?? 0,
        best.validationSampleSize ?? 0,
      );

      await db
        .update(uk49sOptimizerRuns)
        .set({ bestConfigId: best.id })
        .where(eq(uk49sOptimizerRuns.id, runId));

      logger.info({ runId, drawType: run.drawType, configId: best.id, modelId }, "Applied optimizer configuration as active model");

      res.json({
        success: true,
        runId,
        drawType: run.drawType,
        configId: best.id,
        newModelId: modelId,
        metrics: {
          fourHitRate: best.validation4HitRate,
          avgHits: best.validationAvgHits,
          sampleSize: best.validationSampleSize,
        },
        warning:
          "The applied configuration performed best on historical validation data. The prediction algorithm is unchanged and future outcomes remain random.",
      });
    } catch (error) {
      logger.error({ error, runId }, "Failed to apply optimizer configuration");
      res.status(500).json({ success: false, error: "Failed to apply optimizer configuration" });
    }
  }),
);

/**
 * Small-sample diagnostic run of the full pipeline. Proves that
 * history → existing predictor → prediction → actual draw → existing scoring
 * works before hundreds of configurations are evaluated.
 */
router.post(
  "/diagnose",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { drawType: rawDrawType, sampleSize = 10, customWindow = false, validationStartDate, validationEndDate } =
      req.body ?? {};

    const drawType = parseDrawType(rawDrawType);
    if (!drawType) {
      res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
      return;
    }

    try {
      const draws = await loadDrawsForType(drawType);
      const useCustom = customWindow === true && validationStartDate && validationEndDate;
      const window = useCustom
        ? windowFromExplicitDates(draws, drawType, String(validationStartDate), String(validationEndDate))
        : resolveValidationWindow(draws, drawType);

      const report = runPipelineDiagnostic(draws, drawType, window, Number(sampleSize) || 10);

      logger.info(
        {
          drawType,
          validationDrawCount: report.validationDrawCount,
          predictionsGenerated: report.predictionsGenerated,
          predictionsFailed: report.predictionsFailed,
          avgHits: report.avgHits,
          fourHitRate: report.fourHitRate,
          structureIssues: report.structureIssues.length,
          firstRow: report.rows[0]
            ? {
                date: report.rows[0].validationDrawDate,
                trainingDrawCount: report.rows[0].trainingDrawCount,
                predictedMain: report.rows[0].predictedMain,
                actualMain: report.rows[0].actualMain,
                mainHits: report.rows[0].mainHits,
              }
            : null,
        },
        "Optimizer pipeline diagnostic complete",
      );

      res.json({
        success: true,
        drawType,
        report,
        warning:
          "Diagnostic results verify the evaluation pipeline only. The prediction algorithm was not modified.",
      });
    } catch (error) {
      if (error instanceof OptimizerJobError) {
        res.status(error.statusCode).json({ success: false, code: error.code, error: error.message });
        return;
      }
      logger.error({ error, drawType }, "Optimizer pipeline diagnostic failed");
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Diagnostic failed" });
    }
  }),
);

// Cross-validation for stability (unchanged methodology)
router.post(
  "/cross-validate",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { drawType: rawDrawType, weights, lookbackWindow = 90, nFolds = 5 } = req.body ?? {};

    const drawType = parseDrawType(rawDrawType);
    if (!drawType) {
      res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
      return;
    }

    const draws = await loadDrawsForType(drawType);

    if (draws.length < lookbackWindow * nFolds * 2) {
      res.status(400).json({
        error: `Not enough data for ${nFolds}-fold cross-validation. Need ${lookbackWindow * nFolds * 2} draws, have ${draws.length}`,
      });
      return;
    }

    const cvResults: CrossValidationResult[] = crossValidateModel(
      draws,
      drawType,
      weights || DEFAULT_WEIGHTS,
      lookbackWindow,
      nFolds,
    );
    const stability = calculateStabilityMetrics(cvResults);

    res.json({
      success: true,
      crossValidation: { folds: cvResults, stabilityMetrics: stability },
      warning:
        "Cross-validation tests model stability across different time periods. Consistent performance across folds indicates a more robust model.",
    });
  }),
);

// Get optimization history
router.get(
  "/history/:drawType",
  asyncHandler(async (req, res) => {
    const drawType = parseDrawType(req.params.drawType);
    if (!drawType) {
      res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
      return;
    }

    const limit = Math.min(Number.parseInt(String(req.query.limit || "20"), 10) || 20, 100);

    const runs = await db
      .select()
      .from(uk49sOptimizerRuns)
      .where(eq(uk49sOptimizerRuns.drawType, drawType))
      .orderBy(desc(uk49sOptimizerRuns.startedAt))
      .limit(limit);

    res.json({
      success: true,
      drawType,
      count: runs.length,
      optimizationRuns: runs.map((run) => ({
        id: run.id,
        drawType: run.drawType,
        status: run.status,
        configsTested: run.configsTested,
        configsFailed: run.configsFailed,
        totalConfigs: run.totalConfigs,
        validationDrawCount: run.validationDrawCount,
        autoWindow: run.autoWindow,
        errorMessage: run.errorMessage,
        validationPeriod: { startDate: run.validationStartDate, endDate: run.validationEndDate },
        bestMetrics: { fourHitRate: run.best4HitRate, avgHits: run.bestAvgHits },
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      })),
    });
  }),
);

// Get optimization run details
router.get(
  "/run/:runId",
  asyncHandler(async (req, res) => {
    const runId = Number.parseInt(req.params.runId, 10);
    if (!Number.isInteger(runId)) {
      res.status(400).json({ error: "runId must be an integer" });
      return;
    }

    const runs = await db.select().from(uk49sOptimizerRuns).where(eq(uk49sOptimizerRuns.id, runId)).limit(1);
    if (runs.length === 0) {
      res.status(404).json({ error: "Optimization run not found" });
      return;
    }

    const run = runs[0];
    const live = getJobState(runId, true);

    const configs = await db
      .select()
      .from(uk49sOptimizerConfigs)
      .where(eq(uk49sOptimizerConfigs.runId, runId))
      .orderBy(desc(uk49sOptimizerConfigs.validation4HitRate))
      .limit(100);

    res.json({
      success: true,
      run: {
        id: run.id,
        drawType: run.drawType,
        status: run.status,
        configsTested: run.configsTested,
        configsFailed: run.configsFailed,
        totalConfigs: run.totalConfigs,
        validationDrawCount: run.validationDrawCount,
        autoWindow: run.autoWindow,
        errorMessage: run.errorMessage,
        parameters: {
          maxIterations: run.maxIterations,
          populationSize: run.populationSize,
          eliteSize: run.eliteSize,
          mutationRate: run.mutationRate,
        },
        periods: {
          validation: { startDate: run.validationStartDate, endDate: run.validationEndDate },
          test: run.testStartDate ? { startDate: run.testStartDate, endDate: run.testEndDate } : null,
        },
        bestMetrics: { fourHitRate: run.best4HitRate, avgHits: run.bestAvgHits },
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      },
      liveProgress: live ?? null,
      topConfigurations: configs.map((config) => ({
        weights: {
          weightFrequency: config.weightFrequency,
          weightRecency: config.weightRecency,
          weightHotCold: config.weightHotCold,
          weightGapAnalysis: config.weightGapAnalysis,
          weightPairs: config.weightPairs,
          weightTriples: config.weightTriples,
          weightConsecutive: config.weightConsecutive,
          weightOddEven: config.weightOddEven,
          weightLowHigh: config.weightLowHigh,
          weightSumRange: config.weightSumRange,
          weightPositional: config.weightPositional,
          weightRepeat: config.weightRepeat,
          weightFirst3Minus2: config.weightFirst3Minus2,
        },
        lookbackWindow: config.lookbackWindow,
        constraints: {
          enforceDiversity: config.enforceDiversity,
          minNumberSpread: config.minNumberSpread,
          maxSameGroup: config.maxSameGroup,
        },
        metrics: {
          fourHitRate: config.validation4HitRate,
          avgHits: config.validationAvgHits,
          sampleSize: config.validationSampleSize,
          boosterHitRate: config.validationBoosterHitRate,
          stabilityScore: config.stabilityScore,
        },
      })),
    });
  }),
);

export default router;