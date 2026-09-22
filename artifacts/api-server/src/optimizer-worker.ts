/**
 * Optimizer worker thread.
 *
 * Runs the EXISTING optimizeModel() search off the main event loop so the API
 * server stays responsive (progress polling, cancellation, other requests)
 * while hundreds of configurations are evaluated. The prediction algorithm,
 * feature engine, scoring and optimizer strategy are used exactly as-is — this
 * file only forwards progress and the final result back to the parent thread.
 */
import { parentPort, workerData } from "node:worker_threads";
import { optimizeModel } from "@workspace/db/schema";
import type { OptimizerWorkerInput, OptimizerWorkerMessage } from "./lib/optimizer-protocol";

const port = parentPort;

if (!port) {
  throw new Error("optimizer-worker must be started as a worker thread");
}

const { draws, optimizerConfig, searchOptions } = workerData as OptimizerWorkerInput;

function post(message: OptimizerWorkerMessage): void {
  port!.postMessage(message);
}

try {
  const result = optimizeModel(
    draws,
    optimizerConfig,
    (progress) => {
      post({
        type: "progress",
        iteration: progress.iteration,
        phase: progress.phase,
        best4HitRate: progress.bestResult ? progress.bestResult.validation4HitRate : null,
        bestAvgHits: progress.bestResult ? progress.bestResult.validationAvgHits : null,
        bestScore: Number.isFinite(progress.bestScore) ? progress.bestScore : null,
        currentLookbackWindow: progress.current.lookbackWindow,
        currentWeights: progress.current.weights,
        currentConstraints: progress.current.constraints,
        maxHits: progress.maxHits,
        fourHitCount: progress.fourHitCount,
        fourHitFound: progress.fourHitFound,
      });
    },
    searchOptions,
  );

  post({ type: "done", result });
} catch (error) {
  post({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}