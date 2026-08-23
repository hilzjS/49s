import { Router, type IRouter, type Request, type Response } from "express";
import { scrapeAll, scrapeAllYear, scrapeYear, type DrawType } from "../lib/uk49s-scraper";

const router: IRouter = Router();
const validDrawTypes = new Set<DrawType>(["lunchtime", "teatime"]);

function yearParam(value: string) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1997 || year > new Date().getUTCFullYear()) return null;
  return year;
}

function forceRefresh(value: unknown) {
  return value === true || value === "true" || value === "1";
}

router.get("/health", async (_req, res) => {
  const { getScraperHealth } = await import("../lib/uk49s-scraper");
  res.json(getScraperHealth());
});

router.get("/scrape/all", async (req, res) => {
  res.json(await scrapeAll(forceRefresh(req.query.forceRefresh)));
});

router.get("/scrape/all/:year", async (req, res) => {
  const year = yearParam(String(req.params.year));
  if (!year) return res.status(400).json({ error: "year must be a valid year from 1997 through the current year" });
  return res.json(await scrapeAllYear(year, forceRefresh(req.query.forceRefresh)));
});

router.get("/scrape/lunchtime/:year", async (req, res) => {
  return scrapeSingle("lunchtime", req, res);
});

router.get("/scrape/teatime/:year", async (req, res) => {
  return scrapeSingle("teatime", req, res);
});

router.get("/scrape/:drawType/:year", async (req, res) => {
  if (!validDrawTypes.has(req.params.drawType as DrawType)) return res.status(400).json({ error: "drawType must be lunchtime or teatime" });
  return scrapeSingle(req.params.drawType as DrawType, req, res);
});

async function scrapeSingle(drawType: DrawType, req: Request, res: Response) {
  const year = yearParam(String(req.params.year));
  if (!year) return res.status(400).json({ error: "year must be a valid year from 1997 through the current year" });
  return res.json(await scrapeYear(drawType, year, forceRefresh(req.query.forceRefresh)));
}

export default router;