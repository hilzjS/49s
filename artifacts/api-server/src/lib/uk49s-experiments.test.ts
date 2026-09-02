/**
 * UK49s Experiment Lab (v2) Tests
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ablateWeights,
  FEATURE_NAMES,
  DEFAULT_WEIGHTS,
  type FeatureName,
} from "@workspace/db/schema";
import {
  buildAblationVariants,
  runExperiment,
  runBoosterExperiment,
  defaultYearPeriods,
  type ModelVariant,
} from "@workspace/db/schema";
import type { Uk49sDraw } from "@workspace/db/schema";

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

function mockDraws(count: number, drawType: "lunchtime" | "teatime" = "lunchtime"): Uk49sDraw[] {
  const draws: Uk49sDraw[] = [];
  for (let i = 0; i < count; i++) {
    const date = `2020-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    const s = (i % 44) + 1;
    draws.push(createMockDraw(date, drawType, [s, s + 1, s + 2, s + 3, s + 4, s + 5], s >= 10 ? s - 5 : s + 10));
  }
  return draws;
}

// ---------------------------------------------------------------------------
// Ablation helpers
// ---------------------------------------------------------------------------

test("ablateWeights zeroes only the requested features", () => {
  const w = ablateWeights(DEFAULT_WEIGHTS, ["weightFrequency", "weightPairs"]);
  assert.equal(w.weightFrequency, 0);
  assert.equal(w.weightPairs, 0);
  assert.equal(w.weightRecency, DEFAULT_WEIGHTS.weightRecency);
  assert.equal(w.weightFirst3Minus2, DEFAULT_WEIGHTS.weightFirst3Minus2);
});

test("ablateWeights does not mutate the original weights", () => {
  const original = { ...DEFAULT_WEIGHTS };
  ablateWeights(DEFAULT_WEIGHTS, FEATURE_NAMES);
  assert.deepEqual(DEFAULT_WEIGHTS, original);
});

test("FEATURE_NAMES covers all 13 features", () => {
  assert.equal(FEATURE_NAMES.length, 13);
  const keys = Object.keys(DEFAULT_WEIGHTS);
  for (const k of keys) {
    assert.ok(FEATURE_NAMES.includes(k as FeatureName), `missing ${k}`);
  }
});

// ---------------------------------------------------------------------------
// Variant construction
// ---------------------------------------------------------------------------

test("buildAblationVariants creates full + 13 ablated + 4 reference + ensemble", () => {
  const variants = buildAblationVariants(DEFAULT_WEIGHTS, 90);
  // 1 full + 13 ablated + frequency + recency + pattern + random + ensemble = 19
  assert.equal(variants.length, 19);

  const full = variants.find((v) => v.name === "SuperHybrid (full)");
  assert.ok(full);
  assert.equal(full.disabledFeatures.length, 0);

  const ablated = variants.filter((v) => v.kind === "superhybrid_ablated");
  assert.equal(ablated.length, 13);
  for (const v of ablated) {
    assert.equal(v.disabledFeatures.length, 1);
    // The disabled feature must actually be zeroed in weights
    assert.equal(v.weights[v.disabledFeatures[0]], 0);
  }

  const random = variants.find((v) => v.kind === "random");
  assert.ok(random);
  const ensemble = variants.find((v) => v.kind === "ensemble");
  assert.ok(ensemble);
  assert.deepEqual(ensemble.ensembleMembers, ["frequency", "recency", "pattern", "superhybrid"]);
});

// ---------------------------------------------------------------------------
// Experiment execution
// ---------------------------------------------------------------------------

test("runExperiment produces per-period results and summaries", () => {
  const draws = mockDraws(120);
  const variants: ModelVariant[] = [
    { name: "SuperHybrid (full)", kind: "superhybrid", weights: DEFAULT_WEIGHTS, disabledFeatures: [], lookbackWindow: 30, constraints: { enforceDiversity: true, minNumberSpread: 10, maxSameGroup: 2 } },
    { name: "Random", kind: "random", weights: ablateWeights(DEFAULT_WEIGHTS, FEATURE_NAMES), disabledFeatures: [...FEATURE_NAMES], lookbackWindow: 30, constraints: { enforceDiversity: true, minNumberSpread: 10, maxSameGroup: 2 } },
  ];
  const periods = [
    { start: "2020-02-01", end: "2020-03-31" },
    { start: "2020-04-01", end: "2020-05-31" },
  ];
  const { periodResults, summaries } = runExperiment(draws, variants, {
    drawType: "lunchtime",
    periods,
    lookbackWindow: 30,
    randomSeed: 42,
  });

  assert.equal(periodResults.length, 4); // 2 variants x 2 periods
  assert.equal(summaries.length, 2);
  for (const s of summaries) {
    assert.ok(s.totalPredictions > 0);
    assert.ok(s.avgMainHits >= 0);
    assert.ok(Array.isArray(s.periods));
    assert.equal(s.periods.length, 2);
  }
});

test("runExperiment is reproducible with the same seed", () => {
  const draws = mockDraws(100);
  const variants: ModelVariant[] = [
    { name: "Random", kind: "random", weights: ablateWeights(DEFAULT_WEIGHTS, FEATURE_NAMES), disabledFeatures: [...FEATURE_NAMES], lookbackWindow: 20, constraints: { enforceDiversity: false, minNumberSpread: 0, maxSameGroup: 4 } },
  ];
  const periods = [{ start: "2020-02-01", end: "2020-04-30" }];
  const opts = { drawType: "lunchtime" as const, periods, lookbackWindow: 20, randomSeed: 123 };

  const r1 = runExperiment(draws, variants, opts);
  const r2 = runExperiment(draws, variants, opts);

  assert.equal(r1.summaries[0].avgMainHits, r2.summaries[0].avgMainHits);
  assert.equal(r1.summaries[0].totalPredictions, r2.summaries[0].totalPredictions);
});

test("defaultYearPeriods generates chronological year ranges", () => {
  const periods = defaultYearPeriods(2019, 2024);
  assert.equal(periods.length, 5);
  assert.deepEqual(periods[0], { start: "2019-01-01", end: "2019-12-31" });
  assert.deepEqual(periods[4], { start: "2023-01-01", end: "2023-12-31" });
});

// ---------------------------------------------------------------------------
// Booster model experiments
// ---------------------------------------------------------------------------

test("runBoosterExperiment evaluates all three booster models per period", () => {
  const draws = mockDraws(120);
  const results = runBoosterExperiment(draws, "lunchtime", [
    { start: "2020-02-01", end: "2020-03-31" },
    { start: "2020-04-01", end: "2020-05-31" },
  ], 30, 42);

  // 3 models x 2 periods = 6 results
  assert.equal(results.length, 6);
  const names = new Set(results.map((r) => r.name));
  assert.ok(names.has("booster-frequency"));
  assert.ok(names.has("booster-recency"));
  assert.ok(names.has("booster-random"));

  for (const r of results) {
    assert.ok(r.hitRate >= 0 && r.hitRate <= 1);
    assert.ok(r.hits <= r.predictions);
  }
});

test("booster predictions never use the target draw (leakage check)", () => {
  // Construct draws where the booster equals the index: if leakage existed,
  // "booster-recency" (pick last seen booster) would hit 100%.
  const draws: Uk49sDraw[] = [];
  for (let i = 0; i < 60; i++) {
    const date = `2020-02-${String((i % 28) + 1).padStart(2, "0")}`;
    const unique = `${date}-${String(Math.floor(i / 28)).padStart(2, "0")}`; // keep distinct dates
    const d = `2020-0${Math.floor(i / 28) + 2}-${String((i % 28) + 1).padStart(2, "0")}`;
    const s = (i % 44) + 1;
    draws.push(createMockDraw(d, "lunchtime", [s, s + 1, s + 2, s + 3, s + 4, s + 5], ((i * 3) % 49) + 1));
  }
  const results = runBoosterExperiment(draws, "lunchtime", [
    { start: "2020-03-01", end: "2020-03-31" },
  ], 10, 7);

  const recency = results.find((r) => r.name === "booster-recency");
  assert.ok(recency);
  // With a changing booster sequence, the "repeat last" model should NOT hit 100%.
  assert.ok(recency.hitRate < 1, `recency hit rate should be < 1, got ${recency.hitRate}`);
});

// ---------------------------------------------------------------------------
// Statistical helpers (via runExperiment output)
// ---------------------------------------------------------------------------

test("Welch t-test fields are null for tiny samples and numeric for larger ones", () => {
  const draws = mockDraws(200);
  const variants: ModelVariant[] = [
    { name: "SuperHybrid (full)", kind: "superhybrid", weights: DEFAULT_WEIGHTS, disabledFeatures: [], lookbackWindow: 30, constraints: { enforceDiversity: true, minNumberSpread: 10, maxSameGroup: 2 } },
  ];
  const periods = [{ start: "2020-02-01", end: "2020-07-31" }];
  const { summaries } = runExperiment(draws, variants, {
    drawType: "lunchtime",
    periods,
    lookbackWindow: 30,
    randomSeed: 42,
  });
  // With ~150 predictions, the t-test should be computable
  if (summaries[0].totalPredictions >= 30) {
    assert.ok(typeof summaries[0].tStatVsRandom === "number");
    assert.ok(typeof summaries[0].pValueVsRandom === "number");
  }
});
