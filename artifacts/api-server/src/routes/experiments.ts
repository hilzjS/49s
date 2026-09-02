/**
 * UK49s Experiment Lab API Routes (v2)
 *
 * Side-by-side model variants, feature ablation, multi-period walk-forward,
 * stability analysis, separate booster models, ensembles.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { uk49sDraws } from "@workspace/db/schema";
import {
  uk49sExperimentRuns,
  uk49sExperimentVariants,
  uk49sExperimentPeriods,
  uk49sBoosterExperiments,
} from "@workspace/db/schema";
import {
  runExperiment,
  runBoosterExperiment,
  buildAblationVariants,
  defaultYearPeriods,
  type PeriodSpec,
  type ModelVariant,
} from "@workspace/db/schema";
import { eq, desc, asc, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "../lib/admin-auth";

const router: IRouter = Router();

function validDrawType(value: string): value is "lunchtime" | "teatime" {
  return value === "lunchtime" || value === "teatime";
}

function parsePeriods(body: Record<string, unknown>): PeriodSpec[] | null {
  if (Array.isArray(body.periods)) {
    const out: PeriodSpec[] = [];
    for (const p of body.periods) {
      if (
        typeof p === "object" && p !== null &&
        typeof (p as Record<string, unknown>).start === "string" &&
        typeof (p as Record<string, unknown>).end === "string"
      ) {
        out.push({ start: (p as { start: string }).start, end: (p as { end: string }).end });
      }
    }
    if (out.length > 0) return out;
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /run — run an experiment (ablation / multi-period / ensemble)
// ---------------------------------------------------------------------------
router.post("/run", requireAdmin, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const drawType = String(body.drawType ?? "");
  if (!validDrawType(drawType)) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  const lookbackWindow = Math.min(Math.max(parseInt(String(body.lookbackWindow ?? "90"), 10) || 90, 30), 365);
  const randomSeed = typeof body.randomSeed === "number" ? body.randomSeed : 42;
  const periods = parsePeriods(body) ?? defaultYearPeriods(2017);
  const kind = String(body.kind ?? "ablation");

  try {
    const draws = await db
      .select()
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, drawType))
      .orderBy(asc(uk49sDraws.drawDate));

    if (draws.length < lookbackWindow + 50) {
      res.status(400).json({ error: `Not enough data: have ${draws.length}, need at least ${lookbackWindow + 50}` });
      return;
    }

    // Create run record
    const [run] = await db.insert(uk49sExperimentRuns).values({
      name: String(body.name ?? `${kind}-${drawType}-${new Date().toISOString().slice(0, 10)}`),
      kind,
      drawType,
      status: "running",
      periods,
      lookbackWindow,
      randomSeed,
    }).returning();

    const variants = buildAblationVariants(undefined, lookbackWindow);

    const { periodResults, summaries } = runExperiment(draws, variants, {
      drawType,
      periods,
      lookbackWindow,
      randomSeed,
    });

    // Persist variants
    const variantIdByName = new Map<string, number>();
    const ranked = [...summaries].sort((a, b) => b.avgMainHits - a.avgMainHits);
    const rankByName = new Map(ranked.map((s, i) => [s.variantName, i + 1]));

    let bestVariantId: number | null = null;
    for (const summary of summaries) {
      const variant = variants.find((v) => v.name === summary.variantName)!;
      const [row] = await db.insert(uk49sExperimentVariants).values({
        runId: run.id,
        name: summary.variantName,
        modelKind: variant.kind,
        disabledFeatures: summary.disabledFeatures,
        weights: { ...variant.weights } as unknown as Record<string, number>,
        lookbackWindow,
        ensembleMembers: variant.ensembleMembers,
        totalPredictions: summary.totalPredictions,
        avgMainHits: summary.avgMainHits,
        fourHitRate: summary.fourHitRate,
        boosterHitRate: summary.boosterHitRate,
        medianMainHits: summary.medianMainHits,
        maxMainHits: summary.maxMainHits,
        avgHitsVolatility: summary.avgHitsVolatility,
        fourHitRateVolatility: summary.fourHitRateVolatility,
        boosterHitRateVolatility: summary.boosterHitRateVolatility,
        tStatVsRandom: summary.tStatVsRandom,
        pValueVsRandom: summary.pValueVsRandom,
        rank: rankByName.get(summary.variantName),
      }).returning();
      variantIdByName.set(summary.variantName, row.id);
      if (rankByName.get(summary.variantName) === 1) bestVariantId = row.id;
    }

    // Persist per-period results
    for (const pr of periodResults) {
      const variantId = variantIdByName.get(pr.variantName);
      if (!variantId) continue;
      await db.insert(uk49sExperimentPeriods).values({
        variantId,
        periodStart: pr.periodStart,
        periodEnd: pr.periodEnd,
        predictions: pr.predictions,
        avgMainHits: pr.avgMainHits,
        fourHitRate: pr.fourHitRate,
        boosterHitRate: pr.boosterHitRate,
        randomAvgMainHits: pr.randomAvgMainHits,
        randomFourHitRate: pr.randomFourHitRate,
        freqAvgMainHits: pr.freqAvgMainHits,
        freqFourHitRate: pr.freqFourHitRate,
      });
    }

    await db.update(uk49sExperimentRuns)
      .set({ status: "completed", variantsTested: summaries.length, bestVariantId, completedAt: new Date() })
      .where(eq(uk49sExperimentRuns.id, run.id));

    res.json({
      success: true,
      runId: run.id,
      variantsTested: summaries.length,
      periods: periods.length,
      // Ranked summary table
      leaderboard: ranked.map((s, i) => ({
        rank: i + 1,
        name: s.variantName,
        kind: s.kind,
        totalPredictions: s.totalPredictions,
        avgMainHits: s.avgMainHits,
        fourHitRate: s.fourHitRate,
        boosterHitRate: s.boosterHitRate,
        avgHitsVolatility: s.avgHitsVolatility,
        tStatVsRandom: s.tStatVsRandom,
        pValueVsRandom: s.pValueVsRandom,
        beatsRandom: (s.tStatVsRandom ?? 0) > 0 && (s.pValueVsRandom ?? 1) < 0.05,
      })),
      summaries,
      warning: "All results are out-of-sample walk-forward evaluations. Lottery draws are random; no model can guarantee outcomes.",
    });
  } catch (error) {
    logger.error({ error, drawType }, "Experiment run failed");
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Experiment failed" });
  }
});

// ---------------------------------------------------------------------------
// POST /booster — run separate booster-ball model experiment
// ---------------------------------------------------------------------------
router.post("/booster", requireAdmin, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const drawType = String(body.drawType ?? "");
  if (!validDrawType(drawType)) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  const lookbackWindow = Math.min(Math.max(parseInt(String(body.lookbackWindow ?? "90"), 10) || 90, 30), 365);
  const randomSeed = typeof body.randomSeed === "number" ? body.randomSeed : 42;
  const periods = parsePeriods(body) ?? defaultYearPeriods(2017);

  try {
    const draws = await db
      .select()
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, drawType))
      .orderBy(asc(uk49sDraws.drawDate));

    const [run] = await db.insert(uk49sExperimentRuns).values({
      name: `booster-${drawType}-${new Date().toISOString().slice(0, 10)}`,
      kind: "booster_model",
      drawType,
      status: "running",
      periods,
      lookbackWindow,
      randomSeed,
    }).returning();

    const results = runBoosterExperiment(draws, drawType, periods, lookbackWindow, randomSeed);

    for (const r of results) {
      await db.insert(uk49sBoosterExperiments).values({
        runId: run.id,
        name: r.name,
        drawType: r.drawType,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        lookbackWindow,
        predictions: r.predictions,
        hits: r.hits,
        hitRate: r.hitRate,
      });
    }

    await db.update(uk49sExperimentRuns)
      .set({ status: "completed", variantsTested: 3, completedAt: new Date() })
      .where(eq(uk49sExperimentRuns.id, run.id));

    // Aggregate per model
    const byModel = new Map<string, { predictions: number; hits: number }>();
    for (const r of results) {
      const cur = byModel.get(r.name) ?? { predictions: 0, hits: 0 };
      cur.predictions += r.predictions;
      cur.hits += r.hits;
      byModel.set(r.name, cur);
    }

    res.json({
      success: true,
      runId: run.id,
      randomExpectation: 1 / 49,
      models: Array.from(byModel.entries()).map(([name, m]) => ({
        name,
        predictions: m.predictions,
        hits: m.hits,
        hitRate: m.predictions > 0 ? m.hits / m.predictions : 0,
        vsRandom: m.predictions > 0 ? (m.hits / m.predictions) / (1 / 49) : 0,
      })),
      periods: results,
      warning: "Booster hit rate random expectation is 1/49 ≈ 2.04%. Anything within noise of that is not a real edge.",
    });
  } catch (error) {
    logger.error({ error, drawType }, "Booster experiment failed");
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Booster experiment failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /runs — list experiment runs
// ---------------------------------------------------------------------------
router.get("/runs", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
  try {
    const runs = await db
      .select()
      .from(uk49sExperimentRuns)
      .orderBy(desc(uk49sExperimentRuns.createdAt))
      .limit(limit);
    res.json({ success: true, count: runs.length, runs });
  } catch (error) {
    logger.error({ error }, "Failed to list experiment runs");
    res.status(500).json({ success: false, error: "Failed to list experiment runs" });
  }
});

// ---------------------------------------------------------------------------
// GET /runs/:id — run detail with variants and periods
// ---------------------------------------------------------------------------
router.get("/runs/:id", async (req: Request, res: Response) => {
  const runId = parseInt(String(req.params.id), 10);
  if (!Number.isInteger(runId)) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  try {
    const [run] = await db.select().from(uk49sExperimentRuns).where(eq(uk49sExperimentRuns.id, runId)).limit(1);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    const variants = await db
      .select()
      .from(uk49sExperimentVariants)
      .where(eq(uk49sExperimentVariants.runId, runId))
      .orderBy(asc(uk49sExperimentVariants.rank));
    const variantIds = variants.map((v) => v.id);
    const periodsByVariant = new Map<number, typeof uk49sExperimentPeriods.$inferSelect[]>();
    if (variantIds.length > 0) {
      const allPeriods = await db
        .select()
        .from(uk49sExperimentPeriods)
        .where(inArray(uk49sExperimentPeriods.variantId, variantIds));
      for (const p of allPeriods) {
        const arr = periodsByVariant.get(p.variantId) ?? [];
        arr.push(p);
        periodsByVariant.set(p.variantId, arr);
      }
    }

    const boosterResults = await db
      .select()
      .from(uk49sBoosterExperiments)
      .where(eq(uk49sBoosterExperiments.runId, runId));

    res.json({
      success: true,
      run,
      variants: variants.map((v) => ({
        ...v,
        periods: periodsByVariant.get(v.id) ?? [],
      })),
      boosterResults,
    });
  } catch (error) {
    logger.error({ error, runId }, "Failed to get experiment run");
    res.status(500).json({ success: false, error: "Failed to get experiment run" });
  }
});

// ---------------------------------------------------------------------------
// GET /ablation-latest — convenience: latest ablation leaderboard per type
// ---------------------------------------------------------------------------
router.get("/latest/:drawType", async (req: Request, res: Response) => {
  const drawType = String(req.params.drawType);
  if (!validDrawType(drawType)) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }
  try {
    const [run] = await db
      .select()
      .from(uk49sExperimentRuns)
      .where(eq(uk49sExperimentRuns.drawType, drawType))
      .orderBy(desc(uk49sExperimentRuns.createdAt))
      .limit(1);

    if (!run) {
      res.status(404).json({ error: "No experiment runs found" });
      return;
    }

    const variants = await db
      .select()
      .from(uk49sExperimentVariants)
      .where(eq(uk49sExperimentVariants.runId, run.id))
      .orderBy(asc(uk49sExperimentVariants.rank));

    const boosterResults = await db
      .select()
      .from(uk49sBoosterExperiments)
      .where(eq(uk49sBoosterExperiments.runId, run.id));

    res.json({ success: true, run, variants, boosterResults });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get latest experiment");
    res.status(500).json({ success: false, error: "Failed to get latest experiment" });
  }
});

export default router;
