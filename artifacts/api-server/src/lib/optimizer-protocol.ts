/**
 * Message protocol shared by the optimizer worker thread and the job runner.
 * Types only — no runtime code, so it is safe to import from both sides.
 */
import type {
  DiversityConstraints,
  FeatureWeights,
  OptimizerConfig,
  OptimizerResult,
  Uk49sDraw,
} from "@workspace/db/schema";

export interface OptimizerWorkerInput {
  draws: Uk49sDraw[];
  optimizerConfig: OptimizerConfig;
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
}

export type OptimizerWorkerMessage =
  | OptimizerWorkerProgressMessage
  | { type: "done"; result: OptimizerResult }
  | { type: "error"; message: string };