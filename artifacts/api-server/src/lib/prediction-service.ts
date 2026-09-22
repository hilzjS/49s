/**
 * UK49s Prediction Service
 * 
 * Handles prediction generation, storage, and result matching.
 */

import { db } from "@workspace/db";
import {
  uk49sDraws,
  uk49sPredictions,
  uk49sModelConfigs,
  insertUk49sPredictionSchema,
  insertUk49sModelConfigSchema,
  drawToNumbers,
  type DrawType,
  type Uk49sDraw,
  type InsertUk49sPrediction,
} from "@workspace/db/schema";
import {
  generatePrediction,
  predictionToJson,
  DEFAULT_WEIGHTS,
  type FeatureWeights,
  type DiversityConstraints,
  type PredictionResult,
} from "@workspace/db/schema";
import { eq, and, desc, asc, gte } from "drizzle-orm";
import { logger } from "./logger";

export interface ModelInfo {
  id: number;
  drawType: DrawType;
  version: string;
  status: string;
  weights: FeatureWeights;
  lookbackWindow: number;
  constraints: DiversityConstraints;
  trainingCutoff: string | null;
  validation4HitRate: number | null;
  validationAvgHits: number | null;
  validationSampleSize: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PredictionInfo {
  id: number;
  drawType: DrawType;
  predictionDate: string;
  predictedMain: number[];
  predictedBooster: number;
  modelConfigId: number | null;
  modelVersion: string | null;
  trainingCutoff: string;
  status: string;
  mainHits: number | null;
  boosterHit: boolean | null;
  actualMain: number[] | null;
  actualBooster: number | null;
  createdAt: Date;
}

// Get or create default model config
export async function getOrCreateDefaultModel(drawType: DrawType): Promise<number> {
  const existing = await db
    .select()
    .from(uk49sModelConfigs)
    .where(and(
      eq(uk49sModelConfigs.drawType, drawType),
      eq(uk49sModelConfigs.status, "active")
    ))
    .limit(1);
  
  if (existing.length > 0) {
    return existing[0].id;
  }
  
  // Create default model
  const version = `v1.0.0-${Date.now()}`;
  const [model] = await db.insert(uk49sModelConfigs).values({
    drawType,
    version,
    status: "active",
    weightFrequency: DEFAULT_WEIGHTS.weightFrequency,
    weightRecency: DEFAULT_WEIGHTS.weightRecency,
    weightHotCold: DEFAULT_WEIGHTS.weightHotCold,
    weightGapAnalysis: DEFAULT_WEIGHTS.weightGapAnalysis,
    weightPairs: DEFAULT_WEIGHTS.weightPairs,
    weightTriples: DEFAULT_WEIGHTS.weightTriples,
    weightConsecutive: DEFAULT_WEIGHTS.weightConsecutive,
    weightOddEven: DEFAULT_WEIGHTS.weightOddEven,
    weightLowHigh: DEFAULT_WEIGHTS.weightLowHigh,
    weightSumRange: DEFAULT_WEIGHTS.weightSumRange,
    weightPositional: DEFAULT_WEIGHTS.weightPositional,
    weightRepeat: DEFAULT_WEIGHTS.weightRepeat,
    weightFirst3Minus2: DEFAULT_WEIGHTS.weightFirst3Minus2,
    lookbackWindow: 90,
    enforceDiversity: true,
    minNumberSpread: 10,
    maxSameGroup: 2,
    description: "Default SuperHybrid model",
  }).returning();
  
  return model.id;
}

// Get active model info
export async function getActiveModel(drawType: DrawType): Promise<ModelInfo | null> {
  const model = await db
    .select()
    .from(uk49sModelConfigs)
    .where(and(
      eq(uk49sModelConfigs.drawType, drawType),
      eq(uk49sModelConfigs.status, "active")
    ))
    .limit(1);
  
  if (model.length === 0) return null;
  
  const m = model[0];
  return {
    id: m.id,
    drawType: m.drawType,
    version: m.version,
    status: m.status,
    weights: {
      weightFrequency: m.weightFrequency,
      weightRecency: m.weightRecency,
      weightHotCold: m.weightHotCold,
      weightGapAnalysis: m.weightGapAnalysis,
      weightPairs: m.weightPairs,
      weightTriples: m.weightTriples,
      weightConsecutive: m.weightConsecutive,
      weightOddEven: m.weightOddEven,
      weightLowHigh: m.weightLowHigh,
      weightSumRange: m.weightSumRange,
      weightPositional: m.weightPositional,
      weightRepeat: m.weightRepeat,
      weightFirst3Minus2: m.weightFirst3Minus2,
    },
    lookbackWindow: m.lookbackWindow,
    constraints: {
      enforceDiversity: m.enforceDiversity,
      minNumberSpread: m.minNumberSpread,
      maxSameGroup: m.maxSameGroup,
    },
    trainingCutoff: m.trainingCutoff,
    validation4HitRate: m.validation4HitRate,
    validationAvgHits: m.validationAvgHits,
    validationSampleSize: m.validationSampleSize,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

// Generate and store prediction
export async function generateAndStorePrediction(
  drawType: DrawType,
  predictionDate: string
): Promise<{ success: boolean; prediction?: PredictionInfo | null; error?: string }> {
  try {
    // Check if prediction already exists
    const existing = await db
      .select()
      .from(uk49sPredictions)
      .where(and(
        eq(uk49sPredictions.predictionDate, predictionDate),
        eq(uk49sPredictions.drawType, drawType)
      ))
      .limit(1);
    
    if (existing.length > 0) {
      return { success: false, error: "Prediction already exists for this date" };
    }
    
    // Get active model
    const modelId = await getOrCreateDefaultModel(drawType);
    const model = await db.select().from(uk49sModelConfigs).where(eq(uk49sModelConfigs.id, modelId)).limit(1);
    
    if (model.length === 0) {
      return { success: false, error: "No model configuration found" };
    }
    
    const m = model[0];
    const weights: FeatureWeights = {
      weightFrequency: m.weightFrequency,
      weightRecency: m.weightRecency,
      weightHotCold: m.weightHotCold,
      weightGapAnalysis: m.weightGapAnalysis,
      weightPairs: m.weightPairs,
      weightTriples: m.weightTriples,
      weightConsecutive: m.weightConsecutive,
      weightOddEven: m.weightOddEven,
      weightLowHigh: m.weightLowHigh,
      weightSumRange: m.weightSumRange,
      weightPositional: m.weightPositional,
      weightRepeat: m.weightRepeat,
      weightFirst3Minus2: m.weightFirst3Minus2,
    };
    const constraints: DiversityConstraints = {
      enforceDiversity: m.enforceDiversity,
      minNumberSpread: m.minNumberSpread,
      maxSameGroup: m.maxSameGroup,
    };
    
    // Get all historical draws for this type (sorted chronologically).
    // CRITICAL: only draws strictly before the prediction date may be used,
    // otherwise the model would be trained on the very draw it predicts.
    const allDraws = await db
      .select()
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, drawType))
      .orderBy(uk49sDraws.drawDate);

    const draws = allDraws.filter((d) => d.drawDate < predictionDate);

    if (draws.length < m.lookbackWindow) {
      return { success: false, error: `Not enough historical data before ${predictionDate}. Need ${m.lookbackWindow}, have ${draws.length}` };
    }
    
    // Generate prediction using data up to prediction date
    // For future predictions, use all available data
    const prediction = generatePrediction(
      draws,
      drawType,
      weights,
      m.lookbackWindow,
      constraints,
      modelId
    );
    
    // Store prediction
    const [storedPrediction] = await db.insert(uk49sPredictions).values({
      drawType,
      predictionDate,
      predictedMain1: prediction.mainNumbers[0],
      predictedMain2: prediction.mainNumbers[1],
      predictedMain3: prediction.mainNumbers[2],
      predictedMain4: prediction.mainNumbers[3],
      predictedBooster: prediction.boosterBall,
      modelConfigId: modelId,
      trainingCutoff: prediction.trainingCutoff,
      componentScores: JSON.stringify(predictionToJson(prediction)),
      overallScore: prediction.componentScores
        .filter(s => prediction.mainNumbers.includes(s.number))
        .reduce((sum, s) => sum + s.overallScore, 0) / 4,
      status: "pending",
    }).returning();
    
    // Try to match with actual result if available
    await matchPredictionWithResult(storedPrediction.id);
    
    return {
      success: true,
      prediction: await getPredictionInfo(storedPrediction.id),
    };
    
  } catch (error) {
    logger.error({ error, drawType, predictionDate }, "Failed to generate prediction");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Match prediction with actual result
export async function matchPredictionWithResult(predictionId: number): Promise<void> {
  const prediction = await db
    .select()
    .from(uk49sPredictions)
    .where(eq(uk49sPredictions.id, predictionId))
    .limit(1);
  
  if (prediction.length === 0) return;
  
  const p = prediction[0];
  
  // Find actual draw for this date
  const actualDraw = await db
    .select()
    .from(uk49sDraws)
    .where(and(
      eq(uk49sDraws.drawDate, p.predictionDate),
      eq(uk49sDraws.drawType, p.drawType)
    ))
    .limit(1);
  
  if (actualDraw.length === 0) return; // No result yet
  
  const draw = actualDraw[0];
  const actualMain = drawToNumbers(draw).main;
  
  // Calculate hits
  const predictedMain = [p.predictedMain1, p.predictedMain2, p.predictedMain3, p.predictedMain4];
  const mainHits = predictedMain.filter(n => actualMain.includes(n)).length;
  const boosterHit = p.predictedBooster === draw.boosterBall;
  
  // Update prediction
  await db.update(uk49sPredictions)
    .set({
      matchedDrawId: draw.id,
      actualMain1: actualMain[0],
      actualMain2: actualMain[1],
      actualMain3: actualMain[2],
      actualMain4: actualMain[3],
      actualMain5: actualMain[4],
      actualMain6: actualMain[5],
      actualBooster: draw.boosterBall,
      mainHits,
      boosterHit,
      status: mainHits >= 4 || boosterHit ? "matched" : "matched",
      updatedAt: new Date(),
    })
    .where(eq(uk49sPredictions.id, predictionId));
}

// Get prediction info by ID
export async function getPredictionInfo(predictionId: number): Promise<PredictionInfo | null> {
  const prediction = await db
    .select({
      id: uk49sPredictions.id,
      drawType: uk49sPredictions.drawType,
      predictionDate: uk49sPredictions.predictionDate,
      predictedMain1: uk49sPredictions.predictedMain1,
      predictedMain2: uk49sPredictions.predictedMain2,
      predictedMain3: uk49sPredictions.predictedMain3,
      predictedMain4: uk49sPredictions.predictedMain4,
      predictedBooster: uk49sPredictions.predictedBooster,
      modelConfigId: uk49sPredictions.modelConfigId,
      trainingCutoff: uk49sPredictions.trainingCutoff,
      status: uk49sPredictions.status,
      mainHits: uk49sPredictions.mainHits,
      boosterHit: uk49sPredictions.boosterHit,
      actualMain1: uk49sPredictions.actualMain1,
      actualMain2: uk49sPredictions.actualMain2,
      actualMain3: uk49sPredictions.actualMain3,
      actualMain4: uk49sPredictions.actualMain4,
      actualMain5: uk49sPredictions.actualMain5,
      actualMain6: uk49sPredictions.actualMain6,
      actualBooster: uk49sPredictions.actualBooster,
      createdAt: uk49sPredictions.createdAt,
      modelVersion: uk49sModelConfigs.version,
    })
    .from(uk49sPredictions)
    .leftJoin(uk49sModelConfigs, eq(uk49sPredictions.modelConfigId, uk49sModelConfigs.id))
    .where(eq(uk49sPredictions.id, predictionId))
    .limit(1);
  
  if (prediction.length === 0) return null;
  
  const p = prediction[0];
  return {
    id: p.id,
    drawType: p.drawType,
    predictionDate: p.predictionDate,
    predictedMain: [p.predictedMain1, p.predictedMain2, p.predictedMain3, p.predictedMain4],
    predictedBooster: p.predictedBooster,
    modelConfigId: p.modelConfigId,
    modelVersion: p.modelVersion,
    trainingCutoff: p.trainingCutoff,
    status: p.status,
    mainHits: p.mainHits,
    boosterHit: p.boosterHit,
    actualMain: p.actualMain1 ? [p.actualMain1, p.actualMain2!, p.actualMain3!, p.actualMain4!, p.actualMain5!, p.actualMain6!] : null,
    actualBooster: p.actualBooster,
    createdAt: p.createdAt,
  };
}

// Get latest prediction
export async function getLatestPrediction(drawType: DrawType): Promise<PredictionInfo | null> {
  const prediction = await db
    .select()
    .from(uk49sPredictions)
    .where(eq(uk49sPredictions.drawType, drawType))
    .orderBy(desc(uk49sPredictions.predictionDate))
    .limit(1);
  
  if (prediction.length === 0) return null;
  
  return getPredictionInfo(prediction[0].id);
}

// Get prediction history
export async function getPredictionHistory(
  drawType: DrawType,
  limit = 50,
  offset = 0,
  since: Date | null = null
): Promise<PredictionInfo[]> {
  // `since` scopes the history to the current active model so statistics from a
  // previous model are no longer counted (see lib/stats-scope.ts).
  const predictions = await db
    .select()
    .from(uk49sPredictions)
    .where(
      since
        ? and(eq(uk49sPredictions.drawType, drawType), gte(uk49sPredictions.createdAt, since))
        : eq(uk49sPredictions.drawType, drawType)
    )
    .orderBy(desc(uk49sPredictions.predictionDate))
    .limit(limit)
    .offset(offset);
  
  const infos = await Promise.all(predictions.map(p => getPredictionInfo(p.id)));
  return infos.filter((p): p is PredictionInfo => p !== null);
}

// Update model with optimization results
export async function updateActiveModel(
  drawType: DrawType,
  weights: FeatureWeights,
  lookbackWindow: number,
  constraints: DiversityConstraints,
  validation4HitRate: number,
  validationAvgHits: number,
  validationSampleSize: number
): Promise<number> {
  // Archive current active model
  await db.update(uk49sModelConfigs)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(
      eq(uk49sModelConfigs.drawType, drawType),
      eq(uk49sModelConfigs.status, "active")
    ));
  
  // Create new model
  const version = `v${Date.now()}`;
  const [newModel] = await db.insert(uk49sModelConfigs).values({
    drawType,
    version,
    status: "active",
    weightFrequency: weights.weightFrequency,
    weightRecency: weights.weightRecency,
    weightHotCold: weights.weightHotCold,
    weightGapAnalysis: weights.weightGapAnalysis,
    weightPairs: weights.weightPairs,
    weightTriples: weights.weightTriples,
    weightConsecutive: weights.weightConsecutive,
    weightOddEven: weights.weightOddEven,
    weightLowHigh: weights.weightLowHigh,
    weightSumRange: weights.weightSumRange,
    weightPositional: weights.weightPositional,
    weightRepeat: weights.weightRepeat,
    weightFirst3Minus2: weights.weightFirst3Minus2,
    lookbackWindow,
    enforceDiversity: constraints.enforceDiversity,
    minNumberSpread: constraints.minNumberSpread,
    maxSameGroup: constraints.maxSameGroup,
    validation4HitRate,
    validationAvgHits,
    validationSampleSize,
    description: `Optimized SuperHybrid model`,
  }).returning();
  
  return newModel.id;
}

// Get all model versions
export async function getModelHistory(drawType: DrawType): Promise<ModelInfo[]> {
  const models = await db
    .select()
    .from(uk49sModelConfigs)
    .where(eq(uk49sModelConfigs.drawType, drawType))
    .orderBy(desc(uk49sModelConfigs.createdAt));
  
  return models.map(m => ({
    id: m.id,
    drawType: m.drawType,
    version: m.version,
    status: m.status,
    weights: {
      weightFrequency: m.weightFrequency,
      weightRecency: m.weightRecency,
      weightHotCold: m.weightHotCold,
      weightGapAnalysis: m.weightGapAnalysis,
      weightPairs: m.weightPairs,
      weightTriples: m.weightTriples,
      weightConsecutive: m.weightConsecutive,
      weightOddEven: m.weightOddEven,
      weightLowHigh: m.weightLowHigh,
      weightSumRange: m.weightSumRange,
      weightPositional: m.weightPositional,
      weightRepeat: m.weightRepeat,
      weightFirst3Minus2: m.weightFirst3Minus2,
    },
    lookbackWindow: m.lookbackWindow,
    constraints: {
      enforceDiversity: m.enforceDiversity,
      minNumberSpread: m.minNumberSpread,
      maxSameGroup: m.maxSameGroup,
    },
    trainingCutoff: m.trainingCutoff,
    validation4HitRate: m.validation4HitRate,
    validationAvgHits: m.validationAvgHits,
    validationSampleSize: m.validationSampleSize,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }));
}
