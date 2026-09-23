/**
 * Automatic engine showdown.
 *
 * After a new draw has been recorded, both prediction engines are evaluated
 * over the same leakage-free validation window and the stronger one is promoted
 * to the active model, so the next draw is predicted with the winning engine:
 *
 *   - "superhybrid" — SuperHybrid (13 features)
 *   - "hybrid"      — Super Hybrid (Frequency · Gap · Bonus)
 *
 * The comparison is deterministic: same history, same window, same weights for
 * a given engine. An unchanged history therefore always produces the same
 * winner, so the active engine cannot flip back and forth between runs.
 *
 * These are historical statistical patterns, not predictions of future
 * outcomes — selecting the better-performing engine does not make lottery
 * outcomes predictable.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  uk49sDraws,
  DEFAULT_WEIGHTS,
  DEFAULT_HYBRID_WEIGHTS,
  DEFAULT_HYBRID_POOL_SIZE,
  PREDICTION_STRATEGIES,
  defaultWeightsForStrategy,
  runBacktest,
  type DrawType,
  type DiversityConstraints,
  type FeatureWeights,
  type PredictionStrategy,
  type Uk49sDraw,
} from "@workspace/db/schema";
import {
  DEFAULT_LOOKBACK_WINDOW,
  V3_CANDIDATE_POOL_SIZE,
  V3_LOOKBACK_OPTIONS,
  resolveValidationWindow,
  type ValidationWindow,
} from "./optimizer-window";
import { getActiveModel, updateActiveModel } from "./prediction-service";
import { logger } from "./logger";

/** Diversity constraints used by the app's engines by default. */
const DEFAULT_CONSTRAINTS: DiversityConstraints = {
  enforceDiversity: true,
  minNumberSpread: 10,
  maxSameGroup: 2,
};

/** One engine's walk-forward performance over the showdown window. */
export interface EngineEvaluation {
  strategy: PredictionStrategy;
  /** Label of the configuration the engine was evaluated with. */
  label: string;
  /** True when the engine was evaluated with the live active model's settings. */
  liveConfig: boolean;
  lookbackWindow: number;
  poolSize: number;
  totalPredictions: number;
  fourHitCount: number;
  fourHitRate: number;
  avgMainHits: number;
  boosterHitRate: number;
}

export interface ShowdownResult {
  drawType: DrawType;
  evaluatedAt: string;
  /** Latest recorded draw — the showdown runs once per newly recorded draw. */
  latestDrawDate: string;
  window: { startDate: string; endDate: string; drawCount: number };
  evaluations: EngineEvaluation[];
  /** Engine that was active before the showdown. */
  champion: PredictionStrategy;
  /** Engine picked for the next draw. */
  winner: PredictionStrategy;
  /** True when the winner replaced the previous active engine. */
  promoted: boolean;
  detail: string;
}

export const STRATEGY_LABELS: Record<PredictionStrategy, string> = {
  superhybrid: "SuperHybrid (13 features)",
  hybrid: "Super Hybrid (Frequency · Gap · Bonus)",
  superhybrid3: "SuperHybrid v3 (Overdue · Momentum · Neighbours)",
};

/** Last showdown per draw type, kept in memory for status endpoints/UI. */
const lastShowdowns = new Map<DrawType, ShowdownResult>();

export function getLastShowdown(drawType: DrawType): ShowdownResult | null {
  return lastShowdowns.get(drawType) ?? null;
}

/** Higher four-hit rate, then average hits, then booster accuracy. */
function isBetter(a: EngineEvaluation, b: EngineEvaluation): boolean {
  if (a.fourHitRate !== b.fourHitRate) return a.fourHitRate > b.fourHitRate;
  if (a.avgMainHits !== b.avgMainHits) return a.avgMainHits > b.avgMainHits;
  return a.boosterHitRate > b.boosterHitRate;
}

interface EngineRun {
  evaluation: EngineEvaluation;
  weights: FeatureWeights;
  lookbackWindow: number;
  poolSize: number;
  constraints: DiversityConstraints;
}

function evaluateEngine(
  draws: Uk49sDraw[],
  drawType: DrawType,
  window: ValidationWindow,
  strategy: PredictionStrategy,
  live: { weights: FeatureWeights; lookbackWindow: number; poolSize: number; constraints: DiversityConstraints } | null,
): EngineRun {
  const weights = live?.weights ?? defaultWeightsForStrategy(strategy);
  const lookbackWindow = live?.lookbackWindow ?? (strategy === "superhybrid3" ? V3_LOOKBACK_OPTIONS[0] : DEFAULT_LOOKBACK_WINDOW);
  const poolSize = live?.poolSize ?? (strategy === "superhybrid3" ? V3_CANDIDATE_POOL_SIZE : DEFAULT_HYBRID_POOL_SIZE);
  const constraints = live?.constraints ?? DEFAULT_CONSTRAINTS;

  const result = runBacktest(
    draws,
    {
      drawType,
      lookbackWindow,
      testStartDate: window.validationStartDate,
      testEndDate: window.validationEndDate,
      randomSeed: 1,
      strategy,
      poolSize,
    },
    weights,
    constraints,
  );

  return {
    weights,
    lookbackWindow,
    poolSize,
    constraints,
    evaluation: {
      strategy,
      label: STRATEGY_LABELS[strategy],
      liveConfig: live !== null,
      lookbackWindow,
      poolSize,
      totalPredictions: result.totalPredictions,
      fourHitCount: result.fourHitCount,
      fourHitRate: result.fourHitRate,
      avgMainHits: result.avgMainHits,
      boosterHitRate: result.boosterHitRate,
    },
  };
}

/**
 * Runs both engines over the validation window and promotes the winner.
 *
 * Returns the cached result without doing any work when the latest recorded
 * draw has not changed since the last showdown — i.e. exactly one showdown per
 * new draw. Pass `force` to recompute regardless.
 */
export async function runStrategyShowdown(
  drawType: DrawType,
  options: { force?: boolean } = {},
): Promise<ShowdownResult> {
  const draws = await db
    .select()
    .from(uk49sDraws)
    .where(eq(uk49sDraws.drawType, drawType))
    .orderBy(asc(uk49sDraws.drawDate));

  if (draws.length < 2) {
    throw new Error(`Not enough ${drawType} draws for an engine showdown (found ${draws.length}).`);
  }

  const latestDrawDate = draws[draws.length - 1].drawDate;
  const cached = lastShowdowns.get(drawType);

  if (!options.force && cached && cached.latestDrawDate === latestDrawDate) {
    return cached;
  }

  const window = resolveValidationWindow(draws, drawType);
  const activeModel = await getActiveModel(drawType);
  const champion: PredictionStrategy = activeModel?.strategy ?? "superhybrid";

  const runs = PREDICTION_STRATEGIES.map((strategy) =>
    evaluateEngine(
      draws,
      drawType,
      window,
      strategy,
      activeModel && activeModel.strategy === strategy
        ? {
            weights: activeModel.weights,
            lookbackWindow: activeModel.lookbackWindow,
            poolSize: activeModel.poolSize,
            constraints: activeModel.constraints,
          }
        : null,
    ),
  );

  const evaluations = runs.map((run) => run.evaluation);
  const championEval = evaluations.find((evaluation) => evaluation.strategy === champion);

  let best = evaluations[0];
  for (const evaluation of evaluations.slice(1)) {
    if (isBetter(evaluation, best)) best = evaluation;
  }

  // Ties keep the incumbent, so equal engines never cause needless churn.
  const winner = championEval && !isBetter(best, championEval) ? championEval.strategy : best.strategy;
  const winnerRun = runs.find((run) => run.evaluation.strategy === winner)!;

  let promoted = false;
  if (winner !== champion) {
    await updateActiveModel(
      drawType,
      winnerRun.weights,
      winnerRun.lookbackWindow,
      winnerRun.constraints,
      winnerRun.evaluation.fourHitRate,
      winnerRun.evaluation.avgMainHits,
      winnerRun.evaluation.totalPredictions,
      { strategy: winner, poolSize: winnerRun.poolSize },
    );
    promoted = true;
  }

  const result: ShowdownResult = {
    drawType,
    evaluatedAt: new Date().toISOString(),
    latestDrawDate,
    window: {
      startDate: window.validationStartDate,
      endDate: window.validationEndDate,
      drawCount: window.validationDrawCount,
    },
    evaluations,
    champion,
    winner,
    promoted,
    detail: promoted
      ? `${STRATEGY_LABELS[winner]} outscored ${STRATEGY_LABELS[champion]} and is now the active engine`
      : `${STRATEGY_LABELS[winner]} remains the active engine (no engine performed better)`,
  };

  lastShowdowns.set(drawType, result);

  logger.info(
    {
      drawType,
      winner,
      champion,
      promoted,
      window: result.window,
      evaluations: evaluations.map((e) => ({
        strategy: e.strategy,
        fourHitRate: e.fourHitRate,
        avgMainHits: Number(e.avgMainHits.toFixed(4)),
        predictions: e.totalPredictions,
      })),
    },
    "Engine showdown: both engines evaluated, winner picked for the next draw",
  );

  return result;
  }