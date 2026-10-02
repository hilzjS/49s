/**
 * UK49s **SuperHybrid** strategy — cross-session predictions with Flip-Flop.
 *
 * This is a *separate, selectable* strategy that sits alongside the single
 * Base44 engine (`base44-engine.ts`). It does NOT replace or modify that engine,
 * the active model, its weights or its optimizer — it reuses the engine's
 * primitives (`scoreNumbers`, `weightedSample`, the deterministic PRNG) and adds
 * two things of its own:
 *
 *   1. **Flip-Flop cycle.** The system alternates sessions forever:
 *        latest LUNCH  → predict the next TEA
 *        latest TEA    → predict the next LUNCH
 *      The **source is always the chronologically latest actual draw**, never an
 *      older draw picked to match a requested target session. The target session
 *      is *derived* as the opposite of that latest draw, and the target date is
 *      the next valid date for that session. Same-session steps (LUNCH→LUNCH,
 *      TEA→TEA) never happen: a prediction is only made when the immediately
 *      preceding draw is the opposite session. The source is always strictly
 *      before the target in real chronology (by draw date, then session time),
 *      so nothing from the target draw or the future is ever used.
 *
 *   2. **Flip-Flop.** A statistical transition feature measured from the same
 *      adjacent opposite-session pairs used for prediction (LUNCH→TEA,
 *      TEA→LUNCH): how often a number repeats from the opposite session, how
 *      often it alternates, and how much evidence there is for it. No invented
 *      transforms.
 *
 * Components are min–max normalised onto a common scale before being combined,
 * so no single signal dominates. Weights live in the model-config infrastructure
 * and are never optimised here.
 *
 * These are historical statistical patterns, NOT predictions of future
 * outcomes. Lottery draws are random.
 */

import {
  BONUS_COUNT,
  DEFAULT_WEIGHTS,
  DRAW_TIMES,
  MAIN_COUNT,
  MAIN_MAX,
  MIN_TRAIN,
  mulberry32,
  scoreNumbers,
  seedFrom,
  weightedSample,
  type EngineDraw,
  type NumberStat,
} from "./base44-engine";
import type { DrawType, Uk49sDraw } from "./uk49s";

/** Strategy / version identifiers used by the model-config records. */
export const SUPERHYBRID_STRATEGY = "superhybrid";
export const SUPERHYBRID_VERSION = "superhybrid-v1";
/** Lines produced per target draw. */
export const SUPERHYBRID_LINES = 1;
/** Upper bound on scored targets per backtest run. */
export const SUPERHYBRID_MAX_TESTS = 1500;
/** Score sharpening curve (reuses the engine's "power" convention). */
export const SUPERHYBRID_SHARPEN = 2.2;

/** The eight configurable SuperHybrid weights. */
export interface SuperHybridWeights {
  /** Reused Base44 engine score over the target session's own history. */
  existingModel: number;
  /** Frequency in the opposite (source) session's history. */
  crossSession: number;
  /** Frequency in the target session's history. */
  frequency: number;
  /** Recency of the number in the opposite (source) session. */
  recency: number;
  /** Overdue/gap of the number in the target session. */
  gap: number;
  /** Co-occurrence with the source draw's numbers, in the target session. */
  pair: number;
  /** Flip-Flop cross-session transition score. */
  flipFlop: number;
  /** Historical sum-range balance filter strength (0 disables it). */
  pattern: number;
}

export const DEFAULT_SUPERHYBRID_WEIGHTS: SuperHybridWeights = {
  existingModel: 0.3,
  crossSession: 0.2,
  frequency: 0.1,
  recency: 0.1,
  gap: 0.08,
  pair: 0.07,
  flipFlop: 0.15,
  pattern: 0,
};

export const SUPERHYBRID_WEIGHT_ORDER: (keyof SuperHybridWeights)[] = [
  "existingModel",
  "crossSession",
  "frequency",
  "recency",
  "gap",
  "pair",
  "flipFlop",
  "pattern",
];

// ---------------------------------------------------------------------------
// Draw shapes
// ---------------------------------------------------------------------------

/** An engine draw tagged with the session it belongs to. */
export interface SessionDraw extends EngineDraw {
  drawType: DrawType;
}

export function oppositeSession(drawType: DrawType): DrawType {
  return drawType === "lunchtime" ? "teatime" : "lunchtime";
}

export function drawTimeFor(drawType: DrawType): string {
  return DRAW_TIMES[drawType];
}

/** Converts stored draws (any order) to engine draws carrying their session. */
export function toSessionDraws(draws: Uk49sDraw[]): SessionDraw[] {
  return draws.map((draw) => ({
    drawType: draw.drawType,
    draw_date: draw.drawDate,
    draw_time: DRAW_TIMES[draw.drawType],
    numbers: [
      draw.mainNumber1,
      draw.mainNumber2,
      draw.mainNumber3,
      draw.mainNumber4,
      draw.mainNumber5,
      draw.mainNumber6,
    ],
    bonus_numbers: [draw.boosterBall],
  }));
}

/** Ascending real chronology: by date, then by session time. */
export function sortChronological(draws: SessionDraw[]): SessionDraw[] {
  return [...draws].sort((a, b) =>
    a.draw_date === b.draw_date ? a.draw_time.localeCompare(b.draw_time) : a.draw_date.localeCompare(b.draw_date),
  );
}

// ---------------------------------------------------------------------------
// Cross-session source resolution
// ---------------------------------------------------------------------------

/** Adds whole days to an ISO date without timezone drift. */
export function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The chronologically latest actual draw across all recorded draws. */
export function latestCompletedDraw(draws: SessionDraw[]): SessionDraw | null {
  const asc = sortChronological(draws);
  return asc.length ? asc[asc.length - 1] : null;
}

/**
 * The flip-flop target that follows a source draw: the opposite session, on the
 * next valid date for that session.
 *
 * A LUNCH draw is followed by that day's TEA (17:49 > 12:30); a TEA draw is
 * followed by the next day's LUNCH (12:30 < 17:49). This never assumes which
 * session is "current" — it is driven purely by the source draw's session.
 */
export function flipFlopTargetOf(source: SessionDraw): { targetType: DrawType; targetDate: string } {
  const targetType = oppositeSession(source.drawType);
  const sameDay = drawTimeFor(targetType) > source.draw_time;
  return { targetType, targetDate: sameDay ? source.draw_date : addDaysIso(source.draw_date, 1) };
}

/**
 * The flip-flop source for a target: the *latest* draw in `before`, and only
 * when it is the opposite session to the target. Never reaches back to an older
 * opposite-session draw — a same-session latest draw yields no prediction.
 */
export function latestSourceBefore(before: SessionDraw[], targetType: DrawType): SessionDraw | null {
  const latest = before.length ? before[before.length - 1] : null;
  if (!latest) return null;
  return latest.drawType === oppositeSession(targetType) ? latest : null;
}

/**
 * The latest completed opposite-session draw across all recorded draws — the
 * live source for a target. Never assumes which session is "current", and never
 * falls back to an older draw than the chronologically latest one.
 */
export function latestSource(draws: SessionDraw[], targetType: DrawType): SessionDraw | null {
  return latestSourceBefore(sortChronological(draws), targetType);
}

// ---------------------------------------------------------------------------
// Flip-Flop
// ---------------------------------------------------------------------------

export interface FlipFlopStat {
  n: number;
  /** 0..1 transition score (0.5 = neutral vs chance). */
  score: number;
  /** Smoothed share of source appearances that carry into the target session. */
  repeatRate: number;
  /** Smoothed share of source absences that flip into the target session. */
  alternationRate: number;
  /** Source appearances observed (evidence volume). */
  exposure: number;
}

const FLIP_FLOP_SMOOTHING = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Flip-Flop statistics over chronological opposite-session transitions.
 *
 * For every target draw, the paired source is the *immediately preceding* draw,
 * and only when it is the opposite session (identical to the prediction
 * pairing), so the feature can never see the target draw itself and never
 * reaches back past a same-session draw.
 */
export function flipFlopStats(allAsc: SessionDraw[]): FlipFlopStat[] {
  const repeat = new Array<number>(MAIN_MAX + 1).fill(0);
  const exposure = new Array<number>(MAIN_MAX + 1).fill(0);
  const flips = new Array<number>(MAIN_MAX + 1).fill(0);
  const absent = new Array<number>(MAIN_MAX + 1).fill(0);

  let previous: SessionDraw | null = null;

  for (const draw of allAsc) {
    const source = previous && previous.drawType === oppositeSession(draw.drawType) ? previous : null;
    if (source) {
      const src = new Set(source.numbers);
      const tgt = new Set(draw.numbers);
      for (let n = 1; n <= MAIN_MAX; n += 1) {
        if (src.has(n)) {
          exposure[n] += 1;
          if (tgt.has(n)) repeat[n] += 1;
        } else {
          absent[n] += 1;
          if (tgt.has(n)) flips[n] += 1;
        }
      }
    }
    previous = draw;
  }

  const repeatBase = MAIN_COUNT / MAIN_MAX; // P(target has n | source has n) by chance
  const altBase = MAIN_COUNT / (MAIN_MAX - MAIN_COUNT); // P(target has n | source lacks n)
  const k = FLIP_FLOP_SMOOTHING;

  const stats: FlipFlopStat[] = [];
  for (let n = 1; n <= MAIN_MAX; n += 1) {
    const repeatRate = (repeat[n] + k * repeatBase) / (exposure[n] + k);
    const alternationRate = (flips[n] + k * altBase) / (absent[n] + k);
    const confidence = exposure[n] / (exposure[n] + k);
    const repeatSignal = clamp((repeatRate - repeatBase) / repeatBase, -1, 1);
    const altSignal = clamp((alternationRate - altBase) / altBase, -1, 1) * (absent[n] / (absent[n] + k));
    const score = clamp(0.5 + 0.4 * repeatSignal * confidence + 0.2 * altSignal, 0, 1);
    stats.push({ n, score, repeatRate, alternationRate, exposure: exposure[n] });
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Component scoring
// ---------------------------------------------------------------------------

export interface SuperHybridComponents {
  existingModel: number[];
  crossSession: number[];
  frequency: number[];
  recency: number[];
  gap: number[];
  pair: number[];
  flipFlop: number[];
}

/** Min–max normalises a vector onto 0..1 (flat vectors map to 0.5). */
function normalizeVector(values: number[]): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-9) {
    return values.map(() => 0.5);
  }
  return values.map((value) => (value - min) / (max - min));
}

/** Converts a `scoreNumbers` result into a vector indexed by number (1..49). */
function statsToVector(stats: NumberStat[], pick: (stat: NumberStat) => number): number[] {
  const vector = new Array<number>(MAIN_MAX + 1).fill(0);
  for (const stat of stats) vector[stat.n] = pick(stat);
  return vector;
}

function coOccurrence(draws: EngineDraw[]): number[][] {
  const matrix: number[][] = Array.from({ length: MAIN_MAX + 1 }, () => new Array<number>(MAIN_MAX + 1).fill(0));
  for (const draw of draws) {
    for (const a of draw.numbers) {
      for (const b of draw.numbers) {
        if (a !== b) matrix[a][b] += 1;
      }
    }
  }
  return matrix;
}

/**
 * Builds the normalised component vectors (indexed by number 1..49) for a target
 * session, using only the draws supplied in `targetDraws` / `sourceDraws`.
 */
export function buildComponentVectors(
  targetDraws: EngineDraw[],
  sourceDraws: EngineDraw[],
  flips: FlipFlopStat[],
  sourceNumbers: number[],
): SuperHybridComponents {
  const targetStats = scoreNumbers(targetDraws, "numbers", DEFAULT_WEIGHTS);
  const sourceStats = scoreNumbers(sourceDraws, "numbers", DEFAULT_WEIGHTS);

  const existingModel = statsToVector(targetStats, (s) => s.score);
  const frequency = statsToVector(targetStats, (s) => s.count);
  const crossSession = statsToVector(sourceStats, (s) => s.count);

  const recency = new Array<number>(MAIN_MAX + 1).fill(0);
  for (const stat of sourceStats) {
    const gap = stat.lastSeen ?? sourceDraws.length;
    recency[stat.n] = 1 / (1 + gap);
  }

  const expectedGap = MAIN_MAX / MAIN_COUNT;
  const gapVector = new Array<number>(MAIN_MAX + 1).fill(0);
  for (const stat of targetStats) {
    const seenGap = stat.lastSeen ?? targetDraws.length;
    gapVector[stat.n] = Math.min(seenGap / expectedGap, 3);
  }

  const matrix = coOccurrence(targetDraws);
  const pair = new Array<number>(MAIN_MAX + 1).fill(0);
  const sourceSet = new Set(sourceNumbers);
  for (let n = 1; n <= MAIN_MAX; n += 1) {
    let sum = 0;
    for (const m of sourceSet) {
      if (m !== n) sum += matrix[n][m];
    }
    pair[n] = sum;
  }

  const flipFlop = new Array<number>(MAIN_MAX + 1).fill(0.5);
  for (const stat of flips) flipFlop[stat.n] = stat.score;

  return {
    existingModel: normalizeVector(existingModel),
    crossSession: normalizeVector(crossSession),
    frequency: normalizeVector(frequency),
    recency: normalizeVector(recency),
    gap: normalizeVector(gapVector),
    pair: normalizeVector(pair),
    flipFlop: normalizeVector(flipFlop),
  };
}

/** Σ weightᶜ · componentᶜ per number. */
export function combineComponents(
  components: SuperHybridComponents,
  weights: SuperHybridWeights,
): number[] {
  const combined = new Array<number>(MAIN_MAX + 1).fill(0);
  for (let n = 1; n <= MAIN_MAX; n += 1) {
    let total = 0;
    for (const key of SUPERHYBRID_WEIGHT_ORDER) {
      if (key === "pattern") continue; // pattern acts as a selection filter, not a score
      total += weights[key] * components[key][n];
    }
    combined[n] = total;
  }
  return combined;
}

/** Historical target-session sum window used by the pattern filter. */
function sumWindow(targetDraws: EngineDraw[]): { min: number; max: number } | null {
  if (targetDraws.length < MIN_TRAIN) return null;
  const sums = targetDraws.map((draw) => draw.numbers.reduce((a, b) => a + b, 0)).sort((a, b) => a - b);
  const pick = (q: number) => sums[Math.min(sums.length - 1, Math.floor(q * sums.length))];
  return { min: pick(0.1), max: pick(0.9) };
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

export interface SuperHybridSource {
  drawType: DrawType;
  draw_date: string;
  draw_time: string;
  numbers: number[];
  bonus_numbers: number[];
}

export interface SuperHybridPrediction {
  target_type: DrawType;
  target_date: string;
  numbers: number[];
  bonus_numbers: number[];
  confidence: number;
  source: SuperHybridSource;
  /** Weighted contribution of each component, averaged over the chosen line. */
  contributions: SuperHybridWeights;
}

export interface BuildSuperHybridOptions {
  /** Draws strictly before the target, in ascending chronology. */
  before: SessionDraw[];
  /** The target session — must be the opposite of the latest draw in `before`. */
  targetType: DrawType;
  /** Optional; derived from the source's flip-flop cycle when omitted. */
  targetDate?: string;
  weights?: SuperHybridWeights;
}

/**
 * Builds a SuperHybrid line for the flip-flop target that follows the latest
 * draw in `before`. The source is the chronologically latest draw, which must be
 * the opposite session to `targetType`; otherwise (a same-session step) no
 * prediction is made. Returns null when there is no eligible source draw or not
 * enough history — no prediction is ever fabricated.
 */
export function buildSuperHybridPrediction(opts: BuildSuperHybridOptions): SuperHybridPrediction | null {
  const { before, targetType } = opts;
  const weights = opts.weights ?? DEFAULT_SUPERHYBRID_WEIGHTS;

  const source = latestSourceBefore(before, targetType);
  if (!source) return null;
  if (before.length < MIN_TRAIN) return null;

  const targetDate = opts.targetDate ?? flipFlopTargetOf(source).targetDate;

  const sourceType = source.drawType;
  const targetDraws = before.filter((draw) => draw.drawType === targetType);
  const sourceDraws = before.filter((draw) => draw.drawType === sourceType);
  if (targetDraws.length === 0 || sourceDraws.length === 0) return null;

  const flips = flipFlopStats(before);
  const components = buildComponentVectors(targetDraws, sourceDraws, flips, source.numbers);
  const combined = combineComponents(components, weights);

  const pool: NumberStat[] = [];
  for (let n = 1; n <= MAIN_MAX; n += 1) {
    pool.push({ n, count: 0, lastSeen: null, score: combined[n] });
  }

  const rand = mulberry32(
    seedFrom(
      [
        SUPERHYBRID_VERSION,
        targetType,
        targetDate,
        source.draw_date,
        source.draw_time,
        source.numbers.join("-"),
        before.length,
        SUPERHYBRID_WEIGHT_ORDER.map((key) => weights[key]).join(","),
      ].join("|"),
    ),
  );

  const lowMax = Math.floor(MAIN_MAX / 2);
  const window = weights.pattern > 0 ? sumWindow(targetDraws) : null;
  const maxScore = Math.max(...pool.map((s) => s.score)) || 1;

  let numbers: number[] | null = null;
  for (let guard = 0; guard < 40; guard += 1) {
    const candidate = weightedSample(pool, MAIN_COUNT, rand, SUPERHYBRID_SHARPEN);
    const low = candidate.filter((n) => n <= lowMax).length;
    const even = candidate.filter((n) => n % 2 === 0).length;
    if (low === 0 || low === MAIN_COUNT || even === 0 || even === MAIN_COUNT) continue;
    if (window) {
      const sum = candidate.reduce((a, b) => a + b, 0);
      if (sum < window.min || sum > window.max) continue;
    }
    numbers = candidate;
    break;
  }
  if (!numbers) return null;

  const bonusStats = scoreNumbers(targetDraws, "bonus_numbers", DEFAULT_WEIGHTS);
  const [booster] = weightedSample(bonusStats, BONUS_COUNT, rand, SUPERHYBRID_SHARPEN);

  const avgScore = numbers.reduce((acc, n) => acc + combined[n], 0) / numbers.length;
  const contributions = {} as SuperHybridWeights;
  for (const key of SUPERHYBRID_WEIGHT_ORDER) {
    if (key === "pattern") {
      contributions.pattern = weights.pattern;
      continue;
    }
    const avg = numbers.reduce((acc, n) => acc + components[key][n], 0) / numbers.length;
    contributions[key] = Math.round(weights[key] * avg * 1000) / 1000;
  }

  return {
    target_type: targetType,
    target_date: targetDate,
    numbers,
    bonus_numbers: [booster ?? bonusStats[0]?.n ?? 1],
    confidence: Math.round(Math.min(0.99, (avgScore / maxScore) * 0.92) * 100) / 100,
    source: {
      drawType: source.drawType,
      draw_date: source.draw_date,
      draw_time: source.draw_time,
      numbers: source.numbers,
      bonus_numbers: source.bonus_numbers,
    },
    contributions,
  };
}

// ---------------------------------------------------------------------------
// Walk-forward backtest
// ---------------------------------------------------------------------------

export interface SessionMetrics {
  testedDraws: number;
  avgHits: number;
  bestHits: number;
  fourHitCount: number;
  fourHitRate: number;
  boosterRate: number;
  randomAvgHits: number;
  frequencyAvgHits: number;
  randomBoosterRate: number;
  frequencyBoosterRate: number;
  edgeVsRandom: number;
  edgeVsFrequency: number;
  hitDistribution: { hits: number; lines: number; pct: number }[];
}

export interface SuperHybridRun {
  target_date: string;
  target_session: DrawType;
  source_session: DrawType;
  source_date: string;
  source_numbers: number[];
  predicted: number[];
  predicted_booster: number;
  actual: number[];
  actual_booster: number;
  mainHits: number;
  boosterHit: boolean;
  confidence: number;
  contributions: SuperHybridWeights;
  randomHits: number;
  frequencyHits: number;
  randomBoosterHit: boolean;
  frequencyBoosterHit: boolean;
}

export interface SuperHybridReport {
  strategy: typeof SUPERHYBRID_STRATEGY;
  version: string;
  weights: SuperHybridWeights;
  testedDraws: number;
  historyPerRun: number;
  linesPerDraw: number;
  overall: SessionMetrics;
  bySession: Record<DrawType, SessionMetrics>;
  /** Direction breakdown: source session → target session. */
  directions: { lunchToTea: SessionMetrics; teaToLunch: SessionMetrics };
  diagnostics: { component: keyof SuperHybridWeights; average: number }[];
  examples: { lunchToTea: SuperHybridRun | null; teaToLunch: SuperHybridRun | null };
  runs: SuperHybridRun[];
}

export interface SuperHybridBacktestOptions {
  weights?: SuperHybridWeights;
  /** Restrict to a single target session (do not mix samples). */
  only?: DrawType | null;
  startDate?: string;
  endDate?: string;
  maxTests?: number;
}

/** Top-N numbers by historical count (deterministic frequency baseline). */
function frequencyLine(targetDraws: EngineDraw[]): { main: number[]; booster: number } {
  const mainStats = scoreNumbers(targetDraws, "numbers", DEFAULT_WEIGHTS);
  const main = [...mainStats]
    .sort((a, b) => (b.count === a.count ? a.n - b.n : b.count - a.count))
    .slice(0, MAIN_COUNT)
    .map((s) => s.n)
    .sort((a, b) => a - b);
  const bonusStats = scoreNumbers(targetDraws, "bonus_numbers", DEFAULT_WEIGHTS);
  const booster = [...bonusStats].sort((a, b) => (b.count === a.count ? a.n - b.n : b.count - a.count))[0]?.n ?? 1;
  return { main, booster };
}

/** Deterministic random baseline line for a given target draw. */
function randomLine(targetDate: string, targetType: DrawType): { main: number[]; booster: number } {
  const rand = mulberry32(seedFrom(`random|${targetType}|${targetDate}`));
  const pool = Array.from({ length: MAIN_MAX }, (_, i) => i + 1);
  const main: number[] = [];
  while (main.length < MAIN_COUNT && pool.length) {
    const idx = Math.floor(rand() * pool.length);
    main.push(pool.splice(idx, 1)[0]);
  }
  const booster = Math.floor(rand() * MAIN_MAX) + 1;
  return { main: main.sort((a, b) => a - b), booster };
}

function metricsFrom(
  runs: SuperHybridRun[],
  pick: (run: SuperHybridRun) => { hits: number; booster: boolean; randomHits: number; randomBooster: boolean; frequencyHits: number; frequencyBooster: boolean },
): SessionMetrics {
  const distribution = new Array<number>(MAIN_COUNT + 1).fill(0);
  let hits = 0;
  let best = 0;
  let four = 0;
  let booster = 0;
  let randomHits = 0;
  let randomBooster = 0;
  let frequencyHits = 0;
  let frequencyBooster = 0;

  for (const run of runs) {
    const value = pick(run);
    distribution[value.hits] += 1;
    hits += value.hits;
    if (value.hits > best) best = value.hits;
    if (value.hits >= 4) four += 1;
    if (value.booster) booster += 1;
    randomHits += value.randomHits;
    if (value.randomBooster) randomBooster += 1;
    frequencyHits += value.frequencyHits;
    if (value.frequencyBooster) frequencyBooster += 1;
  }

  const count = runs.length;
  const avgHits = count ? hits / count : 0;
  const randomAvg = count ? randomHits / count : 0;
  const frequencyAvg = count ? frequencyHits / count : 0;
  const round = (value: number) => Math.round(value * 1000) / 1000;

  return {
    testedDraws: count,
    avgHits: round(avgHits),
    bestHits: best,
    fourHitCount: four,
    fourHitRate: count ? round(four / count) : 0,
    boosterRate: count ? round(booster / count) : 0,
    randomAvgHits: round(randomAvg),
    frequencyAvgHits: round(frequencyAvg),
    randomBoosterRate: count ? round(randomBooster / count) : 0,
    frequencyBoosterRate: count ? round(frequencyBooster / count) : 0,
    edgeVsRandom: randomAvg ? round((avgHits - randomAvg) / randomAvg) : 0,
    edgeVsFrequency: frequencyAvg ? round((avgHits - frequencyAvg) / frequencyAvg) : 0,
    hitDistribution: distribution.map((lines, index) => ({
      hits: index,
      lines,
      pct: count ? round((lines / count) * 100) : 0,
    })),
  };
}

function defaultMetrics(): SessionMetrics {
  return metricsFrom([], (run) => ({
    hits: run.mainHits,
    booster: run.boosterHit,
    randomHits: run.randomHits,
    randomBooster: run.randomBoosterHit,
    frequencyHits: run.frequencyHits,
    frequencyBooster: run.frequencyBoosterHit,
  }));
}

/**
 * Scores one flip-flop step in the chronological series: the latest available
 * draw (`allAsc[index - 1]`) is the source and the next draw (`allAsc[index]`)
 * is the target. Only opposite-session steps are scored — a same-session step
 * yields nothing. Evaluates the model plus the two baselines against the same
 * target. Returns null when the step is filtered out or ineligible.
 */
function scoreRunAt(
  allAsc: SessionDraw[],
  index: number,
  options: SuperHybridBacktestOptions,
  weights: SuperHybridWeights,
): SuperHybridRun | null {
  // Flip-flop: never predict a draw from a same-session source.
  const previous = allAsc[index - 1];
  if (!previous || previous.drawType === allAsc[index].drawType) return null;

  const target = allAsc[index];
  if (options.only && target.drawType !== options.only) return null;
  if (options.startDate && target.draw_date < options.startDate) return null;
  if (options.endDate && target.draw_date > options.endDate) return null;

  const before = allAsc.slice(0, index);
  if (before.length < MIN_TRAIN) return null;

  const prediction = buildSuperHybridPrediction({
    before,
    targetType: target.drawType,
    targetDate: target.draw_date,
    weights,
  });
  if (!prediction) return null;

  const actualSet = new Set(target.numbers);
  const actualBooster = target.bonus_numbers[0];
  const random = randomLine(target.draw_date, target.drawType);
  const frequency = frequencyLine(before.filter((draw) => draw.drawType === target.drawType));

  return {
    target_date: target.draw_date,
    target_session: target.drawType,
    source_session: prediction.source.drawType,
    source_date: prediction.source.draw_date,
    source_numbers: prediction.source.numbers,
    predicted: prediction.numbers,
    predicted_booster: prediction.bonus_numbers[0],
    actual: target.numbers,
    actual_booster: actualBooster,
    mainHits: prediction.numbers.filter((n) => actualSet.has(n)).length,
    boosterHit: prediction.bonus_numbers[0] === actualBooster,
    confidence: prediction.confidence,
    contributions: prediction.contributions,
    randomHits: random.main.filter((n) => actualSet.has(n)).length,
    frequencyHits: frequency.main.filter((n) => actualSet.has(n)).length,
    randomBoosterHit: random.booster === actualBooster,
    frequencyBoosterHit: frequency.booster === actualBooster,
  };
}

/**
 * Flip-flop walk-forward backtest. It replays the live process exactly: at each
 * point the latest available draw is the source, the immediately following draw
 * is the target, and the run advances to the newly available draw before
 * switching session. Same-session steps are skipped, so the evaluated runs form
 * the alternating LUNCH→TEA→LUNCH→TEA chain. Every feature uses only draws
 * strictly before the target — never the target itself, never the future.
 * Baselines are computed over the exact same target sample.
 */
export function runSuperHybridBacktest(
  draws: Uk49sDraw[],
  options: SuperHybridBacktestOptions = {},
): SuperHybridReport {
  const weights = options.weights ?? DEFAULT_SUPERHYBRID_WEIGHTS;
  const maxTests = options.maxTests ?? SUPERHYBRID_MAX_TESTS;
  const allAsc = sortChronological(toSessionDraws(draws));
  const runs: SuperHybridRun[] = [];

  for (let i = 1; i < allAsc.length && runs.length < maxTests; i += 1) {
    const run = scoreRunAt(allAsc, i, options, weights);
    if (!run) continue;
    runs.push(run);
  }

  return summarizeSuperHybrid(runs, weights);
}

export function summarizeSuperHybrid(runs: SuperHybridRun[], weights: SuperHybridWeights): SuperHybridReport {
  const all = (run: SuperHybridRun) => ({
    hits: run.mainHits,
    booster: run.boosterHit,
    randomHits: run.randomHits,
    randomBooster: run.randomBoosterHit,
    frequencyHits: run.frequencyHits,
    frequencyBooster: run.frequencyBoosterHit,
  });

  const lunchRuns = runs.filter((run) => run.target_session === "lunchtime");
  const teaRuns = runs.filter((run) => run.target_session === "teatime");

  const diagnostics = SUPERHYBRID_WEIGHT_ORDER.map((component) => {
    if (component === "pattern") return { component, average: weights.pattern };
    if (runs.length === 0) return { component, average: 0 };
    const average = runs.reduce((acc, run) => acc + run.contributions[component], 0) / runs.length;
    return { component, average: Math.round(average * 1000) / 1000 };
  });

  const findExample = (session: DrawType) => runs.find((run) => run.target_session === session) ?? null;

  return {
    strategy: SUPERHYBRID_STRATEGY,
    version: SUPERHYBRID_VERSION,
    weights,
    testedDraws: runs.length,
    historyPerRun: MIN_TRAIN,
    linesPerDraw: SUPERHYBRID_LINES,
    overall: runs.length ? metricsFrom(runs, all) : defaultMetrics(),
    bySession: {
      lunchtime: lunchRuns.length ? metricsFrom(lunchRuns, all) : defaultMetrics(),
      teatime: teaRuns.length ? metricsFrom(teaRuns, all) : defaultMetrics(),
    },
    directions: {
      lunchToTea: teaRuns.length ? metricsFrom(teaRuns, all) : defaultMetrics(),
      teaToLunch: lunchRuns.length ? metricsFrom(lunchRuns, all) : defaultMetrics(),
    },
    diagnostics,
    examples: { lunchToTea: findExample("teatime"), teaToLunch: findExample("lunchtime") },
    runs,
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/** Cooperative-yielding variant so a long backtest cannot block the server. */
export async function runSuperHybridBacktestAsync(
  draws: Uk49sDraw[],
  options: SuperHybridBacktestOptions = {},
): Promise<SuperHybridReport> {
  const weights = options.weights ?? DEFAULT_SUPERHYBRID_WEIGHTS;
  const maxTests = options.maxTests ?? SUPERHYBRID_MAX_TESTS;
  const allAsc = sortChronological(toSessionDraws(draws));
  const runs: SuperHybridRun[] = [];

  for (let i = 1; i < allAsc.length && runs.length < maxTests; i += 1) {
    const run = scoreRunAt(allAsc, i, options, weights);
    if (run) runs.push(run);
    await yieldToEventLoop();
  }

  return summarizeSuperHybrid(runs, weights);
}
