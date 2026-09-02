/**
 * UK49s Data API Routes
 * 
 * Handles data ingestion, summary, and retrieval.
 */

import { Router, type IRouter } from "express";
import {
  ingestYear,
  ingestYearBoth,
  ingestAllYears,
  ingestYearRange,
  getDataSummary,
  getLatestDraws,
  updateLatestDraws,
  type IngestionResult,
  type FullIngestionResult,
} from "../lib/ingestion-service";
import { db } from "@workspace/db";
import { uk49sDraws, uk49sScrapeRuns } from "@workspace/db/schema";
import { eq, and, count, desc, asc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "../lib/admin-auth";

const router: IRouter = Router();

// Data summary endpoint
router.get("/summary", async (_req, res) => {
  try {
    const [lunchSummary, teaSummary] = await Promise.all([
      getDataSummary("lunchtime"),
      getDataSummary("teatime"),
    ]);
    
    res.json({
      success: true,
      lunchtime: lunchSummary,
      teatime: teaSummary,
      totalLunchDraws: lunchSummary.totalDraws,
      totalTeaDraws: teaSummary.totalDraws,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get data summary");
    res.status(500).json({ success: false, error: "Failed to get data summary" });
  }
});

// Latest draws endpoint
router.get("/latest/:drawType", async (req, res) => {
  const drawType = req.params.drawType;
  if (drawType !== "lunchtime" && drawType !== "teatime") {
    res.status(400).json({ error: "drawType must be 'lunchtime' or 'teatime'" }); return;
  }
  
  const limit = Math.min(parseInt(String(req.query.limit || "10")), 100);
  
  try {
    const draws = await getLatestDraws(drawType as "lunchtime" | "teatime", limit);
    
    res.json({
      success: true,
      drawType,
      count: draws.length,
      draws: draws.map(d => ({
        drawDate: d.drawDate,
        mainNumbers: [d.mainNumber1, d.mainNumber2, d.mainNumber3, d.mainNumber4, d.mainNumber5, d.mainNumber6],
        boosterBall: d.boosterBall,
        validationStatus: d.validationStatus,
        sourceUrl: d.sourceUrl,
      })),
    });
  } catch (error) {
    logger.error({ error, drawType }, "Failed to get latest draws");
    res.status(500).json({ success: false, error: "Failed to get latest draws" });
  }
});

// Ingest endpoint
router.post("/ingest", requireAdmin, async (req, res) => {
  const { drawType, year, startYear, endYear, forceRefresh } = req.body;
  
  try {
    let result: FullIngestionResult | IngestionResult[];
    
    if (year) {
      if (drawType && drawType !== "both") {
        const singleResult = await ingestYear(drawType, year, forceRefresh);
        res.json(singleResult); return;
      }
      result = await ingestYearBoth(year, forceRefresh);
    } else if (startYear && endYear) {
      result = await ingestYearRange(startYear, endYear, drawType === "both" ? undefined : drawType, forceRefresh);
    } else if (drawType === "latest") {
      result = await updateLatestDraws();
    } else {
      // Ingest all from 2015
      result = await ingestAllYears(forceRefresh);
    }
    
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error({ error }, "Ingestion failed");
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Ingestion failed" });
  }
});

// Scrape run history
router.get("/scrape-runs", async (req, res) => {
  const drawType = req.query.drawType as string | undefined;
  const limit = Math.min(parseInt(String(req.query.limit || "50")), 200);
  
  try {
    const whereClause = drawType 
      ? eq(uk49sScrapeRuns.drawType, drawType as "lunchtime" | "teatime")
      : undefined;
    
    const runs = await db
      .select()
      .from(uk49sScrapeRuns)
      .where(whereClause)
      .orderBy(desc(uk49sScrapeRuns.completedAt))
      .limit(limit);
    
    res.json({
      success: true,
      count: runs.length,
      scrapeRuns: runs.map(r => ({
        id: r.id,
        drawType: r.drawType,
        year: r.year,
        sourceUrl: r.sourceUrl,
        urlsRequested: r.urlsRequested,
        recordsDiscovered: r.recordsDiscovered,
        recordsAccepted: r.recordsAccepted,
        duplicatesRemoved: r.duplicatesRemoved,
        recordsRejected: r.recordsRejected,
        parsingErrors: r.parsingErrors,
        failedUrls: r.failedUrls,
        validationErrors: r.validationErrors,
        success: r.success,
        fromCache: r.fromCache,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      })),
    });
  } catch (error) {
    logger.error({ error }, "Failed to get scrape runs");
    res.status(500).json({ success: false, error: "Failed to get scrape runs" });
  }
});

// Data quality check
router.get("/quality", async (req, res) => {
  try {
    // Get counts by validation status
    const lunchCounts = await db
      .select({ status: uk49sDraws.validationStatus, count: count() })
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, "lunchtime"))
      .groupBy(uk49sDraws.validationStatus);
    
    const teaCounts = await db
      .select({ status: uk49sDraws.validationStatus, count: count() })
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, "teatime"))
      .groupBy(uk49sDraws.validationStatus);
    
    // Get total counts
    const [lunchTotal] = await db
      .select({ count: count() })
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, "lunchtime"));
    
    const [teaTotal] = await db
      .select({ count: count() })
      .from(uk49sDraws)
      .where(eq(uk49sDraws.drawType, "teatime"));
    
    res.json({
      success: true,
      lunchDraws: {
        total: lunchTotal?.count || 0,
        byStatus: lunchCounts.reduce((acc, c) => ({ ...acc, [c.status]: c.count }), {}),
      },
      teaDraws: {
        total: teaTotal?.count || 0,
        byStatus: teaCounts.reduce((acc, c) => ({ ...acc, [c.status]: c.count }), {}),
      },
    });
  } catch (error) {
    logger.error({ error }, "Data quality check failed");
    res.status(500).json({ success: false, error: "Data quality check failed" });
  }
});

// Export data
router.get("/export", async (req, res) => {
  const drawType = req.query.drawType as string | undefined;
  const format = req.query.format as string || "json";
  
  try {
    const whereClause = drawType
      ? eq(uk49sDraws.drawType, drawType as "lunchtime" | "teatime")
      : undefined;
    
    const draws = await db
      .select()
      .from(uk49sDraws)
      .where(whereClause)
      .orderBy(uk49sDraws.drawDate);
    
    if (format === "csv") {
      const header = "draw_date,draw_type,main1,main2,main3,main4,main5,main6,booster\n";
      const rows = draws.map(d =>
        `${d.drawDate},${d.drawType},${d.mainNumber1},${d.mainNumber2},${d.mainNumber3},${d.mainNumber4},${d.mainNumber5},${d.mainNumber6},${d.boosterBall}`
      ).join("\n");
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=uk49s-draws.csv");
      res.send(header + rows);
      return;
    }
    
    res.json({
      success: true,
      count: draws.length,
      draws: draws.map(d => ({
        drawDate: d.drawDate,
        drawType: d.drawType,
        mainNumbers: [d.mainNumber1, d.mainNumber2, d.mainNumber3, d.mainNumber4, d.mainNumber5, d.mainNumber6],
        boosterBall: d.boosterBall,
      })),
    });
  } catch (error) {
    logger.error({ error }, "Export failed");
    res.status(500).json({ success: false, error: "Export failed" });
  }
});

export default router;
