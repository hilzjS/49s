/**
 * Stats scoping — "clear the stats from before".
 *
 * Applying an optimized configuration inserts a new active model with a fresh
 * `createdAt`. From that moment on, predictions and backtests are produced by a
 * different model than everything before it, so mixing the two in the same
 * statistics is misleading.
 *
 * Performance statistics therefore only count rows created on or after the
 * active model's activation time. This is deliberately NON-DESTRUCTIVE: no row
 * is deleted, archived or modified — only what the statistics *count* changes,
 * and the raw history stays available in the database.
 */
import type { DrawType } from "@workspace/db/schema";
import { getActiveModel } from "./prediction-service";
import { logger } from "./logger";

/**
 * Timestamp from which performance statistics count for a draw type. Returns
 * null when there is no active model, in which case statistics are not scoped.
 */
export async function getStatsCutoff(drawType: DrawType): Promise<Date | null> {
  try {
    const model = await getActiveModel(drawType);
    return model ? model.createdAt : null;
  } catch (error) {
    // Scoping must never break a read endpoint — fall back to unscoped stats.
    logger.error({ error, drawType }, "Failed to resolve the stats cutoff for the active model");
    return null;
  }
}