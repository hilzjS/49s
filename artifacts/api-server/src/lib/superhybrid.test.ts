/**
 * SuperHybrid strategy tests — cross-session source selection, Flip-Flop,
 * leakage-safety and baseline sample alignment.
 *
 * These test the engine directly (no database), matching the walk-forward logic
 * used live.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SUPERHYBRID_WEIGHTS,
  MIN_TRAIN,
  buildSuperHybridPrediction,
  flipFlopStats,
  latestSource,
  runSuperHybridBacktest,
  sortChronological,
  toSessionDraws,
  type DrawType,
  type SessionDraw,
  type Uk49sDraw,
} from "@workspace/db/schema";

function draw(date: string, drawType: DrawType, main: number[], booster: number): Uk49sDraw {
  return {
    id: 0,
    drawDate: date,
    drawType,
    mainNumber1: main[0],
    mainNumber2: main[1],
    mainNumber3: main[2],
    mainNumber4: main[3],
    mainNumber5: main[4],
    mainNumber6: main[5],
    boosterBall: booster,
    sourceUrl: null,
    validationStatus: "valid",
    scrapeRunId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function shift(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A deterministic series with a LUNCH and a TEA draw on every day. */
function bothSessionDays(startIso: string, days: number): Uk49sDraw[] {
  const out: Uk49sDraw[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = shift(startIso, i);
    const s = (i % 40) + 1;
    out.push(draw(date, "lunchtime", [s, s + 1, s + 2, s + 3, s + 4, s + 5], ((s + 6) % 49) + 1));
    const t = (i % 40) + 5;
    out.push(draw(date, "teatime", [t, t + 1, t + 2, t + 3, t + 4, t + 5], ((t + 8) % 49) + 1));
  }
  return out;
}

function asc(draws: Uk49sDraw[]): SessionDraw[] {
  return sortChronological(toSessionDraws(draws));
}

/** Draws strictly before a target, in chronological order. */
function before(draws: Uk49sDraw[], targetDate: string, targetTime: string): SessionDraw[] {
  return asc(draws).filter((d) => `${d.draw_date}T${d.draw_time}` < `${targetDate}T${targetTime}`);
}

const START = "2026-09-01";

// ---------------------------------------------------------------------------
// Test 1 — TEA prediction source
// ---------------------------------------------------------------------------

test("SuperHybrid: a TEA prediction uses the latest preceding LUNCH", () => {
  const draws = bothSessionDays(START, 32); // ... through 2026-10-01
  const target = "2026-10-01";
  const prediction = buildSuperHybridPrediction({
    before: before(draws, target, "17:49"),
    targetType: "teatime",
    targetDate: target,
  });

  assert.ok(prediction);
  assert.equal(prediction.source.drawType, "lunchtime");
  assert.equal(prediction.source.draw_date, target);
  assert.notEqual(prediction.source.draw_date, "2026-09-30");
});

// ---------------------------------------------------------------------------
// Test 2 — LUNCH prediction source
// ---------------------------------------------------------------------------

test("SuperHybrid: a LUNCH prediction uses the latest preceding TEA", () => {
  const draws = bothSessionDays(START, 33); // ... through 2026-10-02
  const target = "2026-10-02";
  const prediction = buildSuperHybridPrediction({
    before: before(draws, target, "12:30"),
    targetType: "lunchtime",
    targetDate: target,
  });

  assert.ok(prediction);
  assert.equal(prediction.source.drawType, "teatime");
  assert.equal(prediction.source.draw_date, "2026-10-01");
});

// ---------------------------------------------------------------------------
// Test 3 — No leakage
// ---------------------------------------------------------------------------

test("SuperHybrid: no future data — earlier runs are identical when later draws change", () => {
  const draws = bothSessionDays(START, 40);
  const full = runSuperHybridBacktest(draws);
  const cutIdx = draws.findIndex((d) => d.drawDate === "2026-10-05");
  const truncated = runSuperHybridBacktest(draws.slice(0, cutIdx));

  assert.ok(full.runs.length > 0 && truncated.runs.length > 0);
  // Every run the truncated backtest could see must be byte-identical.
  for (const run of truncated.runs) {
    const match = full.runs.find(
      (r) => r.target_date === run.target_date && r.target_session === run.target_session,
    );
    assert.ok(match, `missing ${run.target_session} ${run.target_date}`);
    assert.deepEqual(match.predicted, run.predicted);
  }
});

test("SuperHybrid: the target draw is never the source", () => {
  const report = runSuperHybridBacktest(bothSessionDays(START, 40));
  assert.ok(report.runs.length > 0);
  for (const run of report.runs) {
    assert.notEqual(run.source_session, run.target_session);
    assert.ok(
      `${run.source_date}T00:00` <= `${run.target_date}T23:59`,
      "source must not be after the target",
    );
    // Identical date is only valid when the source session runs earlier that day.
    if (run.source_date === run.target_date) assert.equal(run.source_session, "lunchtime");
  }
});

// ---------------------------------------------------------------------------
// Test 4 — Flip-Flop determinism
// ---------------------------------------------------------------------------

test("SuperHybrid: Flip-Flop is deterministic and rewards real cross-session repeats", () => {
  const draws: Uk49sDraw[] = [];
  for (let i = 0; i < 30; i += 1) {
    const date = shift(START, i);
    draws.push(draw(date, "lunchtime", [5, 10, 15, 20, 25, 30], 7));
    draws.push(draw(date, "teatime", [5, 11, 16, 21, 26, 31], 8));
  }
  const series = asc(draws);

  const first = flipFlopStats(series);
  const second = flipFlopStats(series);
  assert.deepEqual(first, second, "Flip-Flop must be deterministic");

  const five = first.find((stat) => stat.n === 5);
  const never = first.find((stat) => stat.n === 49);
  assert.ok(five && never);
  // 5 appears in every LUNCH and every TEA → strong positive repeat signal.
  assert.ok(five.score > 0.5, `expected > 0.5, got ${five.score}`);
  // 49 never appears → stays neutral.
  assert.ok(never.score >= 0.25 && never.score <= 0.75, `expected neutral, got ${never.score}`);
});

// ---------------------------------------------------------------------------
// Test 5 — Session separation
// ---------------------------------------------------------------------------

test("SuperHybrid: LUNCH and TEA targets are evaluated independently", () => {
  const draws = bothSessionDays(START, 45);

  const lunch = runSuperHybridBacktest(draws, { only: "lunchtime" });
  const tea = runSuperHybridBacktest(draws, { only: "teatime" });

  assert.ok(lunch.runs.length > 0 && tea.runs.length > 0);
  assert.ok(lunch.runs.every((run) => run.target_session === "lunchtime"));
  assert.ok(tea.runs.every((run) => run.target_session === "teatime"));

  // Direction breakdown maps to the opposite source.
  assert.equal(tea.directions.lunchToTea.testedDraws, tea.runs.length);
  assert.equal(tea.directions.teaToLunch.testedDraws, 0);
  assert.equal(lunch.directions.teaToLunch.testedDraws, lunch.runs.length);
  assert.equal(lunch.directions.lunchToTea.testedDraws, 0);
});

// ---------------------------------------------------------------------------
// Test 6 — Latest live source is auto-detected
// ---------------------------------------------------------------------------

test("SuperHybrid: the latest opposite-session draw is selected automatically", () => {
  const draws = bothSessionDays(START, 32); // newest day: 2026-10-02
  const series = asc(draws);

  const teaSource = latestSource(series, "teatime");
  assert.ok(teaSource);
  assert.equal(teaSource.drawType, "lunchtime");
  assert.equal(teaSource.draw_date, "2026-10-02");

  const lunchSource = latestSource(series, "lunchtime");
  assert.ok(lunchSource);
  assert.equal(lunchSource.drawType, "teatime");
  assert.equal(lunchSource.draw_date, "2026-10-02");

  // Reversed insertion order must not change the resolved source.
  const shuffled = [...draws].reverse();
  assert.equal(latestSource(asc(shuffled), "teatime")?.draw_date, "2026-10-02");
});

// ---------------------------------------------------------------------------
// Test 7 — Missing source
// ---------------------------------------------------------------------------

test("SuperHybrid: no prediction is fabricated without an opposite-session draw", () => {
  // TEA-only history: a TEA prediction has no LUNCH source at all.
  const teaOnly: Uk49sDraw[] = [];
  for (let i = 0; i < 30; i += 1) {
    teaOnly.push(draw(shift(START, i), "teatime", [1, 2, 3, 4, 5, 6], 7));
  }
  const teaSeries = asc(teaOnly);
  assert.ok(teaSeries.length >= MIN_TRAIN);
  assert.equal(
    buildSuperHybridPrediction({ before: teaSeries, targetType: "teatime", targetDate: "2026-12-01" }),
    null,
  );

  // LUNCH-only history: a TEA prediction has no TEA history to score against.
  const lunchOnly: Uk49sDraw[] = [];
  for (let i = 0; i < 30; i += 1) {
    lunchOnly.push(draw(shift(START, i), "lunchtime", [1, 2, 3, 4, 5, 6], 7));
  }
  assert.equal(
    buildSuperHybridPrediction({ before: asc(lunchOnly), targetType: "teatime", targetDate: "2026-12-01" }),
    null,
  );

  // The backtest simply resolves nothing rather than inventing predictions.
  assert.equal(runSuperHybridBacktest(teaOnly, { only: "lunchtime" }).testedDraws, 0);
});

// ---------------------------------------------------------------------------
// Test 8 — Baseline sample
// ---------------------------------------------------------------------------

test("SuperHybrid: random and frequency baselines use the exact same target sample", () => {
  const report = runSuperHybridBacktest(bothSessionDays(START, 45));

  assert.ok(report.runs.length > 0);
  assert.equal(report.overall.testedDraws, report.runs.length);
  assert.equal(
    report.bySession.lunchtime.testedDraws + report.bySession.teatime.testedDraws,
    report.runs.length,
  );

  // Every run carries both baselines for the same target draw.
  for (const run of report.runs) {
    assert.ok(Number.isFinite(run.randomHits));
    assert.ok(Number.isFinite(run.frequencyHits));
    assert.ok(run.randomHits >= 0 && run.randomHits <= 4);
    assert.ok(run.frequencyHits >= 0 && run.frequencyHits <= 4);
  }

  // Hit distribution sums to the resolved sample.
  const sum = report.overall.hitDistribution.reduce((acc, entry) => acc + entry.lines, 0);
  assert.equal(sum, report.runs.length);

  // Weights are the configured defaults, never optimised in this module.
  assert.deepEqual(report.weights, DEFAULT_SUPERHYBRID_WEIGHTS);
});

console.log("All SuperHybrid tests loaded.");
