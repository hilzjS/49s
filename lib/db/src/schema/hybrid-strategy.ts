/**
 * UK49s "Super Hybrid" strategy — Frequency + Gap + Bonus-influence.
 *
 * This is a second, selectable prediction strategy that sits alongside the
 * existing 13-feature SuperHybrid engine. It reproduces the reference
 * "Super Hybrid" scoring:
 *
 *   score = weightFrequency * frequencyScore
 *         + weightGapAnalysis * gapScore
 *         + weightBonusInfluence * bonusScore
 *
 * with the classic weights 0.5 / 0.3 / 0.2 (DEFAULT_HYBRID_WEIGHTS). The top
 * `poolSize` numbers form a "hybrid pool"; the best 4 become the main numbers
 * and the next best available number becomes the booster.
 *
 * IMPORTANT: everything here is computed from draws strictly BEFORE the target
 * draw. The reference script scored numbers using the *next* draw's numbers
 * (future data leakage); that is deliberately NOT reproduced — a number's
 * "bonus influence" is its historical booster-ball frequency, which is only
 * ever known in the past.
 *
 * As with the rest of the platform: these are historical statistical patterns,
 * NOT predictions of future outcomes.
 */

import type { Uk49sDraw } from "./uk49s";
import { drawToNumbers } from "./uk49s";
import { DEFAULT_WEIGHTS, type FeatureWeights } from "./feature-engine";

/** The selectable prediction strategies. */
export type PredictionStrategy = "superhybrid" | "hybrid" | "superhybrid3";

/** Every engine the platform can run, in showdown comparison order. */
export const PREDICTION_STRATEGIES: readonly PredictionStrategy[] = [
  "superhybrid",
  "hybrid",
  "superhybrid3",
];

export function isPredictionStrategy(value: unknown): value is PredictionStrategy {
  return PREDICTION_STRATEGIES.includes(value as PredictionStrategy);
}

/** Default Super Hybrid weights: frequency 0.5, gap 0.3, bonus-influence 0.2. */
export const DEFAULT_HYBRID_WEIGHTS: FeatureWeights = {
  ...DEFAULT_WEIGHTS,
  weightFrequency: 0.5,
  weightRecency: 0,
  weightHotCold: 0,
  weightGapAnalysis: 0.3,
  weightPairs: 0,
  weightTriples: 0,
  weightConsecutive: 0,
  weightOddEven: 0,
  weightLowHigh: 0,
  weightSumRange: 0,
  weightPositional: 0,
  weightRepeat: 0,
  weightFirst3Minus2: 0,
  weightBonusInfluence: 0.2,
};

/** Shipped defaults for the third engine (see superhybrid3-strategy.ts). */
export const DEFAULT_V3_WEIGHTS: FeatureWeights = {
  ...DEFAULT_WEIGHTS,
  weightFrequency: 3.0,
  weightRecency: 0.35,
  weightHotCold: 1.5,
  weightGapAnalysis: 2.0,
  weightPairs: 0,
  weightTriples: 0,
  weightConsecutive: 0,
  weightOddEven: 0,
  weightLowHigh: 0,
  weightSumRange: 0,
  weightPositional: 0,
  weightRepeat: 0,
  weightFirst3Minus2: 0,
  weightBonusInfluence: 0,
  weightMomentum: 1.5,
  weightNeighbour: 1.2,
};

/** The shipped weights of each engine — what a fresh model starts from. */
export function defaultWeightsForStrategy(strategy: PredictionStrategy): FeatureWeights {
  if (strategy === "hybrid") return { ...DEFAULT_HYBRID_WEIGHTS };
  if (strategy === "superhybrid3") return { ...DEFAULT_V3_WEIGHTS };
  return { ...DEFAULT_WEIGHTS };
}

/** Size of the "hybrid pool" the main numbers are drawn from. */
export const DEFAULT_HYBRID_POOL_SIZE = 10;
export const HYBRID_POOL_OPTIONS = [5, 8, 10, 12, 15, 20] as const;
/** Lookback windows that make sense for the short-memory hybrid strategy. */
export const HYBRID_LOOKBACK_OPTIONS = [10, 20, 30, 60, 90, 180] as const;

export interface HybridNumberScore {
  number: number;
  /** Normalised appearance frequency of the number's main-ball history (0-1). */
  frequencyScore: number;
  /** Normalised recency — recently drawn numbers score higher (0-1). */
  gapScore: number;
  /** Normalised booster-ball frequency (0-1). */
  bonusScore: number;
  /** Weighted combination used for ranking. */
  overallScore: number;
}

export interface HybridPredictionResult {
  /** Exactly 4 numbers. */
  mainNumbers: number[];
  /** Exactly 1 booster. */
  boosterBall: number;
  /** The ranked hybrid pool the main numbers were selected from. */
  pool: number[];
  componentScores: HybridNumberScore[];
  trainingCutoff: string;
}

function numbersInWindow(draws: Uk49sDraw[], lookbackWindow?: number): Uk49sDraw[] {
  if (!lookbackWindow || lookbackWindow <= 0) return draws;
  return draws.slice(-lookbackWindow);
}

/** Appearance count of each main number (1-49) within the window. */
export function buildFrequencyMap(draws: Uk49sDraw[], lookbackWindow?: number): Map<number, number> {
  const window = numbersInWindow(draws, lookbackWindow);
  const freq = new Map<number, number>();
  for (let n = 1; n <= 49; n++) freq.set(n, 0);

  for (const draw of window) {
    const { main } = drawToNumbers(draw);
    for (const num of main) {
      freq.set(num, (freq.get(num) ?? 0) + 1);
    }
  }

  return freq;
}

/**
 * Draws since each number last appeared as a main number. `0` means it appeared
 * in the most recent draw of the window; numbers that never appeared get the
 * window length.
 */
export function buildGapMap(draws: Uk49sDraw[], lookbackWindow?: number): Map<number, number> {
  const window = numbersInWindow(draws, lookbackWindow);
  const gap = new Map<number, number>();
  for (let n = 1; n <= 49; n++) gap.set(n, window.length);

  // Walk forwards so the MOST RECENT occurrence wins (smallest gap).
  for (let i = 0; i < window.length; i++) {
    const { main } = drawToNumbers(window[i]);
    for (const num of main) {
      gap.set(num, window.length - 1 - i);
    }
  }

  return gap;
}

/** How often each number appeared as the booster ball within the window. */
export function buildBonusInfluenceMap(draws: Uk49sDraw[], lookbackWindow?: number): Map<number, number> {
  const window = numbersInWindow(draws, lookbackWindow);
  const bonus = new Map<number, number>();
  for (let n = 1; n <= 49; n++) bonus.set(n, 0);

  for (const draw of window) {
    const { booster } = drawToNumbers(draw);
    bonus.set(booster, (bonus.get(booster) ?? 0) + 1);
  }

  return bonus;
}

/**
 * Scores every number 1-49 with the Super Hybrid components and the supplied
 * weights. Component scores are normalised to 0-1 so the weights are directly
 * comparable.
 */
export function scoreHybridNumbers(
  draws: Uk49sDraw[],
  weights: FeatureWeights = DEFAULT_HYBRID_WEIGHTS,
  lookbackWindow?: number,
): HybridNumberScore[] {
  const freq = buildFrequencyMap(draws, lookbackWindow);
  const gap = buildGapMap(draws, lookbackWindow);
  const bonus = buildBonusInfluenceMap(draws, lookbackWindow);

  const maxFreq = Math.max(1, ...freq.values());
  const maxBonus = Math.max(1, ...bonus.values());

  const scores: HybridNumberScore[] = [];
  for (let n = 1; n <= 49; n++) {
    const frequencyScore = (freq.get(n) ?? 0) / maxFreq;
    // Reference formula (10 - gap), clamped to 0-1: small gaps (recent) score high.
    const gapScore = Math.max(0, Math.min(1, (10 - (gap.get(n) ?? 10)) / 10));
    const bonusScore = (bonus.get(n) ?? 0) / maxBonus;

    const overallScore =
      frequencyScore * weights.weightFrequency +
      gapScore * weights.weightGapAnalysis +
      bonusScore * weights.weightBonusInfluence;

    scores.push({ number: n, frequencyScore, gapScore, bonusScore, overallScore });
  }

  return scores;
}

/** The ranked hybrid pool: the top `poolSize` numbers by overall score. */
export function selectHybridPool(scores: HybridNumberScore[], poolSize = DEFAULT_HYBRID_POOL_SIZE): number[] {
  const size = Math.max(4, Math.min(49, Math.floor(poolSize) || DEFAULT_HYBRID_POOL_SIZE));
  return [...scores]
    .sort((a, b) => b.overallScore - a.overallScore || a.number - b.number)
    .slice(0, size)
    .map((score) => score.number);
}

/**
 * Generates a Super Hybrid prediction from draws that are strictly before the
 * target draw. Returns exactly 4 main numbers and 1 booster.
 */
export function generateHybridPrediction(
  draws: Uk49sDraw[],
  weights: FeatureWeights = DEFAULT_HYBRID_WEIGHTS,
  lookbackWindow = 30,
  poolSize = DEFAULT_HYBRID_POOL_SIZE,
): HybridPredictionResult {
  if (draws.length === 0) {
    throw new Error("No historical draws available for hybrid prediction");
  }

  const trainingDraws = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const trainingCutoff = trainingDraws[trainingDraws.length - 1].drawDate;

  const scores = scoreHybridNumbers(trainingDraws, weights, lookbackWindow);
  const pool = selectHybridPool(scores, poolSize);

  const mainNumbers = pool.slice(0, 4).sort((a, b) => a - b);

  const boosterBall =
    pool.find((n) => !mainNumbers.includes(n)) ??
    [...scores]
      .sort((a, b) => b.overallScore - a.overallScore)
      .map((s) => s.number)
      .find((n) => !mainNumbers.includes(n)) ??
    mainNumbers[0];

  return {
    mainNumbers,
    boosterBall,
    pool,
    componentScores: scores,
    trainingCutoff,
  };
}

/** JSON-serialisable form stored on the prediction row for transparency. */
export function hybridPredictionToJson(result: HybridPredictionResult): Record<string, unknown> {
  return {
    strategy: "hybrid",
    mainNumbers: result.mainNumbers,
    boosterBall: result.boosterBall,
    pool: result.pool,
    trainingCutoff: result.trainingCutoff,
    componentScores: result.componentScores.map((score) => ({
      number: score.number,
      frequencyScore: score.frequencyScore,
      gapScore: score.gapScore,
      bonusScore: score.bonusScore,
      overallScore: score.overallScore,
    })),
  };
}
