/**
 * UK49s Optimizer Engine
 * 
 * Implements Random Search + Hill Climbing optimization for model parameters.
 * Includes safeguards against overfitting by requiring sufficient validation samples.
 */

import type { Uk49sDraw, DrawType } from "./uk49s";
import { DEFAULT_WEIGHTS, type FeatureWeights, type DiversityConstraints } from "./feature-engine";
import { runBacktest, type BacktestConfig, type BacktestResult } from "./backtest-engine";

export interface OptimizerConfig {
  drawType: DrawType;
  maxIterations: number;
  populationSize: number;
  eliteSize: number;
  mutationRate: number;
  trainStartDate: string;
  trainEndDate: string;
  validationStartDate: string;
  validationEndDate: string;
  testStartDate?: string;
  testEndDate?: string;
  minValidationSamples: number;
  randomSeed?: number;
}

export interface OptimizerResult {
  bestWeights: FeatureWeights;
  bestConstraints: DiversityConstraints;
  bestLookbackWindow: number;
  validationResult: BacktestResult;
  testResult?: BacktestResult;
  iterations: number;
  allResults: ConfigurationResult[];
}

export interface ConfigurationResult {
  weights: FeatureWeights;
  constraints: DiversityConstraints;
  lookbackWindow: number;
  validation4HitRate: number;
  validationAvgHits: number;
  validationSampleSize: number;
  validationBoosterHitRate: number;
  stabilityScore: number;
  randomSeed: number;
}

// Weight ranges for mutation
const WEIGHT_MIN = 0.0;
const WEIGHT_MAX = 3.0;
const WEIGHT_STEP = 0.1;

const LOOKBACK_OPTIONS = [30, 60, 90, 180, 365];

// Seeded random for reproducibility
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function randomInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randomFloat(rng: () => number, min: number, max: number): number {
  return rng() * (max - min) + min;
}

// Generate random configuration
function generateRandomConfig(
  rng: () => number,
  seed: number
): { weights: FeatureWeights; constraints: DiversityConstraints; lookbackWindow: number } {
  const weights: FeatureWeights = { ...DEFAULT_WEIGHTS };
  
  // Mutate weights
  for (const key of Object.keys(weights) as (keyof FeatureWeights)[]) {
    weights[key] = Math.round(randomFloat(rng, WEIGHT_MIN, WEIGHT_MAX) / WEIGHT_STEP) * WEIGHT_STEP;
  }
  
  // Random constraints
  const constraints: DiversityConstraints = {
    enforceDiversity: rng() > 0.3,
    minNumberSpread: randomInt(rng, 5, 20),
    maxSameGroup: randomInt(rng, 1, 3),
  };
  
  // Random lookback window
  const lookbackWindow = LOOKBACK_OPTIONS[randomInt(rng, 0, LOOKBACK_OPTIONS.length - 1)];
  
  return { weights, constraints, lookbackWindow };
}

// Mutate a configuration (for hill climbing)
function mutateConfig(
  config: { weights: FeatureWeights; constraints: DiversityConstraints; lookbackWindow: number },
  rng: () => number,
  mutationRate: number
): { weights: FeatureWeights; constraints: DiversityConstraints; lookbackWindow: number } {
  const newWeights = { ...config.weights };
  const newConstraints = { ...config.constraints };
  
  // Mutate each weight with probability mutationRate
  for (const key of Object.keys(newWeights) as (keyof FeatureWeights)[]) {
    if (rng() < mutationRate) {
      // Add or subtract a small amount
      const delta = (rng() > 0.5 ? 1 : -1) * WEIGHT_STEP;
      newWeights[key] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, newWeights[key] + delta));
    }
  }
  
  // Mutate constraints
  if (rng() < mutationRate) {
    newConstraints.enforceDiversity = !newConstraints.enforceDiversity;
  }
  if (rng() < mutationRate) {
    newConstraints.minNumberSpread = Math.max(5, Math.min(20, newConstraints.minNumberSpread + (rng() > 0.5 ? 1 : -1)));
  }
  if (rng() < mutationRate) {
    newConstraints.maxSameGroup = Math.max(1, Math.min(3, newConstraints.maxSameGroup + (rng() > 0.5 ? 1 : -1)));
  }
  
  // Occasionally change lookback window
  if (rng() < mutationRate * 0.3) {
    config.lookbackWindow = LOOKBACK_OPTIONS[randomInt(rng, 0, LOOKBACK_OPTIONS.length - 1)];
  }
  
  return { weights: newWeights, constraints: newConstraints, lookbackWindow: config.lookbackWindow };
}

// Evaluate a configuration
function evaluateConfig(
  draws: Uk49sDraw[],
  config: { weights: FeatureWeights; constraints: DiversityConstraints; lookbackWindow: number },
  optimizerConfig: OptimizerConfig,
  seed: number
): ConfigurationResult {
  const backtestConfig: BacktestConfig = {
    drawType: optimizerConfig.drawType,
    lookbackWindow: config.lookbackWindow,
    testStartDate: optimizerConfig.validationStartDate,
    testEndDate: optimizerConfig.validationEndDate,
    randomSeed: seed,
  };
  
  const result = runBacktest(draws, backtestConfig, config.weights, config.constraints);
  
  // Calculate stability score (would need multiple runs in production)
  // Simplified: use sample size as proxy for stability
  const stabilityScore = result.totalPredictions >= optimizerConfig.minValidationSamples ? 1 : 0.5;
  
  return {
    weights: config.weights,
    constraints: config.constraints,
    lookbackWindow: config.lookbackWindow,
    validation4HitRate: result.fourHitRate,
    validationAvgHits: result.avgMainHits,
    validationSampleSize: result.totalPredictions,
    validationBoosterHitRate: result.boosterHitRate,
    stabilityScore,
    randomSeed: seed,
  };
}

// Main optimization function
export function optimizeModel(
  draws: Uk49sDraw[],
  optimizerConfig: OptimizerConfig,
  progressCallback?: (iteration: number, bestScore: number) => void
): OptimizerResult {
  const rng = optimizerConfig.randomSeed
    ? seededRandom(optimizerConfig.randomSeed)
    : Math.random;
  
  const allResults: ConfigurationResult[] = [];
  let bestResult: ConfigurationResult | null = null;
  let bestScore = -Infinity;
  
  // Phase 1: Random Search
  for (let i = 0; i < optimizerConfig.populationSize; i++) {
    // Keep seeds within Postgres int4 range
    const seed = optimizerConfig.randomSeed ? optimizerConfig.randomSeed + i : (1 + i * 7919) % 2147483647;
    const config = generateRandomConfig(rng, seed);
    const result = evaluateConfig(draws, config, optimizerConfig, seed);
    
    allResults.push(result);
    
    // Score based on 4-hit rate (primary) and sample size (secondary)
    const score = result.validation4HitRate * 100 + (result.stabilityScore * 0.1);
    
    if (score > bestScore && result.validationSampleSize >= optimizerConfig.minValidationSamples) {
      bestScore = score;
      bestResult = result;
    }
    
    progressCallback?.(i + 1, bestScore);
  }
  
  // Phase 2: Hill Climbing from best results
  const eliteResults = allResults
    .filter(r => r.validationSampleSize >= optimizerConfig.minValidationSamples)
    .sort((a, b) => b.validation4HitRate - a.validation4HitRate)
    .slice(0, optimizerConfig.eliteSize);
  
  for (const elite of eliteResults) {
    const eliteConfig = {
      weights: elite.weights,
      constraints: elite.constraints,
      lookbackWindow: elite.lookbackWindow,
    };
    
    for (let i = 0; i < 50; i++) {
      const mutated = mutateConfig(eliteConfig, rng, optimizerConfig.mutationRate);
      // Keep seeds within Postgres int4 range
      const hillSeed = ((optimizerConfig.randomSeed ?? 1) * 100003 + i * 997) % 2147483647;
      const result = evaluateConfig(draws, mutated, optimizerConfig, hillSeed);
      
      allResults.push(result);
      
      const score = result.validation4HitRate * 100 + (result.stabilityScore * 0.1);
      
      if (score > bestScore && result.validationSampleSize >= optimizerConfig.minValidationSamples) {
        bestScore = score;
        bestResult = result;
        // Update elite config for further mutation
        Object.assign(eliteConfig, mutated);
      }
      
      progressCallback?.(optimizerConfig.populationSize + i + 1, bestScore);
    }
  }
  
  if (!bestResult) {
    // Fall back to defaults
    return {
      bestWeights: DEFAULT_WEIGHTS,
      bestConstraints: { enforceDiversity: true, minNumberSpread: 10, maxSameGroup: 2 },
      bestLookbackWindow: 90,
      validationResult: createEmptyBacktestResult(),
      iterations: allResults.length,
      allResults,
    };
  }
  
  // Run final validation on test set if provided
  let testResult: BacktestResult | undefined;
  if (optimizerConfig.testStartDate && optimizerConfig.testEndDate) {
    const testConfig: BacktestConfig = {
      drawType: optimizerConfig.drawType,
      lookbackWindow: bestResult.lookbackWindow,
      testStartDate: optimizerConfig.testStartDate,
      testEndDate: optimizerConfig.testEndDate,
      randomSeed: optimizerConfig.randomSeed,
    };
    testResult = runBacktest(draws, testConfig, bestResult.weights, bestResult.constraints);
  }
  
  // Run validation result again for final output
  const finalValidationConfig: BacktestConfig = {
    drawType: optimizerConfig.drawType,
    lookbackWindow: bestResult.lookbackWindow,
    testStartDate: optimizerConfig.validationStartDate,
    testEndDate: optimizerConfig.validationEndDate,
    randomSeed: optimizerConfig.randomSeed,
  };
  const validationResult = runBacktest(draws, finalValidationConfig, bestResult.weights, bestResult.constraints);
  
  return {
    bestWeights: bestResult.weights,
    bestConstraints: bestResult.constraints,
    bestLookbackWindow: bestResult.lookbackWindow,
    validationResult,
    testResult,
    iterations: allResults.length,
    allResults,
  };
}

function createEmptyBacktestResult(): BacktestResult {
  return {
    totalPredictions: 0,
    hitDistribution: [],
    avgMainHits: 0,
    medianMainHits: 0,
    maxMainHits: 0,
    fourHitCount: 0,
    fourHitRate: 0,
    boosterHitCount: 0,
    boosterHitRate: 0,
    predictions: [],
  };
}

// Quick optimization for single lookback window
export function optimizeWeightsForWindow(
  draws: Uk49sDraw[],
  drawType: DrawType,
  lookbackWindow: number,
  trainStartDate: string,
  trainEndDate: string,
  validationStartDate: string,
  validationEndDate: string,
  iterations: number = 500,
  randomSeed?: number
): { weights: FeatureWeights; result: BacktestResult } {
  const optimizerConfig: OptimizerConfig = {
    drawType,
    maxIterations: iterations,
    populationSize: Math.floor(iterations * 0.7),
    eliteSize: 10,
    mutationRate: 0.2,
    trainStartDate,
    trainEndDate,
    validationStartDate,
    validationEndDate,
    minValidationSamples: 50,
    randomSeed,
  };
  
  const result = optimizeModel(draws, optimizerConfig);
  
  return {
    weights: result.bestWeights,
    result: result.validationResult,
  };
}

// Cross-validation for stability testing
export interface CrossValidationResult {
  fold: number;
  trainStart: string;
  trainEnd: string;
  validationStart: string;
  validationEnd: string;
  fourHitRate: number;
  avgHits: number;
  sampleSize: number;
}

export function crossValidateModel(
  draws: Uk49sDraw[],
  drawType: DrawType,
  weights: FeatureWeights,
  lookbackWindow: number,
  nFolds: number = 5
): CrossValidationResult[] {
  const filteredDraws = draws
    .filter(d => d.drawType === drawType)
    .sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  
  if (filteredDraws.length < lookbackWindow * nFolds * 2) {
    return [];
  }
  
  const results: CrossValidationResult[] = [];
  const foldSize = Math.floor(filteredDraws.length / nFolds);
  
  for (let fold = 0; fold < nFolds; fold++) {
    const valStartIdx = fold * foldSize;
    const valEndIdx = valStartIdx + foldSize;
    
    const valStartDate = filteredDraws[valStartIdx].drawDate;
    const valEndDate = filteredDraws[Math.min(valEndIdx, filteredDraws.length - 1)].drawDate;
    
    const trainEndIdx = Math.max(0, valStartIdx - 1);
    const trainStartIdx = Math.max(0, trainEndIdx - lookbackWindow);
    
    const trainStartDate = filteredDraws[trainStartIdx].drawDate;
    const trainEndDate = filteredDraws[trainEndIdx].drawDate;
    
    const config: BacktestConfig = {
      drawType,
      lookbackWindow,
      testStartDate: valStartDate,
      testEndDate: valEndDate,
    };
    
    const backtestResult = runBacktest(draws, config, weights);
    
    results.push({
      fold: fold + 1,
      trainStart: trainStartDate,
      trainEnd: trainEndDate,
      validationStart: valStartDate,
      validationEnd: valEndDate,
      fourHitRate: backtestResult.fourHitRate,
      avgHits: backtestResult.avgMainHits,
      sampleSize: backtestResult.totalPredictions,
    });
  }
  
  return results;
}

// Calculate stability metrics across folds
export interface StabilityMetrics {
  avgFourHitRate: number;
  stdFourHitRate: number;
  avgAvgHits: number;
  stdAvgHits: number;
  minFourHitRate: number;
  maxFourHitRate: number;
  stabilityScore: number;
}

export function calculateStabilityMetrics(cvResults: CrossValidationResult[]): StabilityMetrics {
  if (cvResults.length === 0) {
    return {
      avgFourHitRate: 0,
      stdFourHitRate: 0,
      avgAvgHits: 0,
      stdAvgHits: 0,
      minFourHitRate: 0,
      maxFourHitRate: 0,
      stabilityScore: 0,
    };
  }
  
  const fourHitRates = cvResults.map(r => r.fourHitRate);
  const avgHits = cvResults.map(r => r.avgHits);
  
  const avgFourHitRate = fourHitRates.reduce((a, b) => a + b, 0) / fourHitRates.length;
  const avgAvgHits = avgHits.reduce((a, b) => a + b, 0) / avgHits.length;
  
  const stdFourHitRate = Math.sqrt(
    fourHitRates.reduce((acc, r) => acc + (r - avgFourHitRate) ** 2, 0) / fourHitRates.length
  );
  const stdAvgHits = Math.sqrt(
    avgHits.reduce((acc, r) => acc + (r - avgAvgHits) ** 2, 0) / avgHits.length
  );
  
  // Stability score: lower variance = higher stability
  const stabilityScore = 1 / (1 + stdFourHitRate * 10);
  
  return {
    avgFourHitRate,
    stdFourHitRate,
    avgAvgHits,
    stdAvgHits,
    minFourHitRate: Math.min(...fourHitRates),
    maxFourHitRate: Math.max(...fourHitRates),
    stabilityScore,
  };
}
