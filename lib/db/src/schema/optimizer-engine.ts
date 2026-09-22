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

/** Why the search stopped. */
export type OptimizerStopReason =
  | "four-hit-found"
  | "max-configurations-reached"
  | "search-exhausted";

/**
 * One historical validation prediction. Recorded only when it matched exactly
 * four numbers, so the 4-hit target can be evidenced rather than asserted.
 */
export interface FourHitRecord {
  validationDrawDate: string;
  trainingCutoff: string;
  predictedMain: number[];
  predictedBooster: number;
  actualMain: number[];
  actualBooster: number;
  mainHits: number;
}

/** How many example 4-hit predictions are kept per configuration. */
export const MAX_FOUR_HIT_EXAMPLES = 5;

export interface OptimizerResult {
  bestWeights: FeatureWeights;
  bestConstraints: DiversityConstraints;
  bestLookbackWindow: number;
  validationResult: BacktestResult;
  testResult?: BacktestResult;
  iterations: number;
  allResults: ConfigurationResult[];
  /** Every configuration that produced at least one exact 4-hit prediction. */
  fourHitResults: ConfigurationResult[];
  /** True when at least one validation prediction matched exactly 4 numbers. */
  fourHitFound: boolean;
  /** Best single-prediction hit count seen during the whole search. */
  maxHits: number;
  /** Configurations actually evaluated. */
  evaluatedConfigurations: number;
  stoppedReason: OptimizerStopReason;
}

export interface ConfigurationResult {
  weights: FeatureWeights;
  constraints: DiversityConstraints;
  lookbackWindow: number;
  validation4HitRate: number;
  validationAvgHits: number;
  validationSampleSize: number;
  validationBoosterHitRate: number;
  /** Highest number of matches achieved by a single validation prediction. */
  validationMaxHits: number;
  /** Number of validation predictions that matched exactly 4 numbers. */
  validationFourHitCount: number;
  /** The exact 4-hit predictions (evidenced from the actual historical draws). */
  fourHitExamples: FourHitRecord[];
  stabilityScore: number;
  randomSeed: number;
}

/**
 * Search control only. The configuration generation, evaluation and scoring are
 * unchanged — these options merely decide when to stop searching.
 */
export interface OptimizerSearchOptions {
  /** Hard cap on how many configurations may be evaluated. */
  maxConfigurations?: number;
  /** Stop as soon as a valid 4-hit validation result is found. */
  stopOnFourHit?: boolean;
}

/**
 * Progress payload emitted after each configuration is evaluated. Reporting
 * only — the search strategy, scoring and configuration generation are
 * unchanged.
 */
export interface OptimizerProgress {
  /** Configurations evaluated so far. */
  iteration: number;
  bestScore: number;
  bestResult: ConfigurationResult | null;
  /** The configuration just evaluated. */
  current: {
    weights: FeatureWeights;
    constraints: DiversityConstraints;
    lookbackWindow: number;
  };
  phase: "random-search" | "hill-climbing";
  /** Best single-prediction hit count seen so far. */
  maxHits: number;
  /** Number of configurations that produced at least one exact 4-hit. */
  fourHitCount: number;
  /** Whether a valid 4-hit validation result has been found. */
  fourHitFound: boolean;
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
  
    /**
     * Reporting only: the existing backtest already compares every prediction
     * against the actual historical draw. These derived counters surface that
     * comparison so a genuine 4-hit can be evidenced instead of inferred. The
     * hit counts themselves are produced by the existing scoring pipeline.
     */
    const fourHitPredictions = result.predictions.filter((prediction) => prediction.mainHits === 4);
    
      const fourHitExamples: FourHitRecord[] = fourHitPredictions
        .slice(0, MAX_FOUR_HIT_EXAMPLES)
        .map((prediction) => ({
        validationDrawDate: prediction.predictionDate,
        trainingCutoff: prediction.trainingCutoff,
        predictedMain: prediction.predictedMain,
        predictedBooster: prediction.predictedBooster,
        actualMain: prediction.actualMain,
        actualBooster: prediction.actualBooster,
        mainHits: prediction.mainHits,
      }));
  
    const validationMaxHits = result.predictions.reduce(
      (max, prediction) => Math.max(max, prediction.mainHits),
      0,
    );
  
    return {
      weights: config.weights,
      constraints: config.constraints,
      lookbackWindow: config.lookbackWindow,
      validation4HitRate: result.fourHitRate,
      validationAvgHits: result.avgMainHits,
      validationSampleSize: result.totalPredictions,
      validationBoosterHitRate: result.boosterHitRate,
      validationMaxHits,
          validationFourHitCount: fourHitPredictions.length,
          fourHitExamples,
      stabilityScore,
      randomSeed: seed,
    };
  }

// Main optimization function
export function optimizeModel(
  draws: Uk49sDraw[],
  optimizerConfig: OptimizerConfig,
  progressCallback?: (progress: OptimizerProgress) => void,
  searchOptions?: OptimizerSearchOptions
): OptimizerResult {
  const rng = optimizerConfig.randomSeed
    ? seededRandom(optimizerConfig.randomSeed)
    : Math.random;

  const maxConfigurations =
    searchOptions?.maxConfigurations && searchOptions.maxConfigurations > 0
      ? searchOptions.maxConfigurations
      : Number.POSITIVE_INFINITY;
  const stopOnFourHit = searchOptions?.stopOnFourHit === true;

  const allResults: ConfigurationResult[] = [];
  const fourHitResults: ConfigurationResult[] = [];
  let bestResult: ConfigurationResult | null = null;
  let bestScore = -Infinity;
  let maxHits = 0;
  let evaluated = 0;
  let stoppedReason: OptimizerStopReason = "search-exhausted";
  let targetFound = false;

  /**
   * Applies the existing scoring rule (unchanged), the existing minimum-sample
   * guard, and additionally remembers any configuration that produced a genuine
   * 4-hit. Returns true when the search must stop because the target was hit.
   */
  const recordResult = (result: ConfigurationResult): boolean => {
    allResults.push(result);
    evaluated += 1;

    maxHits = Math.max(maxHits, result.validationMaxHits);

    if (result.validationFourHitCount > 0) {
      fourHitResults.push(result);
      targetFound = true;
    }

    // Score based on 4-hit rate (primary) and sample size (secondary)
    const score = result.validation4HitRate * 100 + (result.stabilityScore * 0.1);

    if (score > bestScore && result.validationSampleSize >= optimizerConfig.minValidationSamples) {
      bestScore = score;
      bestResult = result;
    }

    return stopOnFourHit && targetFound;
  };

  // Phase 1: Random Search
  for (let i = 0; i < optimizerConfig.populationSize; i++) {
    if (evaluated >= maxConfigurations) {
      stoppedReason = "max-configurations-reached";
      break;
    }

    // Keep seeds within Postgres int4 range
    const seed = optimizerConfig.randomSeed ? optimizerConfig.randomSeed + i : (1 + i * 7919) % 2147483647;
    const config = generateRandomConfig(rng, seed);
    const result = evaluateConfig(draws, config, optimizerConfig, seed);

    const stop = recordResult(result);

    progressCallback?.({
      iteration: i + 1,
      bestScore,
      bestResult,
      current: config,
      phase: "random-search",
      maxHits,
      fourHitCount: fourHitResults.length,
      fourHitFound: targetFound,
    });

    if (stop) {
      stoppedReason = "four-hit-found";
      break;
    }
  }

  // Phase 2: Hill Climbing from best results (skipped once the target is hit)
  const eliteResults = targetFound && stopOnFourHit
    ? []
    : allResults
        .filter(r => r.validationSampleSize >= optimizerConfig.minValidationSamples)
        .sort((a, b) => b.validation4HitRate - a.validation4HitRate)
        .slice(0, optimizerConfig.eliteSize);

  for (const elite of eliteResults) {
    if (evaluated >= maxConfigurations) {
      stoppedReason = "max-configurations-reached";
      break;
    }

    const eliteConfig = {
      weights: elite.weights,
      constraints: elite.constraints,
      lookbackWindow: elite.lookbackWindow,
    };

    for (let i = 0; i < 50; i++) {
      if (evaluated >= maxConfigurations) {
        stoppedReason = "max-configurations-reached";
        break;
      }

      const mutated = mutateConfig(eliteConfig, rng, optimizerConfig.mutationRate);
      // Keep seeds within Postgres int4 range
      const hillSeed = ((optimizerConfig.randomSeed ?? 1) * 100003 + i * 997) % 2147483647;
      const result = evaluateConfig(draws, mutated, optimizerConfig, hillSeed);

      const score = result.validation4HitRate * 100 + (result.stabilityScore * 0.1);
            allResults.push(result);
            evaluated += 1;
      maxHits = Math.max(maxHits, result.validationMaxHits);

      if (result.validationFourHitCount > 0) {
        fourHitResults.push(result);
        targetFound = true;
      }

      if (score > bestScore && result.validationSampleSize >= optimizerConfig.minValidationSamples) {
        bestScore = score;
        bestResult = result;
        // Update elite config for further mutation
        Object.assign(eliteConfig, mutated);
      }

      progressCallback?.({
        iteration: optimizerConfig.populationSize + i + 1,
        bestScore,
        bestResult,
        current: mutated,
        phase: "hill-climbing",
        maxHits,
        fourHitCount: fourHitResults.length,
        fourHitFound: targetFound,
      });

      if (stopOnFourHit && targetFound) {
        stoppedReason = "four-hit-found";
        break;
      }
    }

    if (stoppedReason === "four-hit-found" || stoppedReason === "max-configurations-reached") break;
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
      fourHitResults,
      fourHitFound: fourHitResults.length > 0,
      maxHits,
      evaluatedConfigurations: evaluated,
      stoppedReason,
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
    fourHitResults,
    fourHitFound: fourHitResults.length > 0,
    maxHits,
    evaluatedConfigurations: evaluated,
    stoppedReason,
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
