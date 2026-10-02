/**
 * SuperHybrid strategy tests — flip-flop draw selection (latest draw → opposite
 * session), idempotency, the alternating walk-forward chain and leakage-safety.
 *
 * These test the engine directly (no database), reproducing exactly what the
 * live prediction engine would have known at each point in time.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SUPERHYBRID_WEIGHTS,
  MAIN_COUNT,
  MAIN_MAX,
  MIN_TRAIN,
  buildSuperHybridPrediction,
  drawTimeFor,
  flipFlopStats,
  flipFlopTargetOf,
  latestCompletedDraw,
  latestSourceBefore,
  runSuperHybridBacktest,
  sortChronological,
  toSessionDraws,
  type DrawType,
  type SessionDraw,
  type SuperHybridPrediction,
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

/**
 * Reproduces the live engine exactly: resolve the latest actual draw, derive the
 * opposite target session and its next date, then predict from the prior draws.
 */
function liveStep(draws: Uk49sDraw[]): SuperHybridPrediction | null {
  const allAsc = asc(draws);
  const source = latestCompletedDraw(allAsc);
  if (!source) return null;
  const { targetType, targetDate } = flipFlopTargetOf(source);
  const key = `${targetDate}T${drawTimeFor(targetType)}`;
  const before = allAsc.filter((d) => `${d.draw_date}T${d.draw_time}` < key);
  return buildSuperHybridPrediction({ before, targetType, targetDate });
}

const START = "2026-09-01";

// A series whose latest draw is LUNCH 2026-09-30 (the final TEA is withheld).
const endingOnLunch = bothSessionDays(START, 30).filter(
  (d) => !(d.drawDate === "2026-09-30" && d.drawType === "teatime"),
);

// ---------------------------------------------------------------------------
// 1 & 2 — session mapping + example sequence
// ---------------------------------------------------------------------------

test("SuperHybrid: latest draw LUNCH → target is that day's TEA", () => {
  const latest = latestCompletedDraw(asc(endingOnLunch));
  assert.ok(latest);
  assert.equal(latest.drawType, "lunchtime");
  assert.deepEqual(flipFlopTargetOf(latest), { targetType: "teatime", targetDate: "2026-09-30" });

  const prediction = liveStep(endingOnLunch);
  assert.ok(prediction);
  assert.equal(prediction.target_type, "teatime");
  assert.equal(prediction.target_date, "2026-09-30");
  assert.equal(prediction.source.drawType, "lunchtime");
  assert.equal(prediction.source.draw_date, "2026-09-30");
});

test("SuperHybrid: latest draw TEA → target is the next day's LUNCH", () => {
  const withTea = [...endingOnLunch, draw("2026-09-30", "teatime", [7, 8, 9, 10, 11, 12], 20)];
  const latest = latestCompletedDraw(asc(withTea));
  assert.ok(latest);
  assert.equal(latest.drawType, "teatime");
  assert.deepEqual(flipFlopTargetOf(latest), { targetType: "lunchtime", targetDate: "2026-10-01" });

  const prediction = liveStep(withTea);
  assert.ok(prediction);
  assert.equal(prediction.target_type, "lunchtime");
  assert.equal(prediction.target_date, "2026-10-01");
  assert.equal(prediction.source.drawType, "teatime");
  assert.equal(prediction.source.draw_date, "2026-09-30");
});

// ---------------------------------------------------------------------------
// 3 — never same-session
// ---------------------------------------------------------------------------

test("SuperHybrid: no same-session prediction is ever produced", () => {
  const series = asc(endingOnLunch); // latest = LUNCH
  // Asking for a LUNCH prediction from a LUNCH source is rejected outright.
  assert.equal(latestSourceBefore(series, "lunchtime"), null);
  assert.equal(
    buildSuperHybridPrediction({ before: series, targetType: "lunchtime", targetDate: "2026-09-30" }),
    null,
  );
  // The opposite direction is fine.
  assert.ok(buildSuperHybridPrediction({ before: series, targetType: "teatime" }));
});

// ---------------------------------------------------------------------------
// 4 — idempotency (no duplicate predictions)
// ---------------------------------------------------------------------------

test("SuperHybrid: repeated runs without a new draw are identical (idempotent)", () => {
  const first = liveStep(endingOnLunch);
  const second = liveStep(endingOnLunch);
  assert.ok(first && second);
  assert.deepEqual(first, second);
});

// ---------------------------------------------------------------------------
// 5 — a new draw flips the direction
// ---------------------------------------------------------------------------

test("SuperHybrid: a new draw switches the prediction direction", () => {
  const beforeFlip = liveStep(endingOnLunch);
  assert.ok(beforeFlip);
  assert.equal(beforeFlip.target_type, "teatime");

  const afterFlip = liveStep([...endingOnLunch, draw("2026-09-30", "teatime", [7, 8, 9, 10, 11, 12], 20)]);
  assert.ok(afterFlip);
  assert.equal(afterFlip.target_type, "lunchtime");
  assert.equal(afterFlip.source.draw_date, "2026-09-30");
});

// ---------------------------------------------------------------------------
// 6 — the backtest is the alternating chain
// ---------------------------------------------------------------------------

test("SuperHybrid: the backtest advances LUNCH → TEA → LUNCH → TEA", () => {
  const report = runSuperHybridBacktest(bothSessionDays(START, 45));
  assert.ok(report.runs.length > 0);

  for (let i = 0; i < report.runs.length; i += 1) {
    const run = report.runs[i];
    assert.notEqual(run.source_session, run.target_session);
    if (i > 0) {
      // Each target becomes the next source — the chain never skips a step.
      assert.equal(run.source_session, report.runs[i - 1].target_session);
      assert.equal(run.source_date, report.runs[i - 1].target_date);
    }
  }
});

test("SuperHybrid: a same-session step in the data produces no run", () => {
  // Two consecutive LUNCH draws (a missing TEA): the second LUNCH is never a
  // target, but the chain resumes at the next TEA.
  const messy = bothSessionDays(START, 25).filter(
    (d) => !(d.drawDate === "2026-09-20" && d.drawType === "teatime"),
  );
  const report = runSuperHybridBacktest(messy);
  assert.ok(report.runs.length > 0);
  for (const run of report.runs) {
    assert.notEqual(run.source_session, run.target_session);
    assert.ok(!(run.source_date === "2026-09-20" && run.source_session === "lunchtime" && run.target_session === "lunchtime"));
  }
});

// ---------------------------------------------------------------------------
// 7 — no future information
// ---------------------------------------------------------------------------

test("SuperHybrid: no future data — earlier runs are identical when later draws change", () => {
  const draws = bothSessionDays(START, 40);
  const full = runSuperHybridBacktest(draws);
  const cutIdx = draws.findIndex((d) => d.drawDate === "2026-10-05");
  const truncated = runSuperHybridBacktest(draws.slice(0, cutIdx));

  assert.ok(full.runs.length > 0 && truncated.runs.length > 0);
  for (const run of truncated.runs) {
    const match = full.runs.find(
      (r) => r.target_date === run.target_date && r.target_session === run.target_session,
    );
    assert.ok(match, `missing ${run.target_session} ${run.target_date}`);
    assert.deepEqual(match.predicted, run.predicted);
  }
});

// ---------------------------------------------------------------------------
// 8 — clean zero, no fabricated records
// ---------------------------------------------------------------------------

test("SuperHybrid: zero valid flip-flop steps return zero predictions", () => {
  // TEA-only history: every step is TEA → TEA (same session) and is skipped.
  const teaOnly: Uk49sDraw[] = [];
  for (let i = 0; i < 30; i += 1) {
    teaOnly.push(draw(shift(START, i), "teatime", [1, 2, 3, 4, 5, 6], 7));
  }
  const report = runSuperHybridBacktest(teaOnly);
  assert.equal(report.testedDraws, 0);
  assert.equal(report.runs.length, 0);
  assert.equal(report.overall.testedDraws, 0);
  // A single-draw history has no successor at all.
  assert.equal(runSuperHybridBacktest([draw(START, "lunchtime", [1, 2, 3, 4, 5, 6], 7)]).testedDraws, 0);
});

// ---------------------------------------------------------------------------
// 9 & 10 — engine + Flip-Flop unchanged, session selection is the mechanism
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
  assert.ok(five.score > 0.5, `expected > 0.5, got ${five.score}`);
  assert.ok(never.score >= 0.25 && never.score <= 0.75, `expected neutral, got ${never.score}`);
});

test("SuperHybrid: the prediction is a valid 4 + 1 line and weights are untouched", () => {
  const report = runSuperHybridBacktest(bothSessionDays(START, 45));
  assert.ok(report.runs.length > 0);
  assert.deepEqual(report.weights, DEFAULT_SUPERHYBRID_WEIGHTS);

  for (const run of report.runs) {
    assert.equal(run.predicted.length, MAIN_COUNT);
    assert.equal(new Set(run.predicted).size, MAIN_COUNT);
    for (const n of run.predicted) assert.ok(n >= 1 && n <= MAIN_MAX);
    assert.ok(run.predicted_booster >= 1 && run.predicted_booster <= MAIN_MAX);
    assert.ok(Number.isFinite(run.randomHits) && Number.isFinite(run.frequencyHits));
  }

  const sum = report.overall.hitDistribution.reduce((acc, entry) => acc + entry.lines, 0);
  assert.equal(sum, report.runs.length);
  assert.equal(report.overall.testedDraws, report.runs.length);
});

test("SuperHybrid: every run has at least the minimum training history behind it", () => {
  const draws = bothSessionDays(START, 45);
  const report = runSuperHybridBacktest(draws);
  const allAsc = asc(draws);
  assert.ok(report.runs.length > 0);

  for (const run of report.runs) {
    const history = allAsc.filter(
      (d) => `${d.draw_date}T${d.draw_time}` < `${run.target_date}T${drawTimeFor(run.target_session)}`,
    ).length;
    assert.ok(history >= MIN_TRAIN, `expected ≥ ${MIN_TRAIN} prior draws, got ${history}`);
  }
});

console.log("All SuperHybrid tests loaded.");
