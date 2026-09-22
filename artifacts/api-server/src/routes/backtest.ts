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
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "../lib/admin-auth";

const router: IRouter = Router();

// Run walk-forward backtest
router.post("/run", requireAdmin, async (req, res) => {
  const { drawType, lookbackWindow, testStartDate, testEndDate, weights, constraints, randomSeed } = req.body;
  
  if (!drawType || (drawType !== "lunchtime" && drawType !== "teatime")) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" }); return;
  }
  
  if (!testStartDate || !testEndDate) {
    res.status(400).json({ error: "testStartDate and testEndDate are required" }); return;
  }
  
  try {
    // Get all historical draws
    const draws = await db
      .select()
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, drawType))
      .orderBy(uk49sDraws.drawDate);
    
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
    
    // Store backtest run
    await db.insert(uk49sBacktestRuns).values({
      drawType,
      status: "completed",
      lookbackWindow: config.lookbackWindow,
      testStartDate,
      testEndDate,
      includeRandomBaseline: true,
      includeFrequencyBaseline: true,
      totalPredictions: result.superhybrid.totalPredictions,
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
        totalPredictions: result.superhybrid.totalPredictions,
        testPeriod: { startDate: testStartDate, endDate: testEndDate },
        lookbackWindow: config.lookbackWindow,
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
    const runs = await db
      .select()
      .from(uk49sBacktestRuns)
      .where(eq(uk49sBacktestRuns.drawType, drawType))
      .orderBy(desc(uk49sBacktestRuns.completedAt))
      .limit(limit);
    
    res.json({
      success: true,
      count: runs.length,
      backtests: runs.map(r => ({
        id: r.id,
        lookbackWindow: r.lookbackWindow,
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
    const [run] = await db
      .select()
      .from(uk49sBacktestRuns)
      .where(eq(uk49sBacktestRuns.drawType, drawType))
      .orderBy(desc(uk49sBacktestRuns.completedAt))
      .limit(1);
    
    if (!run) {
      res.status(404).json({ error: "No backtest runs found" }); return;
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
      backtest: {
        id: run.id,
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
