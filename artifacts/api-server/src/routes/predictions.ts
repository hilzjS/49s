/**
 * UK49s Predictions API Routes
 *
 * Handles prediction generation, retrieval and history using the single engine.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  generateAndStorePrediction,
  getLatestPrediction,
  getPredictionHistory,
  getActiveModel,
  getModelHistory,
  getNextPredictionDate,
} from "../lib/prediction-service";
import { DEFAULT_WEIGHTS, MAIN_COUNT } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { requireAdmin } from "../lib/admin-auth";
import { getStatsCutoff } from "../lib/stats-scope";

const router: IRouter = Router();

function validDrawType(value: string): value is "lunchtime" | "teatime" {
  return value === "lunchtime" || value === "teatime";
}

const WARNING =
  "These are statistical pattern predictions based on historical data. Lottery outcomes are random and cannot be guaranteed.";

/** Serialises the engine's model/champion state for the client. */
function modelPayload(model: Awaited<ReturnType<typeof getActiveModel>>) {
  if (!model) {
    return {
      id: null,
      drawType: null,
      version: "defaults",
      weights: DEFAULT_WEIGHTS,
      threePlusCount: null,
      avgHitsPerLine: null,
      candidatesTested: null,
      targetMet: false,
      createdAt: null,
      updatedAt: null,
    };
  }
  return model;
}

// Get active model (locked champion) for a draw type
router.get("/model/:drawType", async (req: Request, res: Response) => {
  const drawType = String(req.params.drawType);
  if (!validDrawType(drawType)) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  try {
    const model = await getActiveModel(drawType);
    res.json({ success: true, model: modelPayload(model) });
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
    res.json({ success: true, count: history.length, models: history });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get model history");
    res.status(500).json({ success: false, error: "Failed to get model history" });
  }
});

// Generate a new prediction
router.post("/generate", requireAdmin, async (req: Request, res: Response) => {
  const { drawType, predictionDate } = req.body ?? {};

  if (!validDrawType(String(drawType))) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  try {
    /**
     * Default to the next draw that has not been recorded yet (the day after the
     * latest stored draw) — NOT `now + 1 day`, which would let a prediction skip
     * a draw whose result is missing.
     */
    let targetDate: string;
    if (typeof predictionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(predictionDate)) {
      targetDate = predictionDate;
    } else {
      const nextDate = await getNextPredictionDate(drawType);
      if (!nextDate) {
        res.status(400).json({ success: false, error: `No ${drawType} draws recorded yet — nothing to predict from.` });
        return;
      }
      targetDate = nextDate;
    }

    const result = await generateAndStorePrediction(drawType, targetDate);

    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, prediction: result.prediction, warning: WARNING });
  } catch (error) {
    logger.error({ error, drawType, predictionDate }, "Failed to generate prediction");
    res.status(500).json({ success: false, error: "Failed to generate prediction" });
  }
});

// Latest prediction
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
    res.json({ success: true, prediction: { ...prediction, warning: WARNING } });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get latest prediction");
    res.status(500).json({ success: false, error: "Failed to get latest prediction" });
  }
});

// Prediction history
router.get("/history/:drawType", async (req: Request, res: Response) => {
  const drawType = String(req.params.drawType);
  if (!validDrawType(drawType)) {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" });
    return;
  }

  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10) || 0;

  try {
    // Only count predictions made by the current model.
    const statsSince = await getStatsCutoff(drawType);
    const predictions = await getPredictionHistory(drawType, limit, offset, statsSince);

    res.json({
      success: true,
      count: predictions.length,
      lineSize: MAIN_COUNT,
      statsSince: statsSince ? statsSince.toISOString() : null,
      predictions: predictions.map((p) => ({ ...p, warning: WARNING })),
    });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get prediction history");
    res.status(500).json({ success: false, error: "Failed to get prediction history" });
  }
});

export default router;
