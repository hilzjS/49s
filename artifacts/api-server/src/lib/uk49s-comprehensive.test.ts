/**
 * UK49s Comprehensive Tests
 *
 * Tests for the scraper, the single prediction engine (score + build + walk
 * forward), the walk-forward tuner, and data integrity.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseRecords, type ScrapeStats } from "./uk49s-scraper";
import {
  DEFAULT_WEIGHTS,
  MAIN_COUNT,
  MIN_TRAIN,
  buildGrid,
  buildPredictions,
  drawToNumbers,
  findChampion,
  runBacktest,
  scoreNumbers,
  toEngineDraws,
  type EngineDraw,
  type Uk49sDraw,
} from "@workspace/db/schema";

// ============================================
// SCRAPER TESTS
// ============================================

function createStats(): ScrapeStats {
  return {
    urlsRequested: 0,
    recordsDiscovered: 0,
    recordsAccepted: 0,
    duplicatesRemoved: 0,
    recordsRejected: 0,
    parsingErrors: 0,
    failedUrls: [],
    validationErrors: [],
    fromCache: false,
  };
}

test("Scraper: 2015 Lunchtime fixture parses complete rows and separates booster ball", () => {
  const html = `
    <h2>January 2015</h2>
    <table><tr><td>01/01/2015</td><td>01</td><td>07</td><td>13</td><td>25</td><td>36</td><td>49</td><td>08</td></tr>
    <tr><td>02/01/2015</td><td>02</td><td>08</td><td>14</td><td>26</td><td>37</td><td>48</td><td>09</td></tr></table>
    <h2>February 2015</h2>
    <div class="draw-result">01/02/2015 03 09 15 27 38 47 Booster 10</div>
  `;
  const result = parseRecords(html, "lunchtime", 2015, createStats());
  assert.equal(result.length, 3);
  assert.deepEqual(result[0].winning_numbers, [1, 7, 13, 25, 36, 49]);
  assert.equal(result[0].booster_ball, 8);
  assert.equal(result[2].draw_date, "2015-02-01");
});

test("Scraper: 2015 Teatime fixture removes duplicate dates", () => {
  const fixture = `
    <table>
      <tr><td>31-12-2015</td><td>04</td><td>11</td><td>19</td><td>22</td><td>33</td><td>41</td><td>06</td></tr>
      <tr><td>31-12-2015</td><td>04</td><td>11</td><td>19</td><td>22</td><td>33</td><td>41</td><td>06</td></tr>
      <tr><td>30-12-2015</td><td>04</td><td>11</td><td>19</td><td>22</td><td>33</td><td>41</td><td>06</td></tr>
    </table>`;
  const stats = createStats();
  const result = parseRecords(fixture, "teatime", 2015, stats);
  assert.equal(result.length, 2);
  assert.equal(stats.duplicatesRemoved, 1);
  assert.equal(stats.recordsRejected, 0);
});

test("Scraper: rejects malformed rows with insufficient numbers", () => {
  const html = `<tr><td>01/01/2015</td><td>01</td><td>07</td><td>13</td><td>25</td><td>36</td></tr>`;
  const stats = createStats();
  parseRecords(html, "lunchtime", 2015, stats);
  assert.equal(stats.recordsRejected, 1);
  assert.ok(stats.validationErrors[0].includes("expected 7 numbers"));
});

test("Scraper: rejects numbers outside 1-49 range", () => {
  const html = `<tr><td>01/01/2015</td><td>01</td><td>07</td><td>13</td><td>25</td><td>36</td><td>60</td><td>08</td></tr>`;
  const stats = createStats();
  parseRecords(html, "lunchtime", 2015, stats);
  assert.equal(stats.recordsRejected, 1);
  assert.ok(stats.validationErrors[0].includes("outside 1-49"));
});

test("Scraper: parses named month dates", () => {
  const html = `<div>Monday 1st January 2015 01 07 13 25 36 49 Booster 08</div>`;
  const stats = createStats();
  const result = parseRecords(html, "lunchtime", 2015, stats);
  assert.equal(result.length, 1);
  assert.equal(result[0].draw_date, "2015-01-01");
});

// ============================================
// ENGINE TESTS
// ============================================

function createMockDraw(date: string, drawType: "lunchtime" | "teatime", main: number[], booster: number): Uk49sDraw {
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

function createMockDraws(): Uk49sDraw[] {
  const draws: Uk49sDraw[] = [];
  for (let i = 0; i < 120; i++) {
    const date = `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    const s = (i % 44) + 1;
    const main = [s, s + 1, s + 2, s + 3, s + 4, s + 5];
    const booster = s >= 10 ? s - 5 : s + 10;
    draws.push(createMockDraw(date, i % 2 === 0 ? "lunchtime" : "teatime", main, booster));
  }
  return draws;
}

function engineHistory(draws: Uk49sDraw[], drawType: "lunchtime" | "teatime"): EngineDraw[] {
  return toEngineDraws(draws, drawType);
}

test("Engine: scoreNumbers returns a score for every number in range", () => {
  const history = engineHistory(createMockDraws(), "lunchtime");
  const stats = scoreNumbers(history, "numbers", DEFAULT_WEIGHTS);

  assert.equal(stats.length, 49);
  for (const stat of stats) {
    assert.ok(stat.n >= 1 && stat.n <= 49);
    assert.ok(stat.score >= 0);
    assert.ok(stat.count >= 0);
  }
});

test("Engine: buildPredictions returns a balanced 4-number line plus one booster", () => {
  const history = engineHistory(createMockDraws(), "lunchtime");
  const sets = buildPredictions({ draws: history, targetDate: "2025-01-01", drawTime: "12:30", sets: 1 });

  assert.equal(sets.length, 1);
  const set = sets[0];
  assert.equal(set.numbers.length, MAIN_COUNT);
  assert.equal(set.bonus_numbers.length, 1);
  assert.deepEqual(set.numbers, [...set.numbers].sort((a, b) => a - b));
  assert.equal(new Set(set.numbers).size, MAIN_COUNT);
  for (const n of set.numbers) assert.ok(n >= 1 && n <= 49);
  assert.ok(set.bonus_numbers[0] >= 1 && set.bonus_numbers[0] <= 49);
  assert.equal(set.is_free, true);
  assert.ok(set.confidence >= 0 && set.confidence <= 0.99);
});

test("Engine: buildPredictions is deterministic for the same inputs", () => {
  const history = engineHistory(createMockDraws(), "teatime");
  const a = buildPredictions({ draws: history, targetDate: "2025-01-01", drawTime: "17:49", sets: 1 });
  const b = buildPredictions({ draws: history, targetDate: "2025-01-01", drawTime: "17:49", sets: 1 });
  assert.deepEqual(a, b);
});

// ============================================
// WALK-FORWARD BACKTEST TESTS
// ============================================

test("Backtest: walk-forward produces scores and a hit distribution", () => {
  const history = engineHistory(createMockDraws(), "lunchtime");
  const report = runBacktest(history, 30, DEFAULT_WEIGHTS);

  assert.ok(report.testedDraws > 0);
  const sum = report.hitDistribution.reduce((acc, entry) => acc + entry.lines, 0);
  assert.equal(sum, report.testedDraws * report.linesPerDraw);
  assert.ok(report.randomBaseline > 0);
});

test("Backtest: no future data leakage — each run trains only on older draws", () => {
  const history = engineHistory(createMockDraws(), "lunchtime");
  const report = runBacktest(history, 5, DEFAULT_WEIGHTS);

  // Rebuild the newest run's line from only the draws after it and compare.
  const target = history[0];
  const [fresh] = buildPredictions({
    draws: history.slice(1),
    targetDate: target.draw_date,
    drawTime: target.draw_time,
    sets: 1,
    weights: DEFAULT_WEIGHTS,
  });

  assert.deepEqual(report.runs[0].bestLine, fresh.numbers);
});

test("Backtest: stops cleanly when there is not enough history to train", () => {
  const history = engineHistory(createMockDraws().slice(0, 5), "lunchtime");
  const report = runBacktest(history, 30, DEFAULT_WEIGHTS);
  assert.equal(report.testedDraws, 0);
});

// ============================================
// TUNER TESTS
// ============================================

test("Tuner: grid expands to 392 candidate weight sets", () => {
  assert.equal(buildGrid().length, 392);
  for (const weights of buildGrid()) {
    assert.ok(weights.hot > 0 && weights.hot < 1);
    assert.equal(weights.overdue, Math.round((1 - weights.hot) * 100) / 100);
    assert.ok(weights.halfLife > 0);
    assert.ok(weights.power > 0);
  }
});

test("Tuner: findChampion picks a valid champion from the grid", () => {
  const history = engineHistory(createMockDraws(), "lunchtime");
  const champion = findChampion(history, 5);

  assert.equal(champion.candidatesTested, 392);
  assert.ok(buildGrid().some((w) => w.hot === champion.weights.hot && w.power === champion.weights.power));
  assert.ok(champion.report.testedDraws > 0);
  assert.equal(champion.report.targetMet, champion.report.threePlusCount >= champion.target);
});

// ============================================
// DATA INTEGRITY TESTS
// ============================================

test("Data Integrity: drawToNumbers helper works correctly", () => {
  const draw = createMockDraw("2024-01-15", "lunchtime", [1, 7, 13, 25, 36, 41], 49);
  const result = drawToNumbers(draw);

  assert.deepEqual(result.main, [1, 7, 13, 25, 36, 41]);
  assert.equal(result.booster, 49);
});

test("Data Integrity: toEngineDraws keeps a single draw type and exposes 6 mains", () => {
  const history = engineHistory(createMockDraws(), "teatime");
  assert.ok(history.length > 0);
  for (const draw of history) {
    assert.equal(draw.numbers.length, 6);
    assert.equal(draw.bonus_numbers.length, 1);
    assert.ok(draw.numbers.every((n) => n >= 1 && n <= 49));
  }
});

test("Data Integrity: Booster Ball never appears in main numbers", () => {
  for (const draw of createMockDraws()) {
    const { main, booster } = drawToNumbers(draw);
    assert.ok(!main.includes(booster));
    assert.equal(main.length, 6);
    assert.equal(new Set(main).size, 6);
  }
});

test("Data Integrity: MIN_TRAIN guards short histories", () => {
  assert.equal(MIN_TRAIN, 20);
});

console.log("All UK49s comprehensive tests loaded.");
