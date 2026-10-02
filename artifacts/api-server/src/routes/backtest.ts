/**
 * UK49s Backtest API Routes
 *
 * Handles walk-forward validation and baseline comparisons.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { uk49sDraws, uk49sBacktestRuns, insertUk49sBacktestRunSchema, drawToNumbers, type DrawType } from "@workspace/db/schema";
import {
  runFullBacktest,
  runBacktest,
  compareLookbackWindows,
  calculateRollingMetrics,
  type BacktestConfig,
  type DiversityConstraints,
  type FullBacktestResult,
  type LookbackComparison,
} from "@workspace/db/schema";
import { DEFAULT_WEIGHTS, type FeatureWeights } from "@workspace/db/schema";
import { eq, and, desc, gte, gt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "../lib/admin-auth";
import { getStatsCutoff } from "../lib/stats-scope";

const router: IRouter = Router();

/**
 * A stored backtest only counts as a valid, completed result when it finished
 * AND actually resolved at least one draw. Zero-draw runs are kept for audit
 * but never counted toward statistics or shown as successful backtests.
 */
function isValidBacktest(run: { status: string; totalPredictions: number }): boolean {
  return run.status === "completed" && run.totalPredictions > 0;
}

/** SQL predicate matching the conditions above (used to scope statistics). */
const validBacktestWhere = and(
  eq(uk49sBacktestRuns.status, "completed"),
  gt(uk49sBacktestRuns.totalPredictions, 0),
);

// Run walk-forward backtest
router.post("/run", requireAdmin, async (req, res) => {
  const { drawType, lookbackWindow, testStartDate, testEndDate, weights, constraints, randomSeed } = req.body;
  
  if (!drawType || (drawType !== "lunchtime" && drawType !== "teatime")) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" }); return;
  }
  
  if (!testStartDate || !testEndDate) {
    res.status(400).json({ error: "testStartDate and testEndDate are required" }); return;
  }

  if (String(testStartDate) >= String(testEndDate)) {
    res.status(400).json({ error: "Test start must be before test end." }); return;
  }
  
  try {
    // Get all historical draws
    const draws = await db
      .select()
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, drawType))
      .orderBy(uk49sDraws.drawDate);

    if (draws.length === 0) {
      res.status(400).json({ error: `No ${drawType} draws are available to backtest.` }); return;
    }

    // The walk-forward engine closes the test window with the first draw AFTER
    // testEndDate. When no such draw exists, it silently resolves zero draws and
    // used to persist an empty "completed" run. Enforce the boundary here against
    // the ACTUAL latest available draw for this draw type — never trust the
    // frontend. The requested date is rejected as-is, never silently adjusted.
    const latestDrawDate = draws[draws.length - 1].drawDate;
    if (String(testEndDate) >= latestDrawDate) {
      res.status(400).json({
        error: `Test end must be before the latest available draw (${latestDrawDate}).`,
      }); return;
    }
    
    if (draws.length < (lookbackWindow || 90)) {
      res.status(400).json({ 
        error: `Not enough historical data. Need ${lookbackWindow || 90}, have ${draws.length}` 
      }); return;
    }
    
    const config: BacktestConfig = {
          drawType,
          lookbackWindow: lookbackWindow || 90,
          testStartDate,
          testEndDate,
          randomSeed,
          strategy: req.body.strategy,
        };
    
    const modelWeights: FeatureWeights = weights || DEFAULT_WEIGHTS;
    
    // The optimized model also carries diversity constraints; without them the
    // backtest would evaluate a different configuration than the active model.
    const modelConstraints: DiversityConstraints = {
      enforceDiversity: constraints?.enforceDiversity ?? true,
      minNumberSpread: Number.isFinite(Number(constraints?.minNumberSpread))
        ? Math.floor(Number(constraints?.minNumberSpread))
        : 10,
      maxSameGroup: Number.isFinite(Number(constraints?.maxSameGroup))
        ? Math.floor(Number(constraints?.maxSameGroup))
        : 2,
    };

    // Run full backtest with baselines
    const result = runFullBacktest(draws, config, modelWeights, modelConstraints);

    const resolvedDraws = result.superhybrid.totalPredictions;

    // A backtest is only a completed backtest if it actually resolved draws.
    // Never create a successful history record (or touch model statistics) for
    // an empty run.
    if (resolvedDraws === 0) {
      res.status(400).json({
        error: "No resolved draws were available in the selected validation window. No backtest was saved.",
      }); return;
    }

    // Defensive assertion: the hit distribution must account for exactly the
    // resolved predictions. A mismatch means inconsistent statistics — fail the
    // run instead of persisting it.
    const hitDistributionSum = result.superhybrid.hitDistribution.reduce(
      (sum, entry) => sum + entry.count,
      0,
    );
    if (hitDistributionSum !== resolvedDraws) {
      logger.error(
        { drawType, hitDistributionSum, resolvedDraws },
        "Backtest hit distribution does not sum to the resolved draw count",
      );
      res.status(500).json({
        error: `Backtest produced an inconsistent hit distribution (${hitDistributionSum} accounted for vs ${resolvedDraws} resolved draws). No backtest was saved.`,
      }); return;
    }

    // The random and frequency baselines must be evaluated over the exact same
    // resolved draws as the model — otherwise the comparison is meaningless.
    if (
      result.randomBaseline.totalPredictions !== resolvedDraws ||
      result.frequencyBaseline.totalPredictions !== resolvedDraws
    ) {
      logger.error(
        {
          drawType,
          resolvedDraws,
          randomDraws: result.randomBaseline.totalPredictions,
          frequencyDraws: result.frequencyBaseline.totalPredictions,
        },
        "Backtest baselines were evaluated over a different sample than the model",
      );
      res.status(500).json({
        error: "Backtest baselines did not cover the same resolved draws as the model. No backtest was saved.",
      }); return;
    }

    // Report the draws that were ACTUALLY evaluated, not the requested calendar
    // range. The two can differ when the window is clipped by the history edges.
    const evaluated = result.superhybrid.predictions;
    const actualStartDate = evaluated[0]?.predictionDate ?? String(testStartDate);
    const actualEndDate = evaluated[evaluated.length - 1]?.predictionDate ?? String(testEndDate);

    // Capture the exact model that was evaluated (when the caller identifies it),
    // alongside the lookback window actually used.
    const modelConfigId = Number.isFinite(Number(req.body.modelConfigId))
      ? Number(req.body.modelConfigId)
      : null;

    // Store backtest run — only after validation and full completion.
    await db.insert(uk49sBacktestRuns).values({
      drawType,
      status: "completed",
      modelConfigId,
      lookbackWindow: config.lookbackWindow,
      testStartDate: actualStartDate,
      testEndDate: actualEndDate,
      includeRandomBaseline: true,
      includeFrequencyBaseline: true,
      totalPredictions: resolvedDraws,
      hit0Count: result.superhybrid.hitDistribution.find(h => h.hits === 0)?.count || 0,
      hit1Count: result.superhybrid.hitDistribution.find(h => h.hits === 1)?.count || 0,
      hit2Count: result.superhybrid.hitDistribution.find(h => h.hits === 2)?.count || 0,
      hit3Count: result.superhybrid.hitDistribution.find(h => h.hits === 3)?.count || 0,
      hit4Count: result.superhybrid.hitDistribution.find(h => h.hits === 4)?.count || 0,
      avgMainHits: result.superhybrid.avgMainHits,
      medianMainHits: result.superhybrid.medianMainHits,
      maxMainHits: result.superhybrid.maxMainHits,
      fourHitRate: result.superhybrid.fourHitRate,
      boosterHitRate: result.superhybrid.boosterHitRate,
      randomTotalPredictions: result.randomBaseline.totalPredictions,
      randomAvgMainHits: result.randomBaseline.avgMainHits,
      randomFourHitRate: result.randomBaseline.fourHitRate,
      randomBoosterHitRate: result.randomBaseline.boosterHitRate,
      freqTotalPredictions: result.frequencyBaseline.totalPredictions,
      freqAvgMainHits: result.frequencyBaseline.avgMainHits,
      freqFourHitRate: result.frequencyBaseline.fourHitRate,
      freqBoosterHitRate: result.frequencyBaseline.boosterHitRate,
      randomSeed,
      completedAt: new Date(),
    });
    
    res.json({
      success: true,
      backtest: {
        totalPredictions: resolvedDraws,
        testPeriod: { startDate: actualStartDate, endDate: actualEndDate },
        lookbackWindow: config.lookbackWindow,
        valid: true,
        superhybrid: {
          hitDistribution: result.superhybrid.hitDistribution,
          avgMainHits: result.superhybrid.avgMainHits,
          medianMainHits: result.superhybrid.medianMainHits,
          maxMainHits: result.superhybrid.maxMainHits,
          fourHitCount: result.superhybrid.fourHitCount,
          fourHitRate: result.superhybrid.fourHitRate,
          boosterHitRate: result.superhybrid.boosterHitRate,
        },
        baselines: {
          random: {
            totalPredictions: result.randomBaseline.totalPredictions,
            avgMainHits: result.randomBaseline.avgMainHits,
            fourHitRate: result.randomBaseline.fourHitRate,
            boosterHitRate: result.randomBaseline.boosterHitRate,
          },
          frequency: {
            totalPredictions: result.frequencyBaseline.totalPredictions,
            avgMainHits: result.frequencyBaseline.avgMainHits,
            fourHitRate: result.frequencyBaseline.fourHitRate,
            boosterHitRate: result.frequencyBaseline.boosterHitRate,
          },
        },
        comparison: result.comparison,
        rollingMetrics: result.rollingMetrics,
      },
      warning: "Backtest results are out-of-sample validation. Past performance does not guarantee future results. Lottery outcomes are random.",
    });
  } catch (error) {
    logger.error({ error, drawType }, "Backtest failed");
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Backtest failed" });
  }
});

// Compare different lookback windows
router.post("/compare-windows", requireAdmin, async (req, res) => {
  const { drawType, testStartDate, testEndDate, windows, weights } = req.body;
  
  if (!drawType || (drawType !== "lunchtime" && drawType !== "teatime")) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" }); return;
  }
  
  if (!testStartDate || !testEndDate) {
    res.status(400).json({ error: "testStartDate and testEndDate are required" }); return;
  }
  
  try {
    const draws = await db
      .select()
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, drawType))
      .orderBy(uk49sDraws.drawDate);
    
    const comparison = compareLookbackWindows(
      draws,
      drawType,
      testStartDate,
      testEndDate,
      windows || [30, 60, 90, 180, 365],
      weights || DEFAULT_WEIGHTS
    );
    
    res.json({
      success: true,
      comparison,
      recommendation: comparison.sort((a, b) => b.fourHitRate - a.fourHitRate)[0] || null,
    });
  } catch (error) {
    logger.error({ error, drawType }, "Window comparison failed");
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Window comparison failed" });
  }
});

// Get backtest history
router.get("/history/:drawType", async (req, res) => {
  const drawType = req.params.drawType;
  if (drawType !== "lunchtime" && drawType !== "teatime") {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" }); return;
  }
  
  const limit = Math.min(parseInt(String(req.query.limit || "20")), 100);
    
    try {
      // Backtests recorded before the current model was applied belong to a
      // previous model and are excluded from the statistics.
      const statsSince = await getStatsCutoff(drawType);
      const runs = await db
        .select()
        .from(uk49sBacktestRuns)
        .where(
          statsSince
            ? and(eq(uk49sBacktestRuns.drawType, drawType), gte(uk49sBacktestRuns.completedAt, statsSince))
            : eq(uk49sBacktestRuns.drawType, drawType)
        )
        .orderBy(desc(uk49sBacktestRuns.completedAt))
        .limit(limit);
      
      res.json({
        success: true,
        count: runs.length,
        statsSince: statsSince ? statsSince.toISOString() : null,
        backtests: runs.map(r => ({
        id: r.id,
        valid: isValidBacktest(r),
        lookbackWindow: r.lookbackWindow,
        // Period is the actual evaluated draw range stored at completion time.
        testPeriod: { startDate: r.testStartDate, endDate: r.testEndDate },
        totalPredictions: r.totalPredictions,
        avgMainHits: r.avgMainHits,
        fourHitRate: r.fourHitRate,
        boosterHitRate: r.boosterHitRate,
        baselines: {
          random: {
            avgMainHits: r.randomAvgMainHits,
            fourHitRate: r.randomFourHitRate,
          },
          frequency: {
            avgMainHits: r.freqAvgMainHits,
            fourHitRate: r.freqFourHitRate,
          },
        },
        completedAt: r.completedAt,
      })),
    });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get backtest history");
    res.status(500).json({ success: false, error: "Failed to get backtest history" });
  }
});

// Get latest backtest result
router.get("/latest/:drawType", async (req, res) => {
  const drawType = req.params.drawType;
  if (drawType !== "lunchtime" && drawType !== "teatime") {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" }); return;
  }
  
  try {
      // A backtest only counts while it belongs to the current model AND it is a
      // valid, completed run that resolved at least one draw. Empty/failed runs
      // are ignored so they cannot drive the displayed statistics.
      const statsSince = await getStatsCutoff(drawType);
      const [run] = await db
        .select()
        .from(uk49sBacktestRuns)
        .where(
          statsSince
            ? and(eq(uk49sBacktestRuns.drawType, drawType), gte(uk49sBacktestRuns.completedAt, statsSince), validBacktestWhere)
            : and(eq(uk49sBacktestRuns.drawType, drawType), validBacktestWhere)
        )
        .orderBy(desc(uk49sBacktestRuns.completedAt))
        .limit(1);
      
      if (!run) {
        res.status(404).json({ error: "No valid backtest has been run for the current model yet" }); return;
      }
    
    const hitDistribution = [
      { hits: 0, count: run.hit0Count },
      { hits: 1, count: run.hit1Count },
      { hits: 2, count: run.hit2Count },
      { hits: 3, count: run.hit3Count },
      { hits: 4, count: run.hit4Count },
      { hits: 5, count: 0 },
    ];
    const randomBaseline = {
      totalPredictions: run.randomTotalPredictions ?? 0,
      avgMainHits: run.randomAvgMainHits ?? 0,
      fourHitRate: run.randomFourHitRate ?? 0,
      boosterHitRate: run.randomBoosterHitRate ?? 0,
      hitDistribution: [],
      medianMainHits: 0,
      maxMainHits: 0,
      fourHitCount: 0,
      boosterHitCount: 0,
      predictions: [],
    };
    const frequencyBaseline = {
      totalPredictions: run.freqTotalPredictions ?? 0,
      avgMainHits: run.freqAvgMainHits ?? 0,
      fourHitRate: run.freqFourHitRate ?? 0,
      boosterHitRate: run.freqBoosterHitRate ?? 0,
      hitDistribution: [],
      medianMainHits: 0,
      maxMainHits: 0,
      fourHitCount: 0,
      boosterHitCount: 0,
      predictions: [],
    };
    // Return the same shape as POST /run so the frontend can treat them uniformly
        res.json({
          success: true,
          statsSince: statsSince ? statsSince.toISOString() : null,
          backtest: {
            id: run.id,
        valid: true,
        totalPredictions: run.totalPredictions,
        testPeriod: { startDate: run.testStartDate, endDate: run.testEndDate },
        lookbackWindow: run.lookbackWindow,
        superhybrid: {
          hitDistribution,
          avgMainHits: run.avgMainHits ?? 0,
          medianMainHits: run.medianMainHits ?? 0,
          maxMainHits: run.maxMainHits ?? 0,
          fourHitCount: run.hit4Count,
          fourHitRate: run.fourHitRate ?? 0,
          boosterHitRate: run.boosterHitRate ?? 0,
        },
        baselines: { random: randomBaseline, frequency: frequencyBaseline },
        comparison: {
          superhybridVsRandom: {
            avgHitsDiff: (run.avgMainHits ?? 0) - (run.randomAvgMainHits ?? 0),
            fourHitRateDiff: (run.fourHitRate ?? 0) - (run.randomFourHitRate ?? 0),
          },
          superhybridVsFrequency: {
            avgHitsDiff: (run.avgMainHits ?? 0) - (run.freqAvgMainHits ?? 0),
            fourHitRateDiff: (run.fourHitRate ?? 0) - (run.freqFourHitRate ?? 0),
          },
        },
        rollingMetrics: [],
        completedAt: run.completedAt,
      },
    });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get latest backtest");
    res.status(500).json({ success: false, error: "Failed to get latest backtest" });
  }
});

export default router;
