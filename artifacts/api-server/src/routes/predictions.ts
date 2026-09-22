/**
 * UK49s Predictions API Routes
 *
 * Handles prediction generation, retrieval, and history.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  generateAndStorePrediction,
  getLatestPrediction,
  getPredictionHistory,
  getActiveModel,
  getModelHistory,
} from "../lib/prediction-service";
import { logger } from "../lib/logger";
import { requireAdmin } from "../lib/admin-auth";
import { getStatsCutoff } from "../lib/stats-scope";

const router: IRouter = Router();

function validDrawType(value: string): value is "lunchtime" | "teatime" {
  return value === "lunchtime" || value === "teatime";
}

// Get active model for a draw type
router.get("/model/:drawType", async (req: Request, res: Response) => {
  const drawType = String(req.params.drawType);
  if (!validDrawType(drawType)) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  try {
    const model = await getActiveModel(drawType);

    if (!model) {
      res.status(404).json({ error: "No active model found" });
      return;
    }

    res.json({
      success: true,
      model: {
        id: model.id,
        drawType: model.drawType,
        version: model.version,
        status: model.status,
        weights: model.weights,
        lookbackWindow: model.lookbackWindow,
        constraints: model.constraints,
        trainingCutoff: model.trainingCutoff,
        validationMetrics: model.validation4HitRate !== null ? {
          fourHitRate: model.validation4HitRate,
          avgHits: model.validationAvgHits,
          sampleSize: model.validationSampleSize,
        } : null,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt,
      },
    });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get model");
    res.status(500).json({ success: false, error: "Failed to get model" });
  }
});

// Get model history
router.get("/model/:drawType/history", async (req: Request, res: Response) => {
  const drawType = String(req.params.drawType);
  if (!validDrawType(drawType)) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  try {
    const history = await getModelHistory(drawType);

    res.json({
      success: true,
      count: history.length,
      models: history.map((m) => ({
        id: m.id,
        version: m.version,
        status: m.status,
        weights: m.weights,
        lookbackWindow: m.lookbackWindow,
        constraints: m.constraints,
        validationMetrics: m.validation4HitRate !== null ? {
          fourHitRate: m.validation4HitRate,
          avgHits: m.validationAvgHits,
          sampleSize: m.validationSampleSize,
        } : null,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get model history");
    res.status(500).json({ success: false, error: "Failed to get model history" });
  }
});

// Generate new prediction
router.post("/generate", requireAdmin, async (req: Request, res: Response) => {
  const { drawType, predictionDate } = req.body ?? {};

  if (!validDrawType(String(drawType))) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  // Default to tomorrow for prediction date
  let targetDate: string;
  if (typeof predictionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(predictionDate)) {
    targetDate = predictionDate;
  } else {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    targetDate = tomorrow.toISOString().slice(0, 10);
  }

  try {
    const result = await generateAndStorePrediction(drawType, targetDate);

    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.json({
      success: true,
      prediction: result.prediction,
      warning: "These are statistical pattern predictions based on historical data. Lottery outcomes are random and cannot be guaranteed.",
    });
  } catch (error) {
    logger.error({ error, drawType, predictionDate }, "Failed to generate prediction");
    res.status(500).json({ success: false, error: "Failed to generate prediction" });
  }
});

// Get latest prediction
router.get("/latest/:drawType", async (req: Request, res: Response) => {
  const drawType = String(req.params.drawType);
  if (!validDrawType(drawType)) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  try {
    const prediction = await getLatestPrediction(drawType);

    if (!prediction) {
      res.status(404).json({ error: "No predictions found" });
      return;
    }

    res.json({
      success: true,
      prediction: {
        ...prediction,
        warning: "These are statistical pattern predictions based on historical data. Lottery outcomes are random and cannot be guaranteed.",
      },
    });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get latest prediction");
    res.status(500).json({ success: false, error: "Failed to get latest prediction" });
  }
});

// Get prediction history
router.get("/history/:drawType", async (req: Request, res: Response) => {
  const drawType = String(req.params.drawType);
  if (!validDrawType(drawType)) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

  try {
      // Only count predictions made by the current model, so results from a
      // previous model do not mix into the statistics.
      const statsSince = await getStatsCutoff(drawType);
      const predictions = await getPredictionHistory(drawType, limit, offset, statsSince);
  
      res.json({
        success: true,
        count: predictions.length,
        statsSince: statsSince ? statsSince.toISOString() : null,
        predictions: predictions.map((p) => ({
        ...p,
        warning: "These are statistical pattern predictions based on historical data. Lottery outcomes are random and cannot be guaranteed.",
      })),
    });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get prediction history");
    res.status(500).json({ success: false, error: "Failed to get prediction history" });
  }
});

export default router;
