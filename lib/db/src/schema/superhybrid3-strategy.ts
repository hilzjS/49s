/**
 * UK49s "SuperHybrid v3" strategy — Overdue · Momentum · Combinations.
 *
 * A third, selectable prediction strategy alongside the existing engines.
 * Faithfully ports the reference "UK49-SuperHybrid-4PlusBonus" script:
 *
 *   - per-number scores: frequency + recency-weighted activity + overdue
 *     (absence) + momentum (5/10/20-draw trend) + neighbour activity
 *   - combination-level scoring: pair/triple co-occurrence strength,
 *     spread, parity, decade distribution, plus anti-repeat penalties
 *     (exact repeats, 3/4-overlap, repeated pairs)
 *   - best 4-number combination from the top-15 candidate pool becomes
 *     the main numbers; the best non-main number becomes the booster.
 *
 * IMPORTANT: everything here is computed from draws strictly BEFORE the
 * target draw. The reference script scored numbers using the *next*
 * draw's numbers (future data leakage); that is deliberately NOT
 * reproduced.
 *
 * As with the rest of the platform: these are historical statistical
 * patterns, NOT predictions of future outcomes.
 */

import type { Uk49sDraw } from "./uk49s";
import { drawToNumbers } from "./uk49s";
import { DEFAULT_WEIGHTS, type FeatureWeights } from "./feature-engine";
import { DEFAULT_V3_WEIGHTS, type PredictionStrategy } from "./hybrid-strategy";

/** Shipped defaults for the v3 engine. */
export const DEFAULT_V3_WEIGHTS: FeatureWeights = {
  ...DEFAULT_HYBRID_WEIGHTS,
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

/** Size of the candidate pool the v3 engine ranks before combination search. */
export const V3_CANDIDATE_POOL_SIZE = 15;
export const V3_POOL_OPTIONS = [10, 12, 15, 18, 20] as const;
/** Lookback windows that make sense for the v3 strategy. */
export const V3_LOOKBACK_OPTIONS = [30, 60, 90, 180, 365] as const;

/** One previous prediction (used for anti-repeat penalties). */
export interface PreviousPrediction {
  main: number[];
  bonus?: number;
}

/** Per-number score breakdown. */
export interface NumberScore {
  n: number;
  score: number;
  frequency: number;
  recent: number;
  overdue: number;
  momentum: number;
  neighbour: number;
}

const MIN = 1;
const MAX = 49;

/* =========================================================
   BASIC HELPERS
========================================================= */

function cleanNumbers(numbers: unknown): number[] {
  if (!Array.isArray(numbers)) return [];
  return [...new Set(numbers.map(Number).filter((n) => Number.isInteger(n) && n >= MIN && n <= MAX))];
}

function contains(numbers: number[], n: number): boolean {
  return numbers.includes(n);
}

/* =========================================================
   FREQUENCY
========================================================= */

function frequency(n: number, history: UK49Draw[], window = 50): number {
  return history.slice(0, window).filter((d) => contains(cleanNumbers(d.numbers), n)).length;
}

/* =========================================================
   RECENCY WEIGHTED FREQUENCY
========================================================= */

function recentScore(n: number, history: UK49Draw[], window = 20): number {
  let score = 0;
  const draws = history.slice(0, window);
  for (let i = 0; i < draws.length; i++) {
    const nums = cleanNumbers(draws[i].numbers);
    if (nums.includes(n)) {
      score += window - i;
    }
  }
  return score;
}

/* =========================================================
   OVERDUE
========================================================= */

function overdue(n: number, history: UK49Draw[]): number {
  for (let i = 0; i < history.length; i++) {
    const nums = cleanNumbers(history[i].numbers);
    if (nums.includes(n)) {
      return Math.min(i, 25);
    }
  }
  return 25;
}

/* =========================================================
   MOMENTUM
========================================================= */

function momentum(n: number, history: UK49Draw[]): number {
  const last5 = frequency(n, history, 5);
  const last10 = frequency(n, history, 10);
  const last20 = frequency(n, history, 20);
  return last5 * 3 + last10 * 1.5 + last20 * 0.5;
}

/* =========================================================
   NEIGHBOUR ACTIVITY
========================================================= */

function neighbourScore(n: number, history: UK49Draw[]): number {
  let score = 0;
  for (const draw of history.slice(0, 30)) {
    const nums = cleanNumbers(draw.numbers);
    for (const x of nums) {
      const distance = Math.abs(x - n);
      if (distance === 1) score += 1;
      if (distance === 2) score += 0.5;
    }
  }
  return score;
}

/* =========================================================
   RECENT PREDICTION PENALTY
========================================================= */

function repeatPenalty(n: number, previous: PreviousPrediction[], lookback = 12): number {
  let penalty = 0;
  for (const prediction of previous.slice(0, lookback)) {
    if (prediction.main.includes(n)) {
      penalty += 4;
    }
  }
  return penalty;
}

/* =========================================================
   NUMBER SCORE
========================================================= */

function scoreNumber(n: number, history: UK49Draw[], previous: PreviousPrediction[]): NumberScore {
  const freq = frequency(n, history, 50);
  const recent = recentScore(n, history, 20);
  const due = overdue(n, history);
  const trend = momentum(n, history);
  const neighbour = neighbourScore(n, history);
  const penalty = repeatPenalty(n, previous);

  const score = freq * 3 + recent * 0.35 + due * 2 + trend * 1.5 + neighbour * 1.2 - penalty;

  return { n, score, frequency: freq, recent, overdue: due, momentum: trend, neighbour };
}

/* =========================================================
   CANDIDATE POOL
========================================================= */

function buildCandidates(history: UK49Draw[], previous: PreviousPrediction[]): NumberScore[] {
  const scores: NumberScore[] = [];
  for (let n = MIN; n <= MAX; n++) {
    scores.push(scoreNumber(n, history, previous));
  }
  return scores
    .sort((a, b) => b.score - a.score || a.n - b.n)
    .slice(0, 15);
}

/* =========================================================
   HISTORICAL PAIR STRENGTH
========================================================= */

function pairStrength(a: number, b: number, history: UK49Draw[]): number {
  return history
    .slice(0, 100)
    .filter((draw) => {
      const nums = cleanNumbers(draw.numbers);
      return nums.includes(a) && nums.includes(b);
    }).length;
}

/* =========================================================
   HISTORICAL TRIPLE STRENGTH
========================================================= */

function tripleStrength(a: number, b: number, c: number, history: UK49Draw[]): number {
  return history
    .slice(0, 100)
    .filter((draw) => {
      const nums = cleanNumbers(draw.numbers);
      return nums.includes(a) && nums.includes(b) && nums.includes(c);
    }).length;
}

/* =========================================================
   EXACT PREDICTION REPEAT PENALTY
========================================================= */

function exactRepeatPenalty(combination: number[], previous: PreviousPrediction[]): number {
  const key = [...combination].sort((a, b) => a - b).join("-");
  let penalty = 0;
  for (const prediction of previous.slice(0, 20)) {
    const previousKey = [...prediction.main].sort((a, b) => a - b).join("-");
    if (previousKey === key) {
      penalty += 50;
    }
  }
  return penalty;
}

/* =========================================================
   SIMILARITY PENALTY
========================================================= */

function similarityPenalty(combination: number[], previous: PreviousPrediction[]): number {
  let penalty = 0;
  for (const prediction of previous.slice(0, 10)) {
    const overlap = combination.filter((n) => prediction.main.includes(n)).length;
    if (overlap === 3) penalty += 15;
    if (overlap === 4) penalty += 40;
    if (overlap === 2) penalty += 5;
  }
  return penalty;
}

/* =========================================================
   PAIR REPEAT PENALTY
========================================================= */

function repeatedPairPenalty(combination: number[], previous: PreviousPrediction[]): number {
  let penalty = 0;
  for (let i = 0; i < combination.length; i++) {
    for (let j = i + 1; j < combination.length; j++) {
      const a = combination[i];
      const b = combination[j];
      for (const prediction of previous.slice(0, 15)) {
        if (prediction.main.includes(a) && prediction.main.includes(b)) {
          penalty += 3;
        }
      }
    }
  }
  return penalty;
}

/* =========================================================
   SPREAD
========================================================= */

function spreadScore(numbers: number[]): number {
  const sorted = [...numbers].sort((a, b) => a - b);
  const range = sorted[sorted.length - 1] - sorted[0];
  let score = 0;
  if (range >= 20) score += 5;
  else if (range >= 15) score += 3;
  else if (range >= 10) score += 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] <= 1) {
      score -= 2;
    }
  }
  return score;
}

/* =========================================================
   PARITY
========================================================= */

function parityScore(numbers: number[]): number {
  const odd = numbers.filter((n) => n % 2 !== 0).length;
  if (odd === 2) return 3;
  if (odd === 1 || odd === 3) return 1;
  return -2;
}

/* =========================================================
   DECADE DISTRIBUTION
========================================================= */

function decadeScore(numbers: number[]): number {
  const groups = new Set(numbers.map((n) => Math.floor((n - 1) / 10)));
  return Math.min(groups.size * 1.5, 6);
}

/* =========================================================
   COMBINATION SCORE
========================================================= */

function scoreCombination(
  combination: number[],
  candidateMap: Map<number, NumberScore>,
  history: UK49Draw[],
  previous: PreviousPrediction[],
): number {
  let score = 0;

  for (const n of combination) {
    score += candidateMap.get(n)?.score || 0;
  }

  for (let i = 0; i < combination.length; i++) {
    for (let j = i + 1; j < combination.length; j++) {
      score += pairStrength(combination[i], combination[j], history) * 0.8;
    }
  }

  score += tripleStrength(combination[0], combination[1], combination[2], history) * 0.5;
  score += tripleStrength(combination[0], combination[1], combination[3], history) * 0.5;
  score += tripleStrength(combination[0], combination[2], combination[3], history) * 0.5;
  score += tripleStrength(combination[1], combination[2], combination[3], history) * 0.5;

  score += spreadScore(combination);
  score += parityScore(combination);
  score += decadeScore(combination);

  score -= exactRepeatPenalty(combination, previous);
  score -= similarityPenalty(combination, previous);
  score -= repeatedPairPenalty(combination, previous);

  return score;
}

/* =========================================================
   GENERATE 4-NUMBER COMBINATIONS
========================================================= */

function generateCombinations(candidates: NumberScore[]): number[][] {
  const combinations: number[][] = [];
  for (let a = 0; a < candidates.length - 3; a++) {
    for (let b = a + 1; b < candidates.length - 2; b++) {
      for (let c = b + 1; c < candidates.length - 1; c++) {
        for (let d = c + 1; d < candidates.length; d++) {
          combinations.push([candidates[a].n, candidates[b].n, candidates[c].n, candidates[d].n]);
        }
      }
    }
  }
  return combinations;
}

/* =========================================================
   MAIN 4-NUMBER PREDICTION
========================================================= */

function predictMain(history: UK49Draw[], previous: PreviousPrediction[]) {
  const candidates = buildCandidates(history, previous);
  const candidateMap = new Map<number, NumberScore>();
  for (const candidate of candidates) {
    candidateMap.set(candidate.n, candidate);
  }

  const combinations = generateCombinations(candidates);

  let best: { numbers: number[]; score: number } | null = null;
  for (const combination of combinations) {
    const score = scoreCombination(combination, candidateMap, history, previous);
    if (!best || score > best.score) {
      best = { numbers: [...combination].sort((a, b) => a - b), score };
    }
  }

  return {
    numbers: best?.numbers ?? candidates.slice(0, 4).map((x) => x.n).sort((a, b) => a - b),
    score: best?.score ?? 0,
    candidates,
  };
}

/* =========================================================
   BONUS SCORE
========================================================= */

function bonusScore(n: number, history: UK49Draw[], previous: PreviousPrediction[]): number {
  let score = 0;

  const bonusFrequency = history.slice(0, 50).filter((d) => Number(d.bonus) === n).length;
  const bonusRecent = history.slice(0, 15).reduce((sum, d, index) => (Number(d.bonus) === n ? sum + (15 - index) : sum), 0);

  let bonusOverdue = 20;
  for (let i = 0; i < history.length; i++) {
    if (Number(history[i].bonus) === n) {
      bonusOverdue = Math.min(i, 20);
      break;
    }
  }

  let repeatPenalty = 0;
  for (const prediction of previous.slice(0, 12)) {
    if (prediction.bonus === n) {
      repeatPenalty += 5;
    }
  }

  score = bonusFrequency * 3 + bonusRecent * 0.4 + bonusOverdue * 2 - repeatPenalty;
  return score;
}

/* =========================================================
   BONUS PREDICTION
========================================================= */

function predictBonus(history: UK49Draw[], main: number[], previous: PreviousPrediction[]): number {
  const candidates: { n: number; score: number }[] = [];
  for (let n = MIN; n <= MAX; n++) {
    if (main.includes(n)) {
      continue;
    }
    candidates.push({ n, score: bonusScore(n, history, previous) });
  }

  candidates.sort((a, b) => b.score - a.score || a.n - b.n);

  if (candidates.length === 0) {
    return 1;
  }

  return candidates[0].n;
}

/* =========================================================
   COMPLETE UK49s PREDICTION
========================================================= */

export function predictUK49(history: UK49Draw[], previous: PreviousPrediction[] = []) {
  if (history.length < 10) {
    throw new Error("At least 10 historical UK49s draws are required.");
  }

  const mainResult = predictMain(history, previous);
  const bonus = predictBonus(history, mainResult.numbers, previous);

  return {
    main: mainResult.numbers,
    bonus,
    score: Number(mainResult.score.toFixed(2)),
    candidatePool: mainResult.candidates.map((c) => ({
      number: c.n,
      score: Number(c.score.toFixed(2)),
      frequency: c.frequency,
      recent: c.recent,
      overdue: c.overdue,
      momentum: Number(c.momentum.toFixed(2)),
      neighbour: Number(c.neighbour.toFixed(2)),
    })),
    method: "UK49-SuperHybrid-4PlusBonus",
  };
}

/* =========================================================
   ENGINE ADAPTER (leakage-free, uses draws strictly before target)
========================================================= */

/** UK49Draw shape used by the ported script. */
interface UK49Draw {
  numbers: number[];
  bonus?: number;
}

/** Convert a stored draw to the script's history shape (newest first). */
function toHistoryDraw(draw: Uk49sDraw): UK49Draw {
  const { main, booster } = drawToNumbers(draw);
  return { numbers: main, bonus: booster };
}

/**
 * Generates a SuperHybrid v3 prediction from draws that are strictly
 * before the target draw. Returns exactly 4 main numbers and 1 booster.
 */
export function generateSuperHybrid3Prediction(
  draws: Uk49sDraw[],
  weights: FeatureWeights = DEFAULT_V3_WEIGHTS,
  lookbackWindow = 90,
  options: { previousPredictions?: PreviousPrediction[]; candidatePoolSize?: number } = {},
): { mainNumbers: number[]; boosterBall: number; candidatePool?: NumberScore[]; score?: number } {
  if (draws.length === 0) {
    throw new Error("No historical draws available for SuperHybrid v3 prediction");
  }

  // The script assumes newest-first history; our stored draws are
  // chronological, so reverse once at the boundary.
  const history = [...draws].reverse().map(toHistoryDraw);
  const previous = options.previousPredictions ?? [];
  const poolSize = options.candidatePoolSize ?? V3_CANDIDATE_POOL_SIZE;

  const mainResult = predictMain(history, previous);
  const bonus = predictBonus(history, mainResult.numbers, previous);

  return {
    mainNumbers: mainResult.numbers,
    boosterBall: bonus,
    candidatePool: mainResult.candidates.slice(0, poolSize),
    score: mainResult.score,
  };
}
