/**
 * UK49s Optimizer API Routes
 * 
 * Handles model optimization with Random Search + Hill Climbing.
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { 
  uk49sDraws, 
  uk49sOptimizerRuns, 
  uk49sOptimizerConfigs,
  type DrawType 
} from "@workspace/db/schema";
import {
  optimizeModel,
  crossValidateModel,
  calculateStabilityMetrics,
  type OptimizerConfig,
  type OptimizerResult,
  type CrossValidationResult,
  type StabilityMetrics,
} from "@workspace/db/schema";
import { DEFAULT_WEIGHTS, type FeatureWeights } from "@workspace/db/schema";
import { updateActiveModel } from "../lib/prediction-service";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "../lib/admin-auth";

const router: IRouter = Router();

// Run optimization
router.post("/run", requireAdmin, async (req, res) => {
  const { 
    drawType, 
    maxIterations = 1000,
    populationSize = 100,
    eliteSize = 10,
    mutationRate = 0.1,
    trainStartDate,
    trainEndDate,
    validationStartDate,
    validationEndDate,
    testStartDate,
    testEndDate,
    minValidationSamples = 50,
    randomSeed,
    applyToModel = false,
  } = req.body;
  
  if (!drawType || (drawType !== "lunchtime" && drawType !== "teatime")) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" }); return;
  }
  
  if (!validationStartDate || !validationEndDate) {
    res.status(400).json({ error: "validationStartDate and validationEndDate are required" }); return;
  }
  
  try {
    // Get historical draws
    const draws = await db
      .select()
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, drawType))
      .orderBy(uk49sDraws.drawDate);
    
    if (draws.length < 100) {
      res.status(400).json({ error: `Not enough historical data. Need at least 100 draws, have ${draws.length}` }); return;
    }
    
    // Create optimizer run record
    const [optimizerRun] = await db.insert(uk49sOptimizerRuns).values({
      drawType,
      status: "running",
      maxIterations,
      populationSize,
      eliteSize,
      mutationRate,
      trainStartDate,
      trainEndDate,
      validationStartDate,
      validationEndDate,
      testStartDate,
      testEndDate,
      configsTested: 0,
    }).returning();
    
    // Run optimization
    const optimizerConfig: OptimizerConfig = {
      drawType,
      maxIterations,
      populationSize,
      eliteSize,
      mutationRate,
      trainStartDate: trainStartDate || "",
      trainEndDate: trainEndDate || "",
      validationStartDate,
      validationEndDate,
      testStartDate,
      testEndDate,
      minValidationSamples,
      randomSeed,
    };
    
    let result: OptimizerResult;
    
    try {
      result = optimizeModel(draws, optimizerConfig, (iteration, bestScore) => {
        logger.info({ drawType, iteration, bestScore }, "Optimization progress");
      });
    } catch (optimizeError) {
      await db.update(uk49sOptimizerRuns)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(uk49sOptimizerRuns.id, optimizerRun.id));
      throw optimizeError;
    }
    
    // Store all tested configurations
    for (const configResult of result.allResults.slice(0, 500)) { // Limit stored configs
      await db.insert(uk49sOptimizerConfigs).values({
        runId: optimizerRun.id,
        drawType,
        weightFrequency: configResult.weights.weightFrequency,
        weightRecency: configResult.weights.weightRecency,
        weightHotCold: configResult.weights.weightHotCold,
        weightGapAnalysis: configResult.weights.weightGapAnalysis,
        weightPairs: configResult.weights.weightPairs,
        weightTriples: configResult.weights.weightTriples,
        weightConsecutive: configResult.weights.weightConsecutive,
        weightOddEven: configResult.weights.weightOddEven,
        weightLowHigh: configResult.weights.weightLowHigh,
        weightSumRange: configResult.weights.weightSumRange,
        weightPositional: configResult.weights.weightPositional,
        weightRepeat: configResult.weights.weightRepeat,
        weightFirst3Minus2: configResult.weights.weightFirst3Minus2,
        lookbackWindow: configResult.lookbackWindow,
        enforceDiversity: configResult.constraints.enforceDiversity,
        minNumberSpread: configResult.constraints.minNumberSpread,
        maxSameGroup: configResult.constraints.maxSameGroup,
        validation4HitRate: configResult.validation4HitRate,
        validationAvgHits: configResult.validationAvgHits,
        validationSampleSize: configResult.validationSampleSize,
        validationBoosterHitRate: configResult.validationBoosterHitRate,
        stabilityScore: configResult.stabilityScore,
        randomSeed: configResult.randomSeed,
      });
    }
    
    // Update optimizer run with results
    await db.update(uk49sOptimizerRuns)
      .set({
        status: "completed",
        configsTested: result.iterations,
        best4HitRate: result.validationResult.fourHitRate,
        bestAvgHits: result.validationResult.avgMainHits,
        completedAt: new Date(),
      })
      .where(eq(uk49sOptimizerRuns.id, optimizerRun.id));
    
    // Optionally apply to model
    let newModelId: number | null = null;
    if (applyToModel && result.validationResult.totalPredictions >= minValidationSamples) {
      newModelId = await updateActiveModel(
        drawType,
        result.bestWeights,
        result.bestLookbackWindow,
        result.bestConstraints,
        result.validationResult.fourHitRate,
        result.validationResult.avgMainHits,
        result.validationResult.totalPredictions
      );
    }
    
    res.json({
      success: true,
      optimizerRun: {
        id: optimizerRun.id,
        status: "completed",
        configsTested: result.iterations,
      },
      bestConfiguration: {
        weights: result.bestWeights,
        constraints: result.bestConstraints,
        lookbackWindow: result.bestLookbackWindow,
        validationMetrics: {
          fourHitRate: result.validationResult.fourHitRate,
          avgHits: result.validationResult.avgMainHits,
          sampleSize: result.validationResult.totalPredictions,
          boosterHitRate: result.validationResult.boosterHitRate,
        },
        testMetrics: result.testResult ? {
          fourHitRate: result.testResult.fourHitRate,
          avgHits: result.testResult.avgMainHits,
          sampleSize: result.testResult.totalPredictions,
        } : null,
      },
      topConfigurations: result.allResults
        .sort((a, b) => b.validation4HitRate - a.validation4HitRate)
        .slice(0, 10)
        .map(c => ({
          weights: c.weights,
          lookbackWindow: c.lookbackWindow,
          fourHitRate: c.validation4HitRate,
          avgHits: c.validationAvgHits,
          sampleSize: c.validationSampleSize,
        })),
      newModelId,
      warning: "Optimization results are based on historical data. The selected configuration performed best in validation but may not generalize to future draws. Lottery outcomes are random.",
    });
  } catch (error) {
    logger.error({ error, drawType }, "Optimization failed");
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Optimization failed" });
  }
});

// Cross-validation for stability
router.post("/cross-validate", requireAdmin, async (req, res) => {
  const { drawType, weights, lookbackWindow = 90, nFolds = 5 } = req.body;
  
  if (!drawType || (drawType !== "lunchtime" && drawType !== "teatime")) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" }); return;
  }
  
  try {
    const draws = await db
      .select()
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, drawType))
      .orderBy(uk49sDraws.drawDate);
    
    if (draws.length < lookbackWindow * nFolds * 2) {
      res.status(400).json({ 
        error: `Not enough data for ${nFolds}-fold cross-validation. Need ${lookbackWindow * nFolds * 2} draws, have ${draws.length}` 
      }); return;
    }
    
    const cvResults = crossValidateModel(
      draws,
      drawType,
      weights || DEFAULT_WEIGHTS,
      lookbackWindow,
      nFolds
    );
    
    const stability = calculateStabilityMetrics(cvResults);
    
    res.json({
      success: true,
      crossValidation: {
        folds: cvResults,
        stabilityMetrics: stability,
      },
      warning: "Cross-validation tests model stability across different time periods. Consistent performance across folds indicates a more robust model.",
    });
  } catch (error) {
    logger.error({ error, drawType }, "Cross-validation failed");
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Cross-validation failed" });
  }
});

// Get optimization history
router.get("/history/:drawType", async (req, res) => {
  const drawType = req.params.drawType;
  if (drawType !== "lunchtime" && drawType !== "teatime") {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" }); return;
  }
  
  const limit = Math.min(parseInt(String(req.query.limit || "20")), 100);
  
  try {
    const runs = await db
      .select()
      .from(uk49sOptimizerRuns)
      .where(eq(uk49sOptimizerRuns.drawType, drawType))
      .orderBy(desc(uk49sOptimizerRuns.completedAt))
      .limit(limit);
    
    res.json({
      success: true,
      count: runs.length,
      optimizationRuns: runs.map(r => ({
        id: r.id,
        status: r.status,
        configsTested: r.configsTested,
        validationPeriod: { startDate: r.validationStartDate, endDate: r.validationEndDate },
        testPeriod: r.testStartDate ? { startDate: r.testStartDate, endDate: r.testEndDate } : null,
        bestMetrics: {
          fourHitRate: r.best4HitRate,
          avgHits: r.bestAvgHits,
        },
        completedAt: r.completedAt,
      })),
    });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get optimization history");
    res.status(500).json({ success: false, error: "Failed to get optimization history" });
  }
});

// Get optimization run details
router.get("/run/:runId", async (req, res) => {
  const runId = parseInt(req.params.runId);
  
  try {
    const run = await db
      .select()
      .from(uk49sOptimizerRuns)
      .where(eq(uk49sOptimizerRuns.id, runId))
      .limit(1);
    
    if (run.length === 0) {
      res.status(404).json({ error: "Optimization run not found" }); return;
    }
    
    const configs = await db
      .select()
      .from(uk49sOptimizerConfigs)
      .where(eq(uk49sOptimizerConfigs.runId, runId))
      .orderBy(desc(uk49sOptimizerConfigs.validation4HitRate))
      .limit(100);
    
    res.json({
      success: true,
      run: {
        id: run[0].id,
        status: run[0].status,
        configsTested: run[0].configsTested,
        parameters: {
          maxIterations: run[0].maxIterations,
          populationSize: run[0].populationSize,
          eliteSize: run[0].eliteSize,
          mutationRate: run[0].mutationRate,
        },
        periods: {
          train: { startDate: run[0].trainStartDate, endDate: run[0].trainEndDate },
          validation: { startDate: run[0].validationStartDate, endDate: run[0].validationEndDate },
          test: run[0].testStartDate ? { startDate: run[0].testStartDate, endDate: run[0].testEndDate } : null,
        },
        bestMetrics: {
          fourHitRate: run[0].best4HitRate,
          avgHits: run[0].bestAvgHits,
        },
        completedAt: run[0].completedAt,
      },
      topConfigurations: configs.slice(0, 20).map(c => ({
        weights: {
          weightFrequency: c.weightFrequency,
          weightRecency: c.weightRecency,
          weightHotCold: c.weightHotCold,
          weightGapAnalysis: c.weightGapAnalysis,
          weightPairs: c.weightPairs,
          weightTriples: c.weightTriples,
          weightConsecutive: c.weightConsecutive,
          weightOddEven: c.weightOddEven,
          weightLowHigh: c.weightLowHigh,
          weightSumRange: c.weightSumRange,
          weightPositional: c.weightPositional,
          weightRepeat: c.weightRepeat,
          weightFirst3Minus2: c.weightFirst3Minus2,
        },
        lookbackWindow: c.lookbackWindow,
        constraints: {
          enforceDiversity: c.enforceDiversity,
          minNumberSpread: c.minNumberSpread,
          maxSameGroup: c.maxSameGroup,
        },
        metrics: {
          fourHitRate: c.validation4HitRate,
          avgHits: c.validationAvgHits,
          sampleSize: c.validationSampleSize,
          boosterHitRate: c.validationBoosterHitRate,
          stabilityScore: c.stabilityScore,
        },
      })),
    });
  } catch (error) {
    logger.error({ error, runId }, "Failed to get optimization run details");
    res.status(500).json({ success: false, error: "Failed to get optimization run details" });
  }
});

export default router;
