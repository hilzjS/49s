/**
 * Message protocol shared by the optimizer worker thread and the job runner.
 * Types only — no runtime code, so it is safe to import from both sides.
 */
import type {
  DiversityConstraints,
  FeatureWeights,
  OptimizerConfig,
  OptimizerResult,
  OptimizerSearchOptions,
  Uk49sDraw,
} from "@workspace/db/schema";

export interface OptimizerWorkerInput {
  draws: Uk49sDraw[];
  optimizerConfig: OptimizerConfig;
  /** Search control only: configuration cap and the 4-hit stop condition. */
  searchOptions?: OptimizerSearchOptions;
}

export interface OptimizerWorkerProgressMessage {
  type: "progress";
  /**
   * The engine's iteration label. Note it restarts for each elite
   * configuration in the hill-climbing phase, so the job manager counts actual
   * evaluations itself rather than trusting this as a running total.
   */
  iteration: number;
  phase: "random-search" | "hill-climbing";
  best4HitRate: number | null;
  bestAvgHits: number | null;
  bestScore: number | null;
  currentLookbackWindow: number;
  currentWeights: FeatureWeights;
  currentConstraints: DiversityConstraints;
  /** Best single-prediction hit count seen so far. */
  maxHits: number;
  /** Configurations that produced at least one exact 4-hit prediction. */
  fourHitCount: number;
  /** Whether a valid 4-hit historical validation result has been found. */
  fourHitFound: boolean;
}

export type OptimizerWorkerMessage =
  | OptimizerWorkerProgressMessage
  | { type: "done"; result: OptimizerResult }
  | { type: "error"; message: string };
