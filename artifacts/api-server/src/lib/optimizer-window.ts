/**
 * Optimizer validation-window resolution, preflight validation and pipeline
 * diagnostics.
 *
 * The prediction engine itself lives in `lib/db/src/schema/base44-engine.ts` and
 * is used here unchanged. This module only decides *which historical draws* form
 * the validation period and proves the pipeline is wired up correctly.
 */
import {
  DEFAULT_WEIGHTS,
  MIN_TRAIN,
  buildPredictions,
  findChampionAsync,
  runBacktestAsync,
  toEngineDraws,
  type BacktestReport,
  type Base44Weights,
  type DrawType,
  type EngineDraw,
  type Uk49sDraw,
} from "@workspace/db/schema";

/** Minimum historical draws required before optimizing at all. */
export const MIN_HISTORICAL_DRAWS = 100;
/** Minimum draws a validation window must contain to be statistically useful. */
export const MIN_VALIDATION_DRAWS = 20;
/** How much history the automatic window aims to cover. */
export const VALIDATION_MONTHS = 12;
/** Draws used by the small diagnostic sample run. */
export const DEFAULT_DIAGNOSTIC_SAMPLE = 10;

export interface ValidationWindow {
  drawType: DrawType;
  earliestDrawDate: string;
  latestDrawDate: string;
  referenceDrawDate: string;
  totalDraws: number;
  trainingDrawsBeforeWindow: number;
  validationStartDate: string;
  validationEndDate: string;
  validationDrawCount: number;
  monthsCovered: number;
  usedLargestAvailableWindow: boolean;
}

export interface PreflightCheck {
  name: string;
  ok: boolean;
  critical: boolean;
  detail: string;
}

export class OptimizerPreflightError extends Error {
  readonly checks: PreflightCheck[];

  constructor(message: string, checks: PreflightCheck[]) {
    super(message);
    this.name = "OptimizerPreflightError";
    this.checks = checks;
  }
}

export function sortDrawsForType(draws: Uk49sDraw[], drawType: DrawType): Uk49sDraw[] {
  return draws
    .filter((draw) => draw.drawType === drawType)
    .sort((a, b) => a.drawDate.localeCompare(b.drawDate));
}

function subtractMonths(iso: string, months: number): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * Derives the validation period from the available history for one draw type.
 * The window ends on the draw immediately before the latest draw — the latest
 * draw is the prediction reference and must never appear in its own evaluation.
 */
export function resolveValidationWindow(draws: Uk49sDraw[], drawType: DrawType): ValidationWindow {
  const series = sortDrawsForType(draws, drawType);

  if (series.length < 2) {
    throw new Error(`Not enough ${drawType} draws to derive a validation window (found ${series.length}).`);
  }

  const latestDrawDate = series[series.length - 1].drawDate;
  const endIdx = series.length - 2;
  const validationEndDate = series[endIdx].drawDate;

  const targetStart = subtractMonths(validationEndDate, VALIDATION_MONTHS);
  let startIdx = series.findIndex((draw) => draw.drawDate >= targetStart);
  if (startIdx === -1) startIdx = 0;

  const usedLargestAvailableWindow = startIdx === 0;

  while (endIdx - startIdx + 1 < MIN_VALIDATION_DRAWS && startIdx > 0) {
    startIdx -= 1;
  }

  const validationStartDate = series[startIdx].drawDate;

  return {
    drawType,
    earliestDrawDate: series[0].drawDate,
    latestDrawDate,
    referenceDrawDate: latestDrawDate,
    totalDraws: series.length,
    trainingDrawsBeforeWindow: startIdx,
    validationStartDate,
    validationEndDate,
    validationDrawCount: endIdx - startIdx + 1,
    monthsCovered: Math.round((daysBetween(validationStartDate, validationEndDate) / 30.4375) * 10) / 10,
    usedLargestAvailableWindow,
  };
}

/** Data-integrity checks that must pass before a run starts. */
export function runPreflightChecks(
  draws: Uk49sDraw[],
  drawType: DrawType,
  window: ValidationWindow,
): PreflightCheck[] {
  const series = sortDrawsForType(draws, drawType);
  const checks: PreflightCheck[] = [];

  checks.push({
    name: "Minimum historical draws",
    ok: series.length >= MIN_HISTORICAL_DRAWS,
    critical: true,
    detail: `${series.length} ${drawType} draws available (minimum ${MIN_HISTORICAL_DRAWS})`,
  });

  checks.push({
    name: "Validation window contains draws",
    ok: window.validationDrawCount >= MIN_VALIDATION_DRAWS,
    critical: true,
    detail: `${window.validationDrawCount} draws in ${window.validationStartDate} → ${window.validationEndDate} (minimum ${MIN_VALIDATION_DRAWS})`,
  });

  checks.push({
    name: "No future data leakage",
    ok: window.validationEndDate < window.latestDrawDate,
    critical: true,
    detail: `window ends ${window.validationEndDate}; latest draw ${window.latestDrawDate} is excluded`,
  });

  const dates = series.map((draw) => draw.drawDate);
  const uniqueDates = new Set(dates);
  checks.push({
    name: "No duplicate draws",
    ok: uniqueDates.size === dates.length,
    critical: true,
    detail:
      uniqueDates.size === dates.length
        ? `${dates.length} unique draw dates`
        : `${dates.length - uniqueDates.size} duplicate draw date(s) detected`,
  });

  const malformed = series.filter((draw) => {
    const mains = [
      draw.mainNumber1,
      draw.mainNumber2,
      draw.mainNumber3,
      draw.mainNumber4,
      draw.mainNumber5,
      draw.mainNumber6,
    ];
    const inRange = mains.every((n) => Number.isInteger(n) && n >= 1 && n <= 49);
    const unique = new Set(mains).size === mains.length;
    const boosterOk =
      Number.isInteger(draw.boosterBall) && draw.boosterBall >= 1 && draw.boosterBall <= 49 && !mains.includes(draw.boosterBall);
    return !inRange || !unique || !boosterOk;
  });
  checks.push({
    name: "Required number fields present",
    ok: malformed.length === 0,
    critical: true,
    detail:
      malformed.length === 0
        ? "6 unique main numbers (1-49) plus a booster on every draw"
        : `${malformed.length} malformed draw(s), e.g. ${malformed[0]?.drawDate}`,
  });

  checks.push({
    name: "Training history before window",
    ok: window.trainingDrawsBeforeWindow >= MIN_TRAIN,
    critical: false,
    detail: `${window.trainingDrawsBeforeWindow} draws precede ${window.validationStartDate} (engine minimum ${MIN_TRAIN})`,
  });

  return checks;
}

/** Throws with every failed critical check attached, instead of faking 0%. */
export function assertPreflight(checks: PreflightCheck[]): void {
  const failed = checks.filter((check) => check.critical && !check.ok);
  if (failed.length > 0) {
    throw new OptimizerPreflightError(
      `Optimizer preflight failed: ${failed.map((check) => `${check.name} — ${check.detail}`).join("; ")}`,
      checks,
    );
  }
}

export interface DiagnosticRow {
  validationDrawDate: string;
  drawType: DrawType;
  trainingDrawCount: number;
  trainingCutoff: string;
  predictedMain: number[];
  predictedBooster: number;
  actualMain: number[];
  actualBooster: number;
  mainHits: number;
  boosterHit: boolean;
}

export interface DiagnosticReport {
  drawType: DrawType;
  window: ValidationWindow;
  weights: Base44Weights;
  sampleRequested: number;
  validationDrawCount: number;
  predictionsGenerated: number;
  predictionsFailed: number;
  failures: { date: string; reason: string }[];
  structureIssues: string[];
  avgHits: number;
  fourHitRate: number;
  boosterHitRate: number;
  rows: DiagnosticRow[];
}

/**
 * Runs the engine (history → score → line → actual draw → scoring) over a small
 * sample of the validation window so the wiring can be proven first.
 */
export async function runPipelineDiagnostic(
  draws: Uk49sDraw[],
  drawType: DrawType,
  window: ValidationWindow,
  sampleSize: number = DEFAULT_DIAGNOSTIC_SAMPLE,
  weights: Base44Weights = DEFAULT_WEIGHTS,
): Promise<DiagnosticReport> {
  const series = sortDrawsForType(draws, drawType);
  const windowDraws = series.filter(
    (draw) => draw.drawDate >= window.validationStartDate && draw.drawDate <= window.validationEndDate,
  );
  const sample = windowDraws.slice(0, Math.max(1, Math.min(sampleSize, windowDraws.length)));

  const base: DiagnosticReport = {
    drawType,
    window,
    weights,
    sampleRequested: sampleSize,
    validationDrawCount: window.validationDrawCount,
    predictionsGenerated: 0,
    predictionsFailed: 0,
    failures: [],
    structureIssues: [],
    avgHits: 0,
    fourHitRate: 0,
    boosterHitRate: 0,
    rows: [],
  };

  if (sample.length === 0) {
    return { ...base, failures: [{ date: window.validationStartDate, reason: "validation window contains no draws" }] };
  }

  const drawTime = drawType === "lunchtime" ? "12:30" : "17:49";
  const rows: DiagnosticRow[] = [];

  for (const target of sample) {
    const trainingDraws = series.filter((draw) => draw.drawDate < target.drawDate);
    if (trainingDraws.length < MIN_TRAIN) continue;

    const engineDraws: EngineDraw[] = toEngineDraws(trainingDraws, drawType);
    const [set] = buildPredictions({
      draws: engineDraws,
      targetDate: target.drawDate,
      drawTime,
      sets: 1,
      weights,
    });
    if (!set) continue;

    const actual = drawToNumbersLocal(target);
    const mainHits = set.numbers.filter((n) => actual.main.includes(n)).length;

    rows.push({
      validationDrawDate: target.drawDate,
      drawType,
      trainingDrawCount: trainingDraws.length,
      trainingCutoff: trainingDraws[trainingDraws.length - 1].drawDate,
      predictedMain: set.numbers,
      predictedBooster: set.bonus_numbers[0],
      actualMain: actual.main,
      actualBooster: actual.booster,
      mainHits,
      boosterHit: set.bonus_numbers[0] === actual.booster,
    });
  }

  const evaluated = new Set(rows.map((r) => r.validationDrawDate));
  const failures = sample
    .filter((draw) => !evaluated.has(draw.drawDate))
    .map((draw) => ({ date: draw.drawDate, reason: `not evaluated — fewer than ${MIN_TRAIN} training draws precede it` }));

  const structureIssues: string[] = [];
  for (const row of rows) {
    if (row.predictedMain.length !== 4) {
      structureIssues.push(`${row.validationDrawDate}: ${row.predictedMain.length} predicted main numbers (expected 4)`);
    }
    if (new Set(row.predictedMain).size !== row.predictedMain.length) {
      structureIssues.push(`${row.validationDrawDate}: duplicate predicted main numbers`);
    }
    if (row.predictedMain.some((n) => !Number.isInteger(n) || n < 1 || n > 49)) {
      structureIssues.push(`${row.validationDrawDate}: predicted main number out of range`);
    }
    if (!Number.isInteger(row.predictedBooster) || row.predictedBooster < 1 || row.predictedBooster > 49) {
      structureIssues.push(`${row.validationDrawDate}: predicted booster out of range`);
    }
    const recomputed = row.predictedMain.filter((n) => row.actualMain.includes(n)).length;
    if (recomputed !== row.mainHits) {
      structureIssues.push(`${row.validationDrawDate}: recorded ${row.mainHits} hits but direct comparison yields ${recomputed}`);
    }
  }

  const totalHits = rows.reduce((sum, r) => sum + r.mainHits, 0);
  return {
    ...base,
    predictionsGenerated: rows.length,
    predictionsFailed: failures.length,
    failures,
    structureIssues,
    avgHits: rows.length ? Math.round((totalHits / rows.length) * 100) / 100 : 0,
    fourHitRate: rows.length ? Math.round((rows.filter((r) => r.mainHits >= 4).length / rows.length) * 1000) / 10 : 0,
    boosterHitRate: rows.length ? Math.round((rows.filter((r) => r.boosterHit).length / rows.length) * 1000) / 10 : 0,
    rows,
  };
}

function drawToNumbersLocal(draw: Uk49sDraw): { main: number[]; booster: number } {
  return {
    main: [
      draw.mainNumber1,
      draw.mainNumber2,
      draw.mainNumber3,
      draw.mainNumber4,
      draw.mainNumber5,
      draw.mainNumber6,
    ],
    booster: draw.boosterBall,
  };
}

export function describeWindow(window: ValidationWindow): string {
  return `${window.validationStartDate} → ${window.validationEndDate} (${window.validationDrawCount} draws, ~${window.monthsCovered} months)`;
}

/** Re-exported so the optimizer job can run the tuner without a second import. */
export { findChampionAsync, runBacktestAsync };
export type { BacktestReport };
