/**
 * UK49s Optimizer API Routes
 *
 * The optimizer is the walk-forward tuner from the single app engine
 * (`base44-engine.ts`): it scores all 392 candidate weight sets over past draws
 * and locks the champion (most 3+ match lines; target ≥ 4 such draws).
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { uk49sDraws, uk49sOptimizerRuns, type DrawType } from "@workspace/db/schema";
import {
  DEFAULT_TARGET,
  buildGrid,
} from "@workspace/db/schema";
import {
  OptimizerPreflightError,
  assertPreflight,
  resolveValidationWindow,
  runPipelineDiagnostic,
  runPreflightChecks,
} from "../lib/optimizer-window";
import {
  OptimizerJobError,
  cancelOptimizerJob,
  getActiveJobForDrawType,
  getJobState,
  startOptimizerJob,
} from "../lib/optimizer-jobs";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "../lib/admin-auth";

const router: IRouter = Router();
const TOTAL_CANDIDATES = buildGrid().length;

function parseDrawType(value: unknown): DrawType | null {
  return value === "lunchtime" || value === "teatime" ? value : null;
}

function asyncHandler(fn: (req: any, res: any) => Promise<void>) {
  return (req: any, res: any, next: any) => {
    fn(req, res).catch(next);
  };
}

async function loadDrawsForType(drawType: DrawType) {
  return db.select().from(uk49sDraws).where(eq(uk49sDraws.drawType, drawType)).orderBy(uk49sDraws.drawDate);
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

      res.json({
        success: true,
        drawType,
        ready: checks.every((check) => !check.critical || check.ok),
        window,
        checks,
        candidates: TOTAL_CANDIDATES,
        target: DEFAULT_TARGET,
        activeJob: getActiveJobForDrawType(drawType),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preflight failed";
      logger.error({ error, drawType }, "Optimizer preflight failed");
      res.status(400).json({ success: false, error: message });
    }
  }),
);

/** Starts a walk-forward tuning run. */
router.post(
  "/run",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const drawType = parseDrawType(req.body?.drawType);
    if (!drawType) {
      res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
      return;
    }

    const requestedTests = Number(req.body?.maxTests);
    const maxTests = Number.isFinite(requestedTests) && requestedTests > 0 ? Math.floor(requestedTests) : undefined;

    try {
      const draws = await loadDrawsForType(drawType);
      const window = resolveValidationWindow(draws, drawType);
      assertPreflight(runPreflightChecks(draws, drawType, window));

      const state = await startOptimizerJob({
        drawType,
        draws,
        maxTests,
        autoWindow: true,
        allowDuplicate: req.body?.allowDuplicate === true,
      });

      res.status(202).json({ success: true, runId: state.runId, window, job: state });
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

/** The currently running job for a draw type, if any. */
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
        candidatesTested: row.configsTested,
        candidatesTotal: TOTAL_CANDIDATES,
        threePlusCount: row.fourHitCount,
        avgHitsPerLine: row.bestAvgHits,
        targetMet: row.fourHitFound,
        weights: null,
        errorMessage: row.errorMessage,
        hasResult: false,
      },
    });
  }),
);

/** Cancels a running job. */
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

/** Small-sample diagnostic run that proves the pipeline is wired up. */
router.post(
  "/diagnose",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const drawType = parseDrawType(req.body?.drawType);
    if (!drawType) {
      res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
      return;
    }

    try {
      const draws = await loadDrawsForType(drawType);
      const window = resolveValidationWindow(draws, drawType);
      const report = await runPipelineDiagnostic(draws, drawType, window, Number(req.body?.sampleSize) || 10);

      res.json({
        success: true,
        drawType,
        report,
        warning: "Diagnostic results verify the evaluation pipeline only. The engine was not modified.",
      });
    } catch (error) {
      logger.error({ error, drawType }, "Optimizer pipeline diagnostic failed");
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Diagnostic failed" });
    }
  }),
);

/** Get optimization history. */
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
      target: DEFAULT_TARGET,
      candidates: TOTAL_CANDIDATES,
      optimizationRuns: runs.map((run) => ({
        id: run.id,
        drawType: run.drawType,
        status: run.status,
        candidatesTested: run.configsTested,
        candidatesTotal: TOTAL_CANDIDATES,
        threePlusCount: run.fourHitCount,
        targetMet: run.fourHitFound,
        avgHitsPerLine: run.bestAvgHits,
        maxHits: run.maxHits,
        stoppedReason: run.stoppedReason,
        validationPeriod: { startDate: run.validationStartDate, endDate: run.validationEndDate },
        errorMessage: run.errorMessage,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      })),
    });
  }),
);

export default router;
