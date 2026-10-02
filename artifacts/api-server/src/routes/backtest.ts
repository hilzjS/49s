/**
 * UK49s Backtest API Routes
 *
 * Runs the single engine's walk-forward backtest over an explicit date window
 * (training is always strictly before each target draw) and reports the hit
 * distribution plus the random baseline for comparison.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  uk49sDraws,
  uk49sBacktestRuns,
  DEFAULT_WEIGHTS,
  toEngineDraws,
  runBacktestWindowAsync,
  type BacktestReport,
  type Base44Weights,
  type DrawType,
} from "@workspace/db/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "../lib/admin-auth";
import { getStatsCutoff } from "../lib/stats-scope";

const router: IRouter = Router();

function parseDrawType(value: unknown): DrawType | null {
  return value === "lunchtime" || value === "teatime" ? value : null;
}

function resolveWeights(input: unknown): Base44Weights {
  const w = (input ?? {}) as Partial<Base44Weights>;
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  return {
    hot: num(w.hot, DEFAULT_WEIGHTS.hot),
    overdue: num(w.overdue, DEFAULT_WEIGHTS.overdue),
    halfLife: num(w.halfLife, DEFAULT_WEIGHTS.halfLife),
    power: num(w.power, DEFAULT_WEIGHTS.power),
  };
}

function hitCount(report: BacktestReport, hits: number): number {
  return report.hitDistribution.find((h) => h.hits === hits)?.lines ?? 0;
}

// Run a walk-forward backtest over an explicit window
router.post("/run", requireAdmin, async (req, res) => {
  const drawType = parseDrawType(req.body?.drawType);
  const testStartDate = req.body?.testStartDate;
  const testEndDate = req.body?.testEndDate;

  if (!drawType) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }
  if (!testStartDate || !testEndDate) {
    res.status(400).json({ error: "testStartDate and testEndDate are required" });
    return;
  }
  if (String(testStartDate) >= String(testEndDate)) {
    res.status(400).json({ error: "Test start must be before test end." });
    return;
  }

  try {
    const draws = await db
      .select()
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, drawType))
      .orderBy(uk49sDraws.drawDate);

    if (draws.length === 0) {
      res.status(400).json({ error: `No ${drawType} draws are available to backtest.` });
      return;
    }

    const latestDrawDate = draws[draws.length - 1].drawDate;
    if (String(testEndDate) >= latestDrawDate) {
      res.status(400).json({ error: `Test end must be before the latest available draw (${latestDrawDate}).` });
      return;
    }

    const weights = resolveWeights(req.body?.weights);
    const report = await runBacktestWindowAsync(toEngineDraws(draws, drawType), String(testStartDate), String(testEndDate), weights);

    if (report.testedDraws === 0) {
      res.status(400).json({
        error: "No draws could be resolved in the selected window (each target needs at least 20 older draws). No backtest was saved.",
      });
      return;
    }

    const actualStartDate = report.runs[0].draw_date;
    const actualEndDate = report.runs[report.runs.length - 1].draw_date;
    const fourHitCount = report.runs.filter((r) => r.bestHits >= 4).length;

    await db.insert(uk49sBacktestRuns).values({
      drawType,
      status: "completed",
      modelConfigId: null,
      lookbackWindow: report.historyPerRun,
      testStartDate: actualStartDate,
      testEndDate: actualEndDate,
      includeRandomBaseline: true,
      includeFrequencyBaseline: false,
      totalPredictions: report.testedDraws,
      hit0Count: hitCount(report, 0),
      hit1Count: hitCount(report, 1),
      hit2Count: hitCount(report, 2),
      hit3Count: hitCount(report, 3),
      hit4Count: hitCount(report, 4),
      avgMainHits: report.avgHitsPerLine,
      medianMainHits: null,
      maxMainHits: report.bestEver?.bestHits ?? 0,
      fourHitRate: report.testedDraws ? fourHitCount / report.testedDraws : 0,
      boosterHitRate: 0,
      randomTotalPredictions: report.testedDraws,
      randomAvgMainHits: report.randomBaseline,
      randomFourHitRate: 0,
      randomBoosterHitRate: 0,
      freqTotalPredictions: 0,
      freqAvgMainHits: 0,
      freqFourHitRate: 0,
      freqBoosterHitRate: 0,
      completedAt: new Date(),
    });

    res.json({
      success: true,
      backtest: {
        totalPredictions: report.testedDraws,
        testPeriod: { startDate: actualStartDate, endDate: actualEndDate },
        valid: true,
        hitDistribution: report.hitDistribution,
        avgHits: report.avgHitsPerLine,
        bestHits: report.bestEver?.bestHits ?? 0,
        threePlusCount: report.threePlusCount,
        threePlusRate: report.threePlusRate,
        randomBaseline: report.randomBaseline,
        edgePct: report.edgePct,
        weights: report.weights,
      },
      warning:
        "Backtest results are out-of-sample validation. Past performance does not guarantee future results. Lottery outcomes are random.",
    });
  } catch (error) {
    logger.error({ error, drawType }, "Backtest failed");
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Backtest failed" });
  }
});

// Backtest history
router.get("/history/:drawType", async (req, res) => {
  const drawType = parseDrawType(req.params.drawType);
  if (!drawType) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  const limit = Math.min(parseInt(String(req.query.limit || "20")), 100);

  try {
    const statsSince = await getStatsCutoff(drawType);
    const runs = await db
      .select()
      .from(uk49sBacktestRuns)
      .where(
        statsSince
          ? and(eq(uk49sBacktestRuns.drawType, drawType), gte(uk49sBacktestRuns.completedAt, statsSince))
          : eq(uk49sBacktestRuns.drawType, drawType),
      )
      .orderBy(desc(uk49sBacktestRuns.completedAt))
      .limit(limit);

    res.json({
      success: true,
      count: runs.length,
      statsSince: statsSince ? statsSince.toISOString() : null,
      backtests: runs.map((r) => ({
        id: r.id,
        valid: r.status === "completed" && r.totalPredictions > 0,
        testPeriod: { startDate: r.testStartDate, endDate: r.testEndDate },
        totalPredictions: r.totalPredictions,
        avgHits: r.avgMainHits,
        bestHits: r.maxMainHits,
        fourHitRate: r.fourHitRate,
        randomBaseline: r.randomAvgMainHits,
        completedAt: r.completedAt,
      })),
    });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get backtest history");
    res.status(500).json({ success: false, error: "Failed to get backtest history" });
  }
});

// Latest valid backtest for the current model
router.get("/latest/:drawType", async (req, res) => {
  const drawType = parseDrawType(req.params.drawType);
  if (!drawType) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  try {
    const statsSince = await getStatsCutoff(drawType);
    const [run] = await db
      .select()
      .from(uk49sBacktestRuns)
      .where(
        statsSince
          ? and(
              eq(uk49sBacktestRuns.drawType, drawType),
              gte(uk49sBacktestRuns.completedAt, statsSince),
              eq(uk49sBacktestRuns.status, "completed"),
            )
          : and(eq(uk49sBacktestRuns.drawType, drawType), eq(uk49sBacktestRuns.status, "completed")),
      )
      .orderBy(desc(uk49sBacktestRuns.completedAt))
      .limit(1);

    if (!run || run.totalPredictions === 0) {
      res.status(404).json({ error: "No valid backtest has been run for the current model yet" });
      return;
    }

    res.json({
      success: true,
      statsSince: statsSince ? statsSince.toISOString() : null,
      backtest: {
        id: run.id,
        valid: true,
        totalPredictions: run.totalPredictions,
        testPeriod: { startDate: run.testStartDate, endDate: run.testEndDate },
        hitDistribution: [
          { hits: 0, lines: run.hit0Count, pct: 0 },
          { hits: 1, lines: run.hit1Count, pct: 0 },
          { hits: 2, lines: run.hit2Count, pct: 0 },
          { hits: 3, lines: run.hit3Count, pct: 0 },
          { hits: 4, lines: run.hit4Count, pct: 0 },
        ],
        avgHits: run.avgMainHits ?? 0,
        bestHits: run.maxMainHits ?? 0,
        fourHitRate: run.fourHitRate ?? 0,
        randomBaseline: run.randomAvgMainHits ?? 0,
        completedAt: run.completedAt,
      },
    });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get latest backtest");
    res.status(500).json({ success: false, error: "Failed to get latest backtest" });
  }
});

export default router;
