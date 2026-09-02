/**
 * UK49s Data Ingestion Service
 * 
 * Handles scraping, validation, and database ingestion.
 * Ensures idempotent operations and duplicate prevention.
 */

import { db } from "@workspace/db";
import {
  uk49sDraws,
  uk49sScrapeRuns,
  insertUk49sDrawSchema,
  insertUk49sScrapeRunSchema,
  createDrawFromScrape,
  type DrawType,
  type InsertUk49sDraw,
  type InsertUk49sScrapeRun,
} from "@workspace/db/schema";
import { scrapeYear, scrapeAllYear, scrapeAll, type DrawResult, type ScrapeStats } from "./uk49s-scraper";
import { eq, and, count, desc } from "drizzle-orm";
import { logger } from "./logger";

export interface IngestionResult {
  success: boolean;
  drawType: DrawType;
  year: number;
  imported: number;
  skipped: number;
  rejected: number;
  errors: string[];
  scrapeRunId?: number;
}

export interface FullIngestionResult {
  success: boolean;
  lunchtime: IngestionResult;
  teatime: IngestionResult;
  totalImported: number;
  totalSkipped: number;
  totalRejected: number;
}

// Check if draw already exists
async function drawExists(drawDate: string, drawType: DrawType): Promise<boolean> {
  const existing = await db
    .select({ count: count() })
    .from(uk49sDraws)
    .where(and(eq(uk49sDraws.drawDate, drawDate), eq(uk49sDraws.drawType, drawType)));
  
  return (existing[0]?.count || 0) > 0;
}

// Validate draw data
function validateDraw(result: DrawResult): { valid: boolean; error?: string } {
  // Check main numbers count
  if (result.winning_numbers.length !== 6) {
    return { valid: false, error: `Expected 6 main numbers, got ${result.winning_numbers.length}` };
  }
  
  // Check booster ball range
  if (result.booster_ball < 1 || result.booster_ball > 49) {
    return { valid: false, error: `Booster ball out of range: ${result.booster_ball}` };
  }
  
  // Check main numbers range and uniqueness
  const mainSet = new Set<number>();
  for (const num of result.winning_numbers) {
    if (num < 1 || num > 49) {
      return { valid: false, error: `Main number out of range: ${num}` };
    }
    if (mainSet.has(num)) {
      return { valid: false, error: `Duplicate main number: ${num}` };
    }
    mainSet.add(num);
  }
  
  // Check booster is not in main numbers
  if (mainSet.has(result.booster_ball)) {
    return { valid: false, error: `Booster ball ${result.booster_ball} already in main numbers` };
  }
  
  return { valid: true };
}

// Ingest a single year's data
export async function ingestYear(
  drawType: DrawType,
  year: number,
  forceRefresh = false
): Promise<IngestionResult> {
  const result: IngestionResult = {
    success: false,
    drawType,
    year,
    imported: 0,
    skipped: 0,
    rejected: 0,
    errors: [],
  };
  
  try {
    logger.info({ drawType, year }, "Starting ingestion");
    
    // Create scrape run record
    const scrapeRunData: InsertUk49sScrapeRun = {
      drawType,
      year,
      sourceUrl: `https://uk.lottonumbers.com/uk49s-${drawType}/results/${year}`,
      success: false,
      fromCache: false,
    };
    
    const [scrapeRun] = await db.insert(uk49sScrapeRuns).values(scrapeRunData).returning();
    result.scrapeRunId = scrapeRun.id;
    
    // Scrape data
    const scrapeResponse = await scrapeYear(drawType, year, forceRefresh);
    
    // Update scrape run with results
    await db.update(uk49sScrapeRuns)
      .set({
        urlsRequested: scrapeResponse.stats.urlsRequested,
        recordsDiscovered: scrapeResponse.stats.recordsDiscovered,
        recordsAccepted: scrapeResponse.stats.recordsAccepted,
        duplicatesRemoved: scrapeResponse.stats.duplicatesRemoved,
        recordsRejected: scrapeResponse.stats.recordsRejected,
        parsingErrors: scrapeResponse.stats.parsingErrors,
        failedUrls: scrapeResponse.stats.failedUrls,
        validationErrors: scrapeResponse.stats.validationErrors,
        success: scrapeResponse.success,
        fromCache: scrapeResponse.stats.fromCache,
        completedAt: new Date(),
      })
      .where(eq(uk49sScrapeRuns.id, scrapeRun.id));
    
    // Process each draw result
    for (const drawResult of scrapeResponse.results) {
      // Validate
      const validation = validateDraw(drawResult);
      if (!validation.valid) {
        result.rejected++;
        result.errors.push(`${drawResult.draw_date}: ${validation.error}`);
        continue;
      }
      
      // Check for existing
      const exists = await drawExists(drawResult.draw_date, drawType);
      if (exists) {
        result.skipped++;
        continue;
      }
      
      // Create draw record
      try {
        const drawData = createDrawFromScrape(
          drawResult.draw_date,
          drawType,
          drawResult.winning_numbers,
          drawResult.booster_ball,
          scrapeResponse.source,
          scrapeRun.id
        );
        
        await db.insert(uk49sDraws).values(drawData);
        result.imported++;
      } catch (error) {
        result.rejected++;
        result.errors.push(`${drawResult.draw_date}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    result.success = result.errors.length === 0 && scrapeResponse.success;
    logger.info({ drawType, year, imported: result.imported, skipped: result.skipped, rejected: result.rejected }, "Ingestion complete");
    
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : "Unknown error");
    logger.error({ error, drawType, year }, "Ingestion failed");
  }
  
  return result;
}

// Ingest both Lunchtime and Teatime for a year
export async function ingestYearBoth(year: number, forceRefresh = false): Promise<FullIngestionResult> {
  const [lunchResult, teaResult] = await Promise.all([
    ingestYear("lunchtime", year, forceRefresh),
    ingestYear("teatime", year, forceRefresh),
  ]);
  
  return {
    success: lunchResult.success && teaResult.success,
    lunchtime: lunchResult,
    teatime: teaResult,
    totalImported: lunchResult.imported + teaResult.imported,
    totalSkipped: lunchResult.skipped + teaResult.skipped,
    totalRejected: lunchResult.rejected + teaResult.rejected,
  };
}

// Ingest all available years
export async function ingestAllYears(forceRefresh = false): Promise<FullIngestionResult> {
  const currentYear = new Date().getUTCFullYear();
  const results: FullIngestionResult[] = [];
  
  for (let year = 2015; year <= currentYear; year++) {
    const result = await ingestYearBoth(year, forceRefresh);
    results.push(result);
    
    // Add small delay between years to be respectful to source
    if (year < currentYear) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return {
    success: results.every(r => r.success),
    lunchtime: combineResults(results.map(r => r.lunchtime)),
    teatime: combineResults(results.map(r => r.teatime)),
    totalImported: results.reduce((sum, r) => sum + r.totalImported, 0),
    totalSkipped: results.reduce((sum, r) => sum + r.totalSkipped, 0),
    totalRejected: results.reduce((sum, r) => sum + r.totalRejected, 0),
  };
}

// Ingest year range
export async function ingestYearRange(
  startYear: number,
  endYear: number,
  drawType?: DrawType,
  forceRefresh = false
): Promise<FullIngestionResult | IngestionResult[]> {
  if (drawType) {
    const results: IngestionResult[] = [];
    for (let year = startYear; year <= endYear; year++) {
      const result = await ingestYear(drawType, year, forceRefresh);
      results.push(result);
    }
    return results;
  }
  
  const results: FullIngestionResult[] = [];
  for (let year = startYear; year <= endYear; year++) {
    const result = await ingestYearBoth(year, forceRefresh);
    results.push(result);
  }
  
  return {
    success: results.every(r => r.success),
    lunchtime: combineResults(results.map(r => r.lunchtime)),
    teatime: combineResults(results.map(r => r.teatime)),
    totalImported: results.reduce((sum, r) => sum + r.totalImported, 0),
    totalSkipped: results.reduce((sum, r) => sum + r.totalSkipped, 0),
    totalRejected: results.reduce((sum, r) => sum + r.totalRejected, 0),
  };
}

function combineResults(results: IngestionResult[]): IngestionResult {
  return {
    success: results.every(r => r.success),
    drawType: results[0]?.drawType || "lunchtime",
    year: results[0]?.year || 0,
    imported: results.reduce((sum, r) => sum + r.imported, 0),
    skipped: results.reduce((sum, r) => sum + r.skipped, 0),
    rejected: results.reduce((sum, r) => sum + r.rejected, 0),
    errors: results.flatMap(r => r.errors),
    scrapeRunId: results[results.length - 1]?.scrapeRunId,
  };
}

// Update latest draws only (for daily updates)
export async function updateLatestDraws(): Promise<FullIngestionResult> {
  const currentYear = new Date().getUTCFullYear();
  return ingestYearBoth(currentYear, false);
}

// Get data summary
export interface DataSummary {
  drawType: DrawType;
  totalDraws: number;
  earliestDate: string | null;
  latestDate: string | null;
  yearCounts: { year: number; count: number }[];
  missingDates: string[];
  duplicateCount: number;
  validationErrors: number;
}

export async function getDataSummary(drawType: DrawType): Promise<DataSummary> {
  // Get all draws for this type
  const draws = await db
    .select()
    .from(uk49sDraws)
    .where(eq(uk49sDraws.drawType, drawType))
    .orderBy(uk49sDraws.drawDate);
  
  // Count by year
  const yearCounts = new Map<number, number>();
  for (const draw of draws) {
    const year = parseInt(draw.drawDate.substring(0, 4));
    yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
  }
  
  // Find missing dates (simplified - check for gaps)
  const missingDates: string[] = [];
  if (draws.length > 1) {
    for (let i = 1; i < draws.length; i++) {
      const prevDate = new Date(draws[i - 1].drawDate);
      const currDate = new Date(draws[i].drawDate);
      const diffDays = Math.floor((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // If more than 3 days gap, might be missing data (excluding weekends)
      if (diffDays > 3) {
        // This is a rough check - real implementation would check calendar
        const avgDaysBetweenDraws = draws.length > 100 ? 365 / (draws.length / new Date().getFullYear()) : 2;
        if (diffDays > avgDaysBetweenDraws * 2) {
          missingDates.push(`${draws[i - 1].drawDate} to ${draws[i].drawDate}`);
        }
      }
    }
  }
  
  // Get scrape run stats
  const scrapeRuns = await db
    .select()
    .from(uk49sScrapeRuns)
    .where(eq(uk49sScrapeRuns.drawType, drawType))
    .orderBy(uk49sScrapeRuns.completedAt);
  
  const validationErrors = scrapeRuns.reduce(
    (sum, run) => sum + (run.validationErrors?.length || 0),
    0
  );
  
  return {
    drawType,
    totalDraws: draws.length,
    earliestDate: draws[0]?.drawDate || null,
    latestDate: draws[draws.length - 1]?.drawDate || null,
    yearCounts: Array.from(yearCounts.entries())
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
    missingDates,
    duplicateCount: scrapeRuns.reduce((sum, run) => sum + (run.duplicatesRemoved || 0), 0),
    validationErrors,
  };
}

// Get latest draws
export async function getLatestDraws(
  drawType: DrawType,
  limit = 10
): Promise<typeof uk49sDraws.$inferSelect[]> {
  const rows = await db
    .select()
    .from(uk49sDraws)
    .where(eq(uk49sDraws.drawType, drawType))
    .orderBy(desc(uk49sDraws.drawDate))
    .limit(limit);
  // Return chronological order for display
  return rows.reverse();
}

// Get draws in date range
export async function getDrawsInRange(
  drawType: DrawType,
  startDate: string,
  endDate: string
): Promise<typeof uk49sDraws.$inferSelect[]> {
  return db
    .select()
    .from(uk49sDraws)
    .where(and(
      eq(uk49sDraws.drawType, drawType),
    ))
    .orderBy(uk49sDraws.drawDate);
}
