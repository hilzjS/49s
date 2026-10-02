/**
 * UK49s SuperHybrid API Routes
 *
 * SuperHybrid is a separate, selectable cross-session strategy (see
 * `lib/db/src/schema/superhybrid-engine.ts`). These endpoints expose its
 * configuration, a live cross-session prediction (with its source draw) and a
 * cross-session walk-forward backtest. Nothing here reads or writes the active
 * model or the existing backtest results.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  uk49sDraws,
  DEFAULT_SUPERHYBRID_WEIGHTS,
  SUPERHYBRID_WEIGHT_ORDER,
  runSuperHybridBacktestAsync,
  type DrawType,
  type SuperHybridWeights,
} from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { requireAdmin } from "../lib/admin-auth";
import { getSuperHybridConfig, getSuperHybridLivePrediction } from "../lib/superhybrid-service";

const router: IRouter = Router();

function parseDrawType(value: unknown): DrawType | null {
  return value === "lunchtime" || value === "teatime" ? value : null;
}

function resolveWeights(input: unknown): SuperHybridWeights {
  const source = (input ?? {}) as Partial<Record<keyof SuperHybridWeights, unknown>>;
  const weights = { ...DEFAULT_SUPERHYBRID_WEIGHTS };
  for (const key of SUPERHYBRID_WEIGHT_ORDER) {
    const value = source[key];
    if (value !== undefined && Number.isFinite(Number(value))) weights[key] = Number(value);
  }
  return weights;
}

// SuperHybrid configuration (own version + weights; never auto-optimised)
router.get("/config/:drawType", async (req: Request, res: Response) => {
  const drawType = parseDrawType(req.params.drawType);
  if (!drawType) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  try {
    const config = await getSuperHybridConfig(drawType);
    res.json({ success: true, config });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get SuperHybrid config");
    res.status(500).json({ success: false, error: "Failed to get SuperHybrid config" });
  }
});

// Live cross-session prediction: latest opposite-session draw → next target draw
router.get("/prediction/:drawType", async (req: Request, res: Response) => {
  const drawType = parseDrawType(req.params.drawType);
  if (!drawType) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  try {
    const result = await getSuperHybridLivePrediction(drawType);
    if (!result.ok) {
      // A clear "no source / not enough history" state — not an error.
      res.json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, prediction: result.prediction });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to build SuperHybrid prediction");
    res.status(500).json({ success: false, error: "Failed to build SuperHybrid prediction" });
  }
});

// Cross-session walk-forward backtest (admin). Baselines share the same sample.
router.post("/backtest", requireAdmin, async (req: Request, res: Response) => {
  const drawType = req.body?.drawType == null ? null : parseDrawType(req.body.drawType);
  if (req.body?.drawType != null && !drawType) {
    res.status(400).json({ error: "drawType must be 'lunchtime', 'teatime' or omitted" });
    return;
  }

  const startDate = typeof req.body?.startDate === "string" ? req.body.startDate : undefined;
  const endDate = typeof req.body?.endDate === "string" ? req.body.endDate : undefined;
  const maxTests = Number(req.body?.maxTests) > 0 ? Math.min(Number(req.body.maxTests), 2000) : undefined;

  try {
    const draws = await db.select().from(uk49sDraws);
    if (draws.length === 0) {
      res.status(400).json({ error: "No draws are recorded yet." });
      return;
    }

    const report = await runSuperHybridBacktestAsync(draws, {
      weights: resolveWeights(req.body?.weights),
      only: drawType,
      startDate,
      endDate,
      maxTests,
    });

    if (report.testedDraws === 0) {
      res.status(400).json({
        error:
          "No draws could be resolved for this window (each target needs at least 20 earlier draws and a valid opposite-session source).",
      });
      return;
    }

    const config = await getSuperHybridConfig(drawType ?? "lunchtime");

    res.json({
      success: true,
      model: {
        strategy: report.strategy,
        version: config.version,
        modelConfigId: config.id,
        lookback: config.lookback,
        targetSession: drawType ?? "both",
        sourceSession: drawType ? (drawType === "lunchtime" ? "teatime" : "lunchtime") : "opposite",
      },
      // Keep the payload bounded — every metric above is already aggregated, and
      // the UI only shows the most recent rows.
      report: { ...report, runs: report.runs.slice(-200) },
      warning:
        "SuperHybrid results are out-of-sample walk-forward validation. Past performance does not guarantee future results. Lottery outcomes are random.",
    });
  } catch (error) {
    logger.error({ error }, "SuperHybrid backtest failed");
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "SuperHybrid backtest failed" });
  }
});

export default router;
