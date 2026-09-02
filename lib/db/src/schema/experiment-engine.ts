/**
 * UK49s Experiment Lab Engine (v2)
 *
 * Research infrastructure: side-by-side model variants, feature ablation,
 * multi-period walk-forward testing, stability analysis, separate booster
 * models, and ensembles. All evaluation is strictly out-of-sample:
 * features for a prediction date use ONLY draws before that date.
 */

import type { Uk49sDraw, DrawType } from "./uk49s";
import { drawToNumbers } from "./uk49s";
import {
  calculateAllFeatureScores,
  selectBestNumbers,
  selectBoosterBall,
  DEFAULT_WEIGHTS,
  ablateWeights,
  FEATURE_NAMES,
  type FeatureWeights,
  type FeatureName,
  type DiversityConstraints,
  type NumberFeatureScores,
} from "./feature-engine";
import {
  generateFrequencyPrediction,
  type BacktestPrediction,
} from "./backtest-engine";

// ---------------------------------------------------------------------------
// Model variants
// ---------------------------------------------------------------------------

export type ModelKind =
  | "superhybrid"
  | "frequency"
  | "recency"
  | "pattern"
  | "random"
  | "ensemble"
  | "superhybrid_ablated";

export interface ModelVariant {
  name: string;
  kind: ModelKind;
  weights: FeatureWeights;
  disabledFeatures: FeatureName[];
  lookbackWindow: number;
  constraints: DiversityConstraints;
  ensembleMembers?: ModelKind[];
}

export const DEFAULT_CONSTRAINTS: DiversityConstraints = {
  enforceDiversity: true,
  minNumberSpread: 10,
  maxSameGroup: 2,
};

// Seeded RNG (same algorithm as backtest-engine for consistency)
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ---------------------------------------------------------------------------
// Variant scoring functions (main-number selection from 1..49)
// ---------------------------------------------------------------------------

function scoresFromDraws(
  draws: Uk49sDraw[],
  weights: FeatureWeights,
  lookback: number
): NumberFeatureScores[] {
  return calculateAllFeatureScores(draws, weights, lookback);
}

/** Frequency-only variant: rank numbers purely by appearance count in window. */
function frequencySelection(draws: Uk49sDraw[], lookback: number): number[] {
  const recent = draws.slice(-lookback);
  const counts = new Map<number, number>();
  for (let i = 1; i <= 49; i++) counts.set(i, 0);
  for (const d of recent) {
    for (const n of drawToNumbers(d).main) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 4)
    .map(([n]) => n)
    .sort((a, b) => a - b);
}

/** Recency-only variant: rank by most recent appearance. */
function recencySelection(draws: Uk49sDraw[], lookback: number): number[] {
  const recent = draws.slice(-lookback);
  const lastSeen = new Map<number, number>();
  for (let i = 1; i <= 49; i++) lastSeen.set(i, -1);
  for (let i = 0; i < recent.length; i++) {
    for (const n of drawToNumbers(recent[i]).main) lastSeen.set(n, i);
  }
  return Array.from(lastSeen.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 4)
    .map(([n]) => n)
    .sort((a, b) => a - b);
}

/** Pattern variant: SuperHybrid with only structural/pattern features active. */
const PATTERN_FEATURES: FeatureName[] = [
  "weightConsecutive",
  "weightOddEven",
  "weightLowHigh",
  "weightSumRange",
  "weightPositional",
  "weightFirst3Minus2",
];

function patternWeights(): FeatureWeights {
  const w = { ...DEFAULT_WEIGHTS };
  for (const f of FEATURE_NAMES) w[f] = PATTERN_FEATURES.includes(f) ? 1.0 : 0;
  return w;
}

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

export interface PeriodSpec {
  start: string;
  end: string;
}

export interface VariantPeriodResult {
  variantName: string;
  periodStart: string;
  periodEnd: string;
  predictions: number;
  avgMainHits: number;
  fourHitRate: number;
  boosterHitRate: number;
  medianMainHits: number;
  maxMainHits: number;
  hitCounts: number[]; // index = hits (0..5)
  randomAvgMainHits: number;
  randomFourHitRate: number;
  freqAvgMainHits: number;
  freqFourHitRate: number;
  allHits: number[];      // per-prediction hits (for stats tests)
  randomHits: number[];   // paired random baseline hits
}

export interface VariantSummary {
  variantName: string;
  kind: ModelKind;
  disabledFeatures: string[];
  totalPredictions: number;
  avgMainHits: number;
  fourHitRate: number;
  boosterHitRate: number;
  medianMainHits: number;
  maxMainHits: number;
  // Volatility = std-dev of period-level avgMainHits
  avgHitsVolatility: number;
  fourHitRateVolatility: number;
  boosterHitRateVolatility: number;
  // Welch's t-test of variant hits vs paired random baseline hits
  tStatVsRandom: number | null;
  pValueVsRandom: number | null;
  periods: { start: string; end: string; avgMainHits: number; fourHitRate: number; boosterHitRate: number; predictions: number }[];
}

function evalVariantOnPeriod(
  draws: Uk49sDraw[],
  variant: ModelVariant,
  period: PeriodSpec,
  rng: () => number
): VariantPeriodResult {
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const testDraws = sorted.filter((d) => d.drawDate >= period.start && d.drawDate <= period.end);

  const allNumbers = Array.from({ length: 49 }, (_, i) => i + 1);
  const hitCounts = [0, 0, 0, 0, 0, 0];
  const allHits: number[] = [];
  const randomHits: number[] = [];
  const freqHitsArr: number[] = [];
  let boosterHits = 0;
  let randomBoosterHits = 0;
  let freqBoosterHits = 0;

  for (const target of testDraws) {
    // CRITICAL: only draws strictly before the target date
    const history = sorted.filter((d) => d.drawDate < target.drawDate);
    if (history.length < variant.lookbackWindow) continue;

    const actual = drawToNumbers(target);
    let predictedMain: number[];
    let predictedBooster: number;

    if (variant.kind === "random") {
      const shuffled = [...allNumbers].sort(() => rng() - 0.5);
      predictedMain = shuffled.slice(0, 4).sort((a, b) => a - b);
      predictedBooster = shuffled[4];
    } else if (variant.kind === "frequency") {
      predictedMain = frequencySelection(history, variant.lookbackWindow);
      const fp = generateFrequencyPrediction(history, variant.lookbackWindow);
      predictedBooster = fp.booster;
    } else if (variant.kind === "recency") {
      predictedMain = recencySelection(history, variant.lookbackWindow);
      predictedBooster = recencySelection(history, 10)[0]; // booster: most recent hot number
    } else {
      // superhybrid / superhybrid_ablated / pattern / ensemble
      const scores = scoresFromDraws(history, variant.weights, variant.lookbackWindow);
      if (variant.kind === "ensemble") {
        // Ensemble: average the component selections' ranks
        const ranked = ensembleRanked(history, variant);
        predictedMain = ranked.slice(0, 4);
        const remaining = ranked.filter((n) => !predictedMain.includes(n));
        predictedBooster = remaining[0] ?? selectBoosterBall(scores, predictedMain);
      } else {
        predictedMain = selectBestNumbers(scores, variant.constraints);
        predictedBooster = selectBoosterBall(scores, predictedMain);
      }
    }

    const hits = predictedMain.filter((n) => actual.main.includes(n)).length;
    allHits.push(hits);
    hitCounts[hits] += 1;
    if (predictedBooster === actual.booster) boosterHits += 1;

    // Paired baselines on the same draw
    const shuffled = [...allNumbers].sort(() => rng() - 0.5);
    const rMain = shuffled.slice(0, 4);
    const rHits = rMain.filter((n) => actual.main.includes(n)).length;
    randomHits.push(rHits);
    if (shuffled[4] === actual.booster) randomBoosterHits += 1;

    const fp = generateFrequencyPrediction(history, variant.lookbackWindow);
    const fHits = fp.main.filter((n) => actual.main.includes(n)).length;
    freqHitsArr.push(fHits);
    if (fp.booster === actual.booster) freqBoosterHits += 1;
  }

  const n = allHits.length;
  const sortedHits = [...allHits].sort((a, b) => a - b);
  return {
    variantName: variant.name,
    periodStart: period.start,
    periodEnd: period.end,
    predictions: n,
    avgMainHits: n > 0 ? allHits.reduce((a, b) => a + b, 0) / n : 0,
    fourHitRate: n > 0 ? hitCounts[4] / n : 0,
    boosterHitRate: n > 0 ? boosterHits / n : 0,
    medianMainHits: n > 0 ? sortedHits[Math.floor(n / 2)] : 0,
    maxMainHits: n > 0 ? sortedHits[n - 1] : 0,
    hitCounts,
    randomAvgMainHits: n > 0 ? randomHits.reduce((a, b) => a + b, 0) / n : 0,
    randomFourHitRate: n > 0 ? randomHits.filter((h) => h === 4).length / n : 0,
    freqAvgMainHits: n > 0 ? freqHitsArr.reduce((a, b) => a + b, 0) / n : 0,
    freqFourHitRate: n > 0 ? freqHitsArr.filter((h) => h === 4).length / n : 0,
    allHits,
    randomHits,
  };
}

/** Ensemble: combine member variants' selections by summed rank. */
function ensembleRanked(history: Uk49sDraw[], variant: ModelVariant): number[] {
  const members: { kind: ModelKind; weights: FeatureWeights }[] = [
    { kind: "frequency", weights: { ...DEFAULT_WEIGHTS } },
    { kind: "recency", weights: { ...DEFAULT_WEIGHTS } },
    { kind: "pattern", weights: patternWeights() },
    { kind: "superhybrid", weights: { ...DEFAULT_WEIGHTS } },
  ];
  const rankSum = new Map<number, number>();
  for (let i = 1; i <= 49; i++) rankSum.set(i, 0);

  for (const m of members) {
    let ranked: number[];
    if (m.kind === "frequency") {
      ranked = rankByScores(history, m.weights, variant.lookbackWindow, frequencySelection(history, variant.lookbackWindow));
    } else if (m.kind === "recency") {
      ranked = rankByScores(history, m.weights, variant.lookbackWindow, recencySelection(history, variant.lookbackWindow));
    } else {
      const scores = scoresFromDraws(history, m.weights, variant.lookbackWindow);
      ranked = [...scores].sort((a, b) => b.overallScore - a.overallScore).map((s) => s.number);
    }
    ranked.forEach((num, idx) => rankSum.set(num, (rankSum.get(num) ?? 0) + (49 - idx)));
  }

  return Array.from(rankSum.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([n]) => n);
}

/** Build a full 1..49 ranking for a simple variant from its top-4 (rest in number order). */
function rankByScores(
  history: Uk49sDraw[],
  weights: FeatureWeights,
  lookback: number,
  top4: number[]
): number[] {
  const scores = scoresFromDraws(history, weights, lookback);
  const fullRank = [...scores].sort((a, b) => b.overallScore - a.overallScore).map((s) => s.number);
  // Put the variant's top4 first, then the model ranking for the rest
  const rest = fullRank.filter((n) => !top4.includes(n));
  return [...top4, ...rest];
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Welch's t-test between paired samples (variant hits vs random hits). */
function welchTTest(a: number[], b: number[]): { t: number; p: number } | null {
  if (a.length < 30 || b.length < 30) return null;
  const ma = mean(a), mb = mean(b);
  const va = stddev(a) ** 2, vb = stddev(b) ** 2;
  const na = a.length, nb = b.length;
  const se = Math.sqrt(va / na + vb / nb);
  if (se === 0) return null;
  const t = (ma - mb) / se;
  // Approximate two-tailed p-value via normal approximation (df large)
  const p = 2 * (1 - normalCdf(Math.abs(t)));
  return { t, p };
}

function normalCdf(x: number): number {
  // Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989422804014327; // 1/sqrt(2*pi)
  const p = d * Math.exp((-x * x) / 2) *
    (0.319381530 * t - 0.356563782 * t ** 2 + 1.781477937 * t ** 3 - 1.821255978 * t ** 4 + 1.330274429 * t ** 5);
  return 1 - p;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExperimentRunOptions {
  drawType: DrawType;
  periods: PeriodSpec[];
  lookbackWindow?: number;
  randomSeed?: number;
  constraints?: DiversityConstraints;
  onProgress?: (done: number, total: number, label: string) => void;
}

export function defaultYearPeriods(fromYear = 2016, toYear?: number): PeriodSpec[] {
  const end = toYear ?? new Date().getUTCFullYear();
  const periods: PeriodSpec[] = [];
  for (let y = fromYear; y < end; y++) {
    periods.push({ start: `${y}-01-01`, end: `${y}-12-31` });
  }
  return periods;
}

/** Build the full variant list for an ablation study. */
export function buildAblationVariants(
  baseWeights: FeatureWeights = DEFAULT_WEIGHTS,
  lookbackWindow = 90
): ModelVariant[] {
  const variants: ModelVariant[] = [
    {
      name: "SuperHybrid (full)",
      kind: "superhybrid",
      weights: baseWeights,
      disabledFeatures: [],
      lookbackWindow,
      constraints: DEFAULT_CONSTRAINTS,
    },
  ];
  for (const f of FEATURE_NAMES) {
    variants.push({
      name: `SuperHybrid - ${f.replace("weight", "")}`,
      kind: "superhybrid_ablated",
      weights: ablateWeights(baseWeights, [f]),
      disabledFeatures: [f],
      lookbackWindow,
      constraints: DEFAULT_CONSTRAINTS,
    });
  }
  // Simple reference models
  variants.push(
    { name: "Frequency-only", kind: "frequency", weights: ablateWeights(baseWeights, FEATURE_NAMES), disabledFeatures: [...FEATURE_NAMES], lookbackWindow, constraints: DEFAULT_CONSTRAINTS },
    { name: "Recency-only", kind: "recency", weights: ablateWeights(baseWeights, FEATURE_NAMES), disabledFeatures: [...FEATURE_NAMES], lookbackWindow, constraints: DEFAULT_CONSTRAINTS },
    { name: "Pattern-only", kind: "pattern", weights: patternWeights(), disabledFeatures: FEATURE_NAMES.filter((f) => !PATTERN_FEATURES.includes(f)), lookbackWindow, constraints: DEFAULT_CONSTRAINTS },
    { name: "Random", kind: "random", weights: ablateWeights(baseWeights, FEATURE_NAMES), disabledFeatures: [...FEATURE_NAMES], lookbackWindow, constraints: DEFAULT_CONSTRAINTS },
    { name: "Ensemble (F+R+P+S)", kind: "ensemble", weights: baseWeights, disabledFeatures: [], lookbackWindow, constraints: DEFAULT_CONSTRAINTS, ensembleMembers: ["frequency", "recency", "pattern", "superhybrid"] },
  );
  return variants;
}

/** Run a set of variants across multiple periods and produce summaries. */
export function runExperiment(
  draws: Uk49sDraw[],
  variants: ModelVariant[],
  options: ExperimentRunOptions
): { periodResults: VariantPeriodResult[]; summaries: VariantSummary[] } {
  const filtered = draws.filter((d) => d.drawType === options.drawType);
  const rng = seededRandom(options.randomSeed ?? 42);
  const periodResults: VariantPeriodResult[] = [];

  const total = variants.length * options.periods.length;
  let done = 0;

  for (const variant of variants) {
    for (const period of options.periods) {
      const res = evalVariantOnPeriod(filtered, variant, period, rng);
      periodResults.push(res);
      done += 1;
      options.onProgress?.(done, total, `${variant.name} @ ${period.start}`);
    }
  }

  // Aggregate per variant
  const summaries: VariantSummary[] = variants.map((variant) => {
    const prs = periodResults.filter((r) => r.variantName === variant.name);
    const totalPredictions = prs.reduce((s, r) => s + r.predictions, 0);
    const pooledHits = prs.flatMap((r) => r.allHits);
    const pooledRandomHits = prs.flatMap((r) => r.randomHits);

    const avgByPeriod = prs.map((r) => r.avgMainHits);
    const fourHitByPeriod = prs.map((r) => r.fourHitRate);
    const boosterByPeriod = prs.map((r) => r.boosterHitRate);

    const total4 = prs.reduce((s, r) => s + r.hitCounts[4], 0);
    const totalBooster = prs.reduce((s, r) => s + Math.round(r.boosterHitRate * r.predictions), 0);
    const pooledSorted = [...pooledHits].sort((a, b) => a - b);

    const t = welchTTest(pooledHits, pooledRandomHits);

    return {
      variantName: variant.name,
      kind: variant.kind,
      disabledFeatures: variant.disabledFeatures,
      totalPredictions,
      avgMainHits: mean(pooledHits),
      fourHitRate: totalPredictions > 0 ? total4 / totalPredictions : 0,
      boosterHitRate: totalPredictions > 0 ? totalBooster / totalPredictions : 0,
      medianMainHits: pooledSorted.length > 0 ? pooledSorted[Math.floor(pooledSorted.length / 2)] : 0,
      maxMainHits: pooledSorted.length > 0 ? pooledSorted[pooledSorted.length - 1] : 0,
      avgHitsVolatility: stddev(avgByPeriod),
      fourHitRateVolatility: stddev(fourHitByPeriod),
      boosterHitRateVolatility: stddev(boosterByPeriod),
      tStatVsRandom: t?.t ?? null,
      pValueVsRandom: t?.p ?? null,
      periods: prs.map((r) => ({
        start: r.periodStart,
        end: r.periodEnd,
        avgMainHits: r.avgMainHits,
        fourHitRate: r.fourHitRate,
        boosterHitRate: r.boosterHitRate,
        predictions: r.predictions,
      })),
    };
  });

  return { periodResults, summaries };
}

// ---------------------------------------------------------------------------
// Booster-ball model experiments (separate problem)
// ---------------------------------------------------------------------------

export type BoosterModelKind = "frequency" | "recency" | "random";

export interface BoosterExperimentResult {
  name: string;
  drawType: DrawType;
  periodStart: string;
  periodEnd: string;
  predictions: number;
  hits: number;
  hitRate: number;
}

export function runBoosterExperiment(
  draws: Uk49sDraw[],
  drawType: DrawType,
  periods: PeriodSpec[],
  lookbackWindow = 90,
  randomSeed = 42
): BoosterExperimentResult[] {
  const sorted = draws.filter((d) => d.drawType === drawType).sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const rng = seededRandom(randomSeed);
  const results: BoosterExperimentResult[] = [];

  const models: { name: string; pick: (history: Uk49sDraw[]) => number }[] = [
    {
      name: "booster-frequency",
      pick: (history) => {
        const recent = history.slice(-lookbackWindow);
        const counts = new Map<number, number>();
        for (let i = 1; i <= 49; i++) counts.set(i, 0);
        for (const d of recent) counts.set(d.boosterBall, (counts.get(d.boosterBall) ?? 0) + 1);
        return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      },
    },
    {
      name: "booster-recency",
      pick: (history) => history[history.length - 1].boosterBall, // "repeat last booster"
    },
    {
      name: "booster-random",
      pick: () => Math.floor(rng() * 49) + 1,
    },
  ];

  for (const model of models) {
    for (const period of periods) {
      const testDraws = sorted.filter((d) => d.drawDate >= period.start && d.drawDate <= period.end);
      let hits = 0;
      let n = 0;
      for (const target of testDraws) {
        const history = sorted.filter((d) => d.drawDate < target.drawDate);
        if (history.length < lookbackWindow) continue;
        const predicted = model.pick(history);
        if (predicted === target.boosterBall) hits += 1;
        n += 1;
      }
      results.push({
        name: model.name,
        drawType,
        periodStart: period.start,
        periodEnd: period.end,
        predictions: n,
        hits,
        hitRate: n > 0 ? hits / n : 0,
      });
    }
  }

  return results;
}
