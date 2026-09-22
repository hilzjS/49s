/**
 * Optimizer validation-window resolution, preflight validation and pipeline
 * diagnostics.
 *
 * The prediction algorithm, feature definitions, scoring rules and the
 * optimization strategy all live in lib/db/src/schema/* and are used here
 * completely unchanged. This module only decides *which historical draws* form
 * the validation period and verifies that the existing pipeline is wired up
 * correctly before a run starts.
 */
import {
  DEFAULT_WEIGHTS,
  calculateAllFeatureScores,
  runBacktest,
  type BacktestResult,
  type DrawType,
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
/** Lookback window used for diagnostics (existing engine default). */
export const DEFAULT_LOOKBACK_WINDOW = 90;

export interface ValidationWindow {
  drawType: DrawType;
  earliestDrawDate: string;
  latestDrawDate: string;
  /** The most recent draw — reserved as the current prediction reference. */
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
 *
 * The window always ends on the draw immediately before the latest draw: the
 * latest draw is the current prediction reference, so it must never appear in
 * its own evaluation data. That also guarantees the draw the backtest engine
 * needs in order to close its window.
 *
 * The window aims to cover the most recent 12 months. If less history exists it
 * falls back to the largest valid window available, never going below
 * MIN_VALIDATION_DRAWS unless the data simply does not contain that many draws.
 */
export function resolveValidationWindow(draws: Uk49sDraw[], drawType: DrawType): ValidationWindow {
  const series = sortDrawsForType(draws, drawType);

  if (series.length < 2) {
    throw new Error(
      `Not enough ${drawType} draws to derive a validation window (found ${series.length}).`,
    );
  }

  const latestDrawDate = series[series.length - 1].drawDate;
  const endIdx = series.length - 2;
  const validationEndDate = series[endIdx].drawDate;

  const targetStart = subtractMonths(validationEndDate, VALIDATION_MONTHS);
  let startIdx = series.findIndex((draw) => draw.drawDate >= targetStart);
  if (startIdx === -1) startIdx = 0;

  const usedLargestAvailableWindow = startIdx === 0;

  // Extend backwards rather than reporting a window too small to be useful.
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

  checks.push({
    name: "Draw type is correct",
    ok: series.every((draw) => draw.drawType === drawType),
    critical: true,
    detail: `all ${series.length} rows are ${drawType}`,
  });

  const invalidDates = series.filter(
    (draw) => !/^\d{4}-\d{2}-\d{2}$/.test(draw.drawDate) || Number.isNaN(Date.parse(`${draw.drawDate}T00:00:00Z`)),
  );
  checks.push({
    name: "Draw dates are valid",
    ok: invalidDates.length === 0,
    critical: true,
    detail:
      invalidDates.length === 0
        ? "every draw date is a valid YYYY-MM-DD"
        : `${invalidDates.length} invalid date(s), e.g. ${invalidDates[0]?.drawDate}`,
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
      Number.isInteger(draw.boosterBall) &&
      draw.boosterBall >= 1 &&
      draw.boosterBall <= 49 &&
      !mains.includes(draw.boosterBall);
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
    name: "Prediction function available",
    ok: typeof calculateAllFeatureScores === "function",
    critical: true,
    detail: "calculateAllFeatureScores (existing feature engine)",
  });

  checks.push({
    name: "Scoring function available",
    ok: typeof runBacktest === "function",
    critical: true,
    detail: "runBacktest (existing walk-forward scoring)",
  });

  checks.push({
    name: "Training history before window",
    ok: window.trainingDrawsBeforeWindow >= DEFAULT_LOOKBACK_WINDOW,
    critical: false,
    detail: `${window.trainingDrawsBeforeWindow} draws precede ${window.validationStartDate} (longest lookback is 365)`,
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
 * Runs the existing pipeline (history → features → prediction → actual draw →
 * scoring) over a small sample of the validation window so the wiring can be
 * proven before spending minutes on hundreds of configurations.
 */
export function runPipelineDiagnostic(
  draws: Uk49sDraw[],
  drawType: DrawType,
  window: ValidationWindow,
  sampleSize: number = DEFAULT_DIAGNOSTIC_SAMPLE,
): DiagnosticReport {
  const series = sortDrawsForType(draws, drawType);
  const windowDraws = series.filter(
    (draw) => draw.drawDate >= window.validationStartDate && draw.drawDate <= window.validationEndDate,
  );
  const sample = windowDraws.slice(0, Math.max(1, Math.min(sampleSize, windowDraws.length)));

  const empty: DiagnosticReport = {
    drawType,
    window,
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
    return {
      ...empty,
      failures: [{ date: window.validationStartDate, reason: "validation window contains no draws" }],
    };
  }

  const result: BacktestResult = runBacktest(
    draws,
    {
      drawType,
      lookbackWindow: DEFAULT_LOOKBACK_WINDOW,
      testStartDate: sample[0].drawDate,
      testEndDate: sample[sample.length - 1].drawDate,
      randomSeed: 1,
    },
    DEFAULT_WEIGHTS,
  );

  const indexByDate = new Map<string, number>();
  series.forEach((draw, index) => indexByDate.set(draw.drawDate, index));

  const rows: DiagnosticRow[] = result.predictions.map((prediction) => ({
    validationDrawDate: prediction.predictionDate,
    drawType,
    trainingDrawCount: indexByDate.get(prediction.predictionDate) ?? 0,
    trainingCutoff: prediction.trainingCutoff,
    predictedMain: prediction.predictedMain,
    predictedBooster: prediction.predictedBooster,
    actualMain: prediction.actualMain,
    actualBooster: prediction.actualBooster,
    mainHits: prediction.mainHits,
    boosterHit: prediction.boosterHit,
  }));

  const evaluated = new Set(rows.map((row) => row.validationDrawDate));
  const failures = sample
    .filter((draw) => !evaluated.has(draw.drawDate))
    .map((draw) => ({
      date: draw.drawDate,
      reason: `not evaluated — fewer than ${DEFAULT_LOOKBACK_WINDOW} training draws precede it`,
    }));

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
    if (row.actualMain.length !== 6) {
      structureIssues.push(`${row.validationDrawDate}: actual draw has ${row.actualMain.length} main numbers (expected 6)`);
    }
    if (row.actualMain.some((n) => !Number.isInteger(n) || n < 1 || n > 49)) {
      structureIssues.push(`${row.validationDrawDate}: actual main number out of range`);
    }
    const recomputedHits = row.predictedMain.filter((n) => row.actualMain.includes(n)).length;
    if (recomputedHits !== row.mainHits) {
      structureIssues.push(
        `${row.validationDrawDate}: recorded ${row.mainHits} hits but direct comparison yields ${recomputedHits}`,
      );
    }
  }

  return {
    ...empty,
    predictionsGenerated: rows.length,
    predictionsFailed: failures.length,
    failures,
    structureIssues,
    avgHits: result.avgMainHits,
    fourHitRate: result.fourHitRate,
    boosterHitRate: result.boosterHitRate,
    rows,
  };
}

export function describeWindow(window: ValidationWindow): string {
  return `${window.validationStartDate} → ${window.validationEndDate} (${window.validationDrawCount} draws, ~${window.monthsCovered} months)`;
}
