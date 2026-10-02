/**
 * UK49s prediction engine — the single engine used by the app.
 *
 * Ported from the Base44 `shared/predictor.js` + `shared/backtest.js` pair:
 *
 *   - Frequency + recency-gap scoring with an exponential half-life
 *     (`hot` / `overdue` blend).
 *   - Score-weighted sampling (power curve) to draw a line, with a light
 *     low/high + odd/even balance filter.
 *   - A walk-forward tuner that scores every candidate weight set on past draws
 *     (newest→oldest, each trained only on strictly older draws) and keeps the
 *     one with the most 3+ match lines.
 *
 * UK 49s specifics baked in: a **4-number main line + 1 booster** drawn from
 * 1–49 (lunchtime / teatime). All previous engines (SuperHybrid, Hybrid,
 * SuperHybrid v3) have been removed.
 *
 * These are historical statistical patterns, NOT predictions of future
 * outcomes. Lottery draws are random.
 */

import type { DrawType, Uk49sDraw } from "./uk49s";

/** Main numbers per line. UK 49s draws 6; the app scores a 4-number line. */
export const MAIN_COUNT = 4;
export const MAIN_MAX = 49;
/** Booster numbers per line. */
export const BONUS_COUNT = 1;
export const BONUS_MAX = 49;
/** Minimum older draws required before a prediction can be made. */
export const MIN_TRAIN = 20;
/** Lines produced per target draw. */
export const LINES = 1;
/** A draw with this many (or more) main matches counts as a "win" for tuning. */
export const DEFAULT_TARGET = 4;

/** Face of a draw the engine operates on (newest-first history). */
export type EngineKey = "numbers" | "bonus_numbers";

export interface EngineDraw {
  draw_date: string;
  draw_time: string;
  /** 6 main numbers. */
  numbers: number[];
  /** 1 booster number. */
  bonus_numbers: number[];
}

/** Tunable weights — the four values the walk-forward grid sweeps. */
export interface Base44Weights {
  hot: number;
  overdue: number;
  halfLife: number;
  power: number;
}

export const DEFAULT_WEIGHTS: Base44Weights = { hot: 0.62, overdue: 0.38, halfLife: 60, power: 2.2 };

/** Weight-grid axes (Base44 `games.js` uk49s.optimizer.grid). */
export const WEIGHT_GRID = {
  hot: [0.1, 0.2, 0.3, 0.4, 0.5, 0.62, 0.75, 0.9],
  halfLife: [10, 20, 30, 45, 60, 90, 120],
  power: [1.2, 1.6, 2.0, 2.2, 2.6, 3.2, 4.0],
} as const;

export const DRAW_TIMES: Record<DrawType, string> = { lunchtime: "12:30", teatime: "17:49" };

/** Converts stored draws to the engine's newest-first shape for one draw type. */
export function toEngineDraws(draws: Uk49sDraw[], drawType: DrawType): EngineDraw[] {
  return draws
    .filter((draw) => draw.drawType === drawType)
    .sort((a, b) => a.drawDate.localeCompare(b.drawDate))
    .map((draw) => ({
      draw_date: draw.drawDate,
      draw_time: DRAW_TIMES[drawType],
      numbers: [
        draw.mainNumber1,
        draw.mainNumber2,
        draw.mainNumber3,
        draw.mainNumber4,
        draw.mainNumber5,
        draw.mainNumber6,
      ],
      bonus_numbers: [draw.boosterBall],
    }))
    .reverse();
}

export interface NumberStat {
  n: number;
  count: number;
  lastSeen: number | null;
  score: number;
}

/** Frequency + recency-gap scoring over recent draw history. */
export function scoreNumbers(
  draws: EngineDraw[],
  key: EngineKey,
  weights: Base44Weights = DEFAULT_WEIGHTS,
): NumberStat[] {
  const max = key === "numbers" ? MAIN_MAX : BONUS_MAX;
  const pickCount = key === "numbers" ? MAIN_COUNT : BONUS_COUNT;
  const counts = new Array<number>(max + 1).fill(0);
  const lastSeen = new Array<number | null>(max + 1).fill(null);
  const weighted = new Array<number>(max + 1).fill(0);
  const halfLife = weights.halfLife;

  draws.forEach((draw, index) => {
    const decay = Math.pow(0.5, index / halfLife);
    for (const n of draw[key]) {
      if (n < 1 || n > max) continue;
      counts[n] += 1;
      weighted[n] += decay;
      if (lastSeen[n] === null) lastSeen[n] = index;
    }
  });

  const totalWeighted = weighted.reduce((a, b) => a + b, 0) || 1;
  const expectedShare = 1 / max;
  const expectedGap = max / pickCount;
  const stats: NumberStat[] = [];

  for (let n = 1; n <= max; n++) {
    const share = weighted[n] / totalWeighted;
    const hotness = share / expectedShare;
    const seenAt = lastSeen[n];
    const gap = seenAt === null ? draws.length : seenAt;
    const overdue = gap / expectedGap;
    stats.push({ n, count: counts[n], lastSeen: seenAt, score: weights.hot * hotness + weights.overdue * Math.min(overdue, 3) });
  }
  return stats;
}

export function weightedSample(pool: NumberStat[], take: number, rand: () => number, power: number): number[] {
  const items = pool.map((s) => ({ ...s, w: Math.pow(Math.max(s.score, 0.05), power) }));
  const picked: number[] = [];
  while (picked.length < take && items.length) {
    const total = items.reduce((a, b) => a + b.w, 0);
    let r = rand() * total;
    let idx = 0;
    for (let i = 0; i < items.length; i++) {
      r -= items[i].w;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(items[idx].n);
    items.splice(idx, 1);
  }
  return picked.sort((a, b) => a - b);
}

/** Deterministic PRNG so identical inputs always yield identical lines. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface PredictionSet {
  set_index: number;
  numbers: number[];
  bonus_numbers: number[];
  method: "statistical";
  confidence: number;
  rationale: string | null;
  is_free: boolean;
  target_date: string;
  draw_time: string;
}

export interface BuildPredictionsOptions {
  draws: EngineDraw[];
  targetDate: string;
  drawTime: string;
  sets: number;
  weights?: Base44Weights;
}

/** Builds `sets` balanced lines from the training draws. */
export function buildPredictions(opts: BuildPredictionsOptions): PredictionSet[] {
  const { draws, targetDate, drawTime, sets } = opts;
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const mainStats = scoreNumbers(draws, "numbers", weights);
  const bonusStats = scoreNumbers(draws, "bonus_numbers", weights);
  const rand = mulberry32(
    seedFrom(`${targetDate}|${drawTime}|${draws.length}|${weights.hot}|${weights.halfLife}|${weights.power}`),
  );
  const maxScore = Math.max(...mainStats.map((s) => s.score)) || 1;
  const lowMax = Math.floor(MAIN_MAX / 2);
  const out: PredictionSet[] = [];
  const seen = new Set<string>();
  let guard = 0;

  while (out.length < sets && guard < sets * 40) {
    guard++;
    const numbers = weightedSample(mainStats, MAIN_COUNT, rand, weights.power);
    const key = numbers.join("-");
    if (seen.has(key)) continue;

    const low = numbers.filter((n) => n <= lowMax).length;
    const even = numbers.filter((n) => n % 2 === 0).length;
    if (low === 0 || low === MAIN_COUNT || even === 0 || even === MAIN_COUNT) continue;

    seen.add(key);
    const bonus_numbers = weightedSample(bonusStats, BONUS_COUNT, rand, weights.power);
    const avgScore = numbers.reduce((acc, n) => acc + (mainStats[n - 1]?.score ?? 0), 0) / numbers.length;

    out.push({
      set_index: out.length + 1,
      numbers,
      bonus_numbers,
      method: "statistical",
      confidence: Math.round(Math.min(0.99, (avgScore / maxScore) * 0.92) * 100) / 100,
      rationale: null,
      is_free: out.length === 0,
      target_date: targetDate,
      draw_time: drawTime,
    });
  }

  return out
    .sort((a, b) => b.confidence - a.confidence)
    .map((s, i) => ({ ...s, set_index: i + 1, is_free: i === 0 }));
}

export interface SummariseHistoryResult {
  hot: NumberStat[];
  cold: NumberStat[];
  overdue: NumberStat[];
  sampleSize: number;
}

/** Hot / cold / overdue summaries for a game's main numbers. */
export function summariseHistory(draws: EngineDraw[], weights: Base44Weights = DEFAULT_WEIGHTS): SummariseHistoryResult {
  const main = scoreNumbers(draws, "numbers", weights);
  const hot = [...main].sort((a, b) => b.count - a.count).slice(0, 6);
  const cold = [...main].sort((a, b) => a.count - b.count).slice(0, 6);
  const overdue = [...main].sort((a, b) => (b.lastSeen ?? 999) - (a.lastSeen ?? 999)).slice(0, 6);
  return { hot, cold, overdue, sampleSize: draws.length };
}

export interface BacktestRun {
  draw_date: string;
  draw_time: string;
  actual: number[];
  bestLine: number[];
  bestHits: number;
  avgHits: number;
  bonusHits: number;
}

export interface BacktestReport {
  runs: BacktestRun[];
  testedDraws: number;
  historyPerRun: number;
  linesPerDraw: number;
  avgHitsPerLine: number;
  avgBestHits: number;
  randomBaseline: number;
  edgePct: number;
  hitDistribution: { hits: number; lines: number; pct: number }[];
  threePlusRate: number;
  threePlusCount: number;
  bestEver: BacktestRun | null;
  weights: Base44Weights;
  /** Set by the tuner once the champion reached the target. */
  targetMet?: boolean;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Walk-forward backtest: predict each historic draw using only the draws before
 * it (`history` is newest-first, so training is `history.slice(i + 1)`).
 */
export function runBacktest(
  history: EngineDraw[],
  maxTests = 40,
  weights: Base44Weights = DEFAULT_WEIGHTS,
): BacktestReport {
  const runs: BacktestRun[] = [];
  const distribution = new Array<number>(MAIN_COUNT + 1).fill(0);
  let totalHits = 0;
  let totalLines = 0;

  for (let i = 0; i < history.length && runs.length < maxTests; i++) {
    const target = history[i];
    const train = history.slice(i + 1);
    if (train.length < MIN_TRAIN) break;

    const sets = buildPredictions({
      draws: train,
      targetDate: target.draw_date,
      drawTime: target.draw_time,
      sets: LINES,
      weights,
    });
    if (sets.length === 0) continue;

    const actual = new Set(target.numbers);
    const bonus = new Set(target.bonus_numbers);
    let best: { hits: number; line: number[] } = { hits: -1, line: [] };
    let hitSum = 0;
    let bonusSum = 0;

    for (const s of sets) {
      const hits = s.numbers.filter((n) => actual.has(n)).length;
      hitSum += hits;
      bonusSum += s.bonus_numbers.filter((n) => bonus.has(n)).length;
      distribution[hits] = (distribution[hits] ?? 0) + 1;
      totalLines++;
      totalHits += hits;
      if (hits > best.hits) best = { hits, line: s.numbers };
    }

    runs.push({
      draw_date: target.draw_date,
      draw_time: target.draw_time,
      actual: target.numbers,
      bestLine: best.line,
      bestHits: best.hits,
      avgHits: Math.round((hitSum / sets.length) * 100) / 100,
      bonusHits: bonusSum,
    });
  }

  return summarizeReport(runs, distribution, totalHits, totalLines, weights);
}

interface WalkForwardOptions {
  /** Stop after this many scored draws (newest-first). */
  maxTests?: number;
  /** Only score draws whose date is within this inclusive window. */
  startDate?: string;
  endDate?: string;
}

/** Cooperative-yielding walk-forward loop shared by the backtest entry points. */
async function walkForwardAsync(
  history: EngineDraw[],
  weights: Base44Weights,
  { maxTests = Infinity, startDate, endDate }: WalkForwardOptions,
): Promise<BacktestReport> {
  const runs: BacktestRun[] = [];
  const distribution = new Array<number>(MAIN_COUNT + 1).fill(0);
  let totalHits = 0;
  let totalLines = 0;

  for (let i = 0; i < history.length && runs.length < maxTests; i++) {
    const target = history[i];
    if (startDate && target.draw_date < startDate) break;
    if (endDate && target.draw_date > endDate) continue;

    const train = history.slice(i + 1);
    if (train.length < MIN_TRAIN) break;

    const sets = buildPredictions({
      draws: train,
      targetDate: target.draw_date,
      drawTime: target.draw_time,
      sets: LINES,
      weights,
    });
    if (sets.length === 0) continue;

    const actual = new Set(target.numbers);
    const bonus = new Set(target.bonus_numbers);
    let best: { hits: number; line: number[] } = { hits: -1, line: [] };
    let hitSum = 0;
    let bonusSum = 0;

    for (const s of sets) {
      const hits = s.numbers.filter((n) => actual.has(n)).length;
      hitSum += hits;
      bonusSum += s.bonus_numbers.filter((n) => bonus.has(n)).length;
      distribution[hits] = (distribution[hits] ?? 0) + 1;
      totalLines++;
      totalHits += hits;
      if (hits > best.hits) best = { hits, line: s.numbers };
    }

    runs.push({
      draw_date: target.draw_date,
      draw_time: target.draw_time,
      actual: target.numbers,
      bestLine: best.line,
      bestHits: best.hits,
      avgHits: Math.round((hitSum / sets.length) * 100) / 100,
      bonusHits: bonusSum,
    });

    await yieldToEventLoop();
  }

  return summarizeReport(runs, distribution, totalHits, totalLines, weights);
}

/** Cooperative-yielding variant so a long tuner cannot block the event loop. */
export function runBacktestAsync(
  history: EngineDraw[],
  maxTests = 40,
  weights: Base44Weights = DEFAULT_WEIGHTS,
): Promise<BacktestReport> {
  return walkForwardAsync(history, weights, { maxTests });
}

/**
 * Walk-forward backtest restricted to an explicit date window. Training is
 * always the draws strictly before the target, so it stays leakage-free.
 */
export function runBacktestWindowAsync(
  history: EngineDraw[],
  startDate: string,
  endDate: string,
  weights: Base44Weights = DEFAULT_WEIGHTS,
): Promise<BacktestReport> {
  return walkForwardAsync(history, weights, { startDate, endDate });
}

function summarizeReport(
  runs: BacktestRun[],
  distribution: number[],
  totalHits: number,
  totalLines: number,
  weights: Base44Weights,
): BacktestReport {
  const avgHitsPerLine = totalLines ? totalHits / totalLines : 0;
  const avgBestHits = runs.length ? runs.reduce((a, r) => a + r.bestHits, 0) / runs.length : 0;
  const randomBaseline = MAIN_COUNT * (MAIN_COUNT / MAIN_MAX);
  const threePlus = distribution.slice(3).reduce((a, b) => a + b, 0);

  return {
    runs,
    testedDraws: runs.length,
    historyPerRun: MIN_TRAIN,
    linesPerDraw: LINES,
    avgHitsPerLine: Math.round(avgHitsPerLine * 1000) / 1000,
    avgBestHits: Math.round(avgBestHits * 100) / 100,
    randomBaseline: Math.round(randomBaseline * 1000) / 1000,
    edgePct: randomBaseline ? Math.round(((avgHitsPerLine - randomBaseline) / randomBaseline) * 1000) / 10 : 0,
    hitDistribution: distribution.map((lines, hits) => ({
      hits,
      lines,
      pct: totalLines ? Math.round((lines / totalLines) * 1000) / 10 : 0,
    })),
    threePlusRate: totalLines ? Math.round((threePlus / totalLines) * 1000) / 10 : 0,
    threePlusCount: runs.filter((r) => r.bestHits >= 3).length,
    bestEver: runs.length > 0 ? runs.reduce((a, b) => (b.bestHits > a.bestHits ? b : a)) : null,
    weights,
  };
}

/** Expands the grid into every candidate weight set (8 × 7 × 7 = 392). */
export function buildGrid(): Base44Weights[] {
  const grid: Base44Weights[] = [];
  for (const hot of WEIGHT_GRID.hot) {
    for (const halfLife of WEIGHT_GRID.halfLife) {
      for (const power of WEIGHT_GRID.power) {
        grid.push({ hot, overdue: Math.round((1 - hot) * 100) / 100, halfLife, power });
      }
    }
  }
  return grid;
}

export interface ChampionResult {
  weights: Base44Weights;
  report: BacktestReport;
  candidatesTested: number;
  targetMet: boolean;
  target: number;
}

function isBetter(report: BacktestReport, best: BacktestReport): boolean {
  return (
    report.threePlusCount > best.threePlusCount ||
    (report.threePlusCount === best.threePlusCount && report.avgHitsPerLine > best.avgHitsPerLine)
  );
}

/**
 * Walk-forward tuner: scores every candidate on past draws and keeps the one
 * that produced the most 3+ match lines (ties broken on average matches).
 * `targetMet` is true once the champion reaches the 4-draw target.
 */
export function findChampion(history: EngineDraw[], maxTests = 30): ChampionResult {
  const grid = buildGrid();
  let best: BacktestReport | null = null;

  for (const weights of grid) {
    const report = runBacktest(history, maxTests, weights);
    if (report.testedDraws === 0) continue;
    if (!best || isBetter(report, best)) best = report;
  }

  const report = best ?? runBacktest(history, maxTests, DEFAULT_WEIGHTS);
  const targetMet = report.threePlusCount >= DEFAULT_TARGET;
  report.targetMet = targetMet;
  return { weights: report.weights, report, candidatesTested: grid.length, targetMet, target: DEFAULT_TARGET };
}

/** Yielding variant of {@link findChampion} for use on the API server. */
export async function findChampionAsync(history: EngineDraw[], maxTests = 30): Promise<ChampionResult> {
  const grid = buildGrid();
  let best: BacktestReport | null = null;

  for (const weights of grid) {
    const report = await runBacktestAsync(history, maxTests, weights);
    if (report.testedDraws === 0) continue;
    if (!best || isBetter(report, best)) best = report;
    await yieldToEventLoop();
  }

  const report = best ?? (await runBacktestAsync(history, maxTests, DEFAULT_WEIGHTS));
  const targetMet = report.threePlusCount >= DEFAULT_TARGET;
  report.targetMet = targetMet;
  return { weights: report.weights, report, candidatesTested: grid.length, targetMet, target: DEFAULT_TARGET };
}
