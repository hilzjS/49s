/**
 * UK49s Walk-Forward Backtest Engine
 * 
 * CRITICAL: This module ensures NO FUTURE DATA LEAKAGE.
 * All predictions are made using ONLY data available BEFORE the target draw.
 */

import type { Uk49sDraw, Uk49sModelConfig, DrawType } from "./uk49s";
import { drawToNumbers } from "./uk49s";
import {
  calculateAllFeatureScores,
  selectBestNumbers,
  selectBoosterBall,
  DEFAULT_WEIGHTS,
  type FeatureWeights,
  type DiversityConstraints,
  type NumberFeatureScores,
} from "./feature-engine";

export interface BacktestConfig {
  drawType: DrawType;
  lookbackWindow: number;
  modelConfig?: Partial<FeatureWeights>;
  testStartDate: string;
  testEndDate: string;
  randomSeed?: number;
}

export interface BacktestPrediction {
  predictionDate: string;
  trainingCutoff: string;
  predictedMain: number[];
  predictedBooster: number;
  actualMain: number[];
  actualBooster: number;
  mainHits: number;
  boosterHit: boolean;
  fourPlusHit: boolean;
}

export interface BacktestResult {
  totalPredictions: number;
  hitDistribution: { hits: number; count: number }[];
  avgMainHits: number;
  medianMainHits: number;
  maxMainHits: number;
  fourHitCount: number;
  fourHitRate: number;
  boosterHitCount: number;
  boosterHitRate: number;
  predictions: BacktestPrediction[];
}

// Baseline prediction generators
export function generateRandomPrediction(allNumbers: number[]): { main: number[]; booster: number } {
  const shuffled = [...allNumbers].sort(() => Math.random() - 0.5);
  return {
    main: shuffled.slice(0, 4).sort((a, b) => a - b),
    booster: shuffled[4],
  };
}

export function generateFrequencyPrediction(
  draws: Uk49sDraw[],
  lookbackWindow: number
): { main: number[]; booster: number } {
  // Count frequency of each number
  const recentDraws = draws.slice(-lookbackWindow);
  const counts = new Map<number, number>();
  
  for (let i = 1; i <= 49; i++) counts.set(i, 0);
  
  for (const draw of recentDraws) {
    const { main } = drawToNumbers(draw);
    for (const num of main) {
      counts.set(num, (counts.get(num) || 0) + 1);
    }
  }
  
  // Sort by frequency
  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([num]) => num);
  
  return {
    main: sorted.slice(0, 4),
    booster: sorted[4],
  };
}

// Seeded random for reproducibility
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Run single backtest with a specific model
export function runBacktest(
  draws: Uk49sDraw[],
  config: BacktestConfig,
  weights: FeatureWeights = DEFAULT_WEIGHTS,
  constraints: DiversityConstraints = { enforceDiversity: true, minNumberSpread: 10, maxSameGroup: 2 }
): BacktestResult {
  // Filter to draw type and sort chronologically
  const filteredDraws = draws
    .filter(d => d.drawType === config.drawType)
    .sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  
  // Find test period indices
  const testStartIdx = filteredDraws.findIndex(d => d.drawDate >= config.testStartDate);
  const testEndIdx = filteredDraws.findIndex(d => d.drawDate > config.testEndDate);
  
  if (testStartIdx === -1 || testEndIdx === -1) {
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
  
  const predictions: BacktestPrediction[] = [];
  
  for (let targetIdx = testStartIdx; targetIdx < testEndIdx; targetIdx++) {
    const targetDraw = filteredDraws[targetIdx];
    
    // CRITICAL: Use ONLY draws strictly before the target draw for training
    const trainingDraws = filteredDraws.slice(0, targetIdx);
    
    if (trainingDraws.length < config.lookbackWindow) {
      continue; // Not enough training data
    }
    
    // Use last N draws for training
    const trainingSet = trainingDraws.slice(-config.lookbackWindow);
    const trainingCutoff = trainingSet[trainingSet.length - 1].drawDate;
    
    // Calculate features and generate prediction
    const scores = calculateAllFeatureScores(trainingSet, weights, config.lookbackWindow);
    const predictedMain = selectBestNumbers(scores, constraints);
    const predictedBooster = selectBoosterBall(scores, predictedMain);
    
    // Get actual result
    const actual = drawToNumbers(targetDraw);
    
    // Calculate hits
    const mainHits = predictedMain.filter(n => actual.main.includes(n)).length;
    const boosterHit = predictedBooster === actual.booster;
    
    predictions.push({
      predictionDate: targetDraw.drawDate,
      trainingCutoff,
      predictedMain,
      predictedBooster,
      actualMain: actual.main,
      actualBooster: actual.booster,
      mainHits,
      boosterHit,
      fourPlusHit: mainHits >= 4,
    });
  }
  
  // Calculate statistics
  const hitCounts = new Map<number, number>();
  for (let i = 0; i <= 5; i++) hitCounts.set(i, 0);
  
  for (const pred of predictions) {
    hitCounts.set(pred.mainHits, (hitCounts.get(pred.mainHits) || 0) + 1);
  }
  
  const allHits = predictions.map(p => p.mainHits).sort((a, b) => a - b);
  const avgMainHits = predictions.length > 0
    ? predictions.reduce((sum, p) => sum + p.mainHits, 0) / predictions.length
    : 0;
  const medianMainHits = predictions.length > 0
    ? allHits[Math.floor(allHits.length / 2)]
    : 0;
  const maxMainHits = predictions.length > 0
    ? Math.max(...allHits)
    : 0;
  const fourHitCount = predictions.filter(p => p.fourPlusHit).length;
  const boosterHitCount = predictions.filter(p => p.boosterHit).length;
  
  return {
    totalPredictions: predictions.length,
    hitDistribution: Array.from(hitCounts.entries()).map(([hits, count]) => ({ hits, count })),
    avgMainHits,
    medianMainHits,
    maxMainHits,
    fourHitCount,
    fourHitRate: predictions.length > 0 ? fourHitCount / predictions.length : 0,
    boosterHitCount,
    boosterHitRate: predictions.length > 0 ? boosterHitCount / predictions.length : 0,
    predictions,
  };
}

// Run baseline backtests for comparison
export function runBaselineBacktests(
  draws: Uk49sDraw[],
  config: BacktestConfig,
  randomSeed?: number
): { random: BacktestResult; frequency: BacktestResult } {
  const filteredDraws = draws
    .filter(d => d.drawType === config.drawType)
    .sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  
  const testStartIdx = filteredDraws.findIndex(d => d.drawDate >= config.testStartDate);
  const testEndIdx = filteredDraws.findIndex(d => d.drawDate > config.testEndDate);
  
  if (testStartIdx === -1 || testEndIdx === -1) {
    return {
      random: createEmptyResult(),
      frequency: createEmptyResult(),
    };
  }
  
  const allNumbers = Array.from({ length: 49 }, (_, i) => i + 1);
  const rng = randomSeed ? seededRandom(randomSeed) : Math.random;
  
  const randomPredictions: BacktestPrediction[] = [];
  const frequencyPredictions: BacktestPrediction[] = [];
  
  for (let targetIdx = testStartIdx; targetIdx < testEndIdx; targetIdx++) {
    const targetDraw = filteredDraws[targetIdx];
    const trainingDraws = filteredDraws.slice(0, targetIdx);
    
    if (trainingDraws.length < config.lookbackWindow) continue;
    
    const actual = drawToNumbers(targetDraw);
    
    // Random baseline
    const shuffled = [...allNumbers].sort(() => rng() - 0.5);
    const randMain = shuffled.slice(0, 4).sort((a, b) => a - b);
    const randBooster = shuffled[4];
    const randHits = randMain.filter(n => actual.main.includes(n)).length;
    
    randomPredictions.push({
      predictionDate: targetDraw.drawDate,
      trainingCutoff: trainingDraws[trainingDraws.length - 1].drawDate,
      predictedMain: randMain,
      predictedBooster: randBooster,
      actualMain: actual.main,
      actualBooster: actual.booster,
      mainHits: randHits,
      boosterHit: randBooster === actual.booster,
      fourPlusHit: randHits >= 4,
    });
    
    // Frequency baseline
    const freqPrediction = generateFrequencyPrediction(trainingDraws, config.lookbackWindow);
    const freqHits = freqPrediction.main.filter(n => actual.main.includes(n)).length;
    
    frequencyPredictions.push({
      predictionDate: targetDraw.drawDate,
      trainingCutoff: trainingDraws[trainingDraws.length - 1].drawDate,
      predictedMain: freqPrediction.main,
      predictedBooster: freqPrediction.booster,
      actualMain: actual.main,
      actualBooster: actual.booster,
      mainHits: freqHits,
      boosterHit: freqPrediction.booster === actual.booster,
      fourPlusHit: freqHits >= 4,
    });
  }
  
  return {
    random: calculateStats(randomPredictions),
    frequency: calculateStats(frequencyPredictions),
  };
}

function createEmptyResult(): BacktestResult {
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

function calculateStats(predictions: BacktestPrediction[]): BacktestResult {
  if (predictions.length === 0) return createEmptyResult();
  
  const hitCounts = new Map<number, number>();
  for (let i = 0; i <= 5; i++) hitCounts.set(i, 0);
  
  for (const pred of predictions) {
    hitCounts.set(pred.mainHits, (hitCounts.get(pred.mainHits) || 0) + 1);
  }
  
  const allHits = predictions.map(p => p.mainHits).sort((a, b) => a - b);
  const fourHitCount = predictions.filter(p => p.fourPlusHit).length;
  const boosterHitCount = predictions.filter(p => p.boosterHit).length;
  
  return {
    totalPredictions: predictions.length,
    hitDistribution: Array.from(hitCounts.entries()).map(([hits, count]) => ({ hits, count })),
    avgMainHits: predictions.reduce((sum, p) => sum + p.mainHits, 0) / predictions.length,
    medianMainHits: allHits[Math.floor(allHits.length / 2)],
    maxMainHits: Math.max(...allHits),
    fourHitCount,
    fourHitRate: fourHitCount / predictions.length,
    boosterHitCount,
    boosterHitRate: boosterHitCount / predictions.length,
    predictions,
  };
}

// Rolling performance metrics
export interface RollingMetrics {
  window: number;
  periodStart: string;
  periodEnd: string;
  predictions: number;
  avgHits: number;
  fourHitRate: number;
  boosterHitRate: number;
}

export function calculateRollingMetrics(
  predictions: BacktestPrediction[],
  windows: number[] = [30, 60, 90, 180]
): RollingMetrics[] {
  if (predictions.length === 0) return [];
  
  const results: RollingMetrics[] = [];
  
  for (const window of windows) {
    if (predictions.length < window) continue;
    
    const recentPredictions = predictions.slice(-window);
    const avgHits = recentPredictions.reduce((sum, p) => sum + p.mainHits, 0) / recentPredictions.length;
    const fourHitCount = recentPredictions.filter(p => p.fourPlusHit).length;
    const boosterHitCount = recentPredictions.filter(p => p.boosterHit).length;
    
    results.push({
      window,
      periodStart: recentPredictions[0].predictionDate,
      periodEnd: recentPredictions[recentPredictions.length - 1].predictionDate,
      predictions: window,
      avgHits,
      fourHitRate: fourHitCount / window,
      boosterHitRate: boosterHitCount / window,
    });
  }
  
  return results;
}

// Comprehensive backtest with all baselines
export interface FullBacktestResult {
  superhybrid: BacktestResult;
  randomBaseline: BacktestResult;
  frequencyBaseline: BacktestResult;
  comparison: {
    superhybridVsRandom: { avgHitsDiff: number; fourHitRateDiff: number };
    superhybridVsFrequency: { avgHitsDiff: number; fourHitRateDiff: number };
  };
  rollingMetrics: RollingMetrics[];
}

export function runFullBacktest(
  draws: Uk49sDraw[],
  config: BacktestConfig,
  weights: FeatureWeights = DEFAULT_WEIGHTS,
  constraints: DiversityConstraints = { enforceDiversity: true, minNumberSpread: 10, maxSameGroup: 2 }
): FullBacktestResult {
  // Run SuperHybrid backtest
  const superhybrid = runBacktest(draws, config, weights, constraints);
  
  // Run baseline backtests
  const baselines = runBaselineBacktests(draws, config, config.randomSeed);
  
  // Calculate comparisons
  const comparison = {
    superhybridVsRandom: {
      avgHitsDiff: superhybrid.avgMainHits - baselines.random.avgMainHits,
      fourHitRateDiff: superhybrid.fourHitRate - baselines.random.fourHitRate,
    },
    superhybridVsFrequency: {
      avgHitsDiff: superhybrid.avgMainHits - baselines.frequency.avgMainHits,
      fourHitRateDiff: superhybrid.fourHitRate - baselines.frequency.fourHitRate,
    },
  };
  
  // Calculate rolling metrics
  const rollingMetrics = calculateRollingMetrics(superhybrid.predictions);
  
  return {
    superhybrid,
    randomBaseline: baselines.random,
    frequencyBaseline: baselines.frequency,
    comparison,
    rollingMetrics,
  };
}

// Test different lookback windows
export interface LookbackComparison {
  lookbackWindow: number;
  predictions: number;
  avgMainHits: number;
  fourHitRate: number;
  boosterHitRate: number;
}

export function compareLookbackWindows(
  draws: Uk49sDraw[],
  drawType: DrawType,
  testStartDate: string,
  testEndDate: string,
  windows: number[] = [30, 60, 90, 180, 365],
  weights: FeatureWeights = DEFAULT_WEIGHTS
): LookbackComparison[] {
  const results: LookbackComparison[] = [];
  
  for (const window of windows) {
    const config: BacktestConfig = {
      drawType,
      lookbackWindow: window,
      testStartDate,
      testEndDate,
    };
    
    const result = runBacktest(draws, config, weights);
    
    results.push({
      lookbackWindow: window,
      predictions: result.totalPredictions,
      avgMainHits: result.avgMainHits,
      fourHitRate: result.fourHitRate,
      boosterHitRate: result.boosterHitRate,
    });
  }
  
  return results;
}
